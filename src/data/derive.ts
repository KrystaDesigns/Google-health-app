import type { Dataset, DailyRecord, SleepSession } from './types';
import { addDays, median } from '../lib/stats';

const minutesFrom = (iso: string, dayIso: string) =>
  (Date.parse(iso.slice(0, 19) + 'Z') - Date.parse(dayIso + 'T00:00:00Z')) / 60000;

export function day(ds: Dataset, date: string): DailyRecord {
  return (ds.days[date] ??= { date });
}

/** Fill per-day sleep fields from the main sleep session of each night. */
export function applySleepToDays(ds: Dataset) {
  const byDate = new Map<string, SleepSession[]>();
  for (const s of ds.sleep) {
    const arr = byDate.get(s.date) ?? [];
    arr.push(s);
    byDate.set(s.date, arr);
  }
  for (const [date, sessions] of byDate) {
    const main = sessions.find((s) => s.main) ?? [...sessions].sort((a, b) => b.minutesAsleep - a.minutesAsleep)[0];
    const d = day(ds, date);
    d.sleepMin = sessions.reduce((a, s) => a + s.minutesAsleep, 0);
    d.timeInBedMin = main.timeInBed;
    d.sleepEfficiency = main.efficiency ?? (main.timeInBed ? (100 * main.minutesAsleep) / main.timeInBed : undefined);
    if (main.stages) {
      d.deepMin = main.stages.deep;
      d.lightSleepMin = main.stages.light;
      d.remMin = main.stages.rem;
      d.wakeMin = main.stages.wake;
    } else {
      d.wakeMin = main.minutesAwake;
    }
    d.bedtime = minutesFrom(main.start, date);
    d.waketime = minutesFrom(main.end, date);
  }
}

/** Personal-baseline skin temperature deviation (30-night trailing median). */
export function deriveSkinTempDelta(ds: Dataset) {
  const dates = Object.keys(ds.days).sort();
  for (const date of dates) {
    const d = ds.days[date];
    if (d.skinTemp == null || d.skinTempDelta != null) continue;
    const window: number[] = [];
    for (let i = 1; i <= 30; i++) {
      const v = ds.days[addDays(date, -i)]?.skinTemp;
      if (v != null) window.push(v);
    }
    const m = window.length >= 5 ? median(window) : null;
    if (m != null) d.skinTempDelta = +(d.skinTemp - m).toFixed(2);
  }
}

export function mergeDatasets(a: Dataset, b: Dataset): Dataset {
  const days = { ...a.days };
  for (const [k, v] of Object.entries(b.days)) days[k] = { ...days[k], ...stripUndef(v) };
  const sleepIds = new Set(b.sleep.map((s) => s.id));
  const woIds = new Set(b.workouts.map((w) => w.id));
  const intraday = { ...a.intraday };
  for (const [k, v] of Object.entries(b.intraday)) intraday[k] = { ...intraday[k], ...v };
  return {
    source: [...new Set([...a.source, ...b.source])],
    importedAt: new Date().toISOString(),
    days,
    sleep: [...a.sleep.filter((s) => !sleepIds.has(s.id)), ...b.sleep].sort((x, y) => x.start.localeCompare(y.start)),
    workouts: [...a.workouts.filter((w) => !woIds.has(w.id)), ...b.workouts].sort((x, y) => x.start.localeCompare(y.start)),
    intraday,
  };
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<T>;
}
