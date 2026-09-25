// Small display helpers for the Analytics page. (Which number means what per platform lives in analyticsReport.ts.)

/** 1234 -> "1.5k" */
export function formatCount(value: number): string {
  return value > 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
