import type { NumericKey } from './types';

export interface MetricMeta {
  key: NumericKey;
  label: string;
  unit: string;
  group: 'Activity' | 'Heart' | 'Sleep' | 'Recovery' | 'Body';
  decimals: number;
  /** +1 higher is better, -1 lower is better, 0 neutral */
  better: 1 | -1 | 0;
}

export const METRICS: MetricMeta[] = [
  { key: 'steps', label: 'Steps', unit: '', group: 'Activity', decimals: 0, better: 1 },
  { key: 'distanceKm', label: 'Distance', unit: 'km', group: 'Activity', decimals: 2, better: 1 },
  { key: 'calories', label: 'Calories burned', unit: 'kcal', group: 'Activity', decimals: 0, better: 0 },
  { key: 'azm', label: 'Active Zone Minutes', unit: 'min', group: 'Activity', decimals: 0, better: 1 },
  { key: 'veryActiveMin', label: 'Very active', unit: 'min', group: 'Activity', decimals: 0, better: 1 },
  { key: 'moderateMin', label: 'Fairly active', unit: 'min', group: 'Activity', decimals: 0, better: 1 },
  { key: 'lightMin', label: 'Lightly active', unit: 'min', group: 'Activity', decimals: 0, better: 1 },
  { key: 'sedentaryMin', label: 'Sedentary', unit: 'min', group: 'Activity', decimals: 0, better: -1 },
  { key: 'restingHr', label: 'Resting heart rate', unit: 'bpm', group: 'Heart', decimals: 1, better: -1 },
  { key: 'avgHr', label: 'Average heart rate', unit: 'bpm', group: 'Heart', decimals: 1, better: 0 },
  { key: 'maxHr', label: 'Max heart rate', unit: 'bpm', group: 'Heart', decimals: 0, better: 0 },
  { key: 'hrv', label: 'HRV (RMSSD)', unit: 'ms', group: 'Recovery', decimals: 1, better: 1 },
  { key: 'spo2', label: 'SpO₂', unit: '%', group: 'Recovery', decimals: 1, better: 1 },
  { key: 'breathingRate', label: 'Breathing rate', unit: 'br/min', group: 'Recovery', decimals: 1, better: 0 },
  { key: 'skinTempDelta', label: 'Skin temp variation', unit: '°C', group: 'Recovery', decimals: 2, better: 0 },
  { key: 'stress', label: 'Stress management', unit: '', group: 'Recovery', decimals: 0, better: 1 },
  { key: 'readiness', label: 'Readiness', unit: '', group: 'Recovery', decimals: 0, better: 1 },
  { key: 'sleepMin', label: 'Sleep duration', unit: 'min', group: 'Sleep', decimals: 0, better: 1 },
  { key: 'sleepEfficiency', label: 'Sleep efficiency', unit: '%', group: 'Sleep', decimals: 0, better: 1 },
  { key: 'sleepScore', label: 'Sleep score', unit: '', group: 'Sleep', decimals: 0, better: 1 },
  { key: 'deepMin', label: 'Deep sleep', unit: 'min', group: 'Sleep', decimals: 0, better: 1 },
  { key: 'remMin', label: 'REM sleep', unit: 'min', group: 'Sleep', decimals: 0, better: 1 },
  { key: 'lightSleepMin', label: 'Light sleep', unit: 'min', group: 'Sleep', decimals: 0, better: 0 },
  { key: 'wakeMin', label: 'Awake in bed', unit: 'min', group: 'Sleep', decimals: 0, better: -1 },
  { key: 'bedtime', label: 'Bedtime', unit: 'clock', group: 'Sleep', decimals: 0, better: 0 },
  { key: 'waketime', label: 'Wake time', unit: 'clock', group: 'Sleep', decimals: 0, better: 0 },
  { key: 'weightKg', label: 'Weight', unit: 'kg', group: 'Body', decimals: 1, better: 0 },
];

export const META: Record<string, MetricMeta> = Object.fromEntries(METRICS.map((m) => [m.key, m]));

export function fmtClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtDuration(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function fmtMetric(key: string, v: number | null | undefined, withUnit = true): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const m = META[key];
  if (!m) return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (m.unit === 'clock') return fmtClock(v);
  if (key === 'sleepMin' || key === 'deepMin' || key === 'remMin' || key === 'lightSleepMin') return fmtDuration(v);
  const s = v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: m.decimals });
  return withUnit && m.unit ? `${s} ${m.unit}` : s;
}
