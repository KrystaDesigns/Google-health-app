import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, Empty, Stat } from '../components/ui';
import { Chart } from '../components/Chart';
import { fmtDuration } from '../data/metrics';
import { mean, sum, weekday } from '../lib/stats';

export function Workouts() {
  const { ds, range } = useApp();
  const list = useMemo(() => ds.workouts.filter((w) => w.date >= range.from && w.date <= range.to), [ds, range]);
  const [type, setType] = useState('All');
  const types = useMemo(() => {
    const m = new Map<string, typeof list>();
    for (const w of list) m.set(w.name, [...(m.get(w.name) ?? []), w]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [list]);
  const shown = type === 'All' ? list : list.filter((w) => w.name === type);

  const weekly = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const w of list) {
      const monday = new Date(Date.parse(w.date + 'T12:00:00Z') - weekday(w.date) * 864e5).toISOString().slice(0, 10);
      const rec = m.get(monday) ?? {};
      rec[w.name] = (rec[w.name] ?? 0) + w.durationMin;
      m.set(monday, rec);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list]);

  if (!list.length) return <Empty>No logged exercises in this range.</Empty>;
  // Categorical cap: top 5 types keep their own hue; the rest fold into "Other".
  const named = types.slice(0, 5).map(([n]) => n);
  const cat = (n: string) => (named.includes(n) ? n : 'Other');
  const cats = [...named, ...(types.length > 5 ? ['Other'] : [])];
  // scatter overlaps marks, so it gets a tighter 3-hue cap
  const sc = named.slice(0, 3);
  const scCats = [...sc, ...(types.length > 3 ? ['Other'] : [])];

  return (
    <div className="grid">
      <div className="stats span-3">
        <Stat label="Workouts" value={list.length} hint={`${types.length} activity types`} />
        <Stat label="Total time" value={fmtDuration(sum(list.map((w) => w.durationMin)))} />
        <Stat label="Avg duration" value={fmtDuration(mean(list.map((w) => w.durationMin)) ?? 0)} />
        <Stat label="Calories" value={`${Math.round(sum(list.map((w) => w.calories))).toLocaleString()} kcal`} />
        <Stat label="Distance" value={`${sum(list.map((w) => w.distanceKm)).toFixed(1)} km`} />
        <Stat label="Avg workout HR" value={`${Math.round(mean(list.map((w) => w.avgHr)) ?? 0)} bpm`} />
      </div>

      <Card title="Weekly training volume" sub="Minutes per week by activity" span={2}>
        <Chart
          height={300}
          deps={[weekly]}
          option={(t) => ({
            legend: {},
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => fmtDuration(v ?? 0) },
            xAxis: { type: 'category', data: weekly.map(([w]) => w) },
            yAxis: { type: 'value', name: 'min' },
            series: cats.map((c, i) => ({
              name: c, type: 'bar', stack: 'w',
              data: weekly.map(([, rec]) => Object.entries(rec).filter(([n]) => cat(n) === c).reduce((a, [, v]) => a + v, 0) || null),
              itemStyle: { color: c === 'Other' ? t.muted : t.series[i], borderColor: t.surface, borderWidth: 1 },
            })),
          })}
        />
      </Card>

      <Card title="By activity">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Activity</th><th className="num">#</th><th className="num">Time</th><th className="num">Avg HR</th></tr></thead>
            <tbody>
              {types.map(([n, ws]) => (
                <tr key={n} className={type === n ? 'sel' : ''} onClick={() => setType(type === n ? 'All' : n)}>
                  <td>{n}</td>
                  <td className="num">{ws.length}</td>
                  <td className="num">{fmtDuration(sum(ws.map((w) => w.durationMin)))}</td>
                  <td className="num">{Math.round(mean(ws.map((w) => w.avgHr)) ?? 0) || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Click a row to filter the log below.</p>
      </Card>

      <Card title="Intensity vs duration" sub="Each dot is a workout" span={3}>
        <Chart
          height={300}
          deps={[list]}
          option={(t) => ({
            legend: {},
            tooltip: { trigger: 'item', formatter: (p: any) => `<b>${p.value[3]}</b> · ${p.value[2]}<br/>${fmtDuration(p.value[0])} @ ${p.value[1]} bpm` },
            xAxis: { type: 'value', name: 'minutes', nameLocation: 'middle', nameGap: 24 },
            yAxis: { type: 'value', name: 'avg bpm', scale: true },
            grid: { left: 8, right: 16, top: 36, bottom: 24, containLabel: true },
            series: scCats.map((c, i) => ({
              name: c,
              type: 'scatter', symbolSize: 9,
              data: list.filter((w) => w.avgHr && (c === 'Other' ? !sc.includes(w.name) : w.name === c)).map((w) => [w.durationMin, w.avgHr, w.date, w.name]),
              itemStyle: { color: c === 'Other' ? t.muted : t.series[i], borderColor: t.surface, borderWidth: 1, opacity: 0.85 },
            })),
          })}
        />
      </Card>

      <Card title={`Workout log${type !== 'All' ? ` · ${type}` : ''}`} span={3}>
        <div className="table-wrap tall">
          <table>
            <thead><tr><th>Date</th><th>Activity</th><th className="num">Duration</th><th className="num">Avg HR</th><th className="num">Calories</th><th className="num">Distance</th><th className="num">AZM</th></tr></thead>
            <tbody>
              {[...shown].reverse().map((w) => (
                <tr key={w.id}>
                  <td>{w.start.replace('T', ' ').slice(0, 16)}</td>
                  <td>{w.name}</td>
                  <td className="num">{fmtDuration(w.durationMin)}</td>
                  <td className="num">{w.avgHr ?? '–'}</td>
                  <td className="num">{w.calories ?? '–'}</td>
                  <td className="num">{w.distanceKm ? `${w.distanceKm} km` : '–'}</td>
                  <td className="num">{w.azm ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
