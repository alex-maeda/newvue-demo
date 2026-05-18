/**
 * Ambient Wake-Word Listener Service
 *
 * Uses the browser's built-in Web Speech API to listen ambiently for
 * wake phrases that toggle the primary dictation microphone ON.
 *
 * Architecture:
 *  - State machine: inactive → starting → listening → stopping → inactive
 *  - activate(callback)  — start ambient listening with a wake-word callback
 *  - deactivate()        — returns a Promise that resolves when the mic is released
 *  - Wake-word callback fires from onend (not onresult), guaranteeing the
 *    microphone hardware is fully released before the caller grabs it.
 *
 * Chromium-only (Chrome, Edge, Opera). Firefox and Safari are excluded.
 */

// ─── Wake word list ──────────────────────────────────────────────────
const WAKE_WORDS = [
  'wake',
  'wake up',
  'waik',
  'wakey',
  'mic on',
  'mike on',
  'micon',
  'michael',
  'my con',
  'by con',
  'nikon',
  'my car',
  'my can',
  'mike and',
  'microphone on',
  'turn on',
  'start dictation',
  'start dictating',
  'stock dictating',
  'static',
  'start listening',
  'switch on',
  'engage',
];

// ─── Browser detection ───────────────────────────────────────────────
function isChromiumBrowser() {
  const ua = navigator.userAgent;
  // Chromium-based: Chrome, Edge (Edg/), Opera (OPR/)
  const hasChromiumToken = /Chrome\//.test(ua) || /Edg\//.test(ua) || /OPR\//.test(ua);
  // Exclude Firefox and pure-Safari (Safari UA contains "Safari/" but NOT "Chrome/")
  const isFirefox = /Firefox\//.test(ua);
  return hasChromiumToken && !isFirefox;
}

// ─── Service ─────────────────────────────────────────────────────────
class AmbientListenerService {
  constructor() {
    /** @type {'inactive'|'starting'|'listening'|'stopping'} */
    this._state = 'inactive';

    this._supported = false;
    this._recognition = null;
    this._onWakeWordCb = null;

    // Lifecycle flags
    this._shouldRespawn = false;
    this._wakeWordFired = false;

    // Deactivation promise machinery
    this._deactivatePromise = null;
    this._deactivateResolve = null;

    // Health tracking — detects persistent failures
    this._consecutiveFailures = 0;
    this._degraded = false;
    this._onDegradedChangeCb = null;

    // ── Check support ──
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[Ambient] Web Speech API not available in this browser.');
      return;
    }
    if (!isChromiumBrowser()) {
      console.warn('[Ambient] Feature restricted to Chromium browsers (Chrome, Edge, Opera).');
      return;
    }

    this._supported = true;

    // ── Create recognition instance ──
    this._recognition = new SpeechRecognition();
    this._recognition.continuous = true;
    this._recognition.interimResults = true;
    this._recognition.lang = 'en-US';

