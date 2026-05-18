// ERIK API Service - Streaming with UI action support

// Use relative path — proxied through frontend's nginx/CRA dev server
const ERIK_BASE_URL = '';

export interface ErikStreamResponse {
  answer: string;
  action: string | null;
}

class ErikService {
  private baseUrl: string;

  constructor(baseUrl: string = ERIK_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async askStreaming(
    caseKey: string,
    question: string,
    onChunk?: (chunk: string, fullText: string) => void,
    onAction?: (action: string) => void,
  ): Promise<ErikStreamResponse> {
    const res = await fetch(`${this.baseUrl}/api/erik/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        case_key: caseKey,
        question,
      }),
    });

    if (!res.ok) {
      throw new Error(`Stream request failed: ${res.statusText}`);
    }

    // Check for UI action header (requires CORS exposedHeaders on backend)
    const action = res.headers.get('X-ERIK-Action');
    if (action && onAction) {
      onAction(action);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      fullText += chunk;
      if (onChunk) onChunk(chunk, fullText);
    }

    return { answer: fullText, action };
  }
}

export const erikService = new ErikService();
export default erikService;
