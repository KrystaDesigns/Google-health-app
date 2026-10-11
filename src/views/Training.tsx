import { useMemo } from 'react';
import { useApp } from '../state';
import { Card, Empty, Stat } from '../components/ui';
import { Chart } from '../components/Chart';
import { recommend } from '../lib/training';
import { mean, sum } from '../lib/stats';

const CALL = {
  push: { label: 'Good day to push', icon: '▲', cls: 'tone-good', text: 'Recovery signals are strong. A harder session or longer effort should be well tolerated.' },
  maintain: { label: 'Train normally', icon: '■', cls: 'tone-info', text: 'Signals are within your usual range. Stick to your plan; keep intensity moderate if you feel off.' },
  recover: { label: 'Prioritise recovery', icon: '▼', cls: 'tone-serious', text: 'Several signals point to accumulated strain. Choose rest, mobility or easy movement and protect your sleep tonight.' },
} as const;

export function Training() {
  const { ds, load, range } = useApp();
  const rec = useMemo(() => recommend(ds, load), [ds, load]);
  const pts = useMemo(() => load.filter((p) => p.date >= range.from && p.date <= range.to), [load, range]);
  if (!pts.some((p) => p.load != null)) return <Empty>No heart-rate or workout data to compute training load in this range.</Empty>;
  const last = pts[pts.length - 1];
  const week = pts.slice(-7);
  const prevWeek = pts.slice(-14, -7);
  const zoneACWR = (a: number | null) => (a == null ? '–' : a < 0.8 ? 'Detraining' : a <= 1.3 ? 'Sweet spot' : a <= 1.5 ? 'Caution' : 'High risk');

  return (
    <div className="grid">
      {rec && (
        <Card title={`Today's call · ${rec.date}`} span={3}>
          <div className={`call ${CALL[rec.call].cls}`}>
            <div className="call-head"><span className="ico" aria-hidden>{CALL[rec.call].icon}</span><b>{CALL[rec.call].label}</b><span className="muted small">score {rec.score > 0 ? '+' : ''}{rec.score}</span></div>
            <p>{CALL[rec.call].text}</p>
            <ul className="reasons">
              {rec.reasons.map((r) => <li key={r.text} className={r.good ? 'good' : 'bad'}><span aria-hidden>{r.good ? '✓' : '!'}</span> {r.text}</li>)}
            </ul>
          </div>
        </Card>
      )}

      <div className="stats span-3">
        <Stat label="Load this week" value={Math.round(sum(week.map((p) => p.load)))} hint={`last week ${Math.round(sum(prevWeek.map((p) => p.load)))}`} />
        <Stat label="Fitness (CTL)" value={last.ctl.toFixed(0)} hint="42-day weighted load" />
        <Stat label="Fatigue (ATL)" value={last.atl.toFixed(0)} hint="7-day weighted load" />
        <Stat label="Form (TSB)" value={(last.tsb > 0 ? '+' : '') + last.tsb.toFixed(0)} hint={last.tsb > 5 ? 'fresh' : last.tsb < -20 ? 'heavily fatigued' : last.tsb < -5 ? 'building' : 'neutral'} />
        <Stat label="Acute : chronic" value={last.acwr?.toFixed(2) ?? '–'} hint={zoneACWR(last.acwr)} />
        <Stat label="Avg daily load" value={Math.round(mean(pts.map((p) => p.load)) ?? 0)} />
      </div>

      <Card title="Daily training load" sub="TRIMP from your 5-minute heart rate: minutes above 30% of heart-rate reserve, weighted by intensity" span={3}>
        <Chart
          height={280}
          deps={[pts]}
          option={(t) => ({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            dataZoom: [{ type: 'inside' }],
            xAxis: { type: 'category', data: pts.map((p) => p.date) },
            yAxis: { type: 'value', name: 'TRIMP' },
            series: [{ name: 'Load', type: 'bar', data: pts.map((p) => p.load), itemStyle: { color: t.series[0], borderRadius: [3, 3, 0, 0] } }],
          })}
        />
      </Card>

      <Card title="Fitness vs fatigue" sub="Fitness (CTL) builds slowly; fatigue (ATL) reacts fast. When fatigue sits far above fitness, recovery lags." span={2}>
        <Chart
          height={300}
          deps={[pts]}
          option={(t) => ({
            legend: {},
            tooltip: { trigger: 'axis' },
            dataZoom: [{ type: 'inside' }],
            xAxis: { type: 'category', data: pts.map((p) => p.date), boundaryGap: false },
            yAxis: { type: 'value' },
            series: [
              { name: 'Fitness (CTL)', type: 'line', data: pts.map((p) => p.ctl), showSymbol: false, lineStyle: { width: 2, color: t.series[0] }, itemStyle: { color: t.series[0] }, areaStyle: { color: t.series[0], opacity: 0.08 } },
              { name: 'Fatigue (ATL)', type: 'line', data: pts.map((p) => p.atl), showSymbol: false, lineStyle: { width: 2, color: t.series[1] }, itemStyle: { color: t.series[1] } },
            ],
          })}
        />
      </Card>

      <Card title="Form (TSB)" sub="Fitness minus fatigue. Below −20 = deep fatigue; above +5 = fresh">
        <Chart
          height={300}
          deps={[pts]}
          option={(t) => ({
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: pts.map((p) => p.date), boundaryGap: false },
            yAxis: { type: 'value' },
            series: [{
              name: 'Form', type: 'bar', data: pts.map((p) => ({ value: p.tsb, itemStyle: { color: p.tsb < 0 ? t.diverging[2] : t.diverging[0] } })), barCategoryGap: '10%',
              markLine: { symbol: 'none', silent: true, lineStyle: { color: t.muted, type: 'dashed' }, label: { color: t.muted, position: 'insideEndTop' }, data: [{ yAxis: -20, label: { formatter: 'fatigued' } }, { yAxis: 5, label: { formatter: 'fresh' } }] },
            }],
          })}
        />
      </Card>

      <Card title="Acute : chronic workload ratio" sub="7-day vs 28-day average load. 0.8–1.3 is the 'sweet spot'; above 1.5 you're ramping up faster than your body has adapted to." span={3}>
        <Chart
          height={260}
          deps={[pts]}
          option={(t) => ({
            tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '–' : `${v} · ${zoneACWR(v)}`) },
            xAxis: { type: 'category', data: pts.map((p) => p.date), boundaryGap: false },
            yAxis: { type: 'value', min: 0, max: (v: any) => Math.max(2, Math.ceil(v.max * 10) / 10) },
            series: [{
              name: 'ACWR', type: 'line', data: pts.map((p) => p.acwr), showSymbol: false, lineStyle: { width: 2, color: t.ink2 }, itemStyle: { color: t.ink2 },
              markArea: { silent: true, data: [
                [{ yAxis: 0.8, itemStyle: { color: t.good, opacity: 0.1 }, label: { show: true, position: 'insideLeft', formatter: 'sweet spot', color: t.muted, fontSize: 10 } }, { yAxis: 1.3 }],
                [{ yAxis: 1.5, itemStyle: { color: t.critical, opacity: 0.08 }, label: { show: true, position: 'insideLeft', formatter: 'high risk', color: t.muted, fontSize: 10 } }, { yAxis: 'max' }],
              ] },
            }],
          })}
        />
      </Card>
    </div>
  );
}
