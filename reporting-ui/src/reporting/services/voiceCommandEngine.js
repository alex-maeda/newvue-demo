/**
 * Voice Command Engine — Core Module
 *
 * Intercepts ASR finals before they enter the text pipeline and
 * determines whether the spoken words constitute a voice command.
 *
 * Architecture:
 *   1. Word Tokenizer — splits multi-word ASR finals into single-word tokens
 *   2. Command Registry — maintains the library of registered commands with aliases
 *   3. State Machine — IDLE/BUFFERING/EXECUTING, processes one token at a time
 *
 * The engine sits between ASR onFinal and incrementalInsert. Words that are
 * part of a voice command are consumed (never reach the text pipeline).
 * Words that are NOT part of a command are flushed back to the regular
 * pipeline via a passthrough callback.
 *
 * Design decisions (from architectural discussion):
 *   - Exact matching only (no fuzzy matching)
 *   - Case-insensitive comparison
 *   - Multi-word ASR finals are split into single-word tokens
 *   - 750ms silence timeout terminates ambiguous buffering
 *   - Inactivity timer (MicButton) is suspended during BUFFERING
 *   - Failed/unconfirmed commands flush all text back silently
 *   - signalSpeechActivity() resets the silence timer on ASR interims
 */

// ─── Constants ───────────────────────────────────────────────────────

const SILENCE_TIMEOUT_MS = 750;
const OPEN_ENDED_SILENCE_TIMEOUT_MS = 1200;

// ─── Command Registry ────────────────────────────────────────────────

/**
 * Registered command entries.
 * Each entry:
 * {
 *   id: string,
 *   type: 'self_contained' | 'close_ended' | 'open_ended',
 *   triggerSequences: string[][],   // Array of alias word sequences (lowercase)
 *   handler: (context) => void,
 *   description: string,
 * }
 */
const commands = [];

/**
 * Set of all unique first words across all registered commands.
 * Used for O(1) "could this word start a command?" checks.
 * Built lazily by buildTriggerIndex().
 */
let triggerFirstWords = new Set();

/**
 * Flag indicating the trigger index needs rebuilding.
 */
let indexDirty = true;

/**
 * Register a new voice command.
 *
 * @param {object} entry - Command entry
 * @param {string} entry.id - Unique command identifier
 * @param {string} entry.type - 'self_contained' | 'close_ended' | 'open_ended'
 * @param {string[][]} entry.triggerSequences - Array of word-sequence aliases
 * @param {Function} entry.handler - Handler function: (context) => void
 * @param {string} entry.description - Human-readable description
 */
export function registerCommand(entry) {
  if (!entry.id || !entry.triggerSequences?.length || !entry.handler) {
    console.warn('[VoiceCommandEngine] Invalid command entry:', entry);
    return;
  }

  // Normalize all trigger sequences to lowercase
  const normalized = {
    ...entry,
    triggerSequences: entry.triggerSequences.map(seq =>
      seq.map(word => word.toLowerCase())
    ),
  };

  // Remove existing entry with same ID (allows re-registration)
  const existingIdx = commands.findIndex(c => c.id === entry.id);
  if (existingIdx >= 0) {
    commands[existingIdx] = normalized;
  } else {
    commands.push(normalized);
  }

  indexDirty = true;
  console.log(`[VoiceCommandEngine] Registered command: ${entry.id} (${entry.triggerSequences.length} aliases)`);
}

/**
 * Rebuild the trigger-word index from the current command registry.
 * Called lazily before first use and after any registration.
 */
function buildTriggerIndex() {
  triggerFirstWords = new Set();
  for (const cmd of commands) {
    for (const seq of cmd.triggerSequences) {
      if (seq.length > 0) {
        triggerFirstWords.add(seq[0]);
      }
    }
  }
  indexDirty = false;
  console.log(`[VoiceCommandEngine] Trigger index built: ${triggerFirstWords.size} unique first words`);
}

/**
 * Check if a word could start any registered voice command.
 * @param {string} word - Lowercase word to check
 * @returns {boolean}
 */
function isTriggerWord(word) {
  if (indexDirty) buildTriggerIndex();
  return triggerFirstWords.has(word);
}

/**
 * Find all command candidates whose trigger sequence matches the given
 * word buffer up to the buffer's length.
 *
 * For each matching command+alias, returns:
 * {
 *   command: <command entry>,
 *   aliasIdx: <which alias matched>,
 *   aliasLength: <total words in this alias>,
 *   matchedWords: <how many words from the alias are matched so far>,
 *   isComplete: <true if all words in the alias are matched>,
 * }
 *
 * @param {string[]} wordBuffer - Lowercase words accumulated so far
 * @returns {Array} Candidate matches
 */
