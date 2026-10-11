import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, Empty, MetricSelect, Seg, Stat } from '../components/ui';
import { Chart } from '../components/Chart';
import { METRICS, META, fmtMetric, lowerLabel } from '../data/metrics';
import type { NumericKey } from '../data/types';
import { addDays, linreg, pearson } from '../lib/stats';
import { fmtAxis } from '../components/charts';

export function Correlations() {
  const { ds, days } = useApp();
  const keys = useMemo(() => METRICS.map((m) => m.key).filter((k) => days.filter((d) => d[k] != null).length >= 10), [days]);
  const [x, setX] = useState<NumericKey>('steps');
  const [y, setY] = useState<NumericKey>('deepMin');
  const [lag, setLag] = useState(0);
  const xk = keys.includes(x) ? x : keys[0];
  const yk = keys.includes(y) ? y : keys[1] ?? keys[0];

  const matrix = useMemo(() => {
    const cols = keys.map((k) => days.map((d) => d[k] ?? null));
    const out: [number, number, number, number][] = [];
    for (let i = 0; i < keys.length; i++) for (let j = 0; j < keys.length; j++) {
      const p = i === j ? { r: 1, n: 0 } : pearson(cols[i], cols[j]);
      if (p) out.push([j, i, +p.r.toFixed(2), p.n]);
    }
    return out;
  }, [keys, days]);

  const top = useMemo(() => {
    const res: { a: NumericKey; b: NumericKey; lag: number; r: number; n: number; p: number }[] = [];
    const redundant = (a: string, b: string) => {
      const groups = [['steps', 'distanceKm', 'calories', 'lightMin', 'moderateMin', 'veryActiveMin', 'azm', 'sedentaryMin', 'avgHr', 'maxHr'], ['sleepMin', 'lightSleepMin', 'deepMin', 'remMin', 'wakeMin', 'sleepScore', 'sleepEfficiency', 'waketime', 'bedtime'], ['restingHr', 'avgHr', 'maxHr'], ['readiness', 'hrv', 'restingHr', 'sleepScore', 'stress']];
      return groups.some((g) => g.includes(a) && g.includes(b));
    };
    for (const lagN of [0, 1]) {
      for (const a of keys) for (const b of keys) {
        if (a === b || redundant(a, b) || (lagN === 0 && a > b)) continue;
        const p = pearson(days.map((d) => d[a] ?? null), days.map((d) => ds.days[addDays(d.date, lagN)]?.[b] ?? null));
        if (p && p.n >= 14 && p.p < 0.01) res.push({ a, b, lag: lagN, ...p });
      }
    }
    return res.sort((u, v) => Math.abs(v.r) - Math.abs(u.r)).slice(0, 12);
  }, [keys, days, ds]);

  const scatter = useMemo(() => {
    const pts: [number, number, string][] = [];
    for (const d of days) {
      const a = d[xk];
      const b = ds.days[addDays(d.date, lag)]?.[yk];
      if (a != null && b != null) pts.push([a, b, d.date]);
    }
    const lr = linreg(pts.map((p) => p[0]), pts.map((p) => p[1]));
    const pr = pearson(pts.map((p) => p[0]), pts.map((p) => p[1]));
    return { pts, lr, pr };
  }, [days, ds, xk, yk, lag]);

  if (keys.length < 2) return <Empty>Need at least two metrics with 10+ days of data.</Empty>;
  const xs = scatter.pts.map((p) => p[0]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  return (
    <div className="grid">
      <Card
        title="Relationship explorer"
        sub="Does one metric move with another? Shift the second metric by a day to look for next-day effects."
        span={2}
        actions={
          <div className="row">
            <MetricSelect value={xk} onChange={setX} keys={keys} />
            <span className="muted">vs</span>
            <MetricSelect value={yk} onChange={setY} keys={keys} />
            <Seg value={lag} onChange={setLag} options={[{ v: 0, l: 'same day' }, { v: 1, l: 'next day' }, { v: 2, l: '+2 days' }]} />
          </div>
        }
      >
        <div className="stats compact">
          <Stat label="Pearson r" value={scatter.pr ? scatter.pr.r.toFixed(2) : '–'} hint={scatter.pr ? strength(scatter.pr.r) : undefined} />
          <Stat label="p-value" value={scatter.pr ? (scatter.pr.p < 0.001 ? '< 0.001' : scatter.pr.p.toFixed(3)) : '–'} hint={scatter.pr ? (scatter.pr.p < 0.05 ? 'statistically significant' : 'could be chance') : undefined} />
          <Stat label="Slope" value={scatter.lr ? `${fmtMetric(yk, scatter.lr.slope * (META[xk].key === 'steps' ? 1000 : 1))}` : '–'} hint={scatter.lr ? `per ${META[xk].key === 'steps' ? '1,000 steps' : '1 ' + (META[xk].unit === 'clock' ? 'min' : META[xk].unit || 'unit')}` : undefined} />
          <Stat label="Days" value={scatter.pts.length} />
        </div>
        <Chart
          height={360}
          deps={[scatter]}
          option={(t) => ({
            tooltip: { trigger: 'item', formatter: (p: any) => (p.seriesType === 'scatter' ? `${p.value[2]}<br/>${META[xk].label}: <b>${fmtMetric(xk, p.value[0])}</b><br/>${lag ? `+${lag}d ` : ''}${META[yk].label}: <b>${fmtMetric(yk, p.value[1])}</b>` : 'Linear fit') },
            xAxis: { type: 'value', scale: true, name: META[xk].label, nameLocation: 'middle', nameGap: 28, axisLabel: { formatter: fmtAxis(xk) } },
            yAxis: { type: 'value', scale: true, name: (lag ? `+${lag}d ` : '') + META[yk].label, axisLabel: { formatter: fmtAxis(yk) } },
            grid: { left: 8, right: 16, top: 36, bottom: 28, containLabel: true },
            series: [
              { type: 'scatter', data: scatter.pts, symbolSize: 8, itemStyle: { color: t.series[0], opacity: 0.6, borderColor: t.surface, borderWidth: 1 } },
              ...(scatter.lr ? [{ type: 'line' as const, data: [[minX, scatter.lr.intercept + scatter.lr.slope * minX], [maxX, scatter.lr.intercept + scatter.lr.slope * maxX]], showSymbol: false, lineStyle: { color: t.series[1], width: 2 }, silent: true }] : []),
            ],
          })}
        />
      </Card>

      <Card title="Strongest relationships" sub="p < 0.01, excluding metrics that are mechanically linked">
        <ol className="rank">
          {top.map((c) => (
            <li key={`${c.a}${c.b}${c.lag}`} onClick={() => { setX(c.a); setY(c.b); setLag(c.lag); }}>
              <span className={`r ${c.r > 0 ? 'pos' : 'neg'}`}>{c.r > 0 ? '+' : ''}{c.r.toFixed(2)}</span>
              <span>{META[c.a].label} → {c.lag ? 'next-day ' : ''}{lowerLabel(META[c.b].label)}</span>
            </li>
          ))}
          {!top.length && <li className="muted">No strong relationships found in this range.</li>}
        </ol>
        <p className="muted small">Correlation is not causation — use these as hypotheses to test, e.g. with the Compare view.</p>
      </Card>

      <Card title="Correlation matrix" sub="Pearson r between every pair of daily metrics (blue = move together, red = move opposite). Click a cell to explore it." span={3}>
        <Chart
          height={Math.max(420, keys.length * 26 + 140)}
          deps={[matrix]}
          onClick={(p) => { if (p?.value) { setX(keys[p.value[0]]); setY(keys[p.value[1]]); setLag(0); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}
          option={(t) => ({
            tooltip: { formatter: (p: any) => `${META[keys[p.value[1]]].label} × ${META[keys[p.value[0]]].label}<br/>r = <b>${p.value[2]}</b>${p.value[3] ? ` (n=${p.value[3]})` : ''}` },
            grid: { left: 8, right: 8, top: 8, bottom: 60, containLabel: true },
            xAxis: { type: 'category', data: keys.map((k) => META[k].label), axisLabel: { rotate: 45, fontSize: 10 }, splitLine: { show: false } },
            yAxis: { type: 'category', data: keys.map((k) => META[k].label), inverse: true, axisLabel: { fontSize: 10 }, splitLine: { show: false } },
            visualMap: { dimension: 2, min: -1, max: 1, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 200, itemWidth: 10, inRange: { color: [t.diverging[2], t.diverging[1], t.diverging[0]] }, textStyle: { color: t.muted } },
            series: [{ type: 'heatmap', data: matrix, itemStyle: { borderColor: t.surface, borderWidth: 1 }, label: { show: keys.length <= 16, fontSize: 9, color: t.ink, formatter: (p: any) => (Math.abs(p.value[2]) >= 0.3 && p.value[0] !== p.value[1] ? p.value[2].toFixed(1) : '') } }],
          })}
        />
      </Card>
    </div>
  );
}

function strength(r: number) {
  const a = Math.abs(r);
  return a < 0.1 ? 'none' : a < 0.3 ? 'weak' : a < 0.5 ? 'moderate' : 'strong';
}
