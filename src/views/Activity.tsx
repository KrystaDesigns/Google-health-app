import { useMemo, useState } from 'react';
import { useApp, col } from '../state';
import { Card, Seg, Stat, Empty, MetricSelect } from '../components/ui';
import type { NumericKey } from '../data/types';
import { Chart } from '../components/Chart';
import { histogramOption, trendOption, weekdayBoxOption } from '../components/charts';
import { clean, mean, sum, weekday, WEEKDAYS } from '../lib/stats';
import { fmtMetric } from '../data/metrics';

export function Activity() {
  const { ds, days } = useApp();
  const [goal, setGoal] = useState(10000);
  const extraKeys = (['floors', 'sedentaryHours', 'zoneModerateMin', 'zoneVigorousMin', 'zonePeakMin', 'distanceKm', 'calories'] as NumericKey[]).filter((k) => days.some((d) => d[k] != null));
  const [extra, setExtra] = useState<NumericKey>('floors');
  const extraKey = extraKeys.includes(extra) ? extra : extraKeys[0];
  const steps = clean(col(days, 'steps'));

  const hourGrid = useMemo(() => {
    const s = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const n = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let any = false;
    for (const d of days) {
      const h = ds.intraday[d.date]?.stepsHourly;
      if (!h) continue;
      any = true;
      const wd = weekday(d.date);
      h.forEach((v, i) => {
        s[wd][i] += v;
        n[wd][i]++;
      });
    }
    if (!any) return null;
    const data: [number, number, number][] = [];
    for (let w = 0; w < 7; w++) for (let h = 0; h < 24; h++) data.push([h, w, n[w][h] ? Math.round(s[w][h] / n[w][h]) : 0]);
    return data;
  }, [ds, days]);

  const weekly = useMemo(() => {
    const map = new Map<string, { light: number[]; mod: number[]; very: number[]; sed: number[] }>();
    for (const d of days) {
      const wd = weekday(d.date);
      const monday = new Date(Date.parse(d.date + 'T12:00:00Z') - wd * 864e5).toISOString().slice(0, 10);
      const w = map.get(monday) ?? { light: [], mod: [], very: [], sed: [] };
      if (d.lightMin != null) w.light.push(d.lightMin);
      if (d.moderateMin != null) w.mod.push(d.moderateMin);
      if (d.veryActiveMin != null) w.very.push(d.veryActiveMin);
      if (d.sedentaryMin != null) w.sed.push(d.sedentaryMin);
      map.set(monday, w);
    }
    return [...map.entries()];
  }, [days]);

  if (!steps.length) return <Empty>No activity data in this range.</Empty>;
  const byWd = Array.from({ length: 7 }, () => [] as number[]);
  days.forEach((d) => d.steps != null && byWd[weekday(d.date)].push(d.steps));
  const best = days.reduce((a, d) => ((d.steps ?? 0) > (a.steps ?? 0) ? d : a), days[0]);
  const hit = steps.filter((s) => s >= goal).length;

  return (
    <div className="grid">
      <div className="stats span-3">
        <Stat label="Total steps" value={sum(steps).toLocaleString()} hint={`${steps.length} tracked days`} />
        <Stat label="Daily average" value={fmtMetric('steps', mean(steps))} />
        <Stat label="Distance" value={`${sum(col(days, 'distanceKm')).toFixed(1)} km`} />
        <Stat label="Goal reached" value={`${Math.round((hit / steps.length) * 100)}%`} hint={`${hit} days ≥ ${goal.toLocaleString()}`} />
        <Stat label="Best day" value={fmtMetric('steps', best.steps)} hint={best.date} />
        <Stat label="Avg Active Zone Min" value={fmtMetric('azm', mean(col(days, 'azm')))} hint={`${Math.round(sum(col(days, 'azm')))} total`} />
      </div>

      <Card title="Daily steps" span={3} actions={<Seg value={goal} onChange={setGoal} options={[6000, 8000, 10000, 12000].map((v) => ({ v, l: `${v / 1000}k goal` }))} />}>
        <Chart height={320} deps={[days, goal]} option={(t) => trendOption(t, days, 'steps', { bars: true, goal })} />
      </Card>

      <Card title="When you move" sub="Average steps by hour of day × weekday" span={2}>
        {hourGrid ? (
          <Chart
            height={300}
            deps={[hourGrid]}
            option={(t) => ({
              tooltip: { formatter: (p: any) => `${WEEKDAYS[p.value[1]]} ${String(p.value[0]).padStart(2, '0')}:00–${String(p.value[0] + 1).padStart(2, '0')}:00<br/><b>${p.value[2].toLocaleString()} steps</b> avg` },
              grid: { left: 8, right: 8, top: 8, bottom: 56, containLabel: true },
              xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h}`), splitArea: { show: false } },
              yAxis: { type: 'category', data: WEEKDAYS, inverse: true },
              visualMap: { min: 0, max: Math.max(...hourGrid.map((d) => d[2])), orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 10, inRange: { color: t.seq }, textStyle: { color: t.muted } },
              series: [{ type: 'heatmap', data: hourGrid, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 } }],
            })}
          />
        ) : (
          <Empty>Hourly data appears when you import minute-level steps from a Takeout export.</Empty>
        )}
      </Card>

      <Card title="Weekday pattern" sub="Steps distribution (p5–p95 whiskers)">
        <Chart height={300} deps={[days]} option={(t) => weekdayBoxOption(t, byWd, 'steps')} />
      </Card>

      <Card title="Activity intensity per week" sub="Average minutes per day" span={2}>
        <Chart
          height={300}
          deps={[weekly]}
          option={(t) => ({
            legend: {},
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: { type: 'category', data: weekly.map(([w]) => w) },
            yAxis: { type: 'value' },
            series: [
              { name: 'Lightly active', key: 'light', c: t.seq[t.dark ? 5 : 2] },
              { name: 'Fairly active', key: 'mod', c: t.series[0] },
              { name: 'Very active', key: 'very', c: t.series[1] },
            ].map((s, i, a) => ({
              name: s.name,
              type: 'bar',
              stack: 'a',
              data: weekly.map(([, w]) => Math.round(mean((w as any)[s.key]) ?? 0)),
              itemStyle: { color: s.c, borderColor: t.surface, borderWidth: 1, borderRadius: i === a.length - 1 ? [3, 3, 0, 0] : 0 },
            })),
          })}
        />
      </Card>

      {extraKey && (
        <Card title="More activity metrics" sub="Floors, time sitting, time in heart-rate zones and more" span={3} actions={<MetricSelect value={extraKey} onChange={setExtra} keys={extraKeys} />}>
          <Chart height={260} deps={[days, extraKey]} option={(t) => trendOption(t, days, extraKey, { bars: true })} />
        </Card>
      )}

      <Card title="Steps distribution">
        <Chart height={300} deps={[steps]} option={(t) => histogramOption(t, steps, 'steps')} />
      </Card>
    </div>
  );
}