function findCandidates(wordBuffer) {
  if (indexDirty) buildTriggerIndex();
  const candidates = [];

  for (const cmd of commands) {
    for (let ai = 0; ai < cmd.triggerSequences.length; ai++) {
      const seq = cmd.triggerSequences[ai];

      // Buffer must not exceed the alias length
      if (wordBuffer.length > seq.length) continue;

      // Check if all buffered words match the alias prefix
      let match = true;
      for (let wi = 0; wi < wordBuffer.length; wi++) {
        if (wordBuffer[wi] !== seq[wi]) {
          match = false;
          break;
        }
      }

      if (match) {
        candidates.push({
          command: cmd,
          aliasIdx: ai,
          aliasLength: seq.length,
          matchedWords: wordBuffer.length,
          isComplete: wordBuffer.length === seq.length,
        });
      }
    }
  }

  return candidates;
}

// ─── Word Tokenizer ──────────────────────────────────────────────────

/**
 * Split a raw ASR final string into individual word tokens.
 * Preserves inter-word whitespace in originalText for faithful re-emission.
 *
 * The first token has no leading space. Subsequent tokens get the
 * inter-word space prepended to originalText so that joining all
 * originalText values via '' produces the original string.
 *
 * @param {string} rawText - Raw ASR final (may be multi-word)
 * @returns {Array<{ word: string, originalText: string }>}
 */
export function tokenize(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const tokens = [];
  // Match sequences of: optional whitespace + non-whitespace word
  const regex = /(\s*)(\S+)/g;
  let match;
  let isFirst = true;

  while ((match = regex.exec(rawText)) !== null) {
    const leadingSpace = match[1];
    const word = match[2];

    tokens.push({
      word,
      // First token: no leading space (even if the raw text had one).
      // Subsequent tokens: preserve the inter-word space.
      originalText: isFirst ? word : (leadingSpace || ' ') + word,
    });

    isFirst = false;
  }

  return tokens;
}

/**
 * Re-assemble an array of tokens into a single string.
 * Uses originalText to preserve original spacing.
 *
 * @param {Array<{ word: string, originalText: string }>} tokens
 * @returns {string}
 */
export function reassembleTokens(tokens) {
  return tokens.map(t => t.originalText).join('');
}

// ─── State Machine ───────────────────────────────────────────────────

/**
 * Engine state.
 * Managed as a module-level singleton — only one engine instance exists.
 */
const state = {
  phase: 'IDLE',            // 'IDLE' | 'BUFFERING' | 'COLLECTING_PAYLOAD' | 'COLLECTING_OPEN_PAYLOAD' | 'EXECUTING'
  bufferedTokens: [],        // Tokens trapped so far
  candidateCommands: [],     // Current candidate matches
  completedMatch: null,      // Best complete match found while buffering (greedy hold)
  silenceTimer: null,        // 750ms timeout handle
  // ── Payload collection (Type 2: close_ended commands) ──
  payloadCommand: null,      // The matched close_ended command entry
  payloadTokens: [],         // Tokens collected during payload phase
  payloadTriggerTokens: [],  // Trigger tokens preserved for abort flush
  payloadState: null,        // Arbitrary state managed by the payload handler
  // ── Open-ended collection (Type 3: open_ended commands) ──
  openEndedCommand: null,    // The matched open_ended command entry
  openEndedTokens: [],       // Accumulated payload tokens (blind accumulation)
  openEndedTriggerTokens: [], // Trigger tokens (for flush-back on empty payload)
};

/**
 * Callbacks provided by MicButton at initialization.
 * Set via init().
 */
let callbacks = {
  passthrough: null,              // (text: string) => void — feed text to regular pipeline
  onCommandExecuted: null,        // (commandId: string, description: string) => void
  onBeforeCommandExecute: null,   // () => void — clean up before handler runs
  suspendInactivityTimer: null,   // () => void
  resumeInactivityTimer: null,    // () => void
  onOpenEndedCollectionStarted: null, // (commandId: string, description: string) => void
  onOpenEndedCollectionEnded: null,   // () => void
};

/**
 * Initialize the engine with callbacks.
 * Called once when ASR starts.
 *
 * @param {object} cbs
 * @param {Function} cbs.passthrough - Feed text to the regular ASR pipeline
 * @param {Function} cbs.onCommandExecuted - Notify that a command was executed
 * @param {Function} cbs.onBeforeCommandExecute - Clean up before handler runs (e.g., orphaned entries)
 * @param {Function} cbs.suspendInactivityTimer - Pause the MicButton inactivity timer
 * @param {Function} cbs.resumeInactivityTimer - Resume the MicButton inactivity timer
 */
export function init(cbs) {
  callbacks = { ...callbacks, ...cbs };
  resetState();
  console.log('[VoiceCommandEngine] Initialized');
}

/**
 * Reset the engine state to IDLE.
 * Clears all buffers and timers.
 */
function resetState() {
  clearSilenceTimer();
  state.phase = 'IDLE';
  state.bufferedTokens = [];
  state.candidateCommands = [];
  state.completedMatch = null;
  state.payloadCommand = null;
  state.payloadTokens = [];
  state.payloadTriggerTokens = [];
  state.payloadState = null;
  state.openEndedCommand = null;
  state.openEndedTokens = [];
  state.openEndedTriggerTokens = [];
}

/**
 * Shut down the engine. Flushes any buffered text and resets state.
 * Called when ASR stops.
 */
