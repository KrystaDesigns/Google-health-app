import { useApp } from '../state';
import { Card, Empty } from '../components/ui';
import { Chart } from '../components/Chart';
import { trendOption } from '../components/charts';
import type { NumericKey } from '../data/types';
import { META, fmtMetric } from '../data/metrics';
import { CycleCard } from './Cycle';

const KEYS: [NumericKey, string][] = [
  ['readiness', 'Daily readiness — how prepared your body is for strain'],
  ['hrv', 'Nightly heart-rate variability (RMSSD)'],
  ['skinTempDelta', 'Nightly skin temperature vs your 30-night median — sustained rises can signal illness or cycle phase'],
  ['spo2', 'Average overnight blood-oxygen saturation'],
  ['breathingRate', 'Average breaths per minute during sleep'],
  ['hrvDeep', 'HRV measured during deep sleep — the cleanest nightly recovery signal'],
  ['vo2max', 'Cardio fitness score (estimated VO₂ max). Rises with consistent aerobic training'],
  ['outOfBedMin', 'Time spent out of bed during the night'],
  ['weightKg', 'Body weight'],
  ['bodyFat', 'Body-fat percentage from a connected scale'],
  ['hydrationMl', 'Water logged per day'],
  ['caloriesIn', 'Food energy logged per day'],
  ['stress', 'Stress management score — higher means fewer physiological stress signs'],
];

export function Recovery() {
  const { days } = useApp();
  const present = KEYS.filter(([k]) => days.some((d) => d[k] != null));
  const cycle = <CycleCard />;
  if (!present.length) return <Empty>No recovery metrics (HRV, SpO₂, temperature, readiness…) in this range.</Empty>;
  return (
    <div className="grid">
      {cycle}
      {present.map(([k, sub], i) => (
        <Card key={k} title={META[k].label} sub={sub} span={i === 0 ? 3 : 1 as any}>
          <Chart height={i === 0 ? 280 : 240} deps={[days]} option={(t) => {
            const o = trendOption(t, days, k, { band: k !== 'skinTempDelta' });
            if (k === 'skinTempDelta') {
              (o.series as any[])[0] = { name: META[k].label, type: 'bar', data: days.map((d) => d[k] ?? null), itemStyle: { color: (p: any) => (p.value > 0 ? t.diverging[2] : t.diverging[0]), borderRadius: 2 } };
              (o as any).tooltip.formatter = (ps: any) => `${ps[0].axisValue}<br/>${ps.map((p: any) => `${p.marker} ${p.seriesName}: <b>${fmtMetric(k, p.value)}</b>`).join('<br/>')}`;
              (o.yAxis as any).scale = false;
            }
            if (i > 0) (o as any).legend = { show: false };
            return o;
          }} />
        </Card>
      ))}
    </div>
  );
}
