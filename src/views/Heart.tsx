import { useMemo, useState } from 'react';
import { useApp, col } from '../state';
import { Card, Empty, Stat } from '../components/ui';
import { Chart } from '../components/Chart';
import { trendOption } from '../components/charts';
import { clean, mean, quantile } from '../lib/stats';
import { strainFlags } from '../lib/insights';
import { fmtMetric } from '../data/metrics';

const slotLabel = (k: number) => `${String(Math.floor(k / 12)).padStart(2, '0')}:${String((k % 12) * 5).padStart(2, '0')}`;

export function Heart() {
  const { ds, days, settings } = useApp();
  const maxHr = 220 - settings.age;
  const zones = [
    { name: 'Below zones', lo: 0, hi: Math.round(maxHr * 0.5) },
    { name: 'Fat burn', lo: Math.round(maxHr * 0.5), hi: Math.round(maxHr * 0.7) },
    { name: 'Cardio', lo: Math.round(maxHr * 0.7), hi: Math.round(maxHr * 0.85) },
    { name: 'Peak', lo: Math.round(maxHr * 0.85), hi: 250 },
  ];
  const hrDays = days.filter((d) => ds.intraday[d.date]?.hr5);
  const [sel, setSel] = useState<string>('');
  const selDate = sel && ds.intraday[sel]?.hr5 ? sel : hrDays[hrDays.length - 1]?.date;
  const flags = useMemo(() => strainFlags(ds, days.map((d) => d.date)), [ds, days]);

  const fingerprint = useMemo(() => {
    const data: [number, number, number][] = [];
    hrDays.forEach((d, i) => {
      const h = ds.intraday[d.date].hr5!;
      for (let b = 0; b < 48; b++) {
        const v = mean(h.slice(b * 6, b * 6 + 6));
        if (v != null) data.push([b, i, Math.round(v)]);
      }
    });
    return data;
  }, [ds, hrDays]);

  const byHour = useMemo(() => {
    const buckets = Array.from({ length: 24 }, () => [] as number[]);
    for (const d of hrDays) ds.intraday[d.date].hr5!.forEach((v, k) => v != null && buckets[Math.floor(k / 12)].push(v));
    return buckets.map((b) => [quantile(b, 0.25), quantile(b, 0.5), quantile(b, 0.75)]);
  }, [ds, hrDays]);

  const zoneMinutes = useMemo(() => {
    const m = zones.map(() => 0);
    for (const d of hrDays) for (const v of ds.intraday[d.date].hr5!) if (v != null) m[zones.findIndex((z) => v >= z.lo && v < z.hi)] += 5;
    return m;
  }, [ds, hrDays, maxHr]);

  const rhr = clean(col(days, 'restingHr'));
  if (!rhr.length && !hrDays.length) return <Empty>No heart-rate data in this range.</Empty>;

  return (
    <div className="grid">
      <div className="stats span-3">
        <Stat label="Avg resting HR" value={fmtMetric('restingHr', mean(rhr))} />
        <Stat label="Lowest resting HR" value={fmtMetric('restingHr', rhr.length ? Math.min(...rhr) : null)} />
        <Stat label="Avg HRV" value={fmtMetric('hrv', mean(col(days, 'hrv')))} />
        <Stat label="Max HR recorded" value={fmtMetric('maxHr', Math.max(0, ...clean(col(days, 'maxHr'))) || null)} hint={`Est. max ${maxHr} bpm (age ${settings.age})`} />
        <Stat label="Strain-flag days" value={flags.length} hint="RHR↑ HRV↓ temp↑ vs 30-day baseline" />
      </div>

      <Card title="Resting heart rate" sub="Red lines mark days with multi-signal strain flags" span={3}>
        <Chart height={300} deps={[days, flags]} option={(t) => trendOption(t, days, 'restingHr', { band: true, markDates: flags.map((f) => f.date) })} />
      </Card>

      {hrDays.length > 0 && (
        <>
          <Card title="Heart-rate fingerprint" sub="Every row is a day, every cell 30 minutes. Sleep, commutes and workouts appear as bands. Click a row to inspect that day." span={2}>
            <Chart
              height={Math.min(560, Math.max(260, hrDays.length * 2 + 80))}
              deps={[fingerprint]}
              onClick={(p) => p?.value && setSel(hrDays[p.value[1]].date)}
              option={(t) => ({
                tooltip: { formatter: (p: any) => `${hrDays[p.value[1]].date} ${slotLabel(p.value[0] * 6)}<br/><b>${p.value[2]} bpm</b>` },
                grid: { left: 8, right: 8, top: 8, bottom: 56, containLabel: true },
                xAxis: { type: 'category', data: Array.from({ length: 48 }, (_, b) => slotLabel(b * 6)), axisLabel: { interval: 5 } },
                yAxis: { type: 'category', data: hrDays.map((d) => d.date), inverse: true, axisLabel: { interval: Math.ceil(hrDays.length / 12) } },
                visualMap: { min: 45, max: 140, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 10, inRange: { color: t.seq }, textStyle: { color: t.muted } },
                series: [{ type: 'heatmap', data: fingerprint, progressive: 5000 }],
              })}
            />
          </Card>

          <Card title="Time in heart-rate zones" sub={`Based on estimated max HR ${maxHr} bpm`}>
            <Chart
              height={300}
              deps={[zoneMinutes]}
              option={(t) => ({
                tooltip: { trigger: 'item', formatter: (p: any) => `${p.name} (${zones[p.dataIndex].lo}–${zones[p.dataIndex].hi === 250 ? '' : zones[p.dataIndex].hi} bpm)<br/><b>${Math.round(p.value / 60)} h</b> · ${p.percent}%` },
                legend: { bottom: 0, top: 'auto' },
                series: [{ type: 'pie', radius: ['48%', '72%'], top: -20, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 }, label: { show: false }, data: zones.map((z, i) => ({ name: z.name, value: zoneMinutes[i], itemStyle: { color: [t.seq[t.dark ? 3 : 1], t.series[3], t.series[1], t.critical][i] } })) }],
              })}
            />
          </Card>

          <Card
            title={`Intraday heart rate · ${selDate}`}
            sub="5-minute averages with zone bands"
            span={2}
            actions={
              <select value={selDate} onChange={(e) => setSel(e.target.value)}>
                {[...hrDays].reverse().map((d) => <option key={d.date}>{d.date}</option>)}
              </select>
            }
          >
            <Chart
              height={300}
              deps={[selDate, maxHr]}
              option={(t) => ({
                tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '–' : `${v} bpm`) },
                dataZoom: [{ type: 'inside' }],
                xAxis: { type: 'category', data: Array.from({ length: 288 }, (_, k) => slotLabel(k)), boundaryGap: false, axisLabel: { interval: 35 } },
                yAxis: { type: 'value', min: 40, name: 'bpm' },
                series: [{
                  name: 'Heart rate', type: 'line', showSymbol: false, data: ds.intraday[selDate!]?.hr5 ?? [], lineStyle: { width: 1.5, color: t.critical }, itemStyle: { color: t.critical },
                  markArea: { silent: true, data: zones.slice(1).map((z, i) => [{ yAxis: z.lo, itemStyle: { color: [t.series[3], t.series[1], t.critical][i], opacity: 0.07 }, label: { show: true, position: 'insideRight', color: t.muted, formatter: z.name, fontSize: 10 } }, { yAxis: Math.min(z.hi, 220) }]) },
                }],
              })}
            />
            {ds.intraday[selDate!]?.stepsHourly && (
              <Chart
                height={110}
                deps={[selDate]}
                option={(t) => ({
                  grid: { left: 8, right: 16, top: 20, bottom: 4, containLabel: true },
                  tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${v} steps` },
                  xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h}:00`) },
                  yAxis: { type: 'value', splitNumber: 2 },
                  series: [{ name: 'Steps', type: 'bar', data: ds.intraday[selDate!].stepsHourly, itemStyle: { color: t.series[0], borderRadius: [3, 3, 0, 0] } }],
                })}
              />
            )}
          </Card>

          <Card title="Daily heart-rate rhythm" sub="Median by hour with interquartile band">
            <Chart
              height={300}
              deps={[byHour]}
              option={(t) => ({
                tooltip: { trigger: 'axis', formatter: (ps: any) => `${ps[0].axisValue}:00<br/>median <b>${Math.round(byHour[ps[0].dataIndex][1] ?? 0)} bpm</b><br/>IQR ${Math.round(byHour[ps[0].dataIndex][0] ?? 0)}–${Math.round(byHour[ps[0].dataIndex][2] ?? 0)}` },
                xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => h), boundaryGap: false },
                yAxis: { type: 'value', scale: true, name: 'bpm' },
                series: [
                  { type: 'line', stack: 'iqr', data: byHour.map((b) => b[0]), symbol: 'none', lineStyle: { opacity: 0 } },
                  { type: 'line', stack: 'iqr', data: byHour.map((b) => (b[2] ?? 0) - (b[0] ?? 0)), symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: t.critical, opacity: 0.12 } },
                  { type: 'line', data: byHour.map((b) => b[1]), symbol: 'none', smooth: 0.3, lineStyle: { width: 2, color: t.critical } },
                ],
              })}
            />
          </Card>
        </>
      )}

      {days.some((d) => d.vo2max != null) && (
        <Card title="Cardio fitness (VO₂ max)" sub="ml of oxygen per kg per minute. Each +1 is roughly a meaningful fitness gain; it moves slowly with consistent aerobic training." span={3}>
          <Chart height={240} deps={[days]} option={(t) => trendOption(t, days, 'vo2max')} />
        </Card>
      )}

      <Card title="Heart-rate variability" sub="Nightly RMSSD — higher generally means better recovery" span={3}>
        <Chart height={280} deps={[days]} option={(t) => trendOption(t, days, 'hrv', { band: true })} />
      </Card>
    </div>
  );
}