export function shutdown() {
  if (state.phase === 'BUFFERING' && state.bufferedTokens.length > 0) {
    flushBuffer();
  }
  if (state.phase === 'COLLECTING_PAYLOAD') {
    abortPayloadCollection(null);
  }
  if (state.phase === 'COLLECTING_OPEN_PAYLOAD') {
    // Notify UI that open-ended collection is ending
    if (callbacks.onOpenEndedCollectionEnded) {
      try { callbacks.onOpenEndedCollectionEnded(); } catch (e) { /* ignore */ }
    }
    // Flush trigger + any collected tokens back to pipeline
    const allTokens = [...state.openEndedTriggerTokens, ...state.openEndedTokens];
    if (allTokens.length > 0) {
      emitPassthrough(reassembleTokens(allTokens));
    }
  }
  resetState();
  console.log('[VoiceCommandEngine] Shut down');
}

/**
 * Process an array of word tokens from a single ASR final.
 * This is the main entry point called by MicButton for each onFinal.
 *
 * Non-trigger words in IDLE state are batched and emitted as a single
 * passthrough call, preserving the coherent text chunk for the downstream
 * text pipeline (rather than N individual word emissions).
 *
 * @param {Array<{ word: string, originalText: string }>} tokens
 */
export function processTokens(tokens) {
  if (!tokens || tokens.length === 0) return;

  console.log(`[VCE-DIAG] processTokens called: phase=${state.phase}, tokens=[${tokens.map(t => t.word).join(', ')}], buffered=[${state.bufferedTokens.map(t => t.word).join(', ')}]`);

  // Accumulator for consecutive non-trigger IDLE tokens.
  // Flushed as a single passthrough call when we hit a trigger word
  // or reach the end of the token array.
  let idleAccumulator = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lowerWord = token.word.toLowerCase();

    if (state.phase === 'IDLE') {
      if (isTriggerWord(lowerWord)) {
        // Flush any accumulated idle tokens before entering BUFFERING
        if (idleAccumulator.length > 0) {
          emitPassthrough(reassembleTokens(idleAccumulator));
          idleAccumulator = [];
        }
        // Process this trigger token (transitions state to BUFFERING)
        processOneToken(token, tokens, i);
      } else {
        // Accumulate non-trigger word for batched passthrough
        idleAccumulator.push(token);
      }
    } else if (state.phase === 'COLLECTING_OPEN_PAYLOAD') {
      // Open-ended collection: unconditionally accumulate every token
      collectOpenEndedToken(token);
    } else {
      // BUFFERING, COLLECTING_PAYLOAD, or EXECUTING — delegate to state machine
      processOneToken(token, tokens, i);

      // If the state machine flushed back to IDLE mid-array and there
      // are more tokens, they'll be handled by the IDLE branch above
      // on the next iteration.
    }
  }

  // Flush any remaining accumulated idle tokens
  if (idleAccumulator.length > 0) {
    emitPassthrough(reassembleTokens(idleAccumulator));
    idleAccumulator = [];
  }

  // After processing all tokens in this ASR final:
  // If we're still BUFFERING or collecting, reset the silence timer
  if (state.phase === 'BUFFERING' || state.phase === 'COLLECTING_PAYLOAD') {
    resetSilenceTimer();
  } else if (state.phase === 'COLLECTING_OPEN_PAYLOAD') {
    resetSilenceTimer(OPEN_ENDED_SILENCE_TIMEOUT_MS);
  }
}

/**
 * Process a single token through the state machine.
 *
 * @param {{ word: string, originalText: string }} token
 * @param {Array} allTokens - Full token array (for context)
 * @param {number} tokenIdx - Index of this token in allTokens
 */
