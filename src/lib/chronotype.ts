import type { DailyRecord } from '../data/types';
import { mean, sd, weekday } from './stats';

/**
 * Munich ChronoType Questionnaire-style estimate from tracked sleep:
 * MSFsc = mid-sleep on free days, corrected for catching up on sleep debt.
 * Free days = nights ending Saturday or Sunday.
 */
export function chronotype(days: DailyRecord[]) {
  const nights = days.filter((d) => d.bedtime != null && d.waketime != null && d.sleepMin != null);
  const free = nights.filter((d) => weekday(d.date) >= 5);
  const work = nights.filter((d) => weekday(d.date) < 5);
  if (free.length < 3 || work.length < 5) return null;
  const mid = (d: DailyRecord) => (d.bedtime! + d.waketime!) / 2; // minutes rel. midnight
  const msf = mean(free.map(mid))!;
  const sdf = mean(free.map((d) => d.waketime! - d.bedtime!))!;
  const sdw = mean(work.map((d) => d.waketime! - d.bedtime!))!;
  const sdWeek = (5 * sdw + 2 * sdf) / 7;
  const msfsc = sdf > sdw ? msf - (sdf - sdWeek) / 2 : msf;
  const h = msfsc / 60;
  const type =
    h < 2.5 ? 'Early bird (definite morning type)' : h < 3.5 ? 'Moderately early' : h < 4.5 ? 'Intermediate' : h < 5.5 ? 'Moderately late' : 'Night owl (definite evening type)';
  const msw = mean(work.map(mid))!;
  return { msfsc, type, socialJetlagMin: Math.abs(msf - msw), freeNights: free.length, workNights: work.length };
}

export interface BedtimeBin {
  start: number; // minutes rel. midnight (e.g. −90 = 22:30)
  nights: number;
  sleepScore: number | null;
  efficiency: number | null;
  nextHrv: number | null;
  score: number | null; // combined z-score
}

/** Group nights by bedtime (30-min bins) and score each bin by sleep quality + next-day HRV. */
export function bedtimeBins(days: DailyRecord[]): { bins: BedtimeBin[]; best: BedtimeBin | null } {
  const nights = days.filter((d) => d.bedtime != null);
  const qual = (d: DailyRecord) => d.sleepScore ?? d.sleepEfficiency ?? null;
  const zs = (xs: (number | null | undefined)[]) => {
    const m = mean(xs);
    const s = sd(xs);
    return (v: number | null) => (v == null || m == null || !s ? null : (v - m) / s);
  };
  const zq = zs(nights.map(qual));
  const zh = zs(nights.map((d) => d.hrv));
  const map = new Map<number, DailyRecord[]>();
  for (const d of nights) {
    const b = Math.floor(d.bedtime! / 30) * 30;
    map.set(b, [...(map.get(b) ?? []), d]);
  }
  const bins: BedtimeBin[] = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, ds]) => {
      const q = mean(ds.map(qual));
      const h = mean(ds.map((d) => d.hrv));
      const parts = [zq(q), zh(h)].filter((x): x is number => x != null);
      return {
        start,
        nights: ds.length,
        sleepScore: mean(ds.map((d) => d.sleepScore)),
        efficiency: mean(ds.map((d) => d.sleepEfficiency)),
        nextHrv: h,
        score: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null,
      };
    });
  const eligible = bins.filter((b) => b.nights >= 3 && b.score != null);
  const best = eligible.length ? eligible.reduce((a, b) => (b.score! > a.score! ? b : a)) : null;
  return { bins, best };
}
