import { get, set, del } from 'idb-keyval';
import type { Dataset, Journal, Settings } from './types';
import { DEFAULT_TAGS } from '../lib/journal';
import { DEFAULT_GOALS } from '../lib/goals';

const DS_KEY = 'pulse-lab:dataset';
const SETTINGS_KEY = 'pulse-lab:settings';
const JOURNAL_KEY = 'pulse-lab:journal';

export const defaultSettings: Settings = {
  age: 35,
  intradayOffsetHours: 0,
  theme: 'system',
  // OAuth client IDs are public identifiers, not secrets.
  googleClientId: '901994183920-krn7o3piskk4h7j34cul5sf98j1vp109.apps.googleusercontent.com',
  googleFirstSyncDays: 90,
  goals: DEFAULT_GOALS,
};

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

export const emptyJournal = (): Journal => ({ tags: [...DEFAULT_TAGS], entries: {} });

export async function loadJournal(): Promise<Journal> {
  try {
    return ((await get(JOURNAL_KEY)) as Journal | undefined) ?? emptyJournal();
  } catch {
    return emptyJournal();
  }
}

export async function saveJournal(j: Journal) {
  try {
    await set(JOURNAL_KEY, j);
  } catch {
    /* ignore */
  }
}
