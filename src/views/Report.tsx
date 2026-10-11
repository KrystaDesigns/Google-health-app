import { useMemo, useState } from 'react';
import { useApp, denseDays, col } from '../state';
import { Card, Empty } from '../components/ui';
import { Chart } from '../components/Chart';
import { META, fmtClock, fmtDuration, fmtMetric, lowerLabel } from '../data/metrics';
import type { NumericKey } from '../data/types';
import { addDays, mean, pearson, sd, sum, weekday } from '../lib/stats';
import { normAlerts, describeAlert } from '../lib/norms';
import { strainFlags } from '../lib/insights';
import { tagEffects, effectSentence } from '../lib/journal';
import { bedtimeBins } from '../lib/chronotype';
import { evaluateGoal, DEFAULT_GOALS } from '../lib/goals';

type Row = { k: NumericKey; agg: 'avg' | 'sum'; label?: string };
const ROWS: Row[] = [
  { k: 'steps', agg: 'avg', label: 'Steps / day' },
  { k: 'azm', agg: 'sum', label: 'Active Zone Minutes (total)' },
  { k: 'trainingLoad', agg: 'sum', label: 'Training load (total)' },
  { k: 'sleepMin', agg: 'avg', label: 'Sleep / night' },
  { k: 'sleepScore', agg: 'avg' },
  { k: 'deepMin', agg: 'avg', label: 'Deep sleep / night' },
  { k: 'restingHr', agg: 'avg' },
  { k: 'hrv', agg: 'avg' },
  { k: 'readiness', agg: 'avg' },
  { k: 'weightKg', agg: 'avg' },
];

