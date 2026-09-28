"use strict";
// Thin wrapper around Google's Gemini API (generateContent), which has a genuinely free tier (rate-limited) via
// an API key from Google AI Studio. Plain `fetch`, not an SDK - one less dependency to pin, and every other
// service in this repo already talks to third-party APIs the same way (see e.g. publishedStats.ts).
//
// The API key is only read when a call is actually made (not at import time), so services can start up and the
// rest of the app keeps working even before GEMINI_API_KEY is set in .env - AI features just return a clear
// "not configured" error until then.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiNotConfiguredError = exports.GENERATE_MODEL = exports.CLASSIFY_MODEL = void 0;
exports.complete = complete;
exports.parseJson = parseJson;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Model ids are Google's own names - see https://ai.google.dev/gemini-api/docs/models for the current list
// (Google renames/retires preview models fairly often; "-latest" aliases track the current recommended model
// automatically). Both default to Flash Lite: cheap, fast, vision-capable, and - as of writing - noticeably less
// congested on the free tier than the full "gemini-flash-latest" model, which returned "high demand" errors on
// every attempt in testing. Bump AI_GENERATE_MODEL in .env to a stronger model (e.g. "gemini-flash-latest" or a
// Pro tier) whenever quality matters more than reliability/cost - no code change needed either way.
exports.CLASSIFY_MODEL = process.env.AI_CLASSIFY_MODEL || 'gemini-flash-lite-latest'; // cheap + fast, used for spam/negative triage
exports.GENERATE_MODEL = process.env.AI_GENERATE_MODEL || 'gemini-flash-lite-latest'; // used for anything shown to the reader
class AiNotConfiguredError extends Error {
    constructor() { super('AI features are not set up yet: GEMINI_API_KEY is missing from the environment.'); }
}
exports.AiNotConfiguredError = AiNotConfiguredError;
// Caches the fetched+base64-encoded image by URL: "Generate" and "Regenerate" both re-send the same imageUrl for
// the same compose session, and without this each click re-downloaded the image from Supabase Storage (counted
// as billed egress) purely to re-encode bytes that hadn't changed. A small in-memory FIFO cache is enough here -
// post-service is a single long-running process, not a stateless/serverless one, so it persists across requests.
const inlineImageCache = new Map();
const INLINE_IMAGE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes - long enough to cover a compose session
const INLINE_IMAGE_CACHE_MAX_ENTRIES = 50; // bounds memory; oldest entry is evicted once full
async function toInlineImage(url) {
    const cached = inlineImageCache.get(url);
    if (cached && Date.now() - cached.cachedAt < INLINE_IMAGE_CACHE_TTL_MS) {
        return { mimeType: cached.mimeType, data: cached.data };
    }
    // A User-Agent header, because some hosts (Wikipedia among them) refuse a request without one; harmless for our
    // own Supabase storage URLs either way.
    const res = await fetch(url, { headers: { 'user-agent': 'SocialPush/1.0' } });
    if (!res.ok)
        throw new Error(`Could not fetch the image for the AI (HTTP ${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const result = { mimeType: res.headers.get('content-type') || 'image/jpeg', data: buffer.toString('base64') };
    if (inlineImageCache.size >= INLINE_IMAGE_CACHE_MAX_ENTRIES) {
        const oldestKey = inlineImageCache.keys().next().value;
        if (oldestKey !== undefined)
            inlineImageCache.delete(oldestKey);
    }
    inlineImageCache.set(url, { ...result, cachedAt: Date.now() });
    return result;
}
async function toGeminiParts(content) {
    if (typeof content === 'string')
        return [{ text: content }];
    return Promise.all(content.map(async (part) => part.type === 'text' ? { text: part.text } : { inlineData: await toInlineImage(part.image_url.url) }));
}
/** Calls Gemini's generateContent and returns the model's reply text. Throws AiNotConfiguredError if no key. */
async function complete(opts) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
        throw new AiNotConfiguredError();
    // Gemini has no "system" role in `contents` (the prompt goes in systemInstruction instead), and its own
    // history role for a model turn is "model" rather than "assistant".
    const contents = await Promise.all(opts.messages.map(async (m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: await toGeminiParts(m.content),
    })));
    const res = await fetch(`${GEMINI_API_BASE}/models/${opts.model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.system }] },
            contents,
            generationConfig: { maxOutputTokens: opts.maxTokens ?? 1024 },
        }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(body?.error?.message || `Gemini API error (HTTP ${res.status})`);
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text || '').join('').trim();
}
/** Parses the model's reply as JSON, tolerating a ```json fence around it (models add one fairly often). */
function parseJson(text) {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
}
