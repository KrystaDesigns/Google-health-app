/**
 * Live sync with the Google Health API (v4) straight from the browser.
 *
 * Auth: Google Identity Services token client (no backend, no client secret).
 * Data: daily rollups for activity + heart rate, daily summaries for recovery
 * metrics, sleep sessions with stages, exercises, weight, and 5-minute heart
 * rate / hourly steps for the intraday charts.
 */
import type { Dataset, SleepLevel, SleepSession, Workout } from './types';
import { emptyDataset } from './types';
import { applySleepToDays, day } from './derive';
import { addDays } from '../lib/stats';

const BASE = 'https://health.googleapis.com/v4/users/me';
export const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
];

// ---------------------------------------------------------------- auth

declare global {
  interface Window {
    google?: any;
  }
}

let token: { value: string; expires: number } | null = null;
try {
  const saved = JSON.parse(sessionStorage.getItem('pulse-lab:gh-token') ?? 'null');
  if (saved && saved.expires > Date.now()) token = saved;
} catch {
  /* ignore */
}

export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection or ad-blocker.'));
    document.head.appendChild(s);
  });
}

export function hasValidToken() {
  return !!token && token.expires > Date.now() + 60_000;
}

/** Must be called from a click handler (opens Google's consent popup). */
export async function signIn(clientId: string): Promise<string> {
  if (hasValidToken()) return token!.value;
  // Popups must open synchronously inside the click; GIS is preloaded on app start.
  if (!window.google?.accounts?.oauth2) await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(' '),
      include_granted_scopes: true,
      callback: (resp: any) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        token = { value: resp.access_token, expires: Date.now() + (resp.expires_in ?? 3600) * 1000 };
        try {
          sessionStorage.setItem('pulse-lab:gh-token', JSON.stringify(token));
        } catch {
          /* ignore */
        }
        resolve(token.value);
      },
      error_callback: (err: any) => reject(new Error(err?.type === 'popup_closed' ? 'Sign-in window was closed.' : err?.message || 'Sign-in failed.')),
    });
    client.requestAccessToken();
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.value, () => {});
  token = null;
  try {
    sessionStorage.removeItem('pulse-lab:gh-token');
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- http

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function api(path: string, init?: RequestInit): Promise<any> {
  if (!token) throw new ApiError(401, 'Not signed in');
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.ok) return res.json();
  let msg = res.statusText;
  try {
    msg = (await res.json()).error?.message ?? msg;
  } catch {
    /* ignore */
  }
  if (res.status === 401) token = null;
  throw new ApiError(res.status, msg);
}

async function listAll(type: string, filter: string, pageSize = 1000): Promise<any[]> {
  const out: any[] = [];
  let pageToken = '';
  for (let guard = 0; guard < 200; guard++) {
    const q = new URLSearchParams({ filter, pageSize: String(pageSize) });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await api(`/dataTypes/${type}/dataPoints?${q}`);
    out.push(...(r.dataPoints ?? []));
    pageToken = r.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return out;
}

const civil = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { date: { year: y, month: m, day: d } };
};

