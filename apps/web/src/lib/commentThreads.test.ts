import { describe, expect, it } from 'vitest';
import { buildThreads, filterThreads, type CommentRow } from './commentThreads';

const c = (id: string, over: Partial<CommentRow> = {}): CommentRow => ({
  id: `row-${id}`, post_id: 'p1', platform: 'youtube', external_comment_id: id, parent_external_id: null,
  author_name: 'Fan', text: id, commented_at: '2026-09-26T10:00:00Z', is_own: false, ...over,
});

describe('buildThreads', () => {
  it('groups replies under their top-level comment and marks answered ones', () => {
    const threads = buildThreads([
      c('a', { commented_at: '2026-09-26T10:00:00Z' }),
      c('a1', { parent_external_id: 'a', is_own: true, commented_at: '2026-09-26T11:00:00Z' }),
      c('b', { commented_at: '2026-09-26T12:00:00Z' }),
    ]);
    expect(threads.map((t) => t.root.external_comment_id)).toEqual(['b', 'a']); // newest activity first
    expect(threads[0].needsReply).toBe(true);
    expect(threads[1].replies).toHaveLength(1);
    expect(threads[1].needsReply).toBe(false);
  });

  it('needs a reply again when the reader answers after us, and follows reply-to-reply chains', () => {
    const [t] = buildThreads([
      c('a'),
      c('a1', { parent_external_id: 'a', is_own: true, commented_at: '2026-09-26T11:00:00Z' }),
      c('a2', { parent_external_id: 'a1', commented_at: '2026-09-26T12:00:00Z' }),
    ]);
    expect(t.replies.map((r) => r.external_comment_id)).toEqual(['a1', 'a2']);
    expect(t.needsReply).toBe(true);
  });

  it('keeps platforms apart, keeps our own comments (not needing a reply) and skips orphan replies', () => {
    const threads = buildThreads([
      c('x', { platform: 'facebook' }),
      c('x', { platform: 'instagram', id: 'row-x-ig' }),
      c('mine', { is_own: true }),
      c('orphan', { parent_external_id: 'missing' }),
    ]);
    expect(threads).toHaveLength(3);
    expect(threads.find((t) => t.root.external_comment_id === 'mine')?.needsReply).toBe(false);
  });
});

describe('filterThreads', () => {
  const threads = buildThreads([
    c('a', { platform: 'facebook' }),
    c('a1', { platform: 'facebook', parent_external_id: 'a', is_own: true, commented_at: '2026-09-26T11:00:00Z' }),
    c('b', { platform: 'youtube', post_id: 'p2' }),
  ]);
  it('filters by platform, post and status', () => {
    expect(filterThreads(threads, { platform: 'facebook' })).toHaveLength(1);
    expect(filterThreads(threads, { platform: 'all', status: 'unanswered' }).map((t) => t.root.external_comment_id)).toEqual(['b']);
    expect(filterThreads(threads, { status: 'answered' }).map((t) => t.root.external_comment_id)).toEqual(['a']);
    expect(filterThreads(threads, { postId: 'p2' })).toHaveLength(1);
  });
});
