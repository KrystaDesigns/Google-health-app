import type { DailyRecord, Dataset, NumericKey } from '../data/types';
import { META, fmtClock, fmtMetric } from '../data/metrics';
import { addDays, clean, daysBetween, linreg, mean, median, pearson, sd, weekday, WEEKDAYS } from './stats';

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'info';

export interface Insight {
  id: string;
  tone: Tone;
  title: string;
  body: string;
  metric?: NumericKey;
  date?: string;
  score: number; // ranking weight
}

const v = (d: DailyRecord, k: NumericKey) => d[k] ?? null;

/** Day-level alerts: elevated RHR + depressed HRV + warm skin vs a 30-day baseline. */
export function strainFlags(ds: Dataset, dates: string[]) {
  const out: { date: string; score: number; reasons: string[] }[] = [];
  for (const date of dates) {
    const today = ds.days[date];
    if (!today) continue;
    const base: DailyRecord[] = [];
    for (let i = 1; i <= 30; i++) {
      const r = ds.days[addDays(date, -i)];
      if (r) base.push(r);
    }
    if (base.length < 10) continue;
    let score = 0;
    const reasons: string[] = [];
    const z = (k: NumericKey) => {
      const x = today[k];
      const m = mean(base.map((b) => b[k]));
      const s = sd(base.map((b) => b[k]));
      return x == null || m == null || !s ? null : (x - m) / s;
    };
    const zr = z('restingHr');
    const zh = z('hrv');
    const zt = today.skinTempDelta ?? null;
    const zb = z('breathingRate');
    if (zr != null && zr > 1.5) {
      score += zr;
      reasons.push(`RHR ${fmtMetric('restingHr', today.restingHr)} (${zr.toFixed(1)}σ above baseline)`);
    }
    if (zh != null && zh < -1.5) {
      score += -zh;
      reasons.push(`HRV ${fmtMetric('hrv', today.hrv)} (${(-zh).toFixed(1)}σ below)`);
    }
    if (zt != null && zt > 0.5) {
      score += zt * 2;
      reasons.push(`skin temp +${zt.toFixed(2)} °C`);
    }
    if (zb != null && zb > 2) {
      score += zb / 2;
      reasons.push(`breathing rate ${(zb).toFixed(1)}σ above`);
    }
    if (reasons.length >= 2 || score >= 3) out.push({ date, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

const TREND_KEYS: NumericKey[] = ['steps', 'restingHr', 'hrv', 'sleepMin', 'sleepScore', 'deepMin', 'azm', 'readiness', 'weightKg', 'spo2'];

export function buildInsights(ds: Dataset, days: DailyRecord[], goalSteps = 10000): Insight[] {
  const out: Insight[] = [];
  if (days.length < 7) return out;

  // 1. Trends (regression slope per 30 days, significant only)
  for (const k of TREND_KEYS) {
    const xs: number[] = [];
    const ys: number[] = [];
    days.forEach((d, i) => {
      const y = v(d, k);
      if (y != null) {
        xs.push(i);
        ys.push(y);
      }
    });
    if (ys.length < 14) continue;
    const lr = linreg(xs, ys);
    const p = pearson(xs, ys);
    if (!lr || !p || p.p > 0.01 || Math.abs(p.r) < 0.25) continue;
    const per30 = lr.slope * 30;
    const m = META[k];
    const up = per30 > 0;
    const goodDir = m.better === 0 ? null : (up ? 1 : -1) === m.better;
    out.push({
      id: 'trend-' + k,
      tone: goodDir == null ? 'info' : goodDir ? 'good' : 'serious',
      title: `${m.label} is trending ${up ? 'up' : 'down'}`,
      body: `About ${up ? '+' : ''}${fmtMetric(k, per30)} per month across this period (r = ${p.r.toFixed(2)}, n = ${p.n}).`,
      metric: k,
      score: Math.abs(p.r) * 3,
    });
  }

  // 2. Strain / possible illness
  const flags = strainFlags(ds, days.map((d) => d.date));
  if (flags.length) {
    const top = flags[0];
    out.push({
      id: 'strain',
      tone: 'critical',
      title: `${flags.length} day${flags.length > 1 ? 's' : ''} with strain signals`,
      body: `Strongest on ${top.date}: ${top.reasons.join(', ')}. Combined shifts like this often precede illness, overtraining or poor recovery.`,
      date: top.date,
      score: 5 + flags.length * 0.2,
    });
  }

  // 3. Weekday rhythm for steps
  const byWd = Array.from({ length: 7 }, () => [] as number[]);
  days.forEach((d) => d.steps != null && byWd[weekday(d.date)].push(d.steps));
  const wdMeans = byWd.map((a) => mean(a));
  if (wdMeans.every((x) => x != null)) {
    const best = wdMeans.indexOf(Math.max(...(wdMeans as number[])));
    const worst = wdMeans.indexOf(Math.min(...(wdMeans as number[])));
    out.push({
      id: 'weekday-steps',
      tone: 'info',
      title: `${WEEKDAYS[best]} is your most active day`,
      body: `${fmtMetric('steps', wdMeans[best])} steps on average vs ${fmtMetric('steps', wdMeans[worst])} on ${WEEKDAYS[worst]}s — a ${Math.round(((wdMeans[best]! - wdMeans[worst]!) / wdMeans[worst]!) * 100)}% gap.`,
      metric: 'steps',
      score: 1.5,
    });
  }

  // 4. Sleep regularity & social jetlag
  const beds = clean(days.map((d) => d.bedtime));
  if (beds.length >= 14) {
    const s = sd(beds)!;
    const mid = (d: DailyRecord) => (d.bedtime != null && d.waketime != null ? (d.bedtime + d.waketime) / 2 : null);
    const wkMid = median(days.filter((d) => weekday(d.date) < 5).map(mid));
    const weMid = median(days.filter((d) => weekday(d.date) >= 5).map(mid));
    const jet = wkMid != null && weMid != null ? weMid - wkMid : null;
    out.push({
      id: 'sleep-regularity',
      tone: s > 60 ? 'warning' : 'good',
      title: s > 60 ? 'Irregular bedtime' : 'Consistent bedtime',
      body: `Bedtime varies by ±${Math.round(s)} min (median ${fmtClock(median(beds)!)}).${jet != null ? ` Social jetlag: your weekend sleep midpoint is ${Math.abs(Math.round(jet))} min ${jet >= 0 ? 'later' : 'earlier'} than on weekdays.` : ''}`,
      metric: 'bedtime',
      score: s > 60 ? 3 : 1.2,
    });
  }

  // 5. Interesting relationships (same day and next day)
  const pairs: [NumericKey, NumericKey, number, string][] = [
    ['steps', 'deepMin', 0, 'More steps → more deep sleep that night'],
    ['azm', 'sleepScore', 0, 'Active Zone Minutes → sleep score that night'],
    ['sleepMin', 'restingHr', 1, 'Sleep duration → next-day resting HR'],
    ['sleepMin', 'hrv', 1, 'Sleep duration → next-day HRV'],
    ['bedtime', 'sleepScore', 0, 'Later bedtime → sleep score'],
    ['stress', 'sleepScore', 0, 'Stress management → sleep score'],
  ];
  for (const [a, b, lag, label] of pairs) {
    const xa = days.map((d) => v(d, a));
    const xb = days.map((d) => v(ds.days[addDays(d.date, lag)] ?? { date: '' }, b));
    const p = pearson(xa, xb);
    if (!p || p.p > 0.05 || Math.abs(p.r) < 0.15) continue;
    out.push({
      id: `corr-${a}-${b}-${lag}`,
      tone: 'info',
      title: label.replace('→', p.r > 0 ? '↗' : '↘'),
      body: `${META[a].label} and ${lag ? 'next-day ' : ''}${META[b].label.toLowerCase()} are ${p.r > 0 ? 'positively' : 'negatively'} correlated (r = ${p.r.toFixed(2)}, p ${p.p < 0.001 ? '< 0.001' : '= ' + p.p.toFixed(3)}, n = ${p.n}).`,
      metric: a,
      score: Math.abs(p.r) * 4,
    });
  }

  // 6. Streaks & records
  let cur = 0;
  let best = 0;
  let bestEnd = '';
  for (const d of days) {
    if ((d.steps ?? 0) >= goalSteps) {
      cur++;
      if (cur > best) {
        best = cur;
        bestEnd = d.date;
      }
    } else cur = 0;
  }
  if (best >= 3) {
    out.push({
      id: 'streak',
      tone: 'good',
      title: `Longest ${goalSteps.toLocaleString()}-step streak: ${best} days`,
      body: `Ended ${bestEnd}. You hit the goal on ${days.filter((d) => (d.steps ?? 0) >= goalSteps).length} of ${days.filter((d) => d.steps != null).length} tracked days. ${cur ? `Current streak: ${cur} days.` : ''}`,
      metric: 'steps',
      score: 1.4,
    });
  }

  // 7. Sleep debt
  const sleeps = clean(days.slice(-14).map((d) => d.sleepMin));
  if (sleeps.length >= 7) {
    const debt = sleeps.reduce((a, s) => a + (450 - s), 0);
    if (debt > 120) {
      out.push({
        id: 'sleep-debt',
        tone: debt > 420 ? 'serious' : 'warning',
        title: `Sleep debt of ${Math.round(debt / 60)} h over the last ${sleeps.length} nights`,
        body: `Relative to a 7.5 h target. Averaging ${Math.round(mean(sleeps)! / 6) / 10} h/night recently.`,
        metric: 'sleepMin',
        score: debt / 120,
      });
    }
  }

  const span = daysBetween(days[0].date, days[days.length - 1].date) + 1;
  const coverage = days.filter((d) => d.steps != null || d.restingHr != null).length;
  if (coverage < span * 0.8) {
    out.push({
      id: 'coverage',
      tone: 'info',
      title: 'Gaps in the data',
      body: `Only ${coverage} of ${span} days have activity or heart data. Wear-time gaps can bias averages.`,
      score: 0.5,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}
