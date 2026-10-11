/**
 * Parser for Google Takeout → Fitbit exports (and generic daily CSVs).
 *
 * Handles the "Global Export Data" JSON files (steps, heart_rate, sleep, …)
 * plus the CSV folders (HRV, SpO2, temperature, stress, readiness, AZM, sleep
 * score, respiratory rate). Unknown files are skipped. Everything runs locally.
 */
import type { Dataset, SleepLevel, SleepSession, Workout } from './types';
import { emptyDataset } from './types';
import { applySleepToDays, day, deriveSkinTempDelta } from './derive';

export interface SourceFile {
  path: string;
  size: number;
  text: () => Promise<string>;
}

export interface ParseOptions {
  intradayOffsetHours: number;
}

export interface ParseReport {
  recognised: Record<string, number>;
  skipped: number;
  errors: string[];
}

type Progress = (done: number, total: number, label: string) => void;

const base = (p: string) => p.split('/').pop() ?? p;
const pad = (n: number) => String(n).padStart(2, '0');

/** "01/15/24 08:01:00" → epoch ms as if UTC, shifted by offset hours. */
function fitbitDT(s: string, offsetH = 0): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return Date.UTC(y, +m[1] - 1, +m[2], +m[4], +m[5], +m[6]) + offsetH * 3600e3;
  }
  return Date.parse(s.slice(0, 19) + 'Z') + offsetH * 3600e3;
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoLocal = (ms: number) => new Date(ms).toISOString().slice(0, 19);

