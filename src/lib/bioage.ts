/**
 * Biological-age estimate from wearable data (in the spirit of WHOOP Age).
 *
 * Each factor maps your recent average to a relative mortality risk (hazard
 * ratio, HR) taken from large population studies, then converts that to years
 * using the Gompertz law: all-cause mortality roughly doubles every 8 years, so
 *   years = 8 × log2(HR) ≈ 11.5 × ln(HR).
 * Factors overlap (fit people also walk more), so the sum is shrunk by 0.6 and
 * capped at ±12 years. This is an educational estimate, not a diagnosis.
 *
 * Sources (approximate effect sizes):
 *  - Steps: Paluch et al., Lancet Public Health 2022 (meta-analysis, 47k adults)
 *  - Cardiorespiratory fitness: Kodama et al., JAMA 2009 (HR 0.87 per +1 MET);
 *    norms: FRIEND registry / ACSM percentiles
 *  - Resting HR: Zhang et al., CMAJ 2016 (HR ≈ 1.09 per +10 bpm)
 *  - Sleep duration: Cappuccio et al., Sleep 2010 (U-shaped)
 *  - Sleep regularity: Windred et al., Sleep 2024 (UK Biobank)
 *  - Aerobic activity (150–300 min/wk): Lee et al., Circulation 2022
 *  - Vigorous activity: Wang et al., JAMA Intern Med 2021
 *  - Strength training: Momma et al., Br J Sports Med 2022
 */
import type { DailyRecord, Dataset } from '../data/types';
import { addDays, mean, sd, sum } from './stats';

export type Sex = 'female' | 'male';

const toYears = (hr: number) => 11.5 * Math.log(hr);

/** Median VO₂ max (ml/kg/min) by age & sex — FRIEND/ACSM-style norms. */
const VO2_NORMS: Record<Sex, [number, number][]> = {
  male: [[20, 48], [30, 43], [40, 39], [50, 35], [60, 31], [70, 27], [80, 23]],
  female: [[20, 39], [30, 34], [40, 31], [50, 28], [60, 25], [70, 22], [80, 19]],
};

export function vo2Norm(age: number, sex: Sex): number {
  const t = VO2_NORMS[sex];
  if (age <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (age <= t[i][0]) {
      const [a0, v0] = t[i - 1];
      const [a1, v1] = t[i];
      return v0 + ((v1 - v0) * (age - a0)) / (a1 - a0);
    }
  }
  return t[t.length - 1][1];
}

/** "Fitness age": the age at which your VO₂ max would be the median. */
export function fitnessAge(vo2: number, sex: Sex): number {
  const t = VO2_NORMS[sex];
  if (vo2 >= t[0][1]) return t[0][0] - (vo2 - t[0][1]) / 0.5; // extrapolate gently below 20
  for (let i = 1; i < t.length; i++) {
    if (vo2 >= t[i][1]) {
      const [a0, v0] = t[i - 1];
      const [a1, v1] = t[i];
      return a0 + ((a1 - a0) * (v0 - vo2)) / (v0 - v1);
    }
  }
  return 80 + (t[t.length - 1][1] - vo2) / 0.4;
}

export interface Factor {
  id: string;
  label: string;
  value: string;
  target: string;
  years: number; // + older, − younger (before shrinkage)
  tip: string;
  missing?: boolean;
}

export interface BioAge {
  age: number;
  bioAge: number;
  delta: number; // bioAge − age
  factors: Factor[];
  coverage: number; // share of factors with data
}

const STRENGTH = /weight|strength|resistance|crossfit|circuit|calisthenics|body ?weight|trx|powerlift|kettlebell|pilates/i;

