const DEFAULT_RAPIDAPI_URL = 'https://chatgpt-42.p.rapidapi.com/conversationgpt4-2';
// RapidAPI's free-tier GPT endpoints routinely take 15-20s to respond
// (measured directly against open-ai21, the previous endpoint), so a
// timeout much below that turns ordinary slow-but-successful calls into
// unnecessary queue/retry cycles.
const REQUEST_TIMEOUT_MS = 28000;

function getRapidApiUrl() {
  return process.env.RAPIDAPI_URL || DEFAULT_RAPIDAPI_URL;
}

function getRapidApiHost() {
  return new URL(getRapidApiUrl()).host;
}

class RemoteApiError extends Error {}

function buildPrompt(rawText, nowIso) {
  return [
    'You convert a market trader\'s spoken or typed sale description into strict JSON.',
    `The current date and time is ${nowIso}; resolve relative phrases ("this morning", "by 12pm", "today") against it.`,
    'Respond with ONLY a single JSON object, no prose, no markdown fences, no explanation. Shape:',
    '{"item": string, "quantity": number, "unit_price": number|null, "total_amount": number|null, "occurred_at": ISO 8601 string, "confidence": number between 0 and 1}',
    'If the item or quantity is genuinely ambiguous and you cannot confidently fill those two fields, respond instead with',
    '{"clarification_question": string} asking the single most useful follow-up question.',
    `Trader's sale: "${rawText}"`,
  ].join('\n');
}

// Calls the RapidAPI conversational endpoint (see RAPIDAPI_URL). Throws
// RemoteApiError on anything that should be treated as "the API is
// unavailable right now" (network failure, timeout, 5xx/429) so the caller
// can queue the entry for retry instead of losing it. Any other thrown
// error is a bug.
async function callRapidApi(rawText) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(getRapidApiUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rapidapi-host': getRapidApiHost(),
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: buildPrompt(rawText, new Date().toISOString()) }],
        system_prompt: '',
        // Low temperature: this task wants consistent, strict JSON back,
        // not creative variation.
        temperature: 0.2,
        top_k: 5,
        top_p: 0.9,
        max_tokens: 300,
        web_access: false,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new RemoteApiError(`RapidAPI request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 500 || response.status === 429) {
    throw new RemoteApiError(`RapidAPI returned ${response.status}`);
  }
  if (!response.ok) {
    throw new RemoteApiError(`RapidAPI returned ${response.status}: ${await response.text().catch(() => '')}`);
  }

  const body = await response.json();
  if (typeof body.result !== 'string') {
    throw new RemoteApiError('RapidAPI response had no "result" field');
  }
  return body.result;
}

// The API guarantees free-form text in `result`, not a schema. Try
// progressively looser extraction before giving up: exact JSON, then
// JSON inside a markdown fence, then the first balanced {...} substring
// anywhere in the text (models often wrap JSON in a sentence).
function extractJson(resultText) {
  const attempts = [
    () => JSON.parse(resultText),
    () => {
      const fenced = resultText.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (!fenced) throw new Error('no fence');
      return JSON.parse(fenced[1]);
    },
    () => {
      const start = resultText.indexOf('{');
      const end = resultText.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) throw new Error('no braces');
      return JSON.parse(resultText.slice(start, end + 1));
    },
  ];

  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (_err) {
      // try the next, looser strategy
    }
  }
  return null;
}

function coerceNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// Normalizes whatever shape the model returned into the fields SokoLedger
// actually uses, so downstream code never has to guess at types. Returns
// { kind: 'structured', ... } | { kind: 'clarify', question, partial } |
// { kind: 'unparseable', partial }.
function interpretParsed(parsed, rawText) {
  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'unparseable', partial: null };
  }

  if (typeof parsed.clarification_question === 'string' && parsed.clarification_question.trim()) {
    return { kind: 'clarify', question: parsed.clarification_question.trim(), partial: parsed };
  }

  const item = typeof parsed.item === 'string' ? parsed.item.trim() : '';
  const quantity = coerceNumber(parsed.quantity);
  const unitPrice = coerceNumber(parsed.unit_price);
  const totalAmount = coerceNumber(parsed.total_amount);
  const confidence = coerceNumber(parsed.confidence);
  const occurredAt = parsed.occurred_at && !Number.isNaN(new Date(parsed.occurred_at).getTime())
    ? new Date(parsed.occurred_at)
    : new Date();

  const lowConfidence = confidence !== null && confidence < 0.5;
  if (!item || quantity === null || quantity <= 0 || (unitPrice === null && totalAmount === null) || lowConfidence) {
    return {
      kind: 'clarify',
      question: !item || quantity === null || quantity <= 0
        ? `How many ${item || 'items'} did you sell, exactly?`
        : `How much did each ${item} sell for?`,
      partial: { item, quantity, unitPrice, totalAmount, confidence },
    };
  }

  return {
    kind: 'structured',
    item,
    quantity,
    unitPrice,
    totalAmount,
    confidence,
    occurredAt,
    rawText,
  };
}

async function parseSaleText(rawText) {
  const resultText = await callRapidApi(rawText);
  const parsed = extractJson(resultText);
  return interpretParsed(parsed, rawText);
}

module.exports = { parseSaleText, extractJson, interpretParsed, buildPrompt, RemoteApiError };
