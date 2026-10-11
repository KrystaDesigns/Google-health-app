/**
 * Deterministic synthetic year of tracker data with realistic structure:
 * weekly rhythm, seasonal drift, activity→sleep→recovery coupling, a fitness
 * block, two short illness episodes (RHR↑, HRV↓, skin temp↑), and a habit
 * journal whose tags genuinely shift that night's sleep and next-day recovery.
 */
import type { Dataset, Journal, SleepLevel, SleepSession, Workout } from './types';
import { DEFAULT_TAGS } from '../lib/journal';
import { emptyDataset } from './types';
import { addDays, weekday } from '../lib/stats';
import { applySleepToDays, deriveSkinTempDelta } from './derive';

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDemo(days = 365): { ds: Dataset; journal: Journal } {
  const r = rng(42);
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (!u) u = r();
    while (!v) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const ds = emptyDataset();
  ds.source = ['Demo data'];
  const end = new Date().toISOString().slice(0, 10);
  const start = addDays(end, -days + 1);
  const illness = [Math.floor(days * 0.3), Math.floor(days * 0.78)];
  let prevSleep = 440;
  let prevTags: string[] = [];
  const journal: Journal = { tags: [...DEFAULT_TAGS], entries: {}, demo: true };
  let fitness = 0;

  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const wd = weekday(date);
    const weekend = wd >= 5;
    const season = Math.sin(((i + 60) / 365) * 2 * Math.PI); // + in summer
    const sick = illness.some((s) => i >= s && i < s + 5) ? 1 : illness.some((s) => i >= s + 5 && i < s + 9) ? 0.4 : 0;
    if (i > days * 0.45 && i < days * 0.7) fitness = Math.min(1, fitness + 0.012);
    else fitness = Math.max(0, fitness - 0.004);

    // ---- activity
    const workoutDay = !sick && r() < (weekend ? 0.55 : 0.35) + fitness * 0.25;
    let steps = 7600 + season * 1400 + (weekend ? 900 : 0) + gauss() * 2300 + (workoutDay ? 3800 : 0) + fitness * 1200;
    steps = Math.round(clamp(steps * (1 - sick * 0.65), 900, 28000));
    const very = Math.round(clamp((workoutDay ? 28 + gauss() * 10 : 3 + r() * 6) * (1 - sick), 0, 120));
    const moderate = Math.round(clamp(steps / 900 + gauss() * 5, 0, 80));
    const light = Math.round(clamp(150 + steps / 90 + gauss() * 30, 40, 400));
    const sedentary = Math.round(clamp(1440 - light - moderate - very - prevSleep, 300, 1100));
    const stride = 0.74 + gauss() * 0.01;

    // ---- habit effects from yesterday's journal on tonight's sleep / tomorrow's recovery
    const has = (t: string) => prevTags.includes(t);
    const fx = {
      bed: (has('Caffeine after 2pm') ? 25 : 0) + (has('Screens in bed') ? 20 : 0),
      sleep: (has('Caffeine after 2pm') ? -25 : 0) + (has('Screens in bed') ? -15 : 0) + (has('Stressful day') ? -15 : 0),
      deep: (has('Alcohol') ? -14 : 0) + (has('Late meal') ? -6 : 0) + (has('Stretching / yoga') ? 5 : 0),
      rem: has('Alcohol') ? -10 : 0,
      wake: (has('Alcohol') ? 8 : 0) + (has('Meditation') ? -5 : 0),
      rhr: (has('Alcohol') ? 2.5 : 0) + (has('Late meal') ? 1.2 : 0),
      hrv: (has('Alcohol') ? -7 : 0) + (has('Stressful day') ? -4 : 0) + (has('Meditation') ? 3 : 0),
    };

    // ---- sleep for night ending on `date`
    const bedBase = weekend || wd === 4 ? 23.9 * 60 : 23.05 * 60; // Fri/Sat night later
    const bedtime = Math.round(bedBase + gauss() * 38 - 1440 + sick * 40 - (workoutDay ? 10 : 0) + fx.bed); // minutes rel. midnight
    const sleepMin = Math.round(clamp(435 + (weekend ? 35 : 0) + gauss() * 42 + sick * 45 + fitness * 10 + fx.sleep, 260, 640));
    const wake = Math.round(clamp(42 + gauss() * 14 + sick * 25 + fx.wake, 10, 140));
    const deep = Math.round(clamp(sleepMin * (0.16 + (steps - 8000) / 400000 + fitness * 0.02) + gauss() * 10 + fx.deep, 25, 150));
    const rem = Math.round(clamp(sleepMin * 0.22 + gauss() * 12 - sick * 15 + fx.rem, 30, 160));
    const lightSleep = sleepMin - deep - rem;
    const timeInBed = sleepMin + wake;
    const waketime = bedtime + timeInBed;

    // ---- recovery
    const sleepDebt = (440 - prevSleep) / 60;
    const rhr = clamp(59 - fitness * 3.5 + sleepDebt * 0.6 + sick * 6.5 - season * 0.8 + gauss() * 1.1 + fx.rhr, 46, 80);
    const hrv = clamp(42 + fitness * 6 - sleepDebt * 2 - sick * 14 + gauss() * 5 + fx.hrv, 12, 90);
    const skinTemp = 33.9 + sick * 0.9 + season * 0.15 + gauss() * 0.18;
    const spo2 = clamp(96.4 - sick * 1.2 + gauss() * 0.6, 90, 100);
    const br = clamp(14.6 + sick * 1.8 + gauss() * 0.5, 10, 22);
    const sleepScore = Math.round(clamp(55 + (sleepMin - 360) / 7 + deep / 12 - wake / 6 + gauss() * 4, 40, 97));
    const readiness = Math.round(clamp(70 + (hrv - 42) * 0.9 - (rhr - 58) * 1.8 + (sleepScore - 78) * 0.5 + gauss() * 5, 15, 100));
    const stress = Math.round(clamp(76 + (hrv - 42) * 0.4 - sick * 15 + gauss() * 6 + (weekend ? 3 : -2), 30, 98));
    const azm = Math.round(very * 2 + moderate * 0.6 + gauss() * 3);
    const weight = 72.5 - fitness * 1.6 - i * 0.002 + Math.sin(i / 14) * 0.3 + gauss() * 0.35;

    ds.days[date] = {
      date,
      steps,
      distanceKm: +((steps * stride) / 1000).toFixed(2),
      calories: Math.round(1650 + steps * 0.045 + very * 8 + moderate * 4 + gauss() * 60),
      sedentaryMin: sedentary,
      lightMin: light,
      moderateMin: moderate,
      veryActiveMin: very,
      azm: Math.max(0, azm),
      restingHr: +rhr.toFixed(1),
      hrv: +hrv.toFixed(1),
      spo2: +spo2.toFixed(1),
      breathingRate: +br.toFixed(1),
      skinTemp: +skinTemp.toFixed(2),
      stress,
      readiness,
      sleepScore,
      weightKg: r() < 0.4 ? +weight.toFixed(1) : undefined,
      bodyFat: undefined,
      vo2max: +(41 + fitness * 3.2 + season * 0.4 - sick * 0.8 + gauss() * 0.25).toFixed(1),
      floors: Math.max(0, Math.round(9 + gauss() * 4 + (workoutDay ? 4 : 0))),
      sedentaryHours: +(sedentary / 60).toFixed(1),
      zoneLightMin: Math.round(light / 3),
      zoneModerateMin: Math.round(moderate + very * 0.4),
      zoneVigorousMin: Math.round(very * 0.5),
      zonePeakMin: Math.round(very * 0.1),
      hydrationMl: r() < 0.7 ? Math.round(clamp(1900 + gauss() * 450 + (workoutDay ? 400 : 0), 600, 4000)) : undefined,
      hrvDeep: +(hrv * 1.18 + gauss() * 3).toFixed(1),
      outOfBedMin: Math.round(clamp(gauss() * 4 + 3, 0, 30)),
    };

    // intraday
    const hourWeights = Array.from({ length: 24 }, (_, h) => {
      if (h < 7 && !weekend) return h >= 6 ? 0.4 : 0.01;
      if (h < 9 && weekend) return h >= 8 ? 0.4 : 0.01;
      if (h >= 23) return 0.05;
      const commute = !weekend && (h === 8 || h === 18) ? 2.2 : 1;
      const lunch = h === 12 || h === 13 ? 1.5 : 1;
      const wo = workoutDay && (weekend ? h === 10 : h === 7 || h === 18) ? 5 : 1;
      return commute * lunch * wo * (0.6 + r() * 0.8);
    });
    const tw = hourWeights.reduce((a, b) => a + b, 0);
    const stepsHourly = hourWeights.map((w) => Math.round((steps * w) / tw));
    const sleepEndSlot = Math.floor(waketime / 5);
    const hr5 = Array.from({ length: 288 }, (_, k) => {
      const h = k / 12;
      const asleep = k < sleepEndSlot;
      if (asleep) return +(rhr - 2 + Math.sin(k / 9) * 2 + gauss() * 1.5).toFixed(1);
      const act = stepsHourly[Math.floor(h)] / 400;
      return +(clamp(rhr + 14 + act * 9 + gauss() * 4, 45, 185)).toFixed(1);
    });
    ds.intraday[date] = { stepsHourly, hr5 };
    ds.days[date].avgHr = +(hr5.reduce((a, b) => a + (b ?? 0), 0) / 288).toFixed(1);
    ds.days[date].maxHr = Math.round(Math.min(192, Math.max(...(hr5 as number[])) + (workoutDay ? 20 : 5)));

    // sleep session with hypnogram
    const startMs = Date.parse(date + 'T00:00:00Z') + bedtime * 60000;
    const levels: { t: string; level: SleepLevel; s: number }[] = [];
    let t = startMs;
    let cycle = 0;
    while (t < startMs + timeInBed * 60000) {
      const remainingMin = (startMs + timeInBed * 60000 - t) / 60000;
      const early = cycle < 3;
      const seq: [SleepLevel, number][] = [
        ['light', 15 + r() * 15],
        ['deep', early ? (deep / 3) * (0.7 + r() * 0.6) : r() * 8],
        ['light', 10 + r() * 15],
        ['rem', early ? 8 + r() * 10 : 18 + r() * 18],
        ['wake', r() < 0.6 ? 2 + r() * 8 : 0],
      ];
      for (const [level, m] of seq) {
        const mins = Math.min(Math.round(m), Math.round(remainingMin));
        if (mins <= 0) continue;
        levels.push({ t: new Date(t).toISOString().slice(0, 19), level, s: mins * 60 });
        t += mins * 60000;
        if (t >= startMs + timeInBed * 60000) break;
      }
      cycle++;
    }
    const session: SleepSession = {
      id: 'demo-' + date,
      date,
      start: new Date(startMs).toISOString().slice(0, 19),
      end: new Date(startMs + timeInBed * 60000).toISOString().slice(0, 19),
      main: true,
      minutesAsleep: sleepMin,
      minutesAwake: wake,
      timeInBed,
      efficiency: Math.round((100 * sleepMin) / timeInBed),
      stages: { deep, light: lightSleep, rem, wake },
      levels,
    };
    ds.sleep.push(session);
    prevSleep = sleepMin;

    // ---- today's journal (only the last ~4 months were "logged")
    const tags: string[] = [];
    const maybe = (t: string, p: number) => r() < p && tags.push(t);
    maybe('Alcohol', weekend || wd === 4 ? 0.4 : 0.08);
    maybe('Caffeine after 2pm', weekend ? 0.1 : 0.22);
    maybe('Late meal', 0.2);
    maybe('Stressful day', weekend ? 0.05 : 0.28);
    maybe('Screens in bed', 0.35);
    maybe('Meditation', 0.25);
    maybe('Stretching / yoga', workoutDay ? 0.35 : 0.12);
    if (sick) tags.push('Sick');
    if (i >= days - 120) journal.entries[date] = tags;
    prevTags = tags;

    if (workoutDay) {
      const kinds = ['Run', 'Walk', 'Bike', 'Weights', 'Swim', 'Yoga'];
      const name = kinds[Math.floor(r() ** 1.6 * kinds.length)];
      const dur = Math.round(clamp(42 + gauss() * 15, 15, 120));
      const avgHr = Math.round(name === 'Yoga' ? 95 : name === 'Walk' ? 108 : 138 + fitness * -4 + gauss() * 8);
      const hour = weekend ? 10 : r() < 0.5 ? 7 : 18;
      const w: Workout = {
        id: 'demo-w-' + date,
        date,
        start: `${date}T${String(hour).padStart(2, '0')}:${String(Math.floor(r() * 50)).padStart(2, '0')}:00`,
        name,
        durationMin: dur,
        avgHr,
        calories: Math.round(dur * (avgHr - 60) * 0.12),
        steps: name === 'Run' || name === 'Walk' ? Math.round(dur * (name === 'Run' ? 160 : 105)) : undefined,
        distanceKm: name === 'Run' ? +(dur / (5.6 - fitness * 0.4)).toFixed(2) : name === 'Bike' ? +(dur / 2.4).toFixed(2) : name === 'Walk' ? +(dur / 11).toFixed(2) : undefined,
        azm: Math.round(dur * (avgHr > 130 ? 1.6 : avgHr > 105 ? 0.9 : 0.2)),
        zones: [
          { name: 'Out of Range', minutes: Math.round(dur * 0.15) },
          { name: 'Fat Burn', minutes: Math.round(dur * (avgHr > 130 ? 0.3 : 0.7)) },
          { name: 'Cardio', minutes: Math.round(dur * (avgHr > 130 ? 0.45 : 0.15)) },
          { name: 'Peak', minutes: Math.round(dur * (avgHr > 130 ? 0.1 : 0)) },
        ],
      };
      ds.workouts.push(w);
    }
  }
  for (const d of Object.values(ds.days)) if (d.weightKg) d.bodyFat = +(21.5 + (d.weightKg - 72) * 0.6 + gauss() * 0.4).toFixed(1);
  applySleepToDays(ds);
  deriveSkinTempDelta(ds);
  return { ds, journal };
}
