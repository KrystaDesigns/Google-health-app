import { get, set, del } from 'idb-keyval';
import type { Dataset, Settings } from './types';

const DS_KEY = 'pulse-lab:dataset';
const SETTINGS_KEY = 'pulse-lab:settings';

export const defaultSettings: Settings = { age: 35, intradayOffsetHours: 0, theme: 'system' };

export async function loadDataset(): Promise<Dataset | null> {
  try {
    return ((await get(DS_KEY)) as Dataset | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveDataset(ds: Dataset) {
  try {
    await set(DS_KEY, ds);
  } catch {
    /* storage unavailable (private mode) — app still works for the session */
  }
}

export async function clearDataset() {
  try {
    await del(DS_KEY);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): Settings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
