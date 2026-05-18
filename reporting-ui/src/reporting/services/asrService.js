/**
 * ASR WebSocket Service
 * 
 * Manages the Deepgram WebSocket connection via the Express relay server.
 * Handles MediaRecorder audio streaming, interim/final result parsing,
 * and auto-reconnection with exponential backoff.
 */

// Connection state
let socket = null;
let mediaRecorder = null;
let audioStream = null;
let isRecording = false;
let isConnecting = false;
let pendingAudioChunks = [];
let reconnectAttempts = 0;
let reconnectTimer = null;
let callbacks = null;
let currentVendor = 'speechmatics';

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_BUFFER_SIZE = 60; // ~15s at 250ms chunks

/**
 * Extract transcript text from a Deepgram result message.
 * Handles both direct and nested response shapes.
 */
function extractTranscript(msg) {
  if (!msg || typeof msg !== 'object') return '';

  // Deepgram sends { channel: { alternatives: [{ transcript }] } }
  const t1 = msg?.channel?.alternatives?.[0]?.transcript;
  if (typeof t1 === 'string') return t1;

  // Fallback shapes
  const t2 = msg?.alternatives?.[0]?.transcript;
  if (typeof t2 === 'string') return t2;

  if (typeof msg.transcript === 'string') return msg.transcript;

  return '';
}

/**
 * Check if a Deepgram message is a final (not interim) result.
 */
function isFinalMessage(msg) {
  return msg?.is_final === true;
}

/**
 * Start ASR recording and streaming.
 * @param {string} region - ASR keyword biasing region (e.g. 'head')
 * @param {object} cbs - Callback object { onInterim, onFinal, onStatus, onError }
 */
export async function start(region = 'head', cbs = {}, vendor = 'speechmatics') {
  if (isRecording || isConnecting) return;

  callbacks = cbs;
  isConnecting = true;
  reconnectAttempts = 0;
  pendingAudioChunks = [];
  currentVendor = vendor;

  notify('status', 'connecting');

  try {
    // Request microphone access with timeout failsafe.
    // getUserMedia can hang indefinitely if the OS audio subsystem is
    // unresponsive (e.g., Windows Audio Endpoint Builder stuck). The
    // timeout ensures the UI shows an actionable error instead of
    // staying stuck at "Connecting…" forever.
    const gumPromise = navigator.mediaDevices.getUserMedia({ audio: true });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Microphone access timed out. Try restarting your browser or check system audio settings.')), 5000)
    );
    audioStream = await Promise.race([gumPromise, timeoutPromise]);

    // Start MediaRecorder immediately to capture early speech
    startMediaRecorder();

    // Open WebSocket to the Express relay
    openWebSocket(region);
  } catch (err) {
    isConnecting = false;
    console.error('[ASR] getUserMedia failed:', err);

    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      notify('status', 'error');
      notify('error', { message: 'Microphone permission denied. Please allow mic access in your browser settings.' });
    } else {
      notify('status', 'error');
      notify('error', { message: `Microphone error: ${err.message}` });
    }
  }
}

/**
 * Stop ASR recording and close all connections.
 */
export function stop() {
  clearReconnectTimer();
  isRecording = false;
  isConnecting = false;
  reconnectAttempts = 0;
  pendingAudioChunks = [];

  // Stop MediaRecorder
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch { /* ignore */ }
  }
  mediaRecorder = null;

  // Close WebSocket
  if (socket) {
    try { socket.close(1000, 'User stopped'); } catch { /* ignore */ }
    socket = null;
  }

  // Release audio stream
  if (audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }

  notify('status', 'idle');
}

/**
 * Force-finalize the current Deepgram utterance.
 * Sends the Finalize control message which makes Deepgram immediately
 * produce an is_final result for all buffered audio. The stream continues
 * afterward for the next utterance. This creates a clean split between
 * pre-boundary and post-boundary speech.
 */
export function finalize() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({ type: 'Finalize' }));
      console.log('[ASR] Sent Finalize control message');
    } catch (err) {
      console.warn('[ASR] Failed to send Finalize:', err);
    }
  }
}

/**
 * Check if currently recording.
 */
export function getIsRecording() {
  return isRecording;
}

// ---- Internal helpers ----

function notify(type, data) {
  if (!callbacks) return;
  const key = `on${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  if (typeof callbacks[key] === 'function') {
    try { callbacks[key](data); } catch (e) { console.warn('[ASR] callback error:', e); }
  }
}

function startMediaRecorder() {
  if (!audioStream) return;

  mediaRecorder = new MediaRecorder(audioStream);

  mediaRecorder.ondataavailable = (event) => {
    if (!event.data || event.data.size <= 0) return;

    // If WebSocket is open, stream immediately; otherwise queue
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(event.data); } catch { /* ignore */ }
    } else {
      pendingAudioChunks.push(event.data);

      // Cap buffer to prevent memory growth
      if (pendingAudioChunks.length > MAX_BUFFER_SIZE) {
        pendingAudioChunks.shift();
      }
    }
  };

  // 250ms chunks
  mediaRecorder.start(250);
}

function openWebSocket(region) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws/dictation?vendor=${encodeURIComponent(currentVendor)}&region=${encodeURIComponent(region || 'head')}`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    isConnecting = false;
    isRecording = true;
    reconnectAttempts = 0;

    notify('status', 'listening');

    // Flush buffered audio chunks
    const queued = pendingAudioChunks;
    pendingAudioChunks = [];
    for (const chunk of queued) {
      try {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(chunk);
        }
      } catch { /* ignore */ }
    }
  };

  socket.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    const transcript = extractTranscript(msg);
    if (!transcript) return;

    if (isFinalMessage(msg)) {
      notify('final', transcript);
    } else {
      notify('interim', transcript);
    }
  };

  socket.onclose = (event) => {
    console.log('[ASR] WebSocket closed:', event.code, event.reason);

    // If user intentionally stopped, don't reconnect
    if (!isRecording && !isConnecting) return;

    // Unexpected close — attempt reconnect
    attemptReconnect(region);
  };

  socket.onerror = (err) => {
    console.error('[ASR] WebSocket error:', err);
  };
}

function attemptReconnect(region) {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn('[ASR] Max reconnect attempts reached. Stopping.');
    stop();
    notify('error', { message: 'Lost connection to dictation server. Please toggle microphone to retry.' });
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 8000);
  console.log(`[ASR] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

  notify('status', 'reconnecting');

  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isRecording) return;

    // Re-open WebSocket (MediaRecorder may still be running from the same stream)
    openWebSocket(region);
  }, delay);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export default { start, stop, finalize, getIsRecording };
