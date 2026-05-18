/**
 * erikService.ts — Client-side ERIK chat service.
 *
 * Handles the SSE connection to the ERIK streaming endpoint,
 * dispatching state updates to CockpitContext as events arrive.
 *
 * The service:
 *   1. Creates the user message bubble immediately
 *   2. Connects to the SSE stream
 *   3. Shows status messages during triage/loading phases
 *   4. Streams text deltas into the assistant message bubble
 *   5. Finalizes the stream on completion or error
 */

import type { ErikMessage } from '../context/CockpitContext';

// ── Types ──────────────────────────────────────────────────────────────────

/** SSE event from the server */
interface ErikSSEEvent {
  type: 'status' | 'delta' | 'done' | 'error';
  phase?: string;
  message?: string;
  content?: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** QA fields — included on 'done' events for the QA panel */
  triageInput?: string;
  triageOutput?: string;
  triageTokens?: { input: number; output: number };
  answerInput?: string;
  answerOutput?: string;
  answerTokens?: { input: number; output: number };
}

import type { ErikQAData } from '../types/api';

/** Dispatch function type matching CockpitContext's erikDispatch */
type ErikDispatch = (action:
  | { type: 'ERIK_ADD_MESSAGE'; message: ErikMessage }
  | { type: 'ERIK_APPEND_DELTA'; messageId: string; content: string }
  | { type: 'ERIK_FINISH_STREAM'; messageId: string }
  | { type: 'ERIK_UPDATE_QA'; triage: ErikQAData | null; answer: ErikQAData | null }
) => void;

interface ErikChatRequest {
  question: string;
  patientId: string;
  currentStudyId: string | null;
  conversationHistory: { role: 'user' | 'assistant'; content: string }[];
  currentReportText?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

let idCounter = 0;
function generateId(): string {
  return `erik-${Date.now()}-${++idCounter}`;
}

// ── Main Service ──────────────────────────────────────────────────────────

/**
 * Send a question to ERIK and stream the response.
 *
 * @param request - The chat request payload
 * @param dispatch - CockpitContext's erikDispatch for state updates
 * @param onStatus - Optional callback for status phase updates (for UI indicators)
 */
export async function sendErikChat(
  request: ErikChatRequest,
  dispatch: ErikDispatch,
  onStatus?: (phase: string, message: string) => void,
): Promise<void> {
  const assistantMsgId = generateId();

  // Add the assistant message bubble (starts empty, streaming)
  dispatch({
    type: 'ERIK_ADD_MESSAGE',
    message: {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    },
  });

  try {
    const response = await fetch('/api/v1/erik/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: request.question,
        patientId: request.patientId,
        currentStudyId: request.currentStudyId || '',
        conversationHistory: request.conversationHistory,
        currentReportText: request.currentReportText || '',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      dispatch({
        type: 'ERIK_APPEND_DELTA',
        messageId: assistantMsgId,
        content: `Error: ${error || response.statusText}`,
      });
      dispatch({ type: 'ERIK_FINISH_STREAM', messageId: assistantMsgId });
      return;
    }

    // Read the SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      dispatch({
        type: 'ERIK_APPEND_DELTA',
        messageId: assistantMsgId,
        content: 'Error: Unable to read response stream.',
      });
      dispatch({ type: 'ERIK_FINISH_STREAM', messageId: assistantMsgId });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from the buffer
      // SSE format: "data: <json>\n\n"
      const lines = buffer.split('\n');
      buffer = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // If this is a data line, process it
        if (line.startsWith('data: ')) {
          const json = line.slice(6).trim();
          if (!json) continue;

          try {
            const event: ErikSSEEvent = JSON.parse(json);

            switch (event.type) {
              case 'status':
                if (onStatus && event.phase && event.message) {
                  onStatus(event.phase, event.message);
                }
                break;

              case 'delta':
                if (event.content) {
                  dispatch({
                    type: 'ERIK_APPEND_DELTA',
                    messageId: assistantMsgId,
                    content: event.content,
                  });
                }
                break;

              case 'done':
                // Stream complete — finalize and dispatch QA data
                dispatch({ type: 'ERIK_FINISH_STREAM', messageId: assistantMsgId });
                dispatch({
                  type: 'ERIK_UPDATE_QA',
                  triage: event.triageTokens ? {
                    input: event.triageInput ?? '',
                    output: event.triageOutput ?? '',
                    tokens: event.triageTokens,
                  } : null,
                  answer: event.answerTokens ? {
                    input: event.answerInput ?? '',
                    output: event.answerOutput ?? '',
                    tokens: event.answerTokens,
                  } : null,
                });
                return;

              case 'error':
                dispatch({
                  type: 'ERIK_APPEND_DELTA',
                  messageId: assistantMsgId,
                  content: event.message || 'An unknown error occurred.',
                });
                dispatch({ type: 'ERIK_FINISH_STREAM', messageId: assistantMsgId });
                return;
            }
          } catch {
            // Skip malformed JSON lines
          }
        } else if (line === '' || line.startsWith(':')) {
          // Empty line (event separator) or comment — skip
          continue;
        } else {
          // Incomplete line — put back in buffer
          buffer = lines.slice(i).join('\n');
          break;
        }
      }
    }

    // If we reach here without a 'done' event, finalize anyway
    dispatch({ type: 'ERIK_FINISH_STREAM', messageId: assistantMsgId });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dispatch({
      type: 'ERIK_APPEND_DELTA',
      messageId: assistantMsgId,
      content: `Connection error: ${message}`,
    });
    dispatch({ type: 'ERIK_FINISH_STREAM', messageId: assistantMsgId });
  }
}