function processOneToken(token, allTokens, tokenIdx) {
  const lowerWord = token.word.toLowerCase();

  if (state.phase === 'IDLE') {
    // ── IDLE: check if this word could start a command ──
    if (isTriggerWord(lowerWord)) {
      console.log(`[VCE-DIAG] IDLE→BUFFERING: "${lowerWord}" is a trigger word`);
      // Transition to BUFFERING
      state.phase = 'BUFFERING';
      state.bufferedTokens = [token];
      state.candidateCommands = findCandidates([lowerWord]);
      state.completedMatch = null;

      // Check if any candidate is already complete (single-word command)
      const completeCandidate = state.candidateCommands.find(c => c.isComplete);
      if (completeCandidate) {
        // Check if longer alternatives exist
        const longerExists = state.candidateCommands.some(
          c => !c.isComplete && c.aliasLength > completeCandidate.aliasLength
        );
        if (longerExists) {
          // Greedy hold: we have a complete match but longer alternatives exist
          state.completedMatch = completeCandidate;
          console.log(`[VoiceCommandEngine] BUFFERING: "${lowerWord}" — complete match "${completeCandidate.command.id}" held (longer alternatives exist)`);
        } else {
          // Unambiguous single-word command
          if (completeCandidate.command.type === 'open_ended') {
            console.log(`[VoiceCommandEngine] Single-word open_ended trigger: "${completeCandidate.command.id}" — starting open-ended collection`);
            startOpenEndedCollection(completeCandidate);
          } else if (completeCandidate.command.type === 'close_ended') {
            console.log(`[VoiceCommandEngine] Single-word close_ended trigger: "${completeCandidate.command.id}" — starting payload collection`);
            startPayloadCollection(completeCandidate);
          } else {
            console.log(`[VoiceCommandEngine] Single-word command: "${completeCandidate.command.id}"`);
            executeCommand(completeCandidate);
          }
          return;
        }
      } else {
        console.log(`[VoiceCommandEngine] BUFFERING: "${lowerWord}" — ${state.candidateCommands.length} candidates`);
      }

      // Suspend the MicButton inactivity timer while we're buffering
      if (callbacks.suspendInactivityTimer) {
        callbacks.suspendInactivityTimer();
      }
    } else {
      // Not a trigger word — processTokens handles batched passthrough
      // via the idleAccumulator (this branch should not be reached when
      // processTokens is the caller, but kept as a safety fallback).
      emitPassthrough(token.originalText);
    }

  } else if (state.phase === 'BUFFERING') {
    // ── BUFFERING: add token and narrow candidates ──

    // Fix cross-final spacing: when tokens arrive from separate ASR finals,
    // the first token in each final has no leading space in originalText
    // (the tokenizer only adds inter-word spaces for non-first tokens within
    // a single ASR final). If the buffer already has tokens and the incoming
    // token's originalText doesn't start with whitespace, prepend a space
    // so that reassembleTokens() produces "go to findings" not "gotofindings".
    if (state.bufferedTokens.length > 0 && !/^\s/.test(token.originalText)) {
      token = { ...token, originalText: ' ' + token.originalText };
    }

    state.bufferedTokens.push(token);
    const wordBuffer = state.bufferedTokens.map(t => t.word.toLowerCase());

    // Recompute candidates against the extended buffer
    state.candidateCommands = findCandidates(wordBuffer);

    console.log(`[VCE-DIAG] BUFFERING: buffer=[${wordBuffer.join(', ')}], candidates=${state.candidateCommands.length}, complete=${state.candidateCommands.filter(c => c.isComplete).map(c => c.command.id).join(',') || 'none'}`);

    if (state.candidateCommands.length === 0) {
      // No candidates match — check if we had a completed match (greedy hold)
      if (state.completedMatch) {
        // Execute the completed match; the current token is NOT part of the command
        console.log(`[VoiceCommandEngine] Executing greedy-held command: "${state.completedMatch.command.id}" — current word "${lowerWord}" is not part of it`);

        // The tokens consumed by the command are the first N tokens
        const commandTokenCount = state.completedMatch.matchedWords;
        const remainingTokens = state.bufferedTokens.slice(commandTokenCount);

        if (state.completedMatch.command.type === 'close_ended') {
          startPayloadCollection(state.completedMatch);
          // Re-process remaining tokens as payload
          for (const tok of remainingTokens) {
            processOneToken(tok, remainingTokens, 0);
          }
        } else {
          executeCommand(state.completedMatch);

          // Re-process remaining tokens (they may start a new command or passthrough)
          if (remainingTokens.length > 0) {
            for (let ri = 0; ri < remainingTokens.length; ri++) {
              processOneToken(remainingTokens[ri], remainingTokens, ri);
            }
          }
        }
      } else {
        // No match at all — flush everything including current token
        console.log(`[VoiceCommandEngine] No candidates remain — flushing ${state.bufferedTokens.length} tokens`);
        flushBuffer();
      }
      return;
    }

    // Check if any candidate is now complete
    const completeCandidate = state.candidateCommands.find(c => c.isComplete);
    if (completeCandidate) {
      // Check if longer alternatives still exist
      const longerExists = state.candidateCommands.some(
        c => !c.isComplete && c.aliasLength > completeCandidate.aliasLength
      );
      if (longerExists) {
        // Greedy hold: record this match but keep buffering
        state.completedMatch = completeCandidate;
        console.log(`[VoiceCommandEngine] BUFFERING: "${wordBuffer.join(' ')}" — complete match "${completeCandidate.command.id}" held (longer alternatives exist)`);
      } else {
        // Unambiguous complete match
        if (completeCandidate.command.type === 'open_ended') {
          console.log(`[VoiceCommandEngine] Open_ended trigger complete: "${completeCandidate.command.id}" — "${wordBuffer.join(' ')}" — starting open-ended collection`);
          startOpenEndedCollection(completeCandidate);
        } else if (completeCandidate.command.type === 'close_ended') {
          console.log(`[VoiceCommandEngine] Close_ended trigger complete: "${completeCandidate.command.id}" — "${wordBuffer.join(' ')}" — starting payload collection`);
          startPayloadCollection(completeCandidate);
        } else {
          console.log(`[VoiceCommandEngine] Command complete: "${completeCandidate.command.id}" — "${wordBuffer.join(' ')}"`);
          executeCommand(completeCandidate);
        }
        return;
      }
    } else {
      console.log(`[VoiceCommandEngine] BUFFERING: "${wordBuffer.join(' ')}" — ${state.candidateCommands.length} candidates`);
    }
  } else if (state.phase === 'COLLECTING_PAYLOAD') {
    // ── COLLECTING_PAYLOAD: forward token to payload handler ──

    const result = state.payloadCommand.onPayloadToken(lowerWord, state.payloadState);

    if (result.action === 'continue') {
      // Token is part of the match — commit it to payload buffer
      if (state.payloadTokens.length > 0 && !/^\s/.test(token.originalText)) {
        token = { ...token, originalText: ' ' + token.originalText };
      }
      state.payloadTokens.push(token);
      state.payloadState = result.payloadState;
      console.log(`[VCE-DIAG] COLLECTING_PAYLOAD: "${lowerWord}" → continue (${state.payloadTokens.length} payload tokens)`);

    } else if (result.action === 'complete') {
      // Command is done, this token IS part of the payload (e.g., "all" shortcut)
      if (state.payloadTokens.length > 0 && !/^\s/.test(token.originalText)) {
        token = { ...token, originalText: ' ' + token.originalText };
      }
      state.payloadTokens.push(token);
      state.payloadState = result.payloadState;
      console.log(`[VCE-DIAG] COLLECTING_PAYLOAD: "${lowerWord}" → complete`);
      executePayloadCommand();

    } else if (result.action === 'finalize') {
      // Execute with previous state; this token is NOT part of the match
      state.payloadState = result.payloadState;
      console.log(`[VCE-DIAG] COLLECTING_PAYLOAD: "${lowerWord}" → finalize (flushing trailing word)`);
      executePayloadCommand();
      emitPassthrough(token.originalText);

    } else if (result.action === 'abort') {
      console.log(`[VCE-DIAG] COLLECTING_PAYLOAD: "${lowerWord}" → abort`);
      abortPayloadCollection(token);
    }
  }
  // EXECUTING state: tokens should not arrive here (engine resets to IDLE after execution)
}