/** Estimate from the 30 days ending on `end` (needs ≥ 14 days of data). */
export function estimateBioAge(ds: Dataset, end: string, age: number, sex: Sex, window = 30): BioAge | null {
  const days: DailyRecord[] = [];
  for (let i = 0; i < window; i++) {
    const d = ds.days[addDays(end, -i)];
    if (d) days.push(d);
  }
  if (days.filter((d) => d.steps != null || d.restingHr != null).length < 14) return null;
  const weeks = window / 7;
  const f: Factor[] = [];

  // 1. Steps
  const steps = mean(days.map((d) => d.steps));
  if (steps != null) {
    const hr = steps < 4000 ? 1.45 : steps < 6000 ? 1.2 : steps < 8000 ? 1.0 : steps < 10000 ? 0.85 : 0.78;
    f.push({ id: 'steps', label: 'Daily steps', value: Math.round(steps).toLocaleString(), target: '8,000–10,000+', years: toYears(hr), tip: 'Add a 20-minute walk to reach the next band — the biggest drop in risk is going from <6k to 8k+.' });
  } else f.push({ id: 'steps', label: 'Daily steps', value: '–', target: '8,000+', years: 0, tip: '', missing: true });

  // 2. VO2 max vs age/sex norm
  const vo2 = mean(days.map((d) => d.vo2max));
  if (vo2 != null) {
    const norm = vo2Norm(age, sex);
    f.push({ id: 'vo2', label: 'Cardio fitness (VO₂ max)', value: `${vo2.toFixed(1)} (median for you: ${norm.toFixed(0)})`, target: `> ${Math.round(norm + 5)}`, years: toYears(Math.pow(0.87, (vo2 - norm) / 3.5)), tip: 'Fitness is the strongest single lever: 2 interval sessions a week (e.g. 4×4 min hard) raise VO₂ max within weeks.' });
  } else f.push({ id: 'vo2', label: 'Cardio fitness (VO₂ max)', value: '–', target: '', years: 0, tip: 'Sync with Google Health (VO₂ max needs GPS runs or a few weeks of wear).', missing: true });

  // 3. Resting HR (reference 62 bpm)
  const rhr = mean(days.map((d) => d.restingHr));
  if (rhr != null) f.push({ id: 'rhr', label: 'Resting heart rate', value: `${rhr.toFixed(1)} bpm`, target: '< 60 bpm', years: toYears(Math.pow(1.09, (rhr - 62) / 10)), tip: 'Aerobic training, good sleep and less alcohol all lower resting HR.' });
  else f.push({ id: 'rhr', label: 'Resting heart rate', value: '–', target: '', years: 0, tip: '', missing: true });

  // 4. Sleep duration (U-shaped, 7–8 h best)
  const sleep = mean(days.map((d) => d.sleepMin));
  if (sleep != null) {
    const h = sleep / 60;
    const hr = h < 6 ? 1.12 : h < 7 ? 1.04 : h <= 8.5 ? 1.0 : h <= 9.5 ? 1.1 : 1.3;
    f.push({ id: 'sleep', label: 'Sleep duration', value: `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`, target: '7–8.5 h', years: toYears(hr), tip: h < 7 ? 'Protect a 7–8 h sleep window; move bedtime earlier in 15-minute steps.' : 'Right in the healthy range — keep it.' });
  } else f.push({ id: 'sleep', label: 'Sleep duration', value: '–', target: '', years: 0, tip: '', missing: true });

  // 5. Sleep regularity (bedtime SD)
  const beds = days.map((d) => d.bedtime);
  const bsd = sd(beds);
  if (bsd != null && beds.filter((b) => b != null).length >= 10) {
    const hr = bsd < 30 ? 0.92 : bsd < 60 ? 1.0 : bsd < 90 ? 1.1 : 1.2;
    f.push({ id: 'regularity', label: 'Sleep consistency', value: `bedtime ±${Math.round(bsd)} min`, target: '< ±30 min', years: toYears(hr), tip: 'Regular timing matters as much as duration. Keep weekend bedtimes within an hour of weekdays.' });
  } else f.push({ id: 'regularity', label: 'Sleep consistency', value: '–', target: '', years: 0, tip: '', missing: true });

  // 6. Moderate-to-vigorous activity per week (Active Zone Minutes as proxy)
  const azmWk = days.some((d) => d.azm != null) ? sum(days.map((d) => d.azm)) / weeks : null;
  if (azmWk != null) {
    const hr = azmWk < 75 ? 1.15 : azmWk < 150 ? 1.0 : azmWk < 300 ? 0.88 : 0.82;
    f.push({ id: 'mvpa', label: 'Weekly active minutes', value: `${Math.round(azmWk)} AZM / week`, target: '150–300+', years: toYears(hr), tip: 'Aim for 150–300 Active Zone Minutes a week; brisk walks count.' });
  } else f.push({ id: 'mvpa', label: 'Weekly active minutes', value: '–', target: '', years: 0, tip: '', missing: true });

  // 7. Vigorous activity (vigorous + peak HR zone, else very-active minutes)
  const vig = days.some((d) => d.zoneVigorousMin != null)
    ? sum(days.map((d) => (d.zoneVigorousMin ?? 0) + (d.zonePeakMin ?? 0))) / weeks
    : days.some((d) => d.veryActiveMin != null) ? sum(days.map((d) => d.veryActiveMin)) / weeks : null;
  if (vig != null) {
    const hr = vig < 20 ? 1.05 : vig < 75 ? 1.0 : 0.93;
    f.push({ id: 'vigorous', label: 'Vigorous exercise', value: `${Math.round(vig)} min / week`, target: '75+ min', years: toYears(hr), tip: 'Some time at high intensity (hard runs, intervals, cycling) adds benefit beyond moderate activity.' });
  } else f.push({ id: 'vigorous', label: 'Vigorous exercise', value: '–', target: '', years: 0, tip: '', missing: true });

  // 8. Strength training sessions
  const from = addDays(end, -window + 1);
  const st = ds.workouts.filter((w) => w.date >= from && w.date <= end && STRENGTH.test(w.name));
  const stWk = st.length / weeks;
  const anyWorkouts = ds.workouts.some((w) => w.date >= from && w.date <= end);
  if (anyWorkouts) {
    const hr = stWk < 0.5 ? 1.0 : stWk < 2 ? 0.92 : 0.86;
    f.push({ id: 'strength', label: 'Strength training', value: `${stWk.toFixed(1)} sessions / week`, target: '2+ per week', years: toYears(hr), tip: 'Two 30–60 min resistance sessions a week; log them as Weights/Strength in Fitbit so they are counted.' });
  } else f.push({ id: 'strength', label: 'Strength training', value: '–', target: '2+ per week', years: 0, tip: 'Log workouts on your tracker to include this.', missing: true });

  const present = f.filter((x) => !x.missing);
  const raw = sum(present.map((x) => x.years));
  const delta = Math.max(-12, Math.min(12, raw * 0.6));
  return { age, bioAge: +(age + delta).toFixed(1), delta: +delta.toFixed(1), factors: f, coverage: present.length / f.length };
}

/** Weekly series of estimates and "pace of aging" (years of biological age per calendar year). */
export function bioAgeSeries(ds: Dataset, end: string, age: number, sex: Sex, weeks = 26) {
  const pts: { date: string; bioAge: number; delta: number }[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const d = addDays(end, -w * 7);
    // chronological age advances too
    const ageThen = age - (w * 7) / 365.25;
    const e = estimateBioAge(ds, d, ageThen, sex);
    if (e) pts.push({ date: d, bioAge: e.bioAge, delta: e.delta });
  }
  let pace: number | null = null;
  if (pts.length >= 8) {
    // slope of delta (years) over time (years) → pace = 1 + slope
    const xs = pts.map((p) => (Date.parse(p.date) - Date.parse(pts[0].date)) / (365.25 * 864e5));
    const mx = mean(xs)!;
    const my = mean(pts.map((p) => p.delta))!;
    let num = 0;
    let den = 0;
    xs.forEach((x, i) => {
      num += (x - mx) * (pts[i].delta - my);
      den += (x - mx) ** 2;
    });
    pace = den ? Math.max(-1, Math.min(3, 1 + num / den)) : null;
  }
  return { pts, pace };
}