/** Date part of many timestamp styles. */
function anyDate(s: string): string | null {
  s = s.trim().replace(/^"|"$/g, '');
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(+m[1])}-${pad(+m[2])}`;
  }
  return null;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};

const col = (row: Record<string, string>, ...cands: string[]) => {
  for (const c of cands) if (row[c] != null && row[c] !== '') return row[c];
  const keys = Object.keys(row);
  for (const c of cands) {
    const k = keys.find((k) => k.includes(c));
    if (k && row[k] !== '') return row[k];
  }
  return undefined;
};

/** Generic daily CSV: a date column plus any recognisable metric columns. */
const GENERIC_ALIASES: Record<string, string[]> = {
  steps: ['steps', 'step_count', 'total_steps'],
  distanceKm: ['distance_km', 'distance'],
  calories: ['calories', 'calories_burned', 'energy_kcal'],
  restingHr: ['resting_heart_rate', 'resting_hr', 'rhr'],
  avgHr: ['average_heart_rate', 'avg_hr'],
  hrv: ['hrv', 'rmssd', 'heart_rate_variability'],
  spo2: ['spo2', 'oxygen_saturation', 'average_spo2'],
  breathingRate: ['breathing_rate', 'respiratory_rate'],
  sleepMin: ['sleep_minutes', 'minutes_asleep', 'sleep_duration_min'],
  sleepScore: ['sleep_score', 'overall_score'],
  deepMin: ['deep_sleep_minutes', 'deep_min'],
  remMin: ['rem_sleep_minutes', 'rem_min'],
  azm: ['active_zone_minutes', 'azm'],
  weightKg: ['weight_kg', 'weight'],
  readiness: ['readiness', 'readiness_score'],
  stress: ['stress_score', 'stress'],
};

export async function parseSources(files: SourceFile[], opts: ParseOptions, progress: Progress = () => {}): Promise<{ dataset: Dataset; report: ParseReport }> {
  const ds = emptyDataset();
  ds.source = ['Google Takeout'];
  const report: ParseReport = { recognised: {}, skipped: 0, errors: [] };
  const hit = (k: string) => (report.recognised[k] = (report.recognised[k] ?? 0) + 1);

  // minute-level accumulators
  const minuteSteps = new Map<string, number[]>();
  const minuteCal = new Map<string, number>();
  const minuteDist = new Map<string, number>();
  const hrSum = new Map<string, Float64Array>();
  const hrCnt = new Map<string, Uint32Array>();
  const hrMax = new Map<string, number>();
  const azmCsv = new Map<string, number>();
  const sleepScoreByDate = new Map<string, number>();
  const rhrFromSleepScore = new Map<string, number>();
  let weightUnitLbs = true;

  const off = opts.intradayOffsetHours;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const name = base(f.path);
    const lower = name.toLowerCase();
    progress(i, files.length, name);
    if (!/\.(json|csv)$/.test(lower)) {
      report.skipped++;
      continue;
    }
    try {
      // ---------- Global Export Data JSON ----------
      if (/^steps-\d{4}-\d{2}-\d{2}\.json$/.test(lower)) {
        for (const e of JSON.parse(await f.text())) {
          const t = fitbitDT(e.dateTime, off);
          const d = isoDate(t);
          const arr = minuteSteps.get(d) ?? new Array(24).fill(0);
          arr[new Date(t).getUTCHours()] += +e.value || 0;
          minuteSteps.set(d, arr);
        }
        hit('Steps (minute)');
      } else if (/^heart_rate-\d{4}-\d{2}-\d{2}\.json$/.test(lower)) {
        for (const e of JSON.parse(await f.text())) {
          const bpm = e.value?.bpm;
          if (!bpm) continue;
          const t = fitbitDT(e.dateTime, off);
          const d = isoDate(t);
          let s = hrSum.get(d);
          let c = hrCnt.get(d);
          if (!s || !c) {
            s = new Float64Array(288);
            c = new Uint32Array(288);
            hrSum.set(d, s);
            hrCnt.set(d, c);
          }
          const dt = new Date(t);
          const slot = dt.getUTCHours() * 12 + Math.floor(dt.getUTCMinutes() / 5);
          s[slot] += bpm;
          c[slot]++;
          if (bpm > (hrMax.get(d) ?? 0)) hrMax.set(d, bpm);
        }
        hit('Heart rate (intraday)');
      } else if (/^resting_heart_rate-.*\.json$/.test(lower)) {
        for (const e of JSON.parse(await f.text())) {
          const v = num(e.value?.value);
          const ds2 = e.value?.date ? anyDate(e.value.date) : anyDate(e.dateTime);
          if (v && ds2) day(ds, ds2).restingHr = +v.toFixed(1);
        }
        hit('Resting heart rate');
      } else if (/^calories-\d{4}-\d{2}-\d{2}\.json$/.test(lower)) {
        for (const e of JSON.parse(await f.text())) {
          const d = isoDate(fitbitDT(e.dateTime, off));
          minuteCal.set(d, (minuteCal.get(d) ?? 0) + (+e.value || 0));
        }
        hit('Calories');
      } else if (/^distance-\d{4}-\d{2}-\d{2}\.json$/.test(lower)) {
        for (const e of JSON.parse(await f.text())) {
          const d = isoDate(fitbitDT(e.dateTime, off));
          minuteDist.set(d, (minuteDist.get(d) ?? 0) + (+e.value || 0));
        }
        hit('Distance');
      } else if (/^(very_active|moderately_active|lightly_active|sedentary)_minutes-.*\.json$/.test(lower)) {
        const field = lower.startsWith('very') ? 'veryActiveMin' : lower.startsWith('moder') ? 'moderateMin' : lower.startsWith('light') ? 'lightMin' : 'sedentaryMin';
        for (const e of JSON.parse(await f.text())) {
          const d = anyDate(e.dateTime);
          if (d) day(ds, d)[field] = +e.value || 0;
        }
        hit('Active minutes');
      } else if (/^sleep-\d{4}-\d{2}-\d{2}\.json$/.test(lower)) {
        for (const e of JSON.parse(await f.text())) {
          const s = sleepFromJson(e);
          if (s) ds.sleep.push(s);
        }
        hit('Sleep logs');
      } else if (/^exercise-.*\.json$/.test(lower)) {
        for (const e of JSON.parse(await f.text())) {
          const w = workoutFromJson(e);
          if (w) ds.workouts.push(w);
        }
        hit('Exercises');
      } else if (/^weight-.*\.json$/.test(lower)) {
        for (const e of JSON.parse(await f.text())) {
          const d = anyDate(e.date ?? e.dateTime);
          const w = num(e.weight);
          if (!d || !w) continue;
          // Fitbit exports weight in the account's unit; BMI lets us tell which.
          const bmi = num(e.bmi);
          if (bmi && w / bmi < 4.5) weightUnitLbs = false; // kg / BMI ≈ height² (~2.5–4.5)
          day(ds, d).weightKg = w;
        }
        hit('Weight');
      }
      // ---------- CSV folders ----------
      else if (lower.endsWith('.csv')) {
        const rows = parseCsv(await f.text());
        if (!rows.length) {
          report.skipped++;
          continue;
        }
        const head = Object.keys(rows[0]).join(',');
        if (lower.includes('heart rate variability summary') || (head.includes('rmssd') && head.includes('nremhr'))) {
          for (const r of rows) {
            const d = anyDate(r.timestamp ?? '');
            const v = num(r.rmssd);
            if (d && v) day(ds, d).hrv = +v.toFixed(1);
          }
          hit('HRV');
        } else if (lower.startsWith('daily spo2') || (head.includes('average_value') && head.includes('lower_bound'))) {
          for (const r of rows) {
            const d = anyDate(r.timestamp ?? '');
            const v = num(r.average_value);
            if (d && v) day(ds, d).spo2 = v;
          }
          hit('SpO₂');
        } else if (lower.includes('respiratory rate summary') || head.includes('daily_respiratory_rate')) {
          for (const r of rows) {
            const d = anyDate(r.timestamp ?? '');
            const v = num(r.daily_respiratory_rate ?? col(r, 'full_sleep_breathing_rate', 'breathing_rate'));
            if (d && v) day(ds, d).breathingRate = v;
          }
          hit('Breathing rate');
        } else if (lower.includes('computed temperature') || head.includes('nightly_temperature')) {
          for (const r of rows) {
            const d = anyDate(r.sleep_end ?? r.sleep_start ?? '');
            const v = num(r.nightly_temperature);
            if (d && v) day(ds, d).skinTemp = v;
          }
          hit('Skin temperature');
        } else if (lower.includes('device temperature') || lower.includes('wrist temperature')) {
          report.skipped++;
        } else if (lower.startsWith('sleep_score') || head.includes('overall_score')) {
          for (const r of rows) {
            const d = anyDate(r.timestamp ?? '');
            const v = num(r.overall_score);
            if (d && v) sleepScoreByDate.set(d, v);
            const rhr = num(r.resting_heart_rate);
            if (d && rhr) rhrFromSleepScore.set(d, rhr);
          }
          hit('Sleep score');
        } else if (lower.includes('stress') && head.includes('stress_score')) {
          for (const r of rows) {
            const d = anyDate(r.date ?? '');
            const v = num(r.stress_score);
            if (d && v) day(ds, d).stress = v;
          }
          hit('Stress');
        } else if (lower.includes('readiness') && head.includes('score')) {
          for (const r of rows) {
            const d = anyDate(col(r, 'date', 'timestamp') ?? '');
            const v = num(col(r, 'readiness_score_value', 'readiness_score', 'score'));
            if (d && v) day(ds, d).readiness = v;
          }
          hit('Readiness');
        } else if (lower.includes('active zone minutes') || (head.includes('heart_zone_id') && head.includes('total_minutes'))) {
          for (const r of rows) {
            const d = anyDate(r.date_time ?? '');
            const v = num(r.total_minutes);
            if (d && v) azmCsv.set(d, (azmCsv.get(d) ?? 0) + v);
          }
          hit('Active Zone Minutes');
        } else {
          // generic daily CSV
          const dateKey = Object.keys(rows[0]).find((k) => /^(date|day|timestamp|date_time)$/.test(k));
          let used = false;
          if (dateKey) {
            for (const r of rows) {
              const d = anyDate(r[dateKey]);
              if (!d) continue;
              for (const [field, aliases] of Object.entries(GENERIC_ALIASES)) {
                const k = aliases.find((a) => r[a] != null && r[a] !== '');
                const v = k ? num(r[k]) : undefined;
                if (v != null) {
                  (day(ds, d) as unknown as Record<string, number>)[field] = v;
                  used = true;
                }
              }
            }
          }
          if (used) hit('Generic CSV');
          else report.skipped++;
        }
      } else report.skipped++;
    } catch (err) {
      report.errors.push(`${name}: ${(err as Error).message}`);
    }
    if (i % 25 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  // ---------- fold accumulators into days ----------
  for (const [d, hours] of minuteSteps) {
    day(ds, d).steps = hours.reduce((a, b) => a + b, 0);
    (ds.intraday[d] ??= {}).stepsHourly = hours;
  }
  for (const [d, kcal] of minuteCal) day(ds, d).calories = Math.round(kcal);
  for (const [d, raw] of minuteDist) {
    // Fitbit minute distance is usually centimetres; fall back to metres if stride looks absurd.
    const steps = ds.days[d]?.steps;
    let km = raw / 100000;
    if (steps && steps > 500) {
      const stride = (km * 1000) / steps;
      if (stride < 0.2) km = raw / 1000;
    }
    day(ds, d).distanceKm = +km.toFixed(2);
  }
  for (const [d, s] of hrSum) {
    const c = hrCnt.get(d)!;
    const hr5: (number | null)[] = [];
    let tot = 0;
    let n = 0;
    for (let k = 0; k < 288; k++) {
      hr5.push(c[k] ? Math.round((s[k] / c[k]) * 10) / 10 : null);
      tot += s[k];
      n += c[k];
    }
    (ds.intraday[d] ??= {}).hr5 = hr5;
    const rec = day(ds, d);
    if (n) rec.avgHr = +(tot / n).toFixed(1);
    rec.maxHr = hrMax.get(d);
  }
  for (const [d, v] of azmCsv) day(ds, d).azm = v;
  for (const [d, v] of rhrFromSleepScore) if (ds.days[d]?.restingHr == null) day(ds, d).restingHr = v;

  if (weightUnitLbs) for (const d of Object.values(ds.days)) if (d.weightKg) d.weightKg = +(d.weightKg * 0.45359237).toFixed(1);

  // de-duplicate sleep & workouts by id
  ds.sleep = [...new Map(ds.sleep.map((s) => [s.id, s])).values()].sort((a, b) => a.start.localeCompare(b.start));
  ds.workouts = [...new Map(ds.workouts.map((w) => [w.id, w])).values()].sort((a, b) => a.start.localeCompare(b.start));
  applySleepToDays(ds);
  for (const [d, v] of sleepScoreByDate) day(ds, d).sleepScore = v;
  // AZM fallback from exercises if no AZM CSV
  if (!azmCsv.size) for (const w of ds.workouts) if (w.azm) day(ds, w.date).azm = (ds.days[w.date]?.azm ?? 0) + w.azm;
  deriveSkinTempDelta(ds);
  progress(files.length, files.length, 'Done');
  return { dataset: ds, report };
}

function sleepFromJson(e: any): SleepSession | null {
  if (!e?.startTime || !e?.endTime) return null;
  const sum = e.levels?.summary;
  const stages = sum?.deep
    ? { deep: sum.deep.minutes ?? 0, light: sum.light?.minutes ?? 0, rem: sum.rem?.minutes ?? 0, wake: sum.wake?.minutes ?? 0 }
    : undefined;
  const levels = (e.levels?.data ?? []).map((l: any) => ({ t: String(l.dateTime).slice(0, 19), level: l.level as SleepLevel, s: l.seconds }));
  return {
    id: String(e.logId ?? e.startTime),
    date: e.dateOfSleep ?? String(e.endTime).slice(0, 10),
    start: String(e.startTime).slice(0, 19),
    end: String(e.endTime).slice(0, 19),
    main: e.mainSleep !== false,
    minutesAsleep: e.minutesAsleep ?? 0,
    minutesAwake: e.minutesAwake ?? 0,
    timeInBed: e.timeInBed ?? Math.round((e.duration ?? 0) / 60000),
    efficiency: e.efficiency,
    stages,
    levels: e.mainSleep !== false ? levels : undefined,
  };
}

function workoutFromJson(e: any): Workout | null {
  if (!e?.startTime) return null;
  const t = fitbitDT(e.startTime);
  if (!Number.isFinite(t)) return null;
  let distanceKm = num(e.distance);
  if (distanceKm && e.distanceUnit && /mile/i.test(e.distanceUnit)) distanceKm *= 1.609344;
  return {
    id: String(e.logId ?? e.startTime),
    date: isoDate(t),
    start: isoLocal(t),
    name: e.activityName ?? 'Workout',
    durationMin: Math.round((e.activeDuration ?? e.duration ?? 0) / 60000),
    calories: num(e.calories),
    steps: num(e.steps),
    avgHr: num(e.averageHeartRate),
    distanceKm: distanceKm ? +distanceKm.toFixed(2) : undefined,
    azm: num(e.activeZoneMinutes?.totalMinutes),
    zones: Array.isArray(e.heartRateZones) ? e.heartRateZones.map((z: any) => ({ name: z.name, minutes: z.minutes ?? 0 })) : undefined,
  };
}
