const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJson, interpretParsed } = require('../src/services/parser');

test('extractJson parses exact JSON', () => {
  const result = extractJson('{"item":"eggs","quantity":10}');
  assert.deepEqual(result, { item: 'eggs', quantity: 10 });
});

test('extractJson unwraps a markdown-fenced response', () => {
  const raw = 'Sure, here you go:\n```json\n{"item":"eggs","quantity":10}\n```\nHope that helps!';
  const result = extractJson(raw);
  assert.deepEqual(result, { item: 'eggs', quantity: 10 });
});

test('extractJson finds a JSON object embedded in prose', () => {
  const raw = 'The parsed sale is {"item":"bread","quantity":3} based on your message.';
  const result = extractJson(raw);
  assert.deepEqual(result, { item: 'bread', quantity: 3 });
});

test('extractJson returns null for a clarifying question with no JSON at all', () => {
  const result = extractJson('Could you tell me how many loaves you sold?');
  assert.equal(result, null);
});

test('extractJson returns null for malformed braces', () => {
  const result = extractJson('{item: eggs, quantity: 10'); // not valid JSON, unbalanced
  assert.equal(result, null);
});

test('interpretParsed treats a model clarification_question as a clarify result', () => {
  const result = interpretParsed({ clarification_question: 'How many eggs?' }, 'sold some eggs');
  assert.equal(result.kind, 'clarify');
  assert.equal(result.question, 'How many eggs?');
});

test('interpretParsed asks to clarify when quantity is missing', () => {
  const result = interpretParsed({ item: 'eggs', quantity: null, unit_price: 10 }, 'sold eggs');
  assert.equal(result.kind, 'clarify');
});

test('interpretParsed asks to clarify when both price fields are missing', () => {
  const result = interpretParsed({ item: 'eggs', quantity: 10 }, 'sold 10 eggs');
  assert.equal(result.kind, 'clarify');
});

test('interpretParsed accepts a fully structured, confident result', () => {
  const result = interpretParsed(
    { item: 'eggs', quantity: 10, unit_price: 15, total_amount: 150, confidence: 0.9, occurred_at: '2026-07-30T10:00:00Z' },
    'sold 10 eggs at 15 each'
  );
  assert.equal(result.kind, 'structured');
  assert.equal(result.item, 'eggs');
  assert.equal(result.quantity, 10);
  assert.equal(result.totalAmount, 150);
});

test('interpretParsed treats null/non-object input as unparseable', () => {
  assert.equal(interpretParsed(null, 'x').kind, 'unparseable');
  assert.equal(interpretParsed(undefined, 'x').kind, 'unparseable');
});

test('interpretParsed clarifies on low confidence even with complete fields', () => {
  const result = interpretParsed(
    { item: 'eggs', quantity: 10, total_amount: 150, confidence: 0.2 },
    'maybe sold some eggs?'
  );
  assert.equal(result.kind, 'clarify');
});
