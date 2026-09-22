// Turns a post from GET /api/v1/posts (range query) into a FullCalendar event. Pure, so it is unit tested.
// The whole post rides along in extendedProps so clicking an event can open the edit modal without a
// second request.

import type { EventInput } from '@fullcalendar/core';
import type { EditablePostRecord } from './calendarEdit';
import { deriveCalendarStatus, getPostPlatforms, getPostStart, STATUS_META } from './calendarStatus';

export type EventProps = {
  statusLabel: string;
  platforms: string[];
  /** The full post (content, media_url, publish_jobs, schedules) for the edit modal. */
  post: EditablePostRecord;
};

/** null when the post has no usable start time (it then can't be placed on the calendar). */
export function toEvent(post: EditablePostRecord): EventInput | null {
  const start = getPostStart(post);
  if (!start) return null;

  const status = deriveCalendarStatus(post);
  const meta = STATUS_META[status];

  return {
    id: post.id,
    title: post.content || '(no text)',
    start,
    backgroundColor: meta.color,
    borderColor: meta.color,
    extendedProps: {
      statusLabel: meta.label,
      platforms: getPostPlatforms(post),
      post,
    } satisfies EventProps,
  };
}
