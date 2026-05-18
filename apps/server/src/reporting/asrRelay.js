/**
 * ASR WebSocket Relay — Extracted Module
 *
 * Handles the WebSocket upgrade for /ws/dictation and relays audio
 * between the client browser and the upstream ASR vendor (Deepgram
 * or Speechmatics). Normalizes vendor-specific response formats to
 * a common Deepgram-like shape for the client.
 *
 * Punctuation-only transcripts (e.g., isolated "." from Speechmatics)
 * are filtered at the relay level before reaching the client.
 */

import WebSocket, { WebSocketServer } from 'ws';
import { createClient } from '@deepgram/sdk';

// Load config from env
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';
const SPEECHMATICS_API_KEY = process.env.SPEECHMATICS_API_KEY || '';
const SPEECHMATICS_WS_URL = process.env.SPEECHMATICS_WS_URL || 'wss://eu2.rt.speechmatics.com/v2';

const deepgram = DEEPGRAM_API_KEY ? createClient(DEEPGRAM_API_KEY) : null;

/**
 * Check if a transcript contains any alphanumeric characters.
 * Used to filter punctuation-only ASR outputs (e.g., isolated ".").
 */
function hasAlphanumeric(text) {
  return /[a-zA-Z0-9]/.test(text);
}

/**
 * Voice command trigger words for ASR keyword biasing.
 * These unique words appear in the voice command registry's trigger sequences.
 * Adding them to the ASR keyword/vocab list helps ensure the ASR engine
 * accurately transcribes command phrases.
 *
 * Maintained as a static list on the server side to mirror the client-side
 * voiceCommandRegistry.js. Update this list when new commands are added.
 */
const VOICE_COMMAND_KEYWORDS = [
  'next', 'previous', 'field', 'advance', 'skip', 'prior', 'box',
  'go', 'dictation', 'back', 'last', 'mic', 'off', 'macro', 'undo', 'redo',
  'highlight', 'replace', 'delete', 'insert', 'new', 'paragraph', 'line',
  'start', 'end', 'dot',
];

/**
 * Deepgram boost value for voice command keywords.
 * Intentionally very low to avoid the ASR inappropriately returning
 * these words in normal dictation. Speechmatics does not support
 * per-word bias weights (additional_vocab has no weight parameter).
 */
const VOICE_CMD_DEEPGRAM_BOOST = 0.05;

/**
 * Attach the ASR WebSocket relay to an HTTP server.
 * @param {import('http').Server} httpServer - The HTTP server to attach to
 * @param {object} asrLists - Keyword lists keyed by region (e.g., { head: [...] })
 */
export function attachAsrRelay(httpServer, asrLists) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/dictation' });

  wss.on('error', (err) => {
    console.error('[wss] WebSocketServer error (non-fatal):', err.message || err);
  });

  wss.on('connection', (ws, req) => {
    ws.on('error', (err) => {
      console.error('[ws] Client WebSocket error:', err.message || err);
    });

    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const vendor = (urlParams.get('vendor') || 'speechmatics').toLowerCase();
    const regionParam = (urlParams.get('region') || '').toLowerCase();

    console.log(`[ws] Client connected — vendor: ${vendor}, region: ${regionParam}`);

    if (vendor === 'speechmatics') {
      handleSpeechmatics(ws, regionParam, asrLists);
    } else {
      handleDeepgram(ws, regionParam, asrLists);
    }
  });

  return wss;
}

// ─── Deepgram Handler ────────────────────────────────────────────────

