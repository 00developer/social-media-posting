import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditPostModal, type EditablePostRecord } from './EditPostModal';

// Server-side render of each state. This proves what the modal shows for a given post (status list, gating,
// notices, counters, preview frame). Typing / clicking Save need a browser and are checked there.

const noop = () => {};
const job = (platform: string, status: string, extra: Record<string, unknown> = {}, minute = 1) => ({
  platform,
  status,
  created_at: `2026-09-21T10:${String(minute).padStart(2, '0')}:00Z`,
  ...extra,
});
const sched = (platform: string, at = '2026-09-23T04:30:00Z') => ({ platform, scheduled_at: at, created_at: '2026-09-21T09:00:00Z' });

const basePost: EditablePostRecord = {
  id: '85e737cb-0b8a-4688-a0f4-37b1b489bba1',
  content: 'A test video\nsfvsfvsi\n#ajbca',
  status: 'scheduled',
  media_url: JSON.stringify({ facebook: 'https://x/facebook.mp4', threads: 'https://x/threads.mp4' }),
  publish_jobs: [
    job('facebook', 'scheduled', { content_type: 'reel' }),
    job('threads', 'scheduled', { content_type: 'reel' }),
  ],
  schedules: [sched('facebook'), sched('threads')],
};

const render = (post: EditablePostRecord, isViewer = false) =>
  renderToStaticMarkup(<EditPostModal post={post} userId="u" teamId="t" isViewer={isViewer} onClose={noop} />);

// The <textarea …> and the button whose label is `label`, as HTML strings
const textarea = (html: string) => html.match(/<textarea[^>]*>/)?.[0] ?? '';
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';
const disabled = (tag: string) => /\sdisabled(=|\s|>)/.test(tag);

describe('EditPostModal — editable post', () => {
  const html = render(basePost);

  it('is a dialog titled Edit Post with the caption pre-filled and editable', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Edit post"');
    expect(html).toContain('Edit Post');
    expect(html).toContain('A test video\nsfvsfvsi\n#ajbca');
    expect(disabled(textarea(html))).toBe(false);
  });

  it('lists every platform with its status and scheduled time', () => {
    expect(html).toContain('facebook');
    expect(html).toContain('threads');
    expect(html.match(/>Scheduled</g)?.length).toBe(2);
    expect(html).toMatch(/Times shown in [A-Za-z_\/+\-0-9]+/);
  });

  it('shows the Save / Cancel buttons, with Save disabled until the text changes', () => {
    expect(disabled(button(html, 'Save changes'))).toBe(true);
    expect(button(html, 'Cancel')).not.toBe('');
    expect(disabled(button(html, 'Cancel'))).toBe(false);
    expect(html).not.toContain('>Close<');
  });

  it('explains that only the caption is editable', () => {
    expect(html).toContain('Only the caption can be edited here');
  });

  it('shows a Threads byte counter because Threads is a target', () => {
    expect(html).toMatch(/\d+ characters · \d+\/500 bytes \(Threads\)/);
  });

  it('has no read-only notice', () => {
    expect(html).not.toContain('role="status"');
  });
});

