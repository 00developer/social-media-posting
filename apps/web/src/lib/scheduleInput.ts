// Helpers for the composer's schedule field and upload limit (kept out of the component so they can be unit tested).

/** Client-side upload limit, matching the media service. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const pad2 = (n: number) => String(n).padStart(2, '0');
/** `datetime-local` value for a Date, in local time ("YYYY-MM-DDTHH:mm"). */
export const toDateTimeLocal = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Error message when a `datetime-local` schedule value is in the past (or invalid); null when it is fine. */
export function getScheduleProblem(value: string, nowMs: number): string | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return 'Enter a valid date and time.';
  // Same minute as now is allowed (the input has minute precision).
  if (t < nowMs - 60_000) return 'This time is in the past. Pick a future date and time.';
  return null;
}
