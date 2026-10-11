import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, MetricSelect, Seg } from '../components/ui';
import { Chart } from '../components/Chart';
import { useTokens } from '../components/theme';
import { DEFAULT_GOALS, evaluateGoal, type GoalStatus } from '../lib/goals';
import { META, fmtMetric } from '../data/metrics';
import type { Goal, NumericKey } from '../data/types';

function Ring({ s }: { s: GoalStatus }) {
  const t = useTokens();
  const r = 42;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, s.progress);
  const color = s.met ? t.good : s.forecastMet ? t.series[0] : s.progress >= 0.7 ? t.series[0] : t.series[1];
  return (
    <svg viewBox="0 0 100 100" width="104" height="104" role="img" aria-label={`${Math.round(s.progress * 100)}% of goal`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke={t.dark ? '#2c2c2a' : '#ecebe6'} strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="48" textAnchor="middle" fontSize="18" fontWeight="700" fill={t.ink}>{Math.round(s.progress * 100)}%</text>
      <text x="50" y="65" textAnchor="middle" fontSize="10" fill={t.muted}>{s.met ? 'done ✓' : 'of goal'}</text>
    </svg>
  );
}

const describe = (g: Goal) => `${META[g.metric]?.label ?? g.metric} ${g.dir === 'atLeast' ? '≥' : '≤'} ${fmtMetric(g.metric, g.target)} ${g.period === 'day' ? 'every day' : g.period === 'week' ? 'per week' : 'per month'}`;

export function Goals() {
  const { ds, settings, setSettings, today } = useApp();
  const goals = settings.goals ?? DEFAULT_GOALS;
  const statuses = useMemo(() => goals.map((g) => evaluateGoal(ds, g, today)), [ds, goals, today]);
  const [draft, setDraft] = useState<Goal>({ id: '', metric: 'azm', target: 30, period: 'day', dir: 'atLeast' });
  const save = (gs: Goal[]) => setSettings({ ...settings, goals: gs });

  return (
    <div className="grid">
      {statuses.map((s) => (
        <Card key={s.goal.id} title={describe(s.goal)} sub={s.periodLabel} actions={<button className="link" onClick={() => save(goals.filter((g) => g.id !== s.goal.id))} aria-label="Remove goal">Remove</button>}>
          <div className="goal">
            <Ring s={s} />
            <div className="goal-body">
              <div className="goal-value">{fmtMetric(s.goal.metric, s.value)} <span className="muted small">/ {fmtMetric(s.goal.metric, s.goal.target)}</span></div>
              {s.goal.period === 'day' ? (
                <>
                  <div className="small">🔥 Streak <b>{s.streak} days</b> · best {s.best}</div>
                  {s.hitRate30 != null && <div className="small muted">Hit on {Math.round(s.hitRate30 * 100)}% of the last 30 days</div>}
                  <div className="streak-dots" aria-label="Last 14 days">
                    {s.last14!.map((h, i) => <span key={i} className={h == null ? 'none' : h ? 'hit' : 'miss'} title={h == null ? 'no data' : h ? 'hit' : 'missed'} />)}
                  </div>
                </>
              ) : (
                <>
                  <div className="small">{s.daysLeft} day{s.daysLeft === 1 ? '' : 's'} left</div>
                  <div className={`small ${s.forecastMet ? 'good-text' : 'bad-text'}`}>
                    At this pace: {fmtMetric(s.goal.metric, s.forecast)} {s.forecastMet ? '— on track ✓' : '— behind'}
                  </div>
                  {s.needPerDay != null && !s.met && <div className="small muted">Need ~{fmtMetric(s.goal.metric, s.needPerDay)} per day from here</div>}
                </>
              )}
            </div>
          </div>
          {s.history && s.history.length > 0 && (
            <Chart
              height={120}
              deps={[s]}
              option={(t) => ({
                grid: { left: 4, right: 4, top: 10, bottom: 4, containLabel: true },
                tooltip: { trigger: 'axis', valueFormatter: (v: any) => fmtMetric(s.goal.metric, v) },
                xAxis: { type: 'category', data: s.history!.map((h) => h.label), axisLabel: { fontSize: 10 } },
                yAxis: { type: 'value', show: false },
                series: [{
                  type: 'bar', data: s.history!.map((h) => ({ value: h.value, itemStyle: { color: h.met ? t.series[0] : t.axis, borderRadius: [3, 3, 0, 0] } })),
                  markLine: { symbol: 'none', silent: true, lineStyle: { color: t.good, type: 'dotted' }, label: { show: false }, data: [{ yAxis: s.goal.target }] },
                }],
              })}
            />
          )}
        </Card>
      ))}

      <Card title="Add a goal" span={3}>
        <div className="row wrap">
          <MetricSelect value={draft.metric} onChange={(k: NumericKey) => setDraft({ ...draft, metric: k })} />
          <Seg value={draft.dir} onChange={(v) => setDraft({ ...draft, dir: v })} options={[{ v: 'atLeast', l: 'at least' }, { v: 'atMost', l: 'at most' }]} />
          <input type="number" value={draft.target} onChange={(e) => setDraft({ ...draft, target: +e.target.value })} style={{ width: 110 }} aria-label="Target" />
          <span className="muted small">{META[draft.metric]?.unit === 'clock' ? 'minutes from midnight (−60 = 23:00)' : META[draft.metric]?.unit}</span>
          <Seg value={draft.period} onChange={(v) => setDraft({ ...draft, period: v })} options={[{ v: 'day', l: 'every day' }, { v: 'week', l: 'per week (total)' }, { v: 'month', l: 'per month (total)' }]} />
          <button className="primary" onClick={() => save([...goals, { ...draft, id: 'g-' + Date.now() }])} disabled={!draft.target}>Add goal</button>
        </div>
        <p className="small muted">Weekly and monthly goals add up the daily values (best for steps, Active Zone Minutes, floors, distance). Daily goals count streaks.</p>
        <button className="link small" onClick={() => save(DEFAULT_GOALS)}>Reset to default goals</button>
      </Card>
    </div>
  );
}
