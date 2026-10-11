import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, Seg } from '../components/ui';
import { Chart } from '../components/Chart';
import { METRICS, fmtMetric } from '../data/metrics';
import type { DailyRecord } from '../data/types';
import { addDays, welch, weekday } from '../lib/stats';

type Mode = 'periods' | 'weekend' | 'workout' | 'sleep';

export function Compare() {
  const { ds, bounds, days } = useApp();
  const [mode, setMode] = useState<Mode>('periods');
  const [a, setA] = useState({ from: addDays(bounds.max, -29), to: bounds.max });
  const [b, setB] = useState({ from: addDays(bounds.max, -59), to: addDays(bounds.max, -30) });

  const groups = useMemo((): [string, string, DailyRecord[], DailyRecord[]] => {
    const all = Object.values(ds.days);
    const workoutDates = new Set(ds.workouts.map((w) => w.date));
    switch (mode) {
      case 'weekend':
        return ['Weekend', 'Weekday', days.filter((d) => weekday(d.date) >= 5), days.filter((d) => weekday(d.date) < 5)];
      case 'workout':
        return ['Workout days', 'Rest days', days.filter((d) => workoutDates.has(d.date)), days.filter((d) => !workoutDates.has(d.date))];
      case 'sleep':
        return ['After ≥ 7h sleep', 'After < 7h sleep', days.filter((d) => (d.sleepMin ?? 0) >= 420), days.filter((d) => d.sleepMin != null && d.sleepMin < 420)];
      default:
        return [`${a.from} → ${a.to}`, `${b.from} → ${b.to}`, all.filter((d) => d.date >= a.from && d.date <= a.to), all.filter((d) => d.date >= b.from && d.date <= b.to)];
    }
  }, [mode, ds, days, a, b]);

  const [la, lb, ga, gb] = groups;
  const rows = useMemo(
    () =>
      METRICS.map((m) => ({ m, w: welch(ga.map((d) => d[m.key] ?? null), gb.map((d) => d[m.key] ?? null)) }))
        .filter((r) => r.w)
        .map((r) => ({ ...r, w: r.w! })),
    [ga, gb],
  );

  return (
    <div className="grid">
      <Card
        title="Compare two groups of days"
        sub="Welch's t-test per metric. Effect size (Cohen's d): 0.2 small, 0.5 medium, 0.8 large."
        span={3}
        actions={<Seg value={mode} onChange={setMode} options={[{ v: 'periods', l: 'Two periods' }, { v: 'weekend', l: 'Weekend vs weekday' }, { v: 'workout', l: 'Workout vs rest' }, { v: 'sleep', l: 'Sleep ≥ 7h' }]} />}
      >
        {mode === 'periods' && (
          <div className="row wrap periods">
            <label><span className="chip a">A</span><input type="date" value={a.from} min={bounds.min} max={bounds.max} onChange={(e) => setA({ ...a, from: e.target.value })} /> → <input type="date" value={a.to} min={bounds.min} max={bounds.max} onChange={(e) => setA({ ...a, to: e.target.value })} /></label>
            <label><span className="chip b">B</span><input type="date" value={b.from} min={bounds.min} max={bounds.max} onChange={(e) => setB({ ...b, from: e.target.value })} /> → <input type="date" value={b.to} min={bounds.min} max={bounds.max} onChange={(e) => setB({ ...b, to: e.target.value })} /></label>
          </div>
        )}
        <p className="muted small">A = <b>{la}</b> ({ga.length} days) · B = <b>{lb}</b> ({gb.length} days){mode !== 'periods' && ' · within the selected date range'}</p>

        <Chart
          height={Math.max(240, rows.length * 24 + 60)}
          deps={[rows]}
          option={(t) => ({
            tooltip: { trigger: 'item', formatter: (p: any) => { const r = rows[p.dataIndex]; return `<b>${r.m.label}</b><br/>A: ${fmtMetric(r.m.key, r.w.ma)}<br/>B: ${fmtMetric(r.m.key, r.w.mb)}<br/>d = ${r.w.d.toFixed(2)}, p = ${r.w.p < 0.001 ? '<0.001' : r.w.p.toFixed(3)}`; } },
            grid: { left: 8, right: 24, top: 8, bottom: 24, containLabel: true },
            xAxis: { type: 'value', name: "Cohen's d (A − B)", nameLocation: 'middle', nameGap: 22, min: (v: any) => Math.min(-1, Math.floor(v.min * 2) / 2), max: (v: any) => Math.max(1, Math.ceil(v.max * 2) / 2) },
            yAxis: { type: 'category', data: rows.map((r) => r.m.label), inverse: true, axisLabel: { fontSize: 11 }, splitLine: { show: false } },
            series: [{
              type: 'bar',
              data: rows.map((r) => ({ value: +r.w.d.toFixed(2), itemStyle: { color: r.w.p < 0.05 ? (r.w.d > 0 ? t.diverging[0] : t.diverging[2]) : t.axis, borderRadius: 3 } })),
              barWidth: 12,
              markLine: { symbol: 'none', silent: true, lineStyle: { color: t.muted }, label: { show: false }, data: [{ xAxis: 0 }] },
            }],
          })}
        />
        <p className="muted small">Grey bars: difference not statistically significant (p ≥ 0.05).</p>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Metric</th><th className="num">A</th><th className="num">B</th><th className="num">Δ</th><th className="num">Δ %</th><th className="num">d</th><th className="num">p</th></tr></thead>
            <tbody>
              {rows.map(({ m, w }) => (
                <tr key={m.key} className={w.p < 0.05 ? 'sig' : ''}>
                  <td>{m.label}</td>
                  <td className="num">{fmtMetric(m.key, w.ma)}</td>
                  <td className="num">{fmtMetric(m.key, w.mb)}</td>
                  <td className="num">{m.unit === 'clock' ? `${Math.round(w.ma - w.mb)} min` : fmtMetric(m.key, w.ma - w.mb)}</td>
                  <td className="num">{m.unit === 'clock' || !w.mb ? '–' : `${(((w.ma - w.mb) / Math.abs(w.mb)) * 100).toFixed(1)}%`}</td>
                  <td className="num">{w.d.toFixed(2)}</td>
                  <td className="num">{w.p < 0.001 ? '<0.001' : w.p.toFixed(3)}{w.p < 0.05 ? ' ✱' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
