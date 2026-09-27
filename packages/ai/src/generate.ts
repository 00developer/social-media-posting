import { complete, parseJson, GENERATE_MODEL, type Message } from './client';

// --- Feature 1: caption / hashtag generator for the post composer -------------------------------------------------

export type CaptionResult = { caption: string; paragraph: string; hashtags: string[] };

const CAPTION_SYSTEM = `You write social media post copy for a small business's social media manager.
Given a short prompt or keyword (and optionally a description of an attached image or video), produce:
- "caption": one punchy line suitable as the main caption (no hashtags in it).
- "paragraph": a slightly longer 2-4 sentence version, for platforms that show more text.
- "hashtags": 5-8 relevant hashtags, each starting with # and no spaces inside a tag.
Keep the tone friendly and specific to the prompt, not generic filler. Do not invent facts, prices, or claims not implied by the prompt.
Reply with ONLY JSON: {"caption": string, "paragraph": string, "hashtags": string[]}`;

export async function generateCaption(opts: { prompt: string; mediaDescription?: string; platform?: string }): Promise<CaptionResult> {
  const parts = [
    `Prompt: ${opts.prompt}`,
    opts.mediaDescription ? `Attached media: ${opts.mediaDescription}` : null,
    opts.platform ? `Target platform: ${opts.platform}` : null,
  ].filter(Boolean).join('\n');

  const text = await complete({ model: GENERATE_MODEL, system: CAPTION_SYSTEM, messages: [{ role: 'user', content: parts }], maxTokens: 500 });
  const result = parseJson<CaptionResult>(text);
  if (!result.caption || !Array.isArray(result.hashtags)) throw new Error('AI returned an unexpected shape for the caption result.');
  return result;
}

/** Same as generateCaption, but also gives the model a look at the attached thumbnail/image (vision input). */
export async function generateCaptionFromImage(opts: { prompt: string; imageUrl: string; platform?: string }): Promise<CaptionResult> {
  const content: Message['content'] = [
    { type: 'text', text: `Prompt: ${opts.prompt}${opts.platform ? `\nTarget platform: ${opts.platform}` : ''}` },
    { type: 'image', source: { type: 'url', url: opts.imageUrl } },
  ];
  const text = await complete({ model: GENERATE_MODEL, system: CAPTION_SYSTEM, messages: [{ role: 'user', content }], maxTokens: 500 });
  const result = parseJson<CaptionResult>(text);
  if (!result.caption || !Array.isArray(result.hashtags)) throw new Error('AI returned an unexpected shape for the caption result.');
  return result;
}

// --- Feature 2: suggested reply for a "normal" comment -------------------------------------------------------------

const REPLY_SYSTEM = `You draft a short reply, as the business's social media manager, to a comment on the business's own post.
Use the original post's caption as context so the reply feels relevant, not generic. Keep it brief (1-2 sentences), friendly,
and in plain text (no hashtags, no emoji unless the comment itself uses them). This is a DRAFT a human will review before
sending, so it is fine to be direct and simple. Reply with ONLY the reply text, nothing else - no quotes, no JSON.`;

export async function generateReply(opts: { commentText: string; authorName?: string; postCaption?: string }): Promise<string> {
  const prompt = [
    opts.postCaption ? `Original post caption: """${opts.postCaption}"""` : null,
    `Comment${opts.authorName ? ` from ${opts.authorName}` : ''}: """${opts.commentText}"""`,
  ].filter(Boolean).join('\n\n');

  const text = await complete({ model: GENERATE_MODEL, system: REPLY_SYSTEM, messages: [{ role: 'user', content: prompt }], maxTokens: 200 });
  if (!text) throw new Error('AI returned an empty reply.');
  return text;
}
