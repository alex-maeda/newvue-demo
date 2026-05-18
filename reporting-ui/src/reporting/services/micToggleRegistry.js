/**
 * Mic Toggle Registry
 *
 * Tiny module-level callback registry that decouples the mic-off voice
 * command handler from the DOM.
 *
 * Problem: When the dictation panel is popped out into a Document
 * Picture-in-Picture window, the #mic-toggle-btn element lives in the
 * PiP window's document — not the main document. A plain
 * document.getElementById() from voiceCommandHandlers.js returns null,
 * silently failing the "mic off" command.
 *
 * Solution: MicButton registers its handleToggle function here on mount.
 * The micOff handler calls getMicToggle() instead of searching the DOM.
 */

let _toggleFn = null;

/**
 * Register the mic toggle callback.
 * Called by MicButton on mount / ref update.
 *
 * @param {Function|null} fn — the handleToggle function, or null to clear
 */
export function registerMicToggle(fn) {
  _toggleFn = fn;
}

/**
 * Retrieve the currently registered mic toggle callback.
 * @returns {Function|null}
 */
export function getMicToggle() {
  return _toggleFn;
}
