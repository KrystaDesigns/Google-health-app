import type { Dataset, Journal, NumericKey } from '../data/types';
import { META, fmtMetric, lowerLabel } from '../data/metrics';
import { addDays, welch } from './stats';

export const DEFAULT_TAGS = [
  'Alcohol',
  'Caffeine after 2pm',
  'Late meal',
  'Stressful day',
  'Screens in bed',
  'Meditation',
  'Stretching / yoga',
  'Nap',
  'Travel',
  'Sick',
];

/** Outcomes measured the morning after a tagged day (sleep that night + next-day recovery). */
export const OUTCOMES: NumericKey[] = ['sleepMin', 'deepMin', 'remMin', 'sleepScore', 'sleepEfficiency', 'wakeMin', 'restingHr', 'hrv', 'readiness', 'skinTempDelta'];

export interface TagEffect {
  tag: string;
  metric: NumericKey;
  withTag: number;
  without: number;
  diff: number;
  pct: number | null;
  p: number;
  d: number;
  n: number;
  good: boolean | null;
}

/** All tags for a date: your journal + moods/symptoms logged in Google Health. */
export function tagsOn(j: Journal, ds: Dataset, date: string): string[] {
  return [...(j.entries[date] ?? []), ...(ds.logged?.[date] ?? [])];
}

export function journalDates(j: Journal, ds: Dataset): string[] {
  return [...new Set([...Object.keys(j.entries), ...Object.keys(ds.logged ?? {})])].sort();
}

export function tagEffects(j: Journal, ds: Dataset, minN = 4): TagEffect[] {
  const dates = journalDates(j, ds);
  const allTags = [...new Set(dates.flatMap((d) => tagsOn(j, ds, d)))];
  const out: TagEffect[] = [];
  for (const tag of allTags) {
    const yes = dates.filter((d) => tagsOn(j, ds, d).includes(tag));
    const no = dates.filter((d) => !tagsOn(j, ds, d).includes(tag));
    if (yes.length < minN || no.length < minN) continue;
    for (const k of OUTCOMES) {
      const next = (d: string) => ds.days[addDays(d, 1)]?.[k] ?? null;
      const w = welch(yes.map(next), no.map(next));
      if (!w) continue;
      const better = META[k]?.better ?? 0;
      const diff = w.ma - w.mb;
      out.push({
        tag,
        metric: k,
        withTag: w.ma,
        without: w.mb,
        diff,
        pct: w.mb ? (diff / Math.abs(w.mb)) * 100 : null,
        p: w.p,
        d: w.d,
        n: yes.length,
        good: better === 0 ? null : Math.sign(diff) === better,
      });
    }
  }
  return out;
}

export function effectSentence(e: TagEffect): string {
  const m = META[e.metric];
  const dir = e.diff > 0 ? 'higher' : 'lower';
  const amount = m.unit === 'min' || e.metric.endsWith('Min') ? `${Math.abs(Math.round(e.diff))} min` : fmtMetric(e.metric, Math.abs(e.diff));
  return `After “${e.tag}” days, your ${lowerLabel(m.label)} is ${amount} ${dir} (${fmtMetric(e.metric, e.withTag)} vs ${fmtMetric(e.metric, e.without)}).`;
}