export function Report() {
  const { ds, journal, settings, load, bounds } = useApp();
  const lastMonday = addDays(bounds.max, -weekday(bounds.max) - (weekday(bounds.max) === 6 ? 0 : 7));
  const weeks = useMemo(() => {
    const out: string[] = [];
    for (let w = addDays(bounds.max, -weekday(bounds.max)); w >= bounds.min && out.length < 26; w = addDays(w, -7)) out.push(w);
    return out;
  }, [bounds]);
  const [start, setStart] = useState(lastMonday >= bounds.min ? lastMonday : weeks[0]);
  const end = addDays(start, 6);
  const wk = useMemo(() => denseDays(ds, start, end), [ds, start, end]);
  const prev = useMemo(() => denseDays(ds, addDays(start, -7), addDays(start, -1)), [ds, start]);

  const rows = ROWS.filter((r) => wk.some((d) => d[r.k] != null)).map((r) => {
    const f = r.agg === 'sum' ? (xs: (number | null)[]) => (xs.some((x) => x != null) ? sum(xs) : null) : mean;
    const a = f(col(wk, r.k));
    const b = f(col(prev, r.k));
    const pct = a != null && b ? ((a - b) / Math.abs(b)) * 100 : null;
    const better = META[r.k]?.better ?? 0;
    const good = pct == null || Math.abs(pct) < 3 || better === 0 ? null : Math.sign(pct) === better;
    return { ...r, a, b, pct, good };
  });

  const wins: string[] = [];
  const watch: string[] = [];
  for (const r of rows) {
    if (r.good === true) wins.push(`${r.label ?? META[r.k].label} ${r.pct! > 0 ? 'up' : 'down'} ${Math.abs(r.pct!).toFixed(0)}% vs last week (${fmtMetric(r.k, r.a)}).`);
    if (r.good === false) watch.push(`${r.label ?? META[r.k].label} ${r.pct! > 0 ? 'up' : 'down'} ${Math.abs(r.pct!).toFixed(0)}% vs last week (${fmtMetric(r.k, r.a)}).`);
  }
  for (const g of settings.goals ?? DEFAULT_GOALS) {
    if (g.period !== 'day') continue;
    const s = evaluateGoal(ds, g, end);
    const hits = wk.filter((d) => d[g.metric] != null && (g.dir === 'atLeast' ? d[g.metric]! >= g.target : d[g.metric]! <= g.target)).length;
    if (hits >= 5) wins.push(`Hit your ${lowerLabel(META[g.metric].label)} goal on ${hits} of 7 days${s.streak ? ` (streak: ${s.streak})` : ''}.`);
    else if (wk.some((d) => d[g.metric] != null)) watch.push(`${META[g.metric].label} goal met on only ${hits} of 7 days.`);
  }
  const flags = strainFlags(ds, wk.map((d) => d.date));
  for (const f of flags.slice(0, 2)) watch.push(`Strain signals on ${f.date}: ${f.reasons.join(', ')}.`);
  for (const a of normAlerts(ds, end).filter((a) => a.bad).slice(0, 3)) watch.push(describeAlert(a));

  // pattern of the week: strongest relationship over the trailing 60 days
  const pattern = useMemo(() => {
    const win = denseDays(ds, addDays(end, -59), end);
    const pairs: [NumericKey, NumericKey, number][] = [['steps', 'deepMin', 0], ['azm', 'sleepScore', 0], ['sleepMin', 'hrv', 1], ['sleepMin', 'restingHr', 1], ['bedtime', 'sleepScore', 0], ['trainingLoad', 'hrv', 1], ['trainingLoad', 'restingHr', 1], ['stress', 'sleepScore', 0]];
    let best: { a: NumericKey; b: NumericKey; lag: number; r: number; n: number } | null = null;
    for (const [a, b, lag] of pairs) {
      const p = pearson(win.map((d) => d[a] ?? null), win.map((d) => ds.days[addDays(d.date, lag)]?.[b] ?? null));
      if (p && p.p < 0.05 && (!best || Math.abs(p.r) > Math.abs(best.r))) best = { a, b, lag, r: p.r, n: p.n };
    }
    return best;
  }, [ds, end]);
  const habit = useMemo(() => tagEffects(journal, ds).filter((e) => e.p < 0.05 && e.good != null).sort((a, b) => a.p - b.p)[0], [journal, ds]);
  const lp = load.find((p) => p.date === end) ?? load[load.length - 1];

  // focus for next week
  const focus: string[] = [];
  const avgSleep = mean(col(wk, 'sleepMin'));
  const beds = col(wk, 'bedtime');
  const { best: bestBin } = bedtimeBins(denseDays(ds, addDays(end, -89), end));
  if (avgSleep != null && avgSleep < 420) focus.push(`Sleep averaged ${fmtDuration(avgSleep)}. Aim to be in bed ${bestBin ? `around ${fmtClock(bestBin.start)}–${fmtClock(bestBin.start + 30)} (your best-sleep window)` : '30 minutes earlier'}.`);
  if ((sd(beds) ?? 0) > 60) focus.push(`Bedtime varied by ±${Math.round(sd(beds)!)} min. A steadier schedule usually improves sleep quality.`);
  const azm = sum(col(wk, 'azm'));
  if (wk.some((d) => d.azm != null) && azm < 150) focus.push(`${azm} Active Zone Minutes this week — add ${Math.ceil((150 - azm) / 30)} brisk 30-minute session${150 - azm > 30 ? 's' : ''} to reach 150.`);
  if (lp?.acwr != null && lp.acwr > 1.3) focus.push(`Training load is ramping (acute:chronic ${lp.acwr}). Hold volume steady this week rather than adding more.`);
  if (lp?.acwr != null && lp.acwr < 0.8) focus.push(`Load is below your usual — a good week to build gradually (up to ~10% more).`);
  if (habit && habit.good === false) focus.push(`Consider cutting back: ${effectSentence(habit)}`);
  if (!focus.length) focus.push('Keep doing what you are doing — no metric needs special attention.');

  if (!wk.some((d) => Object.keys(d).length > 1)) return <Empty>No data for this week.</Empty>;

  return (
    <div className="grid report">
      <Card
        title={`Weekly report · ${start} → ${end}`}
        sub="Compared with the previous week"
        span={3}
        actions={
          <div className="row no-print">
            <select value={start} onChange={(e) => setStart(e.target.value)}>
              {weeks.map((w) => <option key={w} value={w}>Week of {w}</option>)}
            </select>
            <button onClick={() => window.print()}>Print / save PDF</button>
          </div>
        }
      >
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table>
            <thead><tr><th>Metric</th><th className="num">This week</th><th className="num">Last week</th><th className="num">Change</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}>
                  <td>{r.label ?? META[r.k].label}</td>
                  <td className="num"><b>{fmtMetric(r.k, r.a)}</b></td>
                  <td className="num">{fmtMetric(r.k, r.b)}</td>
                  <td className={`num ${r.good == null ? '' : r.good ? 'good-text' : 'bad-text'}`}>{r.pct == null ? '–' : `${r.pct > 0 ? '▲' : '▼'} ${Math.abs(r.pct).toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Wins">
        <ul className="bullets good">{wins.length ? wins.map((w) => <li key={w}>{w}</li>) : <li className="muted">No standout improvements this week.</li>}</ul>
      </Card>
      <Card title="Watch">
        <ul className="bullets bad">{watch.length ? watch.map((w) => <li key={w}>{w}</li>) : <li className="muted">Nothing out of your normal range.</li>}</ul>
      </Card>
      <Card title="Focus for next week">
        <ol className="bullets">{focus.map((f) => <li key={f}>{f}</li>)}</ol>
      </Card>

      <Card title="Daily view" sub="Steps and sleep for each day of the week" span={2}>
        <Chart
          height={220}
          deps={[wk]}
          option={(t) => ({
            legend: {},
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            grid: [{ left: 8, right: 8, top: 30, height: '30%', containLabel: true }, { left: 8, right: 8, top: '60%', bottom: 4, containLabel: true }],
            xAxis: [{ type: 'category', data: wk.map((d) => d.date.slice(5)), gridIndex: 0, axisLabel: { show: false } }, { type: 'category', data: wk.map((d) => d.date.slice(5)), gridIndex: 1 }],
            yAxis: [{ type: 'value', gridIndex: 0, splitNumber: 2 }, { type: 'value', gridIndex: 1, splitNumber: 2 }],
            series: [
              { name: 'Steps', type: 'bar', xAxisIndex: 0, yAxisIndex: 0, data: col(wk, 'steps'), itemStyle: { color: t.series[0], borderRadius: [3, 3, 0, 0] } },
              { name: 'Sleep (h)', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: wk.map((d) => (d.sleepMin != null ? +(d.sleepMin / 60).toFixed(1) : null)), itemStyle: { color: t.series[6], borderRadius: [3, 3, 0, 0] } },
            ],
          })}
        />
      </Card>

      <Card title="Patterns">
        {pattern ? (
          <p><b>{META[pattern.a].label} → {pattern.lag ? 'next-day ' : ''}{lowerLabel(META[pattern.b].label)}</b>: {pattern.r > 0 ? 'move together' : 'move in opposite directions'} (r = {pattern.r.toFixed(2)}, last 60 days).</p>
        ) : <p className="muted">No strong relationship in the last 60 days.</p>}
        {habit && <p><b>Journal:</b> {effectSentence(habit)}</p>}
        {lp && <p><b>Training:</b> fitness {lp.ctl.toFixed(0)}, fatigue {lp.atl.toFixed(0)}, form {lp.tsb > 0 ? '+' : ''}{lp.tsb.toFixed(0)}{lp.acwr != null ? `, acute:chronic ${lp.acwr}` : ''}.</p>}
      </Card>
      <p className="small muted span-3">Generated by Pulse Lab from your own data. Statistical patterns, not medical advice.</p>
    </div>
  );
}