function handleDeepgram(ws, regionParam, asrLists) {
  let rawKeywords = asrLists[regionParam] || [];
  if (rawKeywords.length > 100) {
    console.warn(`[deepgram] Region "${regionParam}" has ${rawKeywords.length} keywords. Truncating to 100.`);
    rawKeywords = rawKeywords.slice(0, 100);
  }
  // Medical keywords at standard boost
  const keywords = rawKeywords.map(k => `${k}:0.3`);

  // Merge voice command keywords at minimal boost (deduplicate against medical list)
  const existingLower = new Set(rawKeywords.map(k => k.toLowerCase()));
  for (const vcWord of VOICE_COMMAND_KEYWORDS) {
    if (!existingLower.has(vcWord.toLowerCase())) {
      keywords.push(`${vcWord}:${VOICE_CMD_DEEPGRAM_BOOST}`);
    }
  }

  if (keywords.length > 0) {
    console.log(`[deepgram] ${keywords.length} keywords loaded (medical=0.3, voice_cmd=${VOICE_CMD_DEEPGRAM_BOOST}) for region: "${regionParam}" (NOTE: not sent — Nova-3 does not support keywords)`);
  }

  if (!deepgram) {
    console.warn('[deepgram] Client not configured (missing DEEPGRAM_API_KEY)');
    ws.close(1011, 'Deepgram not configured');
    return;
  }

  let deepgramLive = null;
  let messageBuffer = [];

  try {
    console.log('[deepgram] Initializing live connection...');
    deepgramLive = deepgram.listen.live({
      model: 'nova-3',
      punctuate: false,
      smart_format: false,
      interim_results: true,
      language: 'en',
    });

    deepgramLive.on('Open', () => {
      console.log('[deepgram] Connection open. Flushing buffer:', messageBuffer.length);
      while (messageBuffer.length > 0) {
        const chunk = messageBuffer.shift();
        deepgramLive.send(chunk);
      }
    });

    deepgramLive.on('Results', (data) => {
      // Filter punctuation-only results from Deepgram too
      const transcript = data?.channel?.alternatives?.[0]?.transcript || '';
      if (transcript && !hasAlphanumeric(transcript)) {
        console.log('[deepgram] Discarding punctuation-only result:', JSON.stringify(transcript));
        return;
      }
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(data));
      }
    });

    deepgramLive.on('Metadata', () => {
      console.log('[deepgram] Metadata received');
    });

    deepgramLive.on('Close', () => {
      console.log('[deepgram] Connection closed');
    });

    deepgramLive.on('Error', (err) => {
      console.error('[deepgram] Error:', err?.message || err);
      if (ws.readyState === 1) {
        ws.close(1011, 'Deepgram error');
      }
    });

    if (deepgramLive?.conn) {
      deepgramLive.conn.on?.('error', (err) => {
        console.error('[deepgram] Connection-level error:', err?.message || err);
      });
    }

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'Finalize' && deepgramLive) {
            console.log('[deepgram] Received Finalize control message');
            deepgramLive.finalize();
            return;
          }
        } catch { /* Not valid JSON, fall through */ }
      }

      if (deepgramLive && deepgramLive.getReadyState() === 1) {
        deepgramLive.send(data);
      } else {
        messageBuffer.push(data);
        if (messageBuffer.length > 500) {
          messageBuffer.shift();
        }
      }
    });

    ws.on('close', () => {
      console.log('[deepgram] Client disconnected');
      if (deepgramLive) {
        try { deepgramLive.finish(); } catch (e) { console.error('[deepgram] Error finishing:', e); }
        deepgramLive = null;
      }
      messageBuffer = [];
    });

  } catch (err) {
    console.error('[deepgram] Failed to init live:', err);
    ws.close(1011, 'Deepgram init failed');
  }
}

// ─── Speechmatics Handler ────────────────────────────────────────────

