// Turns a calendar click into the value for the composer's `datetime-local` schedule field.
// Pure and clock-injectable so it can be unit tested. Everything uses local time on purpose:
// the calendar runs in the browser's timezone and `<input type="datetime-local">` is timezone-less.

export type PrefillResult =
  | { allowed: true; value: string }
  | { allowed: false; reason: 'past' };

/** Default time when a future day is clicked in month view (no time information in the click). */
const DEFAULT_HOUR = 9;

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` in local time, the format `<input type="datetime-local">` expects. */
export function toDatetimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const dayKey = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

/**
 * @param clicked FullCalendar's `dateClick` date (local). Midnight for a month-view (all-day) click,
 *                the slot start for a week-view click.
 * @param allDay  true for a month-view click, false for a week-view time slot.
 * @param now     injectable clock for tests.
 *
 * Rules:
 *  - a day before today is never allowed;
 *  - month view, today: the next full hour (23:59 if that would spill into tomorrow);
 *  - month view, a later day: 09:00;
 *  - week view: exactly the clicked slot, unless it already started before `now`.
 */
export function getPrefill(clicked: Date, allDay: boolean, now: Date = new Date()): PrefillResult {
  if (dayKey(clicked) < dayKey(now)) return { allowed: false, reason: 'past' };

  if (!allDay) {
    if (clicked.getTime() < now.getTime()) return { allowed: false, reason: 'past' };
    return { allowed: true, value: toDatetimeLocal(clicked) };
  }

  if (dayKey(clicked) === dayKey(now)) {
    const nextHour = new Date(now);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    if (dayKey(nextHour) !== dayKey(now)) {
      const lastMinute = new Date(now);
      lastMinute.setHours(23, 59, 0, 0);
      return { allowed: true, value: toDatetimeLocal(lastMinute) };
    }
    return { allowed: true, value: toDatetimeLocal(nextHour) };
  }

  const day = new Date(clicked.getFullYear(), clicked.getMonth(), clicked.getDate(), DEFAULT_HOUR, 0, 0, 0);
  return { allowed: true, value: toDatetimeLocal(day) };
}