    this._recognition.onstart = this._handleStart.bind(this);
    this._recognition.onresult = this._handleResult.bind(this);
    this._recognition.onerror = this._handleError.bind(this);
    this._recognition.onend = this._handleEnd.bind(this);
  }

  // ─── Internal: state transitions ──────────────────────────────────

  _handleStart() {
    this._state = 'listening';
    console.log('[Ambient] Listening for wake words…');

    // Health: successful start clears failure count
    this._consecutiveFailures = 0;
    if (this._degraded) {
      this._degraded = false;
      console.log('[Ambient] Service recovered');
      this._onDegradedChangeCb?.(false);
    }
  }

  _handleResult(event) {
    // Guard: once a wake word fires, ignore all subsequent results
    // until this recognition session ends.
    if (this._wakeWordFired) return;

    // Build transcript from new results
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      transcript += event.results[i][0].transcript;
    }

    // Normalize and fuzzy-match
    const normalized = transcript.toLowerCase().replace(/[.,!?;:]/g, '').trim();
    if (normalized) {
      console.log(`[Ambient] Heard: "${normalized}"`);
    }
    const matched = WAKE_WORDS.some((ww) => normalized.includes(ww));

    if (matched) {
      console.log(`[Ambient] Wake word detected: "${normalized}"`);
      this._wakeWordFired = true;
      this._shouldRespawn = false;
      this._playBong();

      // Abort recognition immediately. The actual wake-word callback
      // fires in _handleEnd — AFTER the browser has released the mic.
      this._state = 'stopping';
      this._recognition.abort();
    }
  }

  _handleError(event) {
    if (event.error === 'not-allowed') {
      console.warn('[Ambient] Microphone permission denied — disabling ambient listener.');
      this._shouldRespawn = false;
      this._recordFailure();
    } else if (event.error === 'no-speech') {
      // Normal — the Web Speech API session timed out without hearing speech.
      // onend will fire next; the respawn loop will restart it.
      // NOT counted as a failure.
    } else {
      console.warn('[Ambient] Web Speech API error:', event.error);
      this._recordFailure();
    }
  }

  _handleEnd() {
    this._state = 'inactive';

    // ── Case 1: deactivate() was called ──
    // Resolve the pending promise so the caller knows the mic is free.
    if (this._deactivateResolve) {
      const resolve = this._deactivateResolve;
      this._deactivateResolve = null;
      this._deactivatePromise = null;
      resolve();

      // If activate() was called while deactivation was in-flight
      // (e.g. React StrictMode unmount + remount), honour it now.
      if (this._shouldRespawn) {
        this._startRecognition();
      }
      return;
    }

    // ── Case 2: wake word was detected ──
    // The mic is now released — safe to fire the callback.
    if (this._wakeWordFired) {
      this._wakeWordFired = false;
      if (this._onWakeWordCb) {
        this._onWakeWordCb();
      }
      return;
    }

    // ── Case 3: normal session end (timeout / no-speech) ──
    // Respawn if we're supposed to be listening.
    if (this._shouldRespawn) {
      this._startRecognition();
    }
  }

  // ─── Internal: helpers ────────────────────────────────────────────

  _startRecognition() {
    if (!this._recognition || this._state !== 'inactive') return;
    try {
      this._state = 'starting';
      this._wakeWordFired = false;
      this._recognition.start();
    } catch (e) {
      this._state = 'inactive';
      console.warn('[Ambient] Could not start recognition:', e.message);
      this._recordFailure();
    }
  }

  /**
   * Record a failure and check if the service should be marked degraded.
   * Called on non-trivial errors and start failures.
   */
  _recordFailure() {
    this._consecutiveFailures++;
    if (this._consecutiveFailures >= 3 && !this._degraded) {
      this._degraded = true;
      console.warn('[Ambient] Service degraded — 3 consecutive failures');
      this._onDegradedChangeCb?.(true);
    }
  }

  /**
   * Synthesize a soft "bong" notification using the Web Audio API.
   */
  _playBong() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);

      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } catch (e) {
      console.warn('[Ambient] Audio feedback failed:', e.message);
    }
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Whether the browser supports the ambient wake-word feature.
   */
  isSupported() {
    return this._supported;
  }

  /**
   * Whether the ambient listener has been marked degraded due to
   * consecutive failures (3+). Clears automatically on recovery.
   */
  isDegraded() {
    return this._degraded;
  }

  /**
   * Register a callback to be notified when the degraded state changes.
   * @param {Function|null} cb - (isDegraded: boolean) => void
   */
  onDegradedChange(cb) {
    this._onDegradedChangeCb = cb;
  }

  /**
   * Activate ambient listening.
   *
   * @param {Function} onWakeWord — called (from onend) when a wake word
   *   is detected. The microphone is guaranteed to be released by the
   *   time this fires.
   */
  activate(onWakeWord) {
    if (!this._supported) return;

    this._onWakeWordCb = onWakeWord;
    this._shouldRespawn = true;
    this._wakeWordFired = false;

    // Only start if currently inactive. If we're already listening,
    // starting, or stopping, the existing session (or its onend
    // respawn) will continue.
    if (this._state === 'inactive') {
      this._startRecognition();
    }
  }

  /**
   * Deactivate ambient listening.
   *
   * @returns {Promise<void>} Resolves when the recognition has fully
   *   stopped and the microphone is released.
   */
  deactivate() {
    this._shouldRespawn = false;
    this._wakeWordFired = false;

    // Already inactive — nothing to wait for.
    if (!this._recognition || this._state === 'inactive') {
      return Promise.resolve();
    }

    // Already stopping — return the existing promise.
    if (this._deactivatePromise) {
      return this._deactivatePromise;
    }

    // Initiate stop with failsafe timeout.
    // The Web Speech API's onend event can occasionally fail to fire
    // (e.g., browser audio subsystem issues). The timeout prevents
    // a permanent deadlock that would block all mic functionality.
    this._deactivatePromise = new Promise((resolve) => {
      this._deactivateResolve = resolve;

      setTimeout(() => {
        if (this._deactivateResolve) {
          console.warn('[Ambient] deactivate() timed out after 3s — force-resolving');
          this._state = 'inactive';
          this._deactivateResolve = null;
          this._deactivatePromise = null;
          resolve();
        }
      }, 3000);
    });
    this._state = 'stopping';
    this._recognition.abort();

    return this._deactivatePromise;
  }
}

const ambientListenerService = new AmbientListenerService();

// Expose on window for console-based QA testing of degraded state.
// Usage:  __ambient._degraded = true; __ambient._consecutiveFailures = 3;
//         __ambient._onDegradedChangeCb?.(true);
if (typeof window !== 'undefined') {
  window.__ambient = ambientListenerService;
}

export default ambientListenerService;
