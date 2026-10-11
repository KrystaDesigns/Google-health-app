import type { Dataset, Goal } from '../data/types';
import { addDays, daysBetween, weekday } from './stats';

export const DEFAULT_GOALS: Goal[] = [
  { id: 'g-steps', metric: 'steps', target: 10000, period: 'day', dir: 'atLeast' },
  { id: 'g-sleep', metric: 'sleepMin', target: 420, period: 'day', dir: 'atLeast' },
  { id: 'g-azm', metric: 'azm', target: 150, period: 'week', dir: 'atLeast' },
  { id: 'g-steps-month', metric: 'steps', target: 300000, period: 'month', dir: 'atLeast' },
];

const hit = (g: Goal, v: number | undefined) => v != null && (g.dir === 'atLeast' ? v >= g.target : v <= g.target);

export interface GoalStatus {
  goal: Goal;
  /** current value: today's value for daily goals, period total otherwise */
  value: number | null;
  progress: number; // 0…1 (capped at 1.5 for display)
  met: boolean;
  periodLabel: string;
  // daily goals
  streak?: number;
  best?: number;
  hitRate30?: number;
  last14?: (boolean | null)[];
  // period goals
  daysLeft?: number;
  forecast?: number;
  forecastMet?: boolean;
  needPerDay?: number;
  history?: { label: string; value: number; met: boolean }[];
}

function periodStart(date: string, period: 'week' | 'month') {
  return period === 'week' ? addDays(date, -weekday(date)) : date.slice(0, 8) + '01';
}
function periodEnd(start: string, period: 'week' | 'month') {
  if (period === 'week') return addDays(start, 6);
  const [y, m] = start.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function evaluateGoal(ds: Dataset, g: Goal, today: string): GoalStatus {
  const val = (d: string) => ds.days[d]?.[g.metric];
  if (g.period === 'day') {
    // "today" may not have a full value yet; use latest day with data for display
    const dates = Object.keys(ds.days).filter((d) => d <= today && val(d) != null).sort();
    const last = dates[dates.length - 1];
    const v = last ? val(last)! : null;
    let streak = 0;
    for (let d = last; d && hit(g, val(d)); d = addDays(d, -1)) streak++;
    let best = 0;
    let cur = 0;
    for (const d of dates) {
      cur = hit(g, val(d)) ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    const recent = dates.filter((d) => daysBetween(d, today) < 30);
    const hits = recent.filter((d) => hit(g, val(d))).length;
    const last14 = Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i - 13);
      const x = val(d);
      return x == null ? null : hit(g, x);
    });
    return {
      goal: g,
      value: v,
      progress: v == null ? 0 : progressOf(g, v),
      met: hit(g, v ?? undefined),
      periodLabel: last === today ? 'Today' : last ? `Latest (${last})` : 'No data',
      streak,
      best,
      hitRate30: recent.length ? hits / recent.length : undefined,
      last14,
    };
  }
  const start = periodStart(today, g.period);
  const end = periodEnd(start, g.period);
  let total = 0;
  let counted = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const x = val(d);
    if (x != null) {
      total += x;
      counted++;
    }
  }
  const len = daysBetween(start, end) + 1;
  const elapsed = daysBetween(start, today) + 1;
  const daysLeft = len - elapsed;
  const forecast = counted ? (total / elapsed) * len : 0;
  const history: GoalStatus['history'] = [];
  let s = start;
  for (let i = 0; i < 8; i++) {
    s = periodStart(addDays(s, -1), g.period);
    const e = periodEnd(s, g.period);
    let t = 0;
    let any = false;
    for (let d = s; d <= e; d = addDays(d, 1)) {
      const x = val(d);
      if (x != null) {
        t += x;
        any = true;
      }
    }
    if (any) history.unshift({ label: g.period === 'week' ? s.slice(5) : s.slice(0, 7), value: t, met: hit(g, t) });
  }
  return {
    goal: g,
    value: total,
    progress: progressOf(g, total),
    met: hit(g, total),
    periodLabel: g.period === 'week' ? `This week (${start.slice(5)} → ${end.slice(5)})` : `This month (${start.slice(0, 7)})`,
    daysLeft,
    forecast: Math.round(forecast),
    forecastMet: hit(g, forecast),
    needPerDay: daysLeft > 0 && g.dir === 'atLeast' ? Math.max(0, Math.round((g.target - total) / daysLeft)) : undefined,
    history,
  };
}

function progressOf(g: Goal, v: number) {
  if (g.dir === 'atLeast') return Math.min(1.5, v / g.target);
  return v <= g.target ? 1 : Math.max(0, g.target / v);
}