describe('EditPostModal — read-only states', () => {
  it('published post: Post Details, reason shown, textarea disabled, only Close', () => {
    const html = render({ ...basePost, status: 'published', publish_jobs: [job('facebook', 'completed'), job('threads', 'completed')] });
    expect(html).toContain('Post Details');
    expect(html).toContain('This post is already published, so its caption can no longer be edited.');
    expect(disabled(textarea(html))).toBe(true);
    expect(html).toContain('>Close<');
    expect(html).not.toContain('Save changes');
    expect(html).not.toContain('>Cancel<');
    expect(html.match(/>Published</g)?.length).toBe(2);
  });

  it('partially published post uses the "some platforms" wording', () => {
    const html = render({ ...basePost, publish_jobs: [job('facebook', 'completed'), job('threads', 'scheduled')] });
    expect(html).toContain('already published on some platforms');
    expect(html).not.toContain('Save changes');
  });

  it('publishing right now is read-only', () => {
    const html = render({ ...basePost, publish_jobs: [job('facebook', 'processing'), job('threads', 'scheduled')] });
    expect(html).toContain('being published right now');
    expect(html).toContain('>Processing<');
    expect(html).not.toContain('Save changes');
  });

  it('a viewer sees the details read-only, even on an editable post', () => {
    const html = render(basePost, true);
    expect(html).toContain('Post Details');
    expect(html).toMatch(/Viewers can(&#x27;|')t edit posts\./);
    expect(disabled(textarea(html))).toBe(true);
    expect(html).not.toContain('Save changes');
  });
});

describe('EditPostModal — per-platform detail', () => {
  it('shows the error message of a failed platform, and keeps the post editable', () => {
    const html = render({ ...basePost, publish_jobs: [job('facebook', 'failed', { error_message: 'Facebook Reels rate limit reached (30/24h).' }), job('threads', 'scheduled')] });
    expect(html).toContain('Facebook Reels rate limit reached (30/24h).');
    expect(html).toContain('>Failed<');
    expect(html).toContain('Save changes');
  });

  it('uses the latest job per platform after a retry', () => {
    const html = render({ ...basePost, publish_jobs: [job('facebook', 'failed', { error_message: 'old failure' }, 1), job('facebook', 'scheduled', {}, 5), job('threads', 'scheduled')] });
    expect(html).not.toContain('old failure');
    expect(html.match(/>Scheduled</g)?.length).toBe(2);
  });

  it('a platform without a job row (only a schedule) is listed as Scheduled', () => {
    const html = render({ ...basePost, publish_jobs: [], schedules: [sched('instagram')], media_url: '{}' });
    expect(html).toContain('instagram');
    expect(html).toContain('>Scheduled<');
  });
});

describe('EditPostModal — retry of failed platforms', () => {
  const failedPost = { ...basePost, publish_jobs: [job('facebook', 'failed', { error_message: 'boom' }), job('threads', 'failed', { error_message: 'bang' })] };

  it('offers a retry button naming how many platforms failed', () => {
    expect(render(failedPost)).toContain('Retry failed platforms (2)');
    expect(render({ ...basePost, publish_jobs: [job('facebook', 'failed'), job('threads', 'completed')] })).toContain('Retry failed platforms (1)');
  });

  it('has no retry button when nothing failed, while a retry is already running, or for viewers', () => {
    expect(render(basePost)).not.toContain('Retry failed');
    expect(render({ ...basePost, publish_jobs: [job('facebook', 'failed', {}, 1), job('facebook', 'scheduled', {}, 5), job('threads', 'completed')] })).not.toContain('Retry failed');
    expect(render(failedPost, true)).not.toContain('Retry failed');
  });

  it('shows the automatic-retry note under a platform that is waiting for its next attempt', () => {
    const note = 'Attempt 1/3 failed: fetch failed. Retrying automatically in 1 min.';
    const html = render({ ...basePost, publish_jobs: [job('facebook', 'scheduled', { retry_count: 1, error_message: note }), job('threads', 'scheduled')] });
    expect(html).toContain(note);
    expect(html).not.toContain('Retry failed');
  });
});

describe('EditPostModal — preview and media', () => {
  it('previews a reel video in a 9:16 frame', () => {
    expect(render(basePost)).toContain('aspect-ratio:9 / 16');
  });

  it('shows platform tabs when there are several platforms', () => {
    const html = render(basePost);
    expect(html).toContain('Preview for:');
  });

  it('a normal (non-reel) image on Instagram is previewed in its cropped 4:5 frame', () => {
    const html = render({
      ...basePost,
      media_url: JSON.stringify({ instagram: 'https://x/instagram.jpg' }),
      publish_jobs: [job('instagram', 'scheduled', { content_type: 'post' })],
      schedules: [sched('instagram')],
    });
    expect(html).toContain('aspect-ratio:4 / 5');
    expect(html).toContain('object-cover');
    expect(html).not.toContain('Preview for:'); // a single platform needs no tabs
  });

  it('a text-only post still renders a preview card and no media', () => {
    const html = render({ ...basePost, media_url: '{}', publish_jobs: [job('facebook', 'scheduled')], schedules: [sched('facebook')] });
    expect(html).toContain('Preview');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('<img');
  });

  it('survives garbage in media_url', () => {
    expect(() => render({ ...basePost, media_url: 'not json' })).not.toThrow();
  });
});

describe('EditPostModal — drafts and empty data', () => {
  it('a draft (no jobs, no schedules) is editable and says no platforms are attached', () => {
    const html = render({ id: 'd', content: 'draft text', status: 'draft', media_url: '{}', publish_jobs: [], schedules: [] });
    expect(html).toContain('Edit Post');
    expect(html).toContain('No platforms are attached to this post yet.');
    expect(html).toContain('Save changes');
    expect(html).not.toContain('Preview for:');
  });

  it('copes with a post that has no content at all', () => {
    const html = render({ id: 'e', content: null, publish_jobs: [] });
    expect(html).toContain('0 characters');
  });

  it('escapes HTML in the caption', () => {
    const html = render({ id: 'x', content: '<script>alert(1)</script>', publish_jobs: [] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
