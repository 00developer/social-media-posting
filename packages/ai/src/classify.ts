// Decides what (if anything) should happen next for an incoming comment, BEFORE spending a generation on a reply.
import { complete, parseJson, CLASSIFY_MODEL } from './client';

export type CommentClass = 'normal' | 'spam' | 'negative';

const SYSTEM = `You triage comments on a social media post for a small business's social media manager.
Classify the comment into exactly one category:
- "spam": unrelated to the post, a bot/promo comment, gibberish, or a link-only comment.
- "negative": a genuine complaint, criticism, or an angry/upset reader - anything that deserves a careful human reply, not an automatic one.
- "normal": a genuine, ordinary comment (question, compliment, casual remark) that a friendly short reply would suit.
When unsure between "negative" and "normal", prefer "negative" - a human should look at anything borderline. When unsure between "spam" and "normal", prefer "normal" - do not silently hide a real comment.
Reply with ONLY JSON: {"category": "normal" | "spam" | "negative"}`;

export async function classifyComment(opts: { commentText: string; postCaption?: string }): Promise<CommentClass> {
  const prompt = [
    opts.postCaption ? `Original post caption: """${opts.postCaption}"""` : null,
    `Comment: """${opts.commentText}"""`,
  ].filter(Boolean).join('\n\n');

  const text = await complete({ model: CLASSIFY_MODEL, system: SYSTEM, messages: [{ role: 'user', content: prompt }], maxTokens: 50 });
  try {
    const { category } = parseJson<{ category: string }>(text);
    if (category === 'spam' || category === 'negative' || category === 'normal') return category;
  } catch { /* fall through to the safe default below */ }
  return 'negative'; // an unparsable response is treated as "needs a human", never silently dropped
}