async function dailyRollUp(type: string, from: string, toExcl: string): Promise<any[]> {
  const out: any[] = [];
  let pageToken = '';
  for (let guard = 0; guard < 50; guard++) {
    const r = await api(`/dataTypes/${type}/dataPoints:dailyRollUp`, {
      method: 'POST',
      body: JSON.stringify({ range: { start: civil(from), end: civil(toExcl) }, windowSizeDays: 1, pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
    });
    out.push(...(r.rollupDataPoints ?? []));
    pageToken = r.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return out;
}

async function rollUp(type: string, from: string, toExcl: string, windowSec: number): Promise<any[]> {
  const out: any[] = [];
  let pageToken = '';
  const start = localMidnight(from).toISOString();
  const end = localMidnight(toExcl).toISOString();
  for (let guard = 0; guard < 50; guard++) {
    const r = await api(`/dataTypes/${type}/dataPoints:rollUp`, {
      method: 'POST',
      body: JSON.stringify({ range: { startTime: start, endTime: end }, windowSize: `${windowSec}s`, pageSize: 10000, ...(pageToken ? { pageToken } : {}) }),
    });
    out.push(...(r.rollupDataPoints ?? []));
    pageToken = r.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return out;
}

// ---------------------------------------------------------------- helpers

const localMidnight = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (c: any): string | null => (c?.year ? `${c.year}-${pad(c.month)}-${pad(c.day)}` : null);
const n = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined;
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(x) ? x : undefined;
};
const seconds = (dur?: string) => (dur ? parseFloat(dur) || 0 : 0); // google-duration "3600s"
/** UTC timestamp + "3600s" offset → local wall-clock ISO without zone. */
const localIso = (t: string, offset?: string) => new Date(Date.parse(t) + seconds(offset) * 1000).toISOString().slice(0, 19);
/** Browser-local date / hour of a physical timestamp (rollUp windows have no offset). */
const browserLocal = (t: string) => {
  const d = new Date(t);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes() };
};

function chunks(from: string, toExcl: string, size: number): [string, string][] {
  const out: [string, string][] = [];
  for (let s = from; s < toExcl; s = addDays(s, size)) {
    const e = addDays(s, size);
    out.push([s, e < toExcl ? e : toExcl]);
  }
  return out;
}

/** One malformed record shouldn't fail a whole data type. */
function safe<T>(f: () => T | null): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

const STAGE: Record<string, SleepLevel> = { AWAKE: 'wake', LIGHT: 'light', DEEP: 'deep', REM: 'rem', ASLEEP: 'asleep', RESTLESS: 'restless' };

// ---------------------------------------------------------------- sync

export interface SyncReport {
  ok: string[];
  failed: { what: string; error: string }[];
}

type Progress = (done: number, total: number, label: string) => void;

/** Fetch [from, to] (inclusive dates) into a fresh Dataset. */
export async function syncRange(from: string, to: string, progress: Progress): Promise<{ dataset: Dataset; report: SyncReport }> {
  const ds = emptyDataset();
  ds.source = ['Google Health (live)'];
  const toExcl = addDays(to, 1);
  const report: SyncReport = { ok: [], failed: [] };
  const c14 = chunks(from, toExcl, 14);

  type Job = { what: string; run: () => Promise<void> };
  const jobs: Job[] = [];
  const rollupJob = (what: string, type: string, apply: (date: string, p: any) => void) =>
    c14.forEach(([s, e]) =>
      jobs.push({
        what,
        run: async () => {
          for (const p of await dailyRollUp(type, s, e)) {
            const d = dateOf(p.civilStartTime?.date);
            if (d) apply(d, p);
          }
        },
      }),
    );

  rollupJob('Steps', 'steps', (d, p) => (day(ds, d).steps = n(p.steps?.countSum)));
  rollupJob('Distance', 'distance', (d, p) => {
    const mm = n(p.distance?.millimetersSum);
    if (mm != null) day(ds, d).distanceKm = +(mm / 1e6).toFixed(2);
  });
  rollupJob('Calories', 'total-calories', (d, p) => {
    const k = n(p.totalCalories?.kcalSum);
    if (k != null) day(ds, d).calories = Math.round(k);
  });
  rollupJob('Active Zone Minutes', 'active-zone-minutes', (d, p) => {
    const a = p.activeZoneMinutes;
    if (a) day(ds, d).azm = (n(a.sumInFatBurnHeartZone) ?? 0) + (n(a.sumInCardioHeartZone) ?? 0) + (n(a.sumInPeakHeartZone) ?? 0);
  });
  rollupJob('Active minutes', 'active-minutes', (d, p) => {
    for (const l of p.activeMinutes?.activeMinutesRollupByActivityLevel ?? []) {
      const v = n(l.activeMinutesSum);
      if (l.activityLevel === 'LIGHT') day(ds, d).lightMin = v;
      if (l.activityLevel === 'MODERATE') day(ds, d).moderateMin = v;
      if (l.activityLevel === 'VIGOROUS') day(ds, d).veryActiveMin = v;
    }
  });
  rollupJob('Heart rate (daily)', 'heart-rate', (d, p) => {
    const h = p.heartRate;
    if (!h) return;
    day(ds, d).avgHr = n(h.beatsPerMinuteAvg) != null ? +n(h.beatsPerMinuteAvg)!.toFixed(1) : undefined;
    day(ds, d).maxHr = n(h.beatsPerMinuteMax);
  });

  // Daily summaries (one data point per day)
  const daily = (what: string, type: string, apply: (p: any) => void) =>
    jobs.push({
      what,
      run: async () => {
        const field = type.replace(/-/g, '_');
        for (const p of await listAll(type, `${field}.date >= "${from}" AND ${field}.date < "${toExcl}"`)) apply(p);
      },
    });
  daily('Resting heart rate', 'daily-resting-heart-rate', (p) => {
    const x = p.dailyRestingHeartRate;
    const d = dateOf(x?.date);
    if (d && n(x.beatsPerMinute)) day(ds, d).restingHr = n(x.beatsPerMinute);
  });
  daily('HRV', 'daily-heart-rate-variability', (p) => {
    const x = p.dailyHeartRateVariability;
    const d = dateOf(x?.date);
    const v = n(x?.averageHeartRateVariabilityMilliseconds);
    if (d && v) day(ds, d).hrv = +v.toFixed(1);
  });
  daily('SpO₂', 'daily-oxygen-saturation', (p) => {
    const x = p.dailyOxygenSaturation;
    const d = dateOf(x?.date);
    const v = n(x?.averagePercentage);
    if (d && v) day(ds, d).spo2 = +v.toFixed(1);
  });
  daily('Breathing rate', 'daily-respiratory-rate', (p) => {
    const x = p.dailyRespiratoryRate;
    const d = dateOf(x?.date);
    const v = n(x?.breathsPerMinute);
    if (d && v) day(ds, d).breathingRate = +v.toFixed(1);
  });
  daily('Skin temperature', 'daily-sleep-temperature-derivations', (p) => {
    const x = p.dailySleepTemperatureDerivations;
    const d = dateOf(x?.date);
    const t = n(x?.nightlyTemperatureCelsius);
    if (!d || t == null) return;
    day(ds, d).skinTemp = +t.toFixed(2);
    const b = n(x.baselineTemperatureCelsius);
    if (b != null) day(ds, d).skinTempDelta = +(t - b).toFixed(2);
  });

  jobs.push({
    what: 'Sleep',
    run: async () => {
      const pts = await listAll('sleep', `sleep.interval.civil_end_time >= "${from}" AND sleep.interval.civil_end_time < "${toExcl}"`, 25);
      for (const p of pts) {
        const s = safe(() => sleepFromApi(p));
        if (s) ds.sleep.push(s);
      }
    },
  });
  jobs.push({
    what: 'Exercises',
    run: async () => {
      const pts = await listAll('exercise', `exercise.interval.civil_start_time >= "${from}" AND exercise.interval.civil_start_time < "${toExcl}"`, 25);
      for (const p of pts) {
        const w = safe(() => workoutFromApi(p));
        if (w) ds.workouts.push(w);
      }
    },
  });
  jobs.push({
    what: 'Weight',
    run: async () => {
      for (const p of await listAll('weight', `weight.sample_time.civil_time >= "${from}" AND weight.sample_time.civil_time < "${toExcl}"`)) {
        const d = dateOf(p.weight?.sampleTime?.civilTime?.date);
        const g = n(p.weight?.weightGrams);
        if (d && g) day(ds, d).weightKg = +(g / 1000).toFixed(1);
      }
    },
  });

  // Intraday: 5-minute heart rate and hourly steps (14-day windows)
  c14.forEach(([s, e]) => {
    jobs.push({
      what: 'Heart rate (5-min)',
      run: async () => {
        for (const p of await rollUp('heart-rate', s, e, 300)) {
          const v = n(p.heartRate?.beatsPerMinuteAvg);
          if (v == null) continue;
          const { date, minutes } = browserLocal(p.startTime);
          const id = (ds.intraday[date] ??= {});
          (id.hr5 ??= new Array(288).fill(null))[Math.floor(minutes / 5)] = Math.round(v * 10) / 10;
        }
      },
    });
    jobs.push({
      what: 'Steps (hourly)',
      run: async () => {
        for (const p of await rollUp('steps', s, e, 3600)) {
          const v = n(p.steps?.countSum);
          if (v == null) continue;
          const { date, minutes } = browserLocal(p.startTime);
          const id = (ds.intraday[date] ??= {});
          (id.stepsHourly ??= new Array(24).fill(0))[Math.floor(minutes / 60)] += v;
        }
      },
    });
  });

  // Run with modest concurrency; one failing data type doesn't sink the rest.
  let done = 0;
  const failedKinds = new Map<string, string>();
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift()!;
      progress(done, jobs.length, job.what);
      try {
        if (!failedKinds.has(job.what)) await job.run();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) throw e;
        failedKinds.set(job.what, (e as Error).message);
      }
      done++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  progress(jobs.length, jobs.length, 'Done');

  for (const what of new Set(jobs.map((j) => j.what))) {
    if (failedKinds.has(what)) report.failed.push({ what, error: failedKinds.get(what)! });
    else report.ok.push(what);
  }

  ds.sleep = [...new Map(ds.sleep.map((s) => [s.id, s])).values()].sort((a, b) => a.start.localeCompare(b.start));
  ds.workouts = [...new Map(ds.workouts.map((w) => [w.id, w])).values()].sort((a, b) => a.start.localeCompare(b.start));
  applySleepToDays(ds);
  return { dataset: ds, report };
}

function sleepFromApi(p: any): SleepSession | null {
  const s = p.sleep;
  const iv = s?.interval;
  if (!iv?.startTime || !iv?.endTime) return null;
  const start = localIso(iv.startTime, iv.startUtcOffset);
  const end = localIso(iv.endTime, iv.endUtcOffset);
  const sum = s.summary ?? {};
  const byType: Record<string, number> = {};
  for (const st of sum.stagesSummary ?? []) byType[st.type] = n(st.minutes) ?? 0;
  const inBed = n(sum.minutesInSleepPeriod) ?? Math.round((Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 60000);
  const asleep = n(sum.minutesAsleep) ?? 0;
  const staged = s.type === 'STAGES' && byType.DEEP != null;
  return {
    id: p.name || iv.startTime,
    date: dateOf(iv.civilEndTime?.date) ?? end.slice(0, 10),
    start,
    end,
    main: s.metadata?.mainSleep ?? !s.metadata?.nap,
    minutesAsleep: asleep,
    minutesAwake: n(sum.minutesAwake) ?? 0,
    timeInBed: inBed,
    efficiency: inBed ? Math.round((100 * asleep) / inBed) : undefined,
    stages: staged ? { deep: byType.DEEP ?? 0, light: byType.LIGHT ?? 0, rem: byType.REM ?? 0, wake: byType.AWAKE ?? 0 } : undefined,
    levels: (s.stages ?? []).map((st: any) => ({
      t: localIso(st.startTime, st.startUtcOffset),
      level: STAGE[st.type] ?? 'light',
      s: Math.round((Date.parse(st.endTime) - Date.parse(st.startTime)) / 1000),
    })),
  };
}

function workoutFromApi(p: any): Workout | null {
  const e = p.exercise;
  const iv = e?.interval;
  if (!iv?.startTime) return null;
  const start = localIso(iv.startTime, iv.startUtcOffset);
  const m = e.metricsSummary ?? {};
  const z = m.heartRateZoneDurations;
  const mm = n(m.distanceMillimeters);
  const dur = seconds(e.activeDuration) || (Date.parse(iv.endTime) - Date.parse(iv.startTime)) / 1000;
  return {
    id: p.name || iv.startTime,
    date: start.slice(0, 10),
    start,
    name: e.displayName || titleCase(e.exerciseType ?? 'Workout'),
    durationMin: Math.round(dur / 60),
    calories: n(m.caloriesKcal) != null ? Math.round(n(m.caloriesKcal)!) : undefined,
    steps: n(m.steps),
    avgHr: n(m.averageHeartRateBeatsPerMinute),
    distanceKm: mm ? +(mm / 1e6).toFixed(2) : undefined,
    azm: n(m.activeZoneMinutes),
    zones: z
      ? [
          { name: 'Light', minutes: Math.round(seconds(z.lightTime) / 60) },
          { name: 'Moderate', minutes: Math.round(seconds(z.moderateTime) / 60) },
          { name: 'Vigorous', minutes: Math.round(seconds(z.vigorousTime) / 60) },
          { name: 'Peak', minutes: Math.round(seconds(z.peakTime) / 60) },
        ]
      : undefined,
  };
}

const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
