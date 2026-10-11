import type { Dataset, NumericKey } from '../data/types';
import { META, fmtMetric } from '../data/metrics';
import { addDays, median } from './stats';

/** Robust personal range from the previous `window` days: median ± 2 × scaled MAD. */
export function personalRange(ds: Dataset, k: NumericKey, date: string, window = 60): { lo: number; mid: number; hi: number } | null {
  const vals: number[] = [];
  for (let i = 1; i <= window; i++) {
    const v = ds.days[addDays(date, -i)]?.[k];
    if (v != null) vals.push(v);
  }
  if (vals.length < 14) return null;
  const mid = median(vals)!;
  const mad = median(vals.map((v) => Math.abs(v - mid)))! * 1.4826;
  const spread = Math.max(mad * 2, Math.abs(mid) * 0.02, 1e-6);
  return { lo: mid - spread, mid, hi: mid + spread };
}

/** Same as above for every date in a list (for chart bands). */
export function rangeSeries(ds: Dataset, k: NumericKey, dates: string[]) {
  return dates.map((d) => personalRange(ds, k, d));
}

export const ALERT_METRICS: NumericKey[] = ['restingHr', 'hrv', 'sleepMin', 'deepMin', 'sleepScore', 'spo2', 'breathingRate', 'skinTempDelta', 'steps', 'readiness', 'weightKg'];

export interface NormAlert {
  metric: NumericKey;
  dir: 'high' | 'low';
  days: number; // consecutive recent days outside range
  latest: number;
  range: { lo: number; mid: number; hi: number };
  bad: boolean;
}

/** Metrics outside their personal range for ≥ 2 of the most recent recorded days in a row. */
export function normAlerts(ds: Dataset, asOf: string): NormAlert[] {
  const out: NormAlert[] = [];
  for (const k of ALERT_METRICS) {
    let days = 0;
    let dir: 'high' | 'low' | null = null;
    let latest: number | null = null;
    let range: NormAlert['range'] | null = null;
    let seen = 0;
    for (let i = 0; i < 10 && seen < 5; i++) {
      const date = addDays(asOf, -i);
      const v = ds.days[date]?.[k];
      if (v == null) continue;
      seen++;
      const r = personalRange(ds, k, date);
      if (!r) break;
      const d = v > r.hi ? 'high' : v < r.lo ? 'low' : null;
      if (!d || (dir && d !== dir)) break;
      if (!dir) {
        dir = d;
        latest = v;
        range = r;
      }
      days++;
    }
    if (dir && days >= 2 && latest != null && range) {
      const better = META[k]?.better ?? 0;
      const bad = better === 0 ? true : (dir === 'high' ? 1 : -1) !== better;
      out.push({ metric: k, dir, days, latest, range, bad });
    }
  }
  return out.sort((a, b) => Number(b.bad) - Number(a.bad) || b.days - a.days);
}

export function describeAlert(a: NormAlert): string {
  return `${META[a.metric]?.label ?? a.metric} has been ${a.dir === 'high' ? 'above' : 'below'} your normal range for ${a.days} days (latest ${fmtMetric(a.metric, a.latest)}, usual ${fmtMetric(a.metric, a.range.lo)}–${fmtMetric(a.metric, a.range.hi)}).`;
}
