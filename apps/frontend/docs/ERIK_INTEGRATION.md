# ERIK Integration Guide

This document explains how to integrate ERIK (Enhanced Radiology Insight Kit) into your UI.

## Overview

ERIK provides AI-powered clinical insights by analyzing patient data including radiology reports, clinical notes, problems, medications, labs, and vital signs.

## API Endpoints

### 1. Check Data Availability
```
POST /api/erik/availability
```

Returns what data types are available for a specific case.

**Request:**
```json
{
  "case_key": "patient-1"
}
```

**Response:**
```json
{
  "availability": {
    "radiology": true,
    "problems": true,
    "notes": true,
    "surgery": false,
    "medications": true,
    "labs": true,
    "vitals": true
  }
}
```

### 2. Determine Data Needs
```
POST /api/erik/needs
```

Analyzes the question and determines what patient data is needed to answer it.

**Request:**
```json
{
  "case_key": "patient-1",
  "question": "What imaging findings support the stroke diagnosis?"
}
```

**Response:**
```json
{
  "needs": {
    "radiology": true,
    "problems": true,
    "notes": false,
    "surgery": false,
    "medications": false,
    "labs": false,
    "vitals": false
  },
  "reasoning": "Question relates to imaging findings and diagnosis"
}
```

### 3. Stream Answer
```
POST /api/erik/stream
```

Streams the AI-generated answer. Uses Server-Sent Events (SSE) format.

**Request:**
```json
{
  "case_key": "patient-1",
  "question": "What imaging findings support the stroke diagnosis?",
  "needs": { "radiology": true, "problems": true },
  "availability": { "radiology": true, "problems": true }
}
```

**Response:** Streamed text chunks

### 4. Debug Endpoints
```
POST /api/erik/last-needs   - Returns last needs assessment (for debugging)
POST /api/erik/last-ask     - Returns last ask context (for debugging)
```

## Integration Example

### Basic JavaScript Integration

```javascript
class ErikClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async getAvailability(caseKey) {
    const res = await fetch(`${this.baseUrl}/api/erik/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_key: caseKey })
    });
    return res.json();
  }

  async getNeeds(caseKey, question) {
    const res = await fetch(`${this.baseUrl}/api/erik/needs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_key: caseKey, question })
    });
    return res.json();
  }

  async askStreaming(caseKey, question, needs, availability, onChunk) {
    const res = await fetch(`${this.baseUrl}/api/erik/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_key: caseKey, question, needs, availability })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      fullText += chunk;
      if (onChunk) onChunk(chunk, fullText);
    }

    return fullText;
  }

  // Convenience method: full flow
  async ask(caseKey, question, onChunk) {
    const { availability } = await this.getAvailability(caseKey);
    const { needs } = await this.getNeeds(caseKey, question);
    return this.askStreaming(caseKey, question, needs, availability, onChunk);
  }
}
```

### Usage Example

```javascript
const erik = new ErikClient();

// Simple usage with streaming
async function askErik() {
  const answer = await erik.ask('patient-1', 'Summarize the imaging findings', (chunk, full) => {
    document.getElementById('answer').textContent = full;
  });
  console.log('Final answer:', answer);
}

// Manual flow for more control
async function askErikManual() {
  const caseKey = 'patient-1';
  const question = 'What medications is the patient on?';

  // Step 1: Check availability
  const { availability } = await erik.getAvailability(caseKey);
  console.log('Available data:', availability);

  // Step 2: Determine needs
  const { needs } = await erik.getNeeds(caseKey, question);
  console.log('Data needed:', needs);

  // Step 3: Stream answer
  const answer = await erik.askStreaming(caseKey, question, needs, availability, (chunk) => {
    process.stdout.write(chunk); // or update UI
  });
}
```

### HTML Example

```html
<div class="erik-chat">
  <input type="text" id="erikQuestion" placeholder="Ask ERIK..." />
  <button id="erikAsk">Ask</button>
  <div id="erikAnswer"></div>