function handleSpeechmatics(ws, regionParam, asrLists) {
  if (!SPEECHMATICS_API_KEY) {
    console.warn('[speechmatics] API key not configured (missing SPEECHMATICS_API_KEY)');
    ws.close(1011, 'Speechmatics not configured');
    return;
  }

  // Build additional_vocab from ASR keyword lists (up to 1000 entries)
  let rawKeywords = asrLists[regionParam] || [];
  if (rawKeywords.length > 1000) {
    console.warn(`[speechmatics] Region "${regionParam}" has ${rawKeywords.length} keywords. Truncating to 1000.`);
    rawKeywords = rawKeywords.slice(0, 1000);
  }
  const additionalVocab = rawKeywords.map(k => ({ content: k }));

  // Merge voice command keywords into additional_vocab (deduplicate)
  // Speechmatics has no per-word bias weight — the engine manages weighting internally.
  const existingLower = new Set(rawKeywords.map(k => k.toLowerCase()));
  for (const vcWord of VOICE_COMMAND_KEYWORDS) {
    if (!existingLower.has(vcWord.toLowerCase())) {
      additionalVocab.push({ content: vcWord });
    }
  }

  if (additionalVocab.length > 0) {
    const medCount = rawKeywords.length;
    const vcCount = additionalVocab.length - medCount;
    console.log(`[speechmatics] Using ${additionalVocab.length} additional_vocab entries (${medCount} medical + ${vcCount} voice_cmd) for region: "${regionParam}"`);
  }

  let smWs = null;
  let smReady = false;
  let audioBuffer = [];

  try {
    console.log(`[speechmatics] Connecting to ${SPEECHMATICS_WS_URL}...`);

    smWs = new WebSocket(SPEECHMATICS_WS_URL, {
      headers: {
        'Authorization': `Bearer ${SPEECHMATICS_API_KEY}`,
      },
    });

    smWs.on('open', () => {
      console.log('[speechmatics] WebSocket connected. Sending StartRecognition...');

      const startMsg = {
        message: 'StartRecognition',
        audio_format: {
          type: 'file',
        },
        transcription_config: {
          language: 'en',
          operating_point: 'enhanced',
          enable_partials: true,
          max_delay: 1.0,
          punctuation_overrides: { permitted_marks: [] },
          ...(additionalVocab.length > 0 ? { additional_vocab: additionalVocab } : {}),
        },
      };
      smWs.send(JSON.stringify(startMsg));
      console.log('[speechmatics] StartRecognition sent');
    });

    smWs.on('message', (rawData) => {
      let msg;
      try { msg = JSON.parse(rawData.toString()); } catch { return; }

      // Handle RecognitionStarted — mark ready, flush buffered audio
      if (msg.message === 'RecognitionStarted') {
        console.log('[speechmatics] RecognitionStarted received. Flushing audio buffer:', audioBuffer.length);
        smReady = true;
        while (audioBuffer.length > 0) {
          const chunk = audioBuffer.shift();
          try { smWs.send(chunk); } catch { /* ignore */ }
        }
        return;
      }

      // Normalize Speechmatics responses to Deepgram format for the client
      if (msg.message === 'AddPartialTranscript') {
        const transcript = msg?.metadata?.transcript || '';
        if (!transcript) return;

        // Filter out punctuation-only partials
        if (!hasAlphanumeric(transcript)) return;

        const normalized = {
          is_final: false,
          channel: { alternatives: [{ transcript }] },
        };
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(normalized));
        }
        return;
      }

      if (msg.message === 'AddTranscript') {
        const transcript = msg?.metadata?.transcript || '';
        if (!transcript) return;

        // Filter out punctuation-only finals (e.g., isolated "." that
        // Speechmatics sends after a pause). Pass 1 handles punctuation.
        if (!hasAlphanumeric(transcript)) {
          console.log('[speechmatics] Discarding punctuation-only final:', JSON.stringify(transcript));
          return;
        }

        const normalized = {
          is_final: true,
          channel: { alternatives: [{ transcript }] },
        };
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(normalized));
        }
        return;
      }

      if (msg.message === 'EndOfTranscript') {
        console.log('[speechmatics] EndOfTranscript received');
        return;
      }

      if (msg.message === 'Error') {
        console.error('[speechmatics] Server error:', msg.reason || msg);
        if (ws.readyState === 1) {
          ws.close(1011, 'Speechmatics error: ' + (msg.reason || 'unknown'));
        }
        return;
      }

      // Info/Warning messages — log but don't forward
      if (msg.message === 'Info' || msg.message === 'Warning') {
        console.log(`[speechmatics] ${msg.message}:`, msg.reason || msg.type || msg);
        return;
      }
    });

    smWs.on('close', (code, reason) => {
      console.log(`[speechmatics] WebSocket closed: ${code} ${reason}`);
      smReady = false;
      audioBuffer = [];
      if (ws.readyState === 1) {
        ws.close(1011, 'Speechmatics connection closed');
      }
    });

    smWs.on('error', (err) => {
      console.error('[speechmatics] WebSocket error:', err?.message || err);
    });

    // Client -> Server -> Speechmatics
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'Finalize' && smWs && smWs.readyState === 1) {
            console.log('[speechmatics] Received Finalize → sending ForceEndOfUtterance');
            smWs.send(JSON.stringify({ message: 'ForceEndOfUtterance' }));
            return;
          }
        } catch { /* Not valid JSON, fall through */ }
      }

      // Forward audio data to Speechmatics
      if (smWs && smReady && smWs.readyState === 1) {
        try { smWs.send(data); } catch { /* ignore */ }
      } else {
        audioBuffer.push(data);
        if (audioBuffer.length > 500) {
          audioBuffer.shift();
        }
      }
    });

    ws.on('close', () => {
      console.log('[speechmatics] Client disconnected');
      if (smWs && smWs.readyState === 1) {
        try {
          smWs.send(JSON.stringify({ message: 'EndOfStream' }));
          setTimeout(() => {
            try { smWs.close(1000, 'Client disconnected'); } catch { /* ignore */ }
          }, 500);
        } catch { /* ignore */ }
      }
      smReady = false;
      audioBuffer = [];
    });

  } catch (err) {
    console.error('[speechmatics] Failed to init:', err);
    ws.close(1011, 'Speechmatics init failed');
  }
}

export default { attachAsrRelay };
