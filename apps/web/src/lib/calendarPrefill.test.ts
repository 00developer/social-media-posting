import { describe, it, expect } from 'vitest';
import { getPrefill, toDatetimeLocal } from './calendarPrefill';

// All dates are built with the local-time constructor, exactly like FullCalendar's local dates,
// so these tests behave the same in any machine timezone.
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms);
const valueOf = (r: ReturnType<typeof getPrefill>) => (r.allowed ? r.value : `BLOCKED:${r.reason}`);

describe('toDatetimeLocal', () => {
  it('formats local time as YYYY-MM-DDTHH:mm with zero padding', () => {
    expect(toDatetimeLocal(local(2026, 1, 5, 9, 7))).toBe('2026-01-05T09:07');
    expect(toDatetimeLocal(local(2026, 12, 31, 0, 5))).toBe('2026-12-31T00:05');
  });

  it('does not shift by the UTC offset', () => {
    const value = toDatetimeLocal(local(2026, 9, 22, 17, 45));
    expect(value).toBe('2026-09-22T17:45');
    // The composer does new Date(value); a timezone-less date-time string is parsed as local time.
    const parsed = new Date(value);
    expect([parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate(), parsed.getHours(), parsed.getMinutes()]).toEqual([2026, 9, 22, 17, 45]);
  });
});

describe('getPrefill — month view (all-day click)', () => {
  const now = local(2026, 9, 21, 14, 30);

  it('blocks a day before today', () => {
    expect(valueOf(getPrefill(local(2026, 9, 20), true, now))).toBe('BLOCKED:past');
    expect(valueOf(getPrefill(local(2025, 12, 31), true, now))).toBe('BLOCKED:past');
  });

  it('uses the next full hour for today', () => {
    expect(valueOf(getPrefill(local(2026, 9, 21), true, now))).toBe('2026-09-21T15:00');
  });

  it('is strictly the next hour when now is exactly on the hour, and rounds up just after it', () => {
    expect(valueOf(getPrefill(local(2026, 9, 21), true, local(2026, 9, 21, 14, 0, 0, 0)))).toBe('2026-09-21T15:00');
    expect(valueOf(getPrefill(local(2026, 9, 21), true, local(2026, 9, 21, 14, 0, 1)))).toBe('2026-09-21T15:00');
    expect(valueOf(getPrefill(local(2026, 9, 21), true, local(2026, 9, 21, 14, 59, 59)))).toBe('2026-09-21T15:00');
  });

  it('allows the last hour of the day (23:00) when it still fits in today', () => {
    expect(valueOf(getPrefill(local(2026, 9, 21), true, local(2026, 9, 21, 22, 30)))).toBe('2026-09-21T23:00');
  });

  it('falls back to 23:59 today when the next hour would spill into tomorrow', () => {
    expect(valueOf(getPrefill(local(2026, 9, 21), true, local(2026, 9, 21, 23, 0)))).toBe('2026-09-21T23:59');
    expect(valueOf(getPrefill(local(2026, 9, 21), true, local(2026, 9, 21, 23, 30)))).toBe('2026-09-21T23:59');
  });

  it('uses 09:00 for any later day, across month and year boundaries', () => {
    expect(valueOf(getPrefill(local(2026, 9, 22), true, now))).toBe('2026-09-22T09:00');
    expect(valueOf(getPrefill(local(2026, 10, 1), true, now))).toBe('2026-10-01T09:00');
    expect(valueOf(getPrefill(local(2027, 1, 1), true, now))).toBe('2027-01-01T09:00');
  });

  it('gives tomorrow 09:00 even late at night today', () => {
    expect(valueOf(getPrefill(local(2026, 9, 22), true, local(2026, 9, 21, 23, 45)))).toBe('2026-09-22T09:00');
  });
});

describe('getPrefill — week view (time slot click)', () => {
  const now = local(2026, 9, 21, 14, 30);

  it('keeps the exact clicked slot in the future', () => {
    expect(valueOf(getPrefill(local(2026, 9, 22, 17, 30), false, now))).toBe('2026-09-22T17:30');
    expect(valueOf(getPrefill(local(2026, 9, 21, 15, 0), false, now))).toBe('2026-09-21T15:00');
  });

  it('allows a slot that starts exactly now', () => {
    expect(valueOf(getPrefill(local(2026, 9, 21, 14, 30), false, now))).toBe('2026-09-21T14:30');
  });

  it('blocks a slot that already started', () => {
    expect(valueOf(getPrefill(local(2026, 9, 21, 14, 0), false, now))).toBe('BLOCKED:past');
    expect(valueOf(getPrefill(local(2026, 9, 21, 8, 0), false, now))).toBe('BLOCKED:past');
  });

  it('blocks slots on earlier days', () => {
    expect(valueOf(getPrefill(local(2026, 9, 20, 23, 30), false, now))).toBe('BLOCKED:past');
  });
});

describe('getPrefill — output shape', () => {
  it('always returns a value the datetime-local input accepts', () => {
    const now = local(2026, 1, 5, 8, 15);
    const results = [
      getPrefill(local(2026, 1, 5), true, now),
      getPrefill(local(2026, 1, 6), true, now),
      getPrefill(local(2026, 1, 6, 0, 0), false, now),
    ];
    for (const r of results) {
      expect(r.allowed).toBe(true);
      if (r.allowed) expect(r.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    }
  });
});
