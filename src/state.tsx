import { createContext, useContext } from 'react';
import type { DailyRecord, Dataset, NumericKey, Settings } from './data/types';
import { dateRange } from './lib/stats';

export interface Range {
  from: string;
  to: string;
  preset: string;
}

export interface AppState {
  ds: Dataset;
  settings: Settings;
  setSettings: (s: Settings) => void;
  range: Range;
  setRange: (r: Range) => void;
  /** dense list of every date in range (records may be empty) */
  days: DailyRecord[];
  /** same length window immediately before the range, for deltas */
  prevDays: DailyRecord[];
  bounds: { min: string; max: string };
  goto: (view: string, arg?: string) => void;
}

export const AppCtx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(AppCtx);

export function denseDays(ds: Dataset, from: string, to: string): DailyRecord[] {
  if (from > to) return [];
  return dateRange(from, to).map((d) => ds.days[d] ?? { date: d });
}

export const col = (days: DailyRecord[], k: NumericKey) => days.map((d) => d[k] ?? null);

export function boundsOf(ds: Dataset) {
  const keys = Object.keys(ds.days).sort();
  return { min: keys[0] ?? new Date().toISOString().slice(0, 10), max: keys[keys.length - 1] ?? new Date().toISOString().slice(0, 10) };
}
