import { describe, it, expect } from 'vitest';
import { toEvent, type EventProps } from './calendarEvent';
import type { EditablePostRecord } from './calendarEdit';
import { STATUS_META } from './calendarStatus';

const job = (platform: string, status: string, extra: Record<string, unknown> = {}) => ({ platform, status, created_at: '2026-09-21T10:00:00Z', ...extra });
const sched = (platform: string, at: string) => ({ platform, scheduled_at: at, created_at: '2026-09-21T09:00:00Z' });

const post: EditablePostRecord = {
  id: '85e737cb-0b8a-4688-a0f4-37b1b489bba1',
  content: 'A test video\n#tag',
  status: 'scheduled',
  media_url: '{"facebook":"https://x/f.mp4"}',
  publish_jobs: [job('facebook', 'scheduled', { content_type: 'reel' }), job('threads', 'failed', { error_message: 'boom' })],
  schedules: [sched('facebook', '2026-09-23T04:30:00Z'), sched('threads', '2026-09-23T04:30:00Z')],
};

describe('toEvent', () => {
  it('builds a positioned, coloured event', () => {
    const e = toEvent(post)!;
    expect(e.id).toBe(post.id);
    expect(e.title).toBe('A test video\n#tag');
    expect(e.start).toBe('2026-09-23T04:30:00Z');
    // one job scheduled + one failed and nothing published -> failed (red)
    expect(e.backgroundColor).toBe(STATUS_META.failed.color);
    expect(e.borderColor).toBe(STATUS_META.failed.color);
  });

  it('carries the whole post in extendedProps so the edit modal needs no second request', () => {
    const props = toEvent(post)!.extendedProps as EventProps;
    expect(props.post).toBe(post); // same object, not a copy
    expect(props.post.publish_jobs?.[1]).toMatchObject({ platform: 'threads', error_message: 'boom' });
    expect(props.post.media_url).toBe('{"facebook":"https://x/f.mp4"}');
    expect(props.platforms).toEqual(['facebook', 'threads']);
    expect(props.statusLabel).toBe('Failed');
  });

  it('uses the post start for the position and falls back to created_at without schedules', () => {
    expect(toEvent({ id: 'a', content: 'x', created_at: '2026-09-18T08:00:00Z', publish_jobs: [] })!.start).toBe('2026-09-18T08:00:00Z');
  });

  it('returns null when there is no usable start time', () => {
    expect(toEvent({ id: 'a', content: 'x', publish_jobs: [], schedules: [] })).toBeNull();
  });

  it('gives an empty caption a placeholder title', () => {
    expect(toEvent({ ...post, content: '' })!.title).toBe('(no text)');
    expect(toEvent({ ...post, content: null })!.title).toBe('(no text)');
  });

  it.each([
    ['published', [job('facebook', 'completed')], 'published'],
    ['scheduled', [job('facebook', 'scheduled')], 'scheduled'],
    ['processing', [job('facebook', 'processing')], 'processing'],
    ['partial', [job('facebook', 'completed'), job('threads', 'failed')], 'partial'],
  ] as const)('colours a %s post with the shared status table', (_name, jobs, key) => {
    const e = toEvent({ ...post, publish_jobs: [...jobs] })!;
    expect(e.backgroundColor).toBe(STATUS_META[key].color);
    expect((e.extendedProps as EventProps).statusLabel).toBe(STATUS_META[key].label);
  });
});