</div>

<script>
const erik = new ErikClient();
const caseKey = 'patient-1'; // Set from your app context

document.getElementById('erikAsk').addEventListener('click', async () => {
  const question = document.getElementById('erikQuestion').value;
  const answerDiv = document.getElementById('erikAnswer');
  
  answerDiv.textContent = 'Thinking...';
  
  await erik.ask(caseKey, question, (chunk, full) => {
    answerDiv.textContent = full;
  });
});
</script>
```

## Data Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   UI/Client │────▶│  /availability   │────▶│ Check FHIR  │
└─────────────┘     └──────────────────┘     │  Resources  │
       │                                      └─────────────┘
       │
       ▼
┌──────────────────┐     ┌─────────────┐
│     /needs       │────▶│  LLM Call   │
└──────────────────┘     │ (Determine  │
       │                 │  data needs)│
       │                 └─────────────┘
       ▼
┌──────────────────┐     ┌─────────────┐
│    /stream       │────▶│  LLM Call   │
└──────────────────┘     │ (Generate   │
       │                 │   answer)   │
       ▼                 └─────────────┘
┌─────────────┐
│  Streamed   │
│   Answer    │
└─────────────┘
```

## Configuration

ERIK requires the following environment variables:

```env
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4o          # or gpt-4-turbo, etc.
```

## Case Key Format

The `case_key` parameter identifies which patient/case to query. It corresponds to entries in `data/cases.manifest.json`:

```json
{
  "cases": [
    {
      "id": "patient-1",
      "label": "Patient 1 - Stroke Case",
      "patientId": "1"
    }
  ]
}
```

## Error Handling

All endpoints return standard HTTP status codes:

- `200` - Success
- `400` - Bad request (missing parameters)
- `404` - Case not found
- `500` - Server error

Error response format:
```json
{
  "error": "error_code",
  "message": "Human readable message"
}
```

## Styling

### Required CSS Files

Include these stylesheets in your HTML:

```html
<link rel="stylesheet" href="/css/newvue-theme.css" />
<link rel="stylesheet" href="/css/erik-sparkle-button.css" />
```

### ERIK Chat Container

```css
/* Basic chat container */
.erik-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1f2e;
  border-radius: 8px;
  overflow: hidden;
}

/* Messages area */
.erik-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Individual message bubble */
.erik-bubble {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
}

.erik-bubble.user {
  align-self: flex-end;
  background: #3a7bd5;
  color: white;
}

.erik-bubble.erik {
  align-self: flex-start;
  background: #2b3342;
  color: #dbe9f7;
}

/* Input area */
.erik-input-area {
  display: flex;
  gap: 8px;
  padding: 12px;
  background: #232936;
  border-top: 1px solid #3a475d;
}

.erik-input {
  flex: 1;
  padding: 10px 14px;
  background: #1a1f2e;
  border: 1px solid #3a475d;
  border-radius: 8px;
  color: #dbe9f7;
  font-size: 14px;
}

.erik-input:focus {
  outline: none;
  border-color: #3a7bd5;
}

.erik-send-btn {
  padding: 10px 16px;
  background: #3a7bd5;
  border: none;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  transition: background 0.2s;
}

.erik-send-btn:hover {
  background: #2d6bc4;
}

.erik-send-btn:disabled {
  background: #3a475d;
  cursor: not-allowed;
}
```

### Sparkle Button Effect

The ERIK send button includes a sparkle animation effect. Include the sparkle button CSS:

