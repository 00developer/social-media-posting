"use strict";
// Thin wrapper around the Anthropic Messages API. Plain `fetch`, not the SDK - one less dependency to pin, and
// every other service in this repo already talks to third-party APIs the same way (see e.g. publishedStats.ts).
//
// The API key is only read when a call is actually made (not at import time), so services can start up and the
// rest of the app keeps working even before ANTHROPIC_API_KEY is set in .env - AI features just return a clear
// "not configured" error until then.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiNotConfiguredError = exports.GENERATE_MODEL = exports.CLASSIFY_MODEL = void 0;
exports.complete = complete;
exports.parseJson = parseJson;
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Model ids per Anthropic's current naming (see the Claude API docs for the full list).
exports.CLASSIFY_MODEL = process.env.AI_CLASSIFY_MODEL || 'claude-haiku-4-5-20251001'; // cheap + fast, used for spam/negative triage
exports.GENERATE_MODEL = process.env.AI_GENERATE_MODEL || 'claude-sonnet-5'; // higher quality, used for anything shown to the reader
class AiNotConfiguredError extends Error {
    constructor() { super('AI features are not set up yet: ANTHROPIC_API_KEY is missing from the environment.'); }
}
exports.AiNotConfiguredError = AiNotConfiguredError;
/** Calls the Messages API and returns the concatenated text of the response. Throws AiNotConfiguredError if no key. */
async function complete(opts) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
        throw new AiNotConfiguredError();
    const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify({ model: opts.model, system: opts.system, messages: opts.messages, max_tokens: opts.maxTokens ?? 1024 }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(body?.error?.message || `Anthropic API error (HTTP ${res.status})`);
    return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}
/** Parses the model's reply as JSON, tolerating a ```json fence around it (models add one fairly often). */
function parseJson(text) {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
}