// ─── Command Execution ───────────────────────────────────────────────

/**
 * Execute a matched voice command.
 * Consumes all buffered tokens, runs the handler, and resets to IDLE.
 *
 * @param {{ command: object, matchedWords: number }} match
 */
function executeCommand(match) {
  const { command } = match;

  console.log(`[VCE-DIAG] EXECUTING: command="${command.id}", consumed ${match.matchedWords} tokens`);
  state.phase = 'EXECUTING';
  clearSilenceTimer();

  const consumedTokens = state.bufferedTokens.slice(0, match.matchedWords);
  const consumedText = reassembleTokens(consumedTokens);

  console.log(`[VoiceCommandEngine] Executing "${command.id}": consumed "${consumedText}"`);

  // Build execution context
  const context = {
    commandId: command.id,
    commandType: command.type,
    consumedText,
    consumedTokens,
  };

  // Clean up any orphaned state BEFORE the handler runs.
  // This is critical: command handlers call setActiveTextarea(),
  // which checks for pending action queue entries. If an orphaned
  // entry exists (created by onInterim for command-word interims),
  // setActiveTextarea would call asrService.finalize() and disrupt
  // the ASR stream. The onBeforeCommandExecute callback lets MicButton
  // close/remove that orphaned entry first.
  if (callbacks.onBeforeCommandExecute) {
    try {
      callbacks.onBeforeCommandExecute();
    } catch (err) {
      console.warn('[VoiceCommandEngine] onBeforeCommandExecute callback error:', err);
    }
  }

  try {
    command.handler(context);
  } catch (err) {
    console.error(`[VoiceCommandEngine] Handler error for "${command.id}":`, err);
  }

  // Notify UI of successful execution
  if (callbacks.onCommandExecuted) {
    try {
      callbacks.onCommandExecuted(command.id, command.description);
    } catch (err) {
      console.warn('[VoiceCommandEngine] onCommandExecuted callback error:', err);
    }
  }

  // Resume inactivity timer (command consumed the text, so the
  // regular pipeline has nothing new — but the user might speak again)
  if (callbacks.resumeInactivityTimer) {
    callbacks.resumeInactivityTimer();
  }

  // Reset to IDLE
  resetState();
}

// ─── Payload Collection (Type 2: close_ended commands) ───────────────

/**
 * Start payload collection for a close_ended (Type 2) command.
 * Called when a trigger sequence matches and the command type is 'close_ended'.
 * Transitions to COLLECTING_PAYLOAD and waits for payload tokens.
 *
 * @param {{ command: object, matchedWords: number }} match
 */
function startPayloadCollection(match) {
  const { command } = match;

  // Preserve trigger tokens for potential flush on abort
  const triggerTokens = state.bufferedTokens.slice(0, match.matchedWords);

  console.log(`[VCE-DIAG] Starting payload collection for "${command.id}" (${triggerTokens.length} trigger tokens)`);

  clearSilenceTimer();
  state.phase = 'COLLECTING_PAYLOAD';
  state.payloadCommand = command;
  state.payloadTokens = [];
  state.payloadTriggerTokens = triggerTokens;
  state.payloadState = command.initPayloadState ? command.initPayloadState() : {};
  state.bufferedTokens = [];
  state.candidateCommands = [];
  state.completedMatch = null;

  // Ensure inactivity timer is suspended during payload collection
  // (may already be suspended from BUFFERING, but safe to call again)
  if (callbacks.suspendInactivityTimer) {
    callbacks.suspendInactivityTimer();
  }

  resetSilenceTimer();
}

