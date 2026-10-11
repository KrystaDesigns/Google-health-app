import { useMemo } from 'react';
import { useApp } from '../state';
import { Card, Stat } from '../components/ui';
import { Chart } from '../components/Chart';
import { addDays, daysBetween, mean, median } from '../lib/stats';
import type { NumericKey } from '../data/types';
import { META, fmtMetric } from '../data/metrics';

const METRICS: NumericKey[] = ['skinTempDelta', 'restingHr', 'hrv'];

/** Cycle-aware view of recovery signals; renders nothing without menstrual-period data. */
export function CycleCard() {
  const { ds, today } = useApp();
  const data = useMemo(() => {
    const dates = Object.keys(ds.days).sort();
    const starts = dates.filter((d) => ds.days[d].period && !ds.days[addDays(d, -1)]?.period);
    if (!starts.length) return null;
    const lengths = starts.slice(1).map((s, i) => daysBetween(starts[i], s)).filter((n) => n >= 18 && n <= 45);
    const typical = median(lengths) ?? 28;
    const cycleDay = (d: string) => {
      const s = [...starts].reverse().find((x) => x <= d);
      return s ? daysBetween(s, d) + 1 : null;
    };
    const byDay = METRICS.map((k) => {
      const buckets = Array.from({ length: 35 }, () => [] as number[]);
      for (const d of dates) {
        const cd = cycleDay(d);
        const v = ds.days[d][k];
        if (cd && cd <= 35 && v != null) buckets[cd - 1].push(v);
      }
      return { k, avg: buckets.map((b) => (b.length >= 2 ? +mean(b)!.toFixed(2) : null)) };
    });
    const last = starts[starts.length - 1];
    return { starts, typical, current: cycleDay(today), last, next: addDays(last, Math.round(typical)), byDay, n: lengths.length };
  }, [ds, today]);

  if (!data) return null;
  return (
    <Card title="Cycle-aware recovery" sub="Average skin temperature, resting HR and HRV by day of your menstrual cycle. A temperature rise mid-cycle typically marks ovulation; RHR often rises and HRV dips in the luteal phase." span={3}>
      <div className="stats compact">
        <Stat label="Cycle day today" value={data.current ?? '–'} hint={`started ${data.last}`} />
        <Stat label="Typical cycle" value={`${Math.round(data.typical)} days`} hint={`${data.n} complete cycles`} />
        <Stat label="Next period (est.)" value={data.next} hint="from your median cycle length" />
      </div>
      <div className="mini-grid">
        {data.byDay.map(({ k, avg }) => (
          <div key={k}>
            <div className="small" style={{ fontWeight: 600 }}>{META[k].label}</div>
            <Chart
              height={160}
              deps={[avg]}
              option={(t) => ({
                grid: { left: 4, right: 8, top: 10, bottom: 4, containLabel: true },
                tooltip: { trigger: 'axis', formatter: (ps: any) => `Cycle day ${ps[0].axisValue}<br/><b>${fmtMetric(k, ps[0].value)}</b>` },
                xAxis: { type: 'category', data: avg.map((_, i) => i + 1), axisLabel: { interval: 6 }, boundaryGap: false },
                yAxis: { type: 'value', scale: true, splitNumber: 3 },
                series: [{
                  type: 'line', data: avg, showSymbol: false, connectNulls: true, smooth: 0.3, lineStyle: { width: 2, color: t.series[4] }, itemStyle: { color: t.series[4] },
                  markLine: data.current && data.current <= 35 ? { symbol: 'none', silent: true, lineStyle: { color: t.muted, type: 'dashed' }, label: { formatter: 'today', color: t.muted, fontSize: 10 }, data: [{ xAxis: String(data.current) }] } : undefined,
                }],
              })}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
