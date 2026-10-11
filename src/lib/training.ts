import type { Dataset, DailyRecord } from '../data/types';
import { addDays, mean, median, sd } from './stats';

/**
 * Banister TRIMP from 5-minute heart-rate averages. Samples below 30% heart-rate
 * reserve are ignored so ordinary daily life doesn't accumulate "training".
 * Falls back to logged workouts / Active Zone Minutes when no intraday HR exists.
 */
export function dailyLoad(ds: Dataset, d: DailyRecord, age: number, fallbackRhr: number): number | null {
  const maxHr = 220 - age;
  const rhr = d.restingHr ?? fallbackRhr;
  const trimp = (hr: number, minutes: number) => {
    const r = (hr - rhr) / (maxHr - rhr);
    return r < 0.3 ? 0 : minutes * r * 0.64 * Math.exp(1.92 * Math.min(r, 1));
  };
  const hr5 = ds.intraday[d.date]?.hr5;
  if (hr5?.some((v) => v != null)) return Math.round(hr5.reduce((a: number, v) => a + (v != null ? trimp(v, 5) : 0), 0));
  const wo = ds.workouts.filter((w) => w.date === d.date && w.avgHr);
  if (wo.length) return Math.round(wo.reduce((a, w) => a + trimp(w.avgHr!, w.durationMin), 0));
  if (d.azm != null) return Math.round(d.azm * 1.6); // ≈ TRIMP per AZM at cardio intensity
  return null;
}

export interface LoadPoint {
  date: string;
  load: number | null;
  atl: number; // acute (7-day) fatigue
  ctl: number; // chronic (42-day) fitness
  tsb: number; // form = ctl − atl (yesterday)
  acwr: number | null; // 7-day / 28-day mean load
}

/** Fitness-fatigue model over every day in the dataset (needs history for CTL). */
export function loadSeries(ds: Dataset, age: number): LoadPoint[] {
  const dates = Object.keys(ds.days).sort();
  if (!dates.length) return [];
  const rhr = median(dates.map((k) => ds.days[k].restingHr)) ?? 60;
  const out: LoadPoint[] = [];
  let atl = 0;
  let ctl = 0;
  const loads: (number | null)[] = [];
  for (let d = dates[0]; d <= dates[dates.length - 1]; d = addDays(d, 1)) {
    const rec = ds.days[d] ?? { date: d };
    const load = dailyLoad(ds, rec, age, rhr);
    loads.push(load);
    const tsb = ctl - atl;
    const L = load ?? 0;
    atl += (L - atl) / 7;
    ctl += (L - ctl) / 42;
    const m7 = mean(loads.slice(-7));
    const m28 = mean(loads.slice(-28));
    out.push({ date: d, load, atl: +atl.toFixed(1), ctl: +ctl.toFixed(1), tsb: +tsb.toFixed(1), acwr: m7 != null && m28 && loads.length >= 21 ? +(m7 / m28).toFixed(2) : null });
  }
  return out;
}

export type Readiness = 'push' | 'maintain' | 'recover';

export interface Recommendation {
  date: string;
  call: Readiness;
  score: number; // −100…100
  reasons: { text: string; good: boolean }[];
}

/** Rule-based daily call from recovery signals vs personal baseline plus load balance. */
export function recommend(ds: Dataset, series: LoadPoint[], date?: string): Recommendation | null {
  const dates = Object.keys(ds.days).sort();
  const today = date ?? [...dates].reverse().find((k) => ds.days[k].restingHr != null || ds.days[k].hrv != null || ds.days[k].sleepMin != null);
  if (!today) return null;
  const d = ds.days[today];
  const base = Array.from({ length: 30 }, (_, i) => ds.days[addDays(today, -i - 1)]).filter(Boolean) as DailyRecord[];
  const reasons: Recommendation['reasons'] = [];
  let score = 0;
  const z = (k: 'hrv' | 'restingHr') => {
    const m = mean(base.map((b) => b[k]));
    const s = sd(base.map((b) => b[k]));
    return d[k] == null || m == null || !s ? null : (d[k]! - m) / s;
  };
  const zh = z('hrv');
  if (zh != null) {
    score += Math.max(-2, Math.min(2, zh)) * 20;
    reasons.push({ text: `HRV ${zh >= 0 ? 'above' : 'below'} your normal (${zh >= 0 ? '+' : ''}${zh.toFixed(1)}σ)`, good: zh >= -0.5 });
  }
  const zr = z('restingHr');
  if (zr != null) {
    score -= Math.max(-2, Math.min(2, zr)) * 15;
    reasons.push({ text: `Resting HR ${zr <= 0 ? 'at or below' : 'above'} your normal (${zr >= 0 ? '+' : ''}${zr.toFixed(1)}σ)`, good: zr <= 0.5 });
  }
  if (d.sleepMin != null) {
    const short = 450 - d.sleepMin;
    score -= Math.max(-1, Math.min(2, short / 60)) * 12;
    reasons.push({ text: `Slept ${Math.floor(d.sleepMin / 60)}h ${Math.round(d.sleepMin % 60)}m`, good: d.sleepMin >= 420 });
  }
  const lp = series.find((p) => p.date === today);
  if (lp?.acwr != null) {
    if (lp.acwr > 1.5) {
      score -= 25;
      reasons.push({ text: `Load ramping fast (acute:chronic ${lp.acwr})`, good: false });
    } else if (lp.acwr < 0.8) {
      score += 10;
      reasons.push({ text: `Load below your usual (acute:chronic ${lp.acwr})`, good: true });
    } else reasons.push({ text: `Load balanced (acute:chronic ${lp.acwr})`, good: true });
  }
  if (lp && lp.tsb < -30) {
    score -= 30;
    reasons.push({ text: `Accumulated fatigue is high (form ${lp.tsb.toFixed(0)})`, good: false });
  } else if (lp && lp.tsb > 5) {
    score += 10;
    reasons.push({ text: `You're fresh (form +${lp.tsb.toFixed(0)})`, good: true });
  }
  if (d.skinTempDelta != null && d.skinTempDelta > 0.5) {
    score -= 25;
    reasons.push({ text: `Skin temperature +${d.skinTempDelta.toFixed(1)} °C`, good: false });
  }
  if (!reasons.length) return null;
  score = Math.round(Math.max(-100, Math.min(100, score)));
  return { date: today, call: score >= 15 ? 'push' : score <= -20 ? 'recover' : 'maintain', score, reasons };
}
