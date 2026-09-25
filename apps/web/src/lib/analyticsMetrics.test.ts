import { describe, expect, it } from 'vitest';
import { formatCount } from './analyticsMetrics';

describe('formatCount', () => {
  it('shows small numbers as they are', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates thousands', () => {
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(12345)).toBe('12.3k');
  });
});