```css
/* Sparkle button container */
.erik-sparkle-btn {
  position: relative;
  overflow: visible;
}

/* Sparkle layer overlay */
.erik-sparkle-layer {
  position: absolute;
  inset: -20px;
  pointer-events: none;
  overflow: visible;
}

/* Individual sparkle animations */
.erik-sparkle-layer .spark {
  position: absolute;
  width: 6px;
  height: 6px;
  opacity: 0;
  animation: sparkle 1.5s ease-in-out infinite;
}

@keyframes sparkle {
  0%, 100% { opacity: 0; transform: scale(0); }
  50% { opacity: 1; transform: scale(1); }
}

/* Stagger sparkle animations */
.spark.s1 { left: 10%; top: 20%; animation-delay: 0s; }
.spark.s2 { left: 30%; top: 10%; animation-delay: 0.1s; }
.spark.s3 { left: 50%; top: 25%; animation-delay: 0.2s; }
.spark.s4 { left: 70%; top: 15%; animation-delay: 0.3s; }
.spark.s5 { left: 90%; top: 20%; animation-delay: 0.4s; }
.spark.s6 { left: 20%; top: 80%; animation-delay: 0.5s; }
.spark.s7 { left: 40%; top: 85%; animation-delay: 0.6s; }
.spark.s8 { left: 60%; top: 75%; animation-delay: 0.7s; }
.spark.s9 { left: 80%; top: 85%; animation-delay: 0.8s; }
```

### Loading State

```css
/* Typing indicator */
.erik-typing {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
}

.erik-typing span {
  width: 8px;
  height: 8px;
  background: #5a6a7d;
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}

.erik-typing span:nth-child(1) { animation-delay: 0s; }
.erik-typing span:nth-child(2) { animation-delay: 0.2s; }
.erik-typing span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}
```

### Complete HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ERIK Chat</title>
  <link rel="stylesheet" href="/css/newvue-theme.css" />
  <link rel="stylesheet" href="/css/erik-sparkle-button.css" />
  <style>
    /* Add the CSS from above sections */
  </style>
</head>
<body>
  <div class="erik-chat">
    <div class="erik-messages" id="erikMessages">
      <!-- Messages will be added here -->
    </div>
    <div class="erik-input-area">
      <input type="text" 
             class="erik-input" 
             id="erikInput" 
             placeholder="Ask ERIK..." />
      <button class="erik-send-btn erik-sparkle-btn" id="erikSend">
        <span class="erik-sparkle-icon">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M2.5 11.5l18-8-7 17-3-6-8-3z" fill="currentColor"/>
          </svg>
        </span>
        <!-- Sparkle overlay -->
        <div class="erik-sparkle-layer">
          <svg class="spark s1" viewBox="0 0 68 68">
            <path fill="white" d="M26.5 25.5C19 33.4 0 34 0 34s19.1 1.4 26.5 9.5C33.2 50.9 34 68 34 68s3-17.3 10.5-24.5C51.6 36.6 68 34 68 34s-16.3-1.9-23.5-8.5C36.6 18.2 34 0 34 0s-.3 18 -7.5 25.5z"/>
          </svg>
          <!-- Add more sparkles as needed -->
        </div>
      </button>
    </div>
  </div>

  <script>
    // Add the ErikClient class and usage code from above
  </script>
</body>
</html>
```

### Dark Theme Variables

The demo uses these CSS custom properties for theming:

```css
:root {
  --erik-bg-primary: #1a1f2e;
  --erik-bg-secondary: #232936;
  --erik-bg-tertiary: #2b3342;
  --erik-border: #3a475d;
  --erik-text-primary: #dbe9f7;
  --erik-text-secondary: #8a9bb3;
  --erik-accent: #3a7bd5;
  --erik-accent-hover: #2d6bc4;
  --erik-success: #4caf50;
  --erik-warning: #ff9800;
  --erik-error: #f44336;
}
```

## See Also

- [ERIK API Flow](./ERIK_API_FLOW.md) - Detailed API flow documentation
- [ERIK Data Sources](./ERIK_DATA_SOURCES.md) - Data source documentation
- [ERIK Data Adapter](./ERIK_DATA_APAPTER.md) - Data adapter documentation
