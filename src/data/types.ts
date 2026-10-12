/** One calendar day of summarised metrics. Every field is optional because
 *  exports differ by device, firmware and what the user enabled. */
export interface DailyRecord {
  date: string; // YYYY-MM-DD (local)
  steps?: number;
  distanceKm?: number;
  calories?: number;
  floors?: number;
  sedentaryMin?: number;
  lightMin?: number;
  moderateMin?: number;
  veryActiveMin?: number;
  azm?: number; // active zone minutes
  restingHr?: number;
  avgHr?: number;
  maxHr?: number;
  hrv?: number; // RMSSD ms
  spo2?: number; // %
  breathingRate?: number; // breaths / min
  skinTemp?: number; // °C absolute, nightly
  skinTempDelta?: number; // °C relative to personal baseline
  stress?: number; // 0-100
  readiness?: number; // 0-100
  weightKg?: number;
  // sleep (main sleep of the night that *ended* on this date)
  sleepMin?: number;
  timeInBedMin?: number;
  sleepEfficiency?: number;
  sleepScore?: number;
  deepMin?: number;
  lightSleepMin?: number;
  remMin?: number;
  wakeMin?: number;
  bedtime?: number; // minutes relative to midnight of `date` (negative = previous evening)
  waketime?: number; // minutes after midnight of `date`
  outOfBedMin?: number;
  // extra Google Health metrics
  vo2max?: number;
  sedentaryHours?: number;
  bodyFat?: number;
  hrvDeep?: number;
  zoneLightMin?: number;
  zoneModerateMin?: number;
  zoneVigorousMin?: number;
  zonePeakMin?: number;
  hydrationMl?: number;
  caloriesIn?: number;
  period?: number; // 1 on menstrual-period days
  // derived
  trainingLoad?: number;
}

export type NumericKey = {
  [K in keyof DailyRecord]-?: DailyRecord[K] extends number | undefined ? K : never;
}[keyof DailyRecord];

export type SleepLevel = 'wake' | 'light' | 'deep' | 'rem' | 'restless' | 'asleep' | 'awake';

export interface SleepSession {
  id: string;
  date: string; // date of wake-up
  start: string; // local ISO (no zone)
  end: string;
  main: boolean;
  minutesAsleep: number;
  minutesAwake: number;
  timeInBed: number;
  efficiency?: number;
  outOfBedMin?: number;
  stages?: { deep: number; light: number; rem: number; wake: number };
  levels?: { t: string; level: SleepLevel; s: number }[];
}

export interface Workout {
  id: string;
  date: string;
  start: string; // local ISO
  name: string;
  durationMin: number;
  calories?: number;
  steps?: number;
  avgHr?: number;
  distanceKm?: number;
  azm?: number;
  zones?: { name: string; minutes: number }[];
}

export interface IntradayDay {
  stepsHourly?: number[]; // 24
  hr5?: (number | null)[]; // 288 five-minute averages
}

export interface Dataset {
  source: string[];
  importedAt: string;
  days: Record<string, DailyRecord>;
  sleep: SleepSession[];
  workouts: Workout[];
  intraday: Record<string, IntradayDay>;
  /** symptoms / moods logged in Google Health, keyed by date */
  logged?: Record<string, string[]>;
}

export interface Settings {
  age: number;
  intradayOffsetHours: number; // shift applied to minute-level UTC timestamps
  theme: 'system' | 'light' | 'dark';
  googleClientId: string;
  googleLastSync?: string; // ISO timestamp of last successful live sync
  googleFirstSyncDays: number;
  googleExtraScopes?: boolean; // cycle + logged moods/symptoms
  goals?: Goal[];
  sex?: 'female' | 'male';
}

export interface Goal {
  id: string;
  metric: NumericKey;
  target: number;
  /** 'day' = every day hits target; 'week'/'month' = total over the period */
  period: 'day' | 'week' | 'month';
  dir: 'atLeast' | 'atMost';
}

/** Daily habit journal: date → tag ids */
export interface Journal {
  tags: string[];
  entries: Record<string, string[]>;
  demo?: boolean; // generated with demo data; cleared when real data arrives
}

export const emptyDataset = (): Dataset => ({
  source: [],
  importedAt: new Date().toISOString(),
  days: {},
  sleep: [],
  workouts: [],
  intraday: {},
});
