import { describe, expect, it } from 'vitest';
import { getScheduleProblem, MAX_UPLOAD_BYTES, toDateTimeLocal } from './scheduleInput';

describe('toDateTimeLocal', () => {
  it('formats a local date for a datetime-local input', () => {
    expect(toDateTimeLocal(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05T07:03');
  });
});

describe('getScheduleProblem', () => {
  const now = new Date(2026, 9, 13, 12, 0).getTime();
  it('accepts an empty value and future times', () => {
    expect(getScheduleProblem('', now)).toBeNull();
    expect(getScheduleProblem('2026-10-13T12:30', now)).toBeNull();
  });
  it('allows the current minute', () => {
    expect(getScheduleProblem('2026-10-13T12:00', now + 30_000)).toBeNull();
  });
  it('rejects past times and invalid values', () => {
    expect(getScheduleProblem('2026-10-13T11:00', now)).toMatch(/past/);
    expect(getScheduleProblem('not-a-date', now)).toMatch(/valid/);
  });
});

it('limits uploads to 100 MB', () => {
  expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
});