/**
 * Execute a Type 2 command with its collected payload.
 * Similar to executeCommand but includes payload context.
 */
function executePayloadCommand() {
  const command = state.payloadCommand;
  const payloadTokens = [...state.payloadTokens];
  const triggerTokens = [...state.payloadTriggerTokens];
  const payloadState = state.payloadState;

  console.log(`[VCE-DIAG] EXECUTING payload command: "${command.id}", ${payloadTokens.length} payload tokens`);
  state.phase = 'EXECUTING';
  clearSilenceTimer();

  const consumedTokens = [...triggerTokens, ...payloadTokens];
  const consumedText = reassembleTokens(consumedTokens);

  const context = {
    commandId: command.id,
    commandType: command.type,
    consumedText,
    consumedTokens,
    payloadState,
    payloadWords: payloadTokens.map(t => t.word.toLowerCase()),
  };

  // Clean up orphaned entries before handler runs
  if (callbacks.onBeforeCommandExecute) {
    try {
      callbacks.onBeforeCommandExecute();
    } catch (err) {
      console.warn('[VoiceCommandEngine] onBeforeCommandExecute callback error:', err);
    }
  }

  try {
    command.handler(context);
  } catch (err) {
    console.error(`[VoiceCommandEngine] Payload handler error for "${command.id}":`, err);
  }

  if (callbacks.onCommandExecuted) {
    try {
      callbacks.onCommandExecuted(command.id, command.description);
    } catch (err) {
      console.warn('[VoiceCommandEngine] onCommandExecuted callback error:', err);
    }
  }

  if (callbacks.resumeInactivityTimer) {
    callbacks.resumeInactivityTimer();
  }

  resetState();
}

/**
 * Abort payload collection and flush all consumed tokens back to the
 * regular pipeline (trigger tokens + payload tokens + optional failing token).
 *
 * @param {{ word: string, originalText: string }|null} failingToken
 */
function abortPayloadCollection(failingToken) {
  const allTokens = [...state.payloadTriggerTokens, ...state.payloadTokens];
  if (failingToken) {
    if (allTokens.length > 0 && !/^\s/.test(failingToken.originalText)) {
      failingToken = { ...failingToken, originalText: ' ' + failingToken.originalText };
    }
    allTokens.push(failingToken);
  }

  const flushedText = reassembleTokens(allTokens);
  console.log(`[VoiceCommandEngine] Aborting payload collection — flushing "${flushedText}"`);

  if (callbacks.resumeInactivityTimer) {
    callbacks.resumeInactivityTimer();
  }

  if (flushedText) {
    emitPassthrough(flushedText);
  }

  resetState();
}

// ─── Open-Ended Collection (Type 3: open_ended commands) ─────────────

/**
 * Start open-ended collection for a Type 3 command.
 * Called when a trigger sequence matches and the command type is 'open_ended'.
 * Transitions to COLLECTING_OPEN_PAYLOAD and accumulates all subsequent tokens
 * until a silence timeout (1200ms).
 *
 * @param {{ command: object, matchedWords: number }} match
 */
function startOpenEndedCollection(match) {
  const { command } = match;

  // Preserve trigger tokens for potential flush on empty payload
  const triggerTokens = state.bufferedTokens.slice(0, match.matchedWords);

  console.log(`[VCE-DIAG] Starting open-ended collection for "${command.id}" (${triggerTokens.length} trigger tokens)`);

  clearSilenceTimer();
  state.phase = 'COLLECTING_OPEN_PAYLOAD';
  state.openEndedCommand = command;
  state.openEndedTokens = [];
  state.openEndedTriggerTokens = triggerTokens;
  state.bufferedTokens = [];
  state.candidateCommands = [];
  state.completedMatch = null;

  // Ensure inactivity timer is suspended during collection
  if (callbacks.suspendInactivityTimer) {
    callbacks.suspendInactivityTimer();
  }

  // Notify UI that open-ended collection has started
  if (callbacks.onOpenEndedCollectionStarted) {
    try {
      callbacks.onOpenEndedCollectionStarted(command.id, command.description);
    } catch (err) {
      console.warn('[VoiceCommandEngine] onOpenEndedCollectionStarted callback error:', err);
    }
  }

  resetSilenceTimer(OPEN_ENDED_SILENCE_TIMEOUT_MS);
}

/**
 * Accumulate a single token during open-ended collection.
 * Every token is unconditionally added — no evaluation or filtering.
 *
 * @param {{ word: string, originalText: string }} token
 */
function collectOpenEndedToken(token) {
  // Fix cross-final spacing (same logic as BUFFERING/COLLECTING_PAYLOAD)
  if (state.openEndedTokens.length > 0 && !/^\s/.test(token.originalText)) {
    token = { ...token, originalText: ' ' + token.originalText };
  }

  state.openEndedTokens.push(token);
  console.log(`[VCE-DIAG] COLLECTING_OPEN_PAYLOAD: "${token.word}" accumulated (${state.openEndedTokens.length} total)`);

  // Reset silence timer — each new token refreshes the 1200ms window
  resetSilenceTimer(OPEN_ENDED_SILENCE_TIMEOUT_MS);
}

/**
 * Execute a Type 3 open-ended command with the collected payload.
 * Assembles the open payload context and calls the handler.
 */
function executeOpenEndedCommand() {
  const command = state.openEndedCommand;
  const payloadTokens = [...state.openEndedTokens];
  const triggerTokens = [...state.openEndedTriggerTokens];

  console.log(`[VCE-DIAG] EXECUTING open-ended command: "${command.id}", ${payloadTokens.length} payload tokens`);
  state.phase = 'EXECUTING';
  clearSilenceTimer();

  const consumedTokens = [...triggerTokens, ...payloadTokens];
  const consumedText = reassembleTokens(consumedTokens);

  const context = {
    commandId: command.id,
    commandType: command.type,
    consumedText,
    consumedTokens,
    openEndedPayloadTokens: payloadTokens,
    openEndedPayloadText: reassembleTokens(payloadTokens),
  };

  // Notify UI that open-ended collection has ended
  if (callbacks.onOpenEndedCollectionEnded) {
    try {
      callbacks.onOpenEndedCollectionEnded();
    } catch (err) {
      console.warn('[VoiceCommandEngine] onOpenEndedCollectionEnded callback error:', err);
    }
  }

  // Clean up orphaned entries before handler runs
  if (callbacks.onBeforeCommandExecute) {
    try {
      callbacks.onBeforeCommandExecute();
    } catch (err) {
      console.warn('[VoiceCommandEngine] onBeforeCommandExecute callback error:', err);
    }
  }

  try {
    command.handler(context);
  } catch (err) {
    console.error(`[VoiceCommandEngine] Open-ended handler error for "${command.id}":`, err);
  }

  if (callbacks.onCommandExecuted) {
    try {
      callbacks.onCommandExecuted(command.id, command.description);
    } catch (err) {
      console.warn('[VoiceCommandEngine] onCommandExecuted callback error:', err);
    }
  }

  if (callbacks.resumeInactivityTimer) {
    callbacks.resumeInactivityTimer();
  }

  resetState();
}

// ─── Buffer Flush ────────────────────────────────────────────────────

/**
 * Flush all buffered tokens back to the regular ASR pipeline.
 * Called when we determine the buffered text is NOT a voice command.
 */
function flushBuffer() {
  console.log(`[VCE-DIAG] FLUSH: ${state.bufferedTokens.length} tokens → passthrough`);
  if (state.bufferedTokens.length === 0) {
    resetState();
    return;
  }

  const flushedText = reassembleTokens(state.bufferedTokens);
  console.log(`[VoiceCommandEngine] Flushing "${flushedText}" to regular pipeline`);

  // Resume inactivity timer BEFORE passthrough so the timer
  // starts from the arrival of this text, not from when we
  // originally trapped it.
  if (callbacks.resumeInactivityTimer) {
    callbacks.resumeInactivityTimer();
  }

  // Feed flushed text through the regular pipeline
  emitPassthrough(flushedText);

  // Reset to IDLE
  resetState();
}

/**
 * Emit text to the passthrough (regular ASR pipeline) callback.
 * @param {string} text
 */
function emitPassthrough(text) {
  if (!text) return;
  if (callbacks.passthrough) {
    try {
      callbacks.passthrough(text);
    } catch (err) {
      console.error('[VoiceCommandEngine] Passthrough callback error:', err);
    }
  } else {
    console.warn('[VoiceCommandEngine] No passthrough callback — text lost:', text);
  }
}

// ─── Silence Timer ───────────────────────────────────────────────────

/**
 * Reset (restart) the 450ms silence timer.
 * If it fires, we either execute a completed match or flush the buffer.
 */
function resetSilenceTimer(timeoutMs = SILENCE_TIMEOUT_MS) {
  clearSilenceTimer();
  state.silenceTimer = setTimeout(() => {
    state.silenceTimer = null;
    onSilenceTimeout();
  }, timeoutMs);
}

/**
 * Clear the silence timer.
 */
function clearSilenceTimer() {
  if (state.silenceTimer) {
    clearTimeout(state.silenceTimer);
    state.silenceTimer = null;
  }
}

/**
 * Called when 450ms passes without new ASR tokens while BUFFERING.
 */
function onSilenceTimeout() {
  // ── Handle open-ended collection timeout (Type 3) ──
  if (state.phase === 'COLLECTING_OPEN_PAYLOAD') {
    console.log(`[VCE-DIAG] SILENCE TIMEOUT in COLLECTING_OPEN_PAYLOAD: command="${state.openEndedCommand.id}", tokens=${state.openEndedTokens.length}`);

    // Notify UI that collection is ending
    if (callbacks.onOpenEndedCollectionEnded) {
      try { callbacks.onOpenEndedCollectionEnded(); } catch (e) { /* ignore */ }
    }

    if (state.openEndedTokens.length >= 1) {
      // Payload has at least 1 word — execute the command
      executeOpenEndedCommand();
    } else {
      // Empty payload (false trigger) — flush trigger tokens back to pipeline
      console.log(`[VoiceCommandEngine] Open-ended timeout with empty payload — flushing trigger tokens back`);
      const triggerText = reassembleTokens(state.openEndedTriggerTokens);
      if (callbacks.resumeInactivityTimer) {
        callbacks.resumeInactivityTimer();
      }
      if (triggerText) {
        emitPassthrough(triggerText);
      }
      resetState();
    }
    return;
  }

  // ── Handle payload collection timeout (Type 2) ──
  if (state.phase === 'COLLECTING_PAYLOAD') {
    console.log(`[VCE-DIAG] SILENCE TIMEOUT in COLLECTING_PAYLOAD: command="${state.payloadCommand.id}", payloadTokens=${state.payloadTokens.length}`);
    const result = state.payloadCommand.onPayloadTimeout(state.payloadState);
    if (result.action === 'execute') {
      state.payloadState = result.payloadState;
      executePayloadCommand();
    } else {
      abortPayloadCollection(null);
    }
    return;
  }

  if (state.phase !== 'BUFFERING') return;

  console.log(`[VCE-DIAG] SILENCE TIMEOUT: phase=${state.phase}, completedMatch=${state.completedMatch?.command?.id || 'none'}, buffer=[${state.bufferedTokens.map(t => t.word).join(', ')}]`);

  if (state.completedMatch) {
    const commandTokenCount = state.completedMatch.matchedWords;
    const remainingTokens = state.bufferedTokens.slice(commandTokenCount);

    if (state.completedMatch.command.type === 'open_ended') {
      console.log(`[VoiceCommandEngine] Silence timeout — starting open-ended collection for "${state.completedMatch.command.id}"`);
      startOpenEndedCollection(state.completedMatch);
      // Re-process remaining tokens as open-ended payload
      for (const tok of remainingTokens) {
        collectOpenEndedToken(tok);
      }
    } else if (state.completedMatch.command.type === 'close_ended') {
      console.log(`[VoiceCommandEngine] Silence timeout — starting payload collection for "${state.completedMatch.command.id}"`);
      startPayloadCollection(state.completedMatch);
      for (const tok of remainingTokens) {
        processOneToken(tok, remainingTokens, 0);
      }
    } else {
      console.log(`[VoiceCommandEngine] Silence timeout — executing completed command: "${state.completedMatch.command.id}"`);
      executeCommand(state.completedMatch);

      if (remainingTokens.length > 0) {
        const remainingText = reassembleTokens(remainingTokens);
        console.log(`[VoiceCommandEngine] Flushing ${remainingTokens.length} remaining tokens after timeout command: "${remainingText}"`);
        emitPassthrough(remainingText);
      }
    }
  } else {
    // No completed command — flush everything
    console.log(`[VoiceCommandEngine] Silence timeout — no complete command, flushing ${state.bufferedTokens.length} tokens`);
    flushBuffer();
  }
}

// ─── Debug / Inspection ──────────────────────────────────────────────

/**
 * Get the current engine state (for debugging/testing).
 * @returns {{ phase: string, bufferedWords: string[], candidateCount: number }}
 */
export function getState() {
  return {
    phase: state.phase,
    bufferedWords: state.bufferedTokens.map(t => t.word),
    candidateCount: state.candidateCommands.length,
    hasCompletedMatch: state.completedMatch !== null,
    payloadCommand: state.payloadCommand?.id || null,
    payloadWords: state.payloadTokens.map(t => t.word),
  };
}

/**
 * Get all registered commands (for UI display).
 * @returns {Array<{ id: string, description: string, aliases: string[][] }>}
 */
export function getRegisteredCommands() {
  return commands.map(cmd => ({
    id: cmd.id,
    description: cmd.description,
    aliases: cmd.triggerSequences,
  }));
}

// ─── Speech Activity Signal ──────────────────────────────────────────

/**
 * Signal that speech activity is ongoing (e.g., an interim result arrived).
 * If the engine is currently BUFFERING, this resets the silence timer
 * to prevent premature timeout while the ASR is still processing speech.
 *
 * This is ASR-vendor-agnostic: it simply tells the engine "the user is
 * still speaking, don't flush yet." Combined with the 750ms timer,
 * this provides robust protection against premature command flush.
 */
export function signalSpeechActivity() {
  if (state.phase === 'BUFFERING' || state.phase === 'COLLECTING_PAYLOAD') {
    console.log(`[VCE-DIAG] signalSpeechActivity: resetting silence timer (phase=${state.phase}, buffer=[${state.bufferedTokens.map(t => t.word).join(', ')}])`);
    resetSilenceTimer();
  } else if (state.phase === 'COLLECTING_OPEN_PAYLOAD') {
    console.log(`[VCE-DIAG] signalSpeechActivity: resetting open-ended silence timer (${state.openEndedTokens.length} tokens collected)`);
    resetSilenceTimer(OPEN_ENDED_SILENCE_TIMEOUT_MS);
  }
}

export default {
  registerCommand,
  tokenize,
  reassembleTokens,
  processTokens,
  init,
  shutdown,
  getState,
  getRegisteredCommands,
  signalSpeechActivity,
};
