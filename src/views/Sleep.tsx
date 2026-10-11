import { useMemo, useState } from 'react';
import { useApp, col } from '../state';
import { Card, Empty, Seg, Stat } from '../components/ui';
import { Chart } from '../components/Chart';
import { trendOption, weekdayBoxOption } from '../components/charts';
import { clean, mean, median, sd, weekday } from '../lib/stats';
import { fmtClock, fmtDuration, fmtMetric } from '../data/metrics';
import type { SleepLevel } from '../data/types';
import { bedtimeBins, chronotype } from '../lib/chronotype';

const ORIGIN = 360; // chart minutes are measured from 18:00 the previous evening
const STAGE_Y: Record<string, number> = { wake: 3, awake: 3, restless: 3, rem: 2, light: 1, asleep: 1, deep: 0 };

export function Sleep() {
  const { ds, days } = useApp();
  const [target, setTarget] = useState(450);
  const nights = days.filter((d) => d.sleepMin != null);
  const sessions = useMemo(() => {
    const set = new Set(days.map((d) => d.date));
    return ds.sleep.filter((s) => s.main && set.has(s.date) && s.levels?.length);
  }, [ds, days]);
  const [sel, setSel] = useState('');
  const night = sessions.find((s) => s.date === sel) ?? sessions[sessions.length - 1];

  const chrono = useMemo(() => chronotype(days), [days]);
  const bins = useMemo(() => bedtimeBins(days), [days]);
  if (!nights.length) return <Empty>No sleep data in this range.</Empty>;

  const beds = clean(col(days, 'bedtime'));
  const wakes = clean(col(days, 'waketime'));
  const mid = (d: (typeof days)[number]) => (d.bedtime != null && d.waketime != null ? (d.bedtime + d.waketime) / 2 : null);
  const jet = (median(nights.filter((d) => weekday(d.date) >= 5).map(mid)) ?? 0) - (median(nights.filter((d) => weekday(d.date) < 5).map(mid)) ?? 0);
  let debt = 0;
  const debtSeries = days.map((d) => {
    if (d.sleepMin != null) debt += (target - d.sleepMin) / 60;
    return +debt.toFixed(2);
  });
  const stageTotals = ['deepMin', 'lightSleepMin', 'remMin', 'wakeMin'].map((k) => mean(col(days, k as any)) ?? 0);
  const byWd = Array.from({ length: 7 }, () => [] as number[]);
  nights.forEach((d) => byWd[weekday(d.date)].push(d.sleepMin!));

  return (
    <div className="grid">
      <div className="stats span-3">
        <Stat label="Avg sleep" value={fmtDuration(mean(col(days, 'sleepMin'))!)} hint={`${nights.length} nights`} />
        <Stat label="Efficiency" value={fmtMetric('sleepEfficiency', mean(col(days, 'sleepEfficiency')))} />
        <Stat label="Median bedtime" value={beds.length ? fmtClock(median(beds)!) : '–'} hint={beds.length > 2 ? `±${Math.round(sd(beds)!)} min` : undefined} />
        <Stat label="Median wake" value={wakes.length ? fmtClock(median(wakes)!) : '–'} hint={wakes.length > 2 ? `±${Math.round(sd(wakes)!)} min` : undefined} />
        <Stat label="Social jetlag" value={`${Math.round(Math.abs(jet))} min`} hint={jet >= 0 ? 'weekend midpoint later' : 'weekend midpoint earlier'} />
        <Stat label="Avg sleep score" value={fmtMetric('sleepScore', mean(col(days, 'sleepScore')))} />
      </div>

      <Card title="Sleep schedule" sub="Each bar runs from bedtime to wake-up; consistent bars = regular rhythm" span={3}>
        <Chart
          height={320}
          deps={[days]}
          option={(t) => ({
            tooltip: {
              trigger: 'axis',
              axisPointer: { type: 'shadow' },
              formatter: (ps: any) => {
                const d = days[ps[0].dataIndex];
                return d.bedtime == null ? `${d.date}<br/>no sleep logged` : `<b>${d.date}</b><br/>${fmtClock(d.bedtime)} → ${fmtClock(d.waketime!)}<br/>asleep ${fmtDuration(d.sleepMin!)} · in bed ${fmtDuration(d.timeInBedMin ?? 0)}`;
              },
            },
            dataZoom: [{ type: 'inside' }],
            xAxis: { type: 'category', data: days.map((d) => d.date) },
            yAxis: { type: 'value', inverse: true, min: (v: any) => Math.floor((v.min - 30) / 60) * 60, max: (v: any) => Math.ceil((v.max + 30) / 60) * 60, interval: 120, axisLabel: { formatter: (v: number) => fmtClock(v - ORIGIN) } },
            series: [
              { type: 'bar', stack: 's', data: days.map((d) => (d.bedtime != null ? d.bedtime + ORIGIN : null)), itemStyle: { color: 'transparent' }, emphasis: { disabled: true } },
              { type: 'bar', stack: 's', data: days.map((d) => (d.bedtime != null && d.waketime != null ? d.waketime - d.bedtime : null)), itemStyle: { color: t.series[6], borderRadius: 3 } },
            ],
          })}
        />
      </Card>

      <Card title="Sleep stages per night" span={2}>
        <Chart
          height={300}
          deps={[days]}
          option={(t) => ({
            legend: {},
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => (v == null ? '–' : fmtDuration(v)) },
            dataZoom: [{ type: 'inside' }],
            xAxis: { type: 'category', data: days.map((d) => d.date) },
            yAxis: { type: 'value', max: (v: any) => Math.ceil(v.max / 120) * 120, axisLabel: { formatter: (v: number) => `${v / 60}h` }, interval: 120 },
            series: ([['Deep', 'deepMin', t.stage.deep], ['Light', 'lightSleepMin', t.stage.light], ['REM', 'remMin', t.stage.rem], ['Awake', 'wakeMin', t.stage.wake]] as const).map(([name, k, c], i) => ({
              name, type: 'bar', stack: 'st', data: col(days, k), itemStyle: { color: c, borderColor: t.surface, borderWidth: 0.5, borderRadius: i === 3 ? [2, 2, 0, 0] : 0 }, barCategoryGap: '15%',
            })),
          })}
        />
      </Card>

      <Card title="Average composition" sub="Typical adult ranges: deep 13–23%, REM 20–25%">
        <Chart
          height={300}
          deps={[stageTotals]}
          option={(t) => ({
            tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}<br/><b>${fmtDuration(p.value)}</b> · ${p.percent}%` },
            legend: { bottom: 0, top: 'auto' },
            series: [{
              type: 'pie', radius: ['42%', '64%'], top: -20, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
              label: { formatter: '{d}%', color: t.ink2 },
              data: [['Deep', t.stage.deep], ['Light', t.stage.light], ['REM', t.stage.rem], ['Awake', t.stage.wake]].map(([n, c], i) => ({ name: n, value: Math.round(stageTotals[i]), itemStyle: { color: c } })),
            }],
          })}
        />
      </Card>

      {night && (
        <Card
          title={`Hypnogram · night ending ${night.date}`}
          sub={`${night.start.slice(11, 16)} → ${night.end.slice(11, 16)} · ${fmtDuration(night.minutesAsleep)} asleep · efficiency ${night.efficiency ?? '–'}%`}
          span={3}
          actions={
            <select value={night.date} onChange={(e) => setSel(e.target.value)}>
              {[...sessions].reverse().map((s) => <option key={s.id}>{s.date}</option>)}
            </select>
          }
        >
          <Chart
            height={220}
            deps={[night]}
            option={(t) => {
              const data: [number, number, number, SleepLevel][] = night.levels!.map((l) => {
                const s = Date.parse(l.t + 'Z');
                return [s, s + l.s * 1000, STAGE_Y[l.level] ?? 1, l.level];
              });
              const colorOf = (y: number) => [t.stage.deep, t.stage.light, t.stage.rem, t.stage.wake][y];
              return {
                tooltip: { formatter: (p: any) => `<b>${p.value[3]}</b><br/>${new Date(p.value[0]).toISOString().slice(11, 16)} – ${new Date(p.value[1]).toISOString().slice(11, 16)} (${Math.round((p.value[1] - p.value[0]) / 60000)} min)` },
                grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
                xAxis: { type: 'time', axisLabel: { formatter: (v: number) => new Date(v).toISOString().slice(11, 16) }, splitLine: { show: false } },
                yAxis: { type: 'category', data: ['Deep', 'Light', 'REM', 'Awake'] },
                series: [{
                  type: 'custom',
                  renderItem: (_: any, api: any) => {
                    const y = api.value(2);
                    const a = api.coord([api.value(0), y]);
                    const b = api.coord([api.value(1), y]);
                    const h = api.size([0, 1])[1] * 0.7;
                    return { type: 'rect', shape: { x: a[0], y: a[1] - h / 2, width: Math.max(1, b[0] - a[0]), height: h, r: 2 }, style: { fill: colorOf(y) } };
                  },
                  encode: { x: [0, 1], y: 2 },
                  data,
                }],
              };
            }}
          />
        </Card>
      )}

      <Card title="Chronotype & ideal bedtime" sub="Your natural timing (from free-day sleep, corrected for catch-up sleep) and the bedtime window linked to your best nights" span={3}>
        <div className="stats compact">
          <Stat label="Chronotype" value={chrono ? chrono.type.split(' (')[0] : '–'} hint={chrono ? `free-day mid-sleep ${fmtClock(chrono.msfsc)}` : 'needs 3+ weekend & 5+ weekday nights'} />
          <Stat label="Best bedtime window" value={bins.best ? `${fmtClock(bins.best.start)}–${fmtClock(bins.best.start + 30)}` : '–'} hint={bins.best ? `${bins.best.nights} nights · best sleep quality + HRV` : 'needs 3+ nights per window'} />
          <Stat label="Sleep score there" value={bins.best?.sleepScore != null ? Math.round(bins.best.sleepScore) : bins.best?.efficiency != null ? `${Math.round(bins.best.efficiency)}%` : '–'} hint="average in that window" />
          <Stat label="HRV there" value={bins.best?.nextHrv != null ? `${bins.best.nextHrv.toFixed(1)} ms` : '–'} />
        </div>
        <Chart
          height={240}
          deps={[bins]}
          option={(t) => ({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: any) => { const b = bins.bins[ps[0].dataIndex]; return `<b>Bed ${fmtClock(b.start)}–${fmtClock(b.start + 30)}</b><br/>${b.nights} nights<br/>sleep score ${b.sleepScore != null ? Math.round(b.sleepScore) : '–'} · efficiency ${b.efficiency != null ? Math.round(b.efficiency) + '%' : '–'}<br/>HRV ${b.nextHrv != null ? b.nextHrv.toFixed(1) + ' ms' : '–'}`; } },
            xAxis: { type: 'category', data: bins.bins.map((b) => fmtClock(b.start)), name: 'bedtime' },
            yAxis: { type: 'value', name: 'quality (z)', splitNumber: 3 },
            series: [{
              type: 'bar', data: bins.bins.map((b) => ({ value: b.score != null ? +b.score.toFixed(2) : null, itemStyle: { color: b === bins.best ? t.good : b.nights < 3 ? t.axis : (b.score ?? 0) >= 0 ? t.series[0] : t.series[1], borderRadius: 3 } })),
              markLine: { symbol: 'none', silent: true, lineStyle: { color: t.muted }, label: { show: false }, data: [{ yAxis: 0 }] },
            }],
          })}
        />
        <p className="small muted">Bars above zero = better-than-average nights for you. Grey = fewer than 3 nights (not enough to judge). {chrono && `Weekend sleep shifts your clock by ${Math.round(chrono.socialJetlagMin)} min.`}</p>
      </Card>

      <Card title="Cumulative sleep debt" sub="Hours above (debt) or below (surplus) your target" span={2} actions={<Seg value={target} onChange={setTarget} options={[420, 450, 480].map((v) => ({ v, l: `${v / 60}h` }))} />}>
        <Chart
          height={260}
          deps={[debtSeries]}
          option={(t) => ({
            tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${v} h` },
            xAxis: { type: 'category', data: days.map((d) => d.date), boundaryGap: false },
            yAxis: { type: 'value', name: 'hours' },
            series: [{
              name: 'Sleep debt', type: 'line', data: debtSeries, showSymbol: false, lineStyle: { width: 2, color: t.series[6] }, itemStyle: { color: t.series[6] }, areaStyle: { color: t.series[6], opacity: 0.1 },
              markLine: { symbol: 'none', silent: true, lineStyle: { color: t.muted }, label: { formatter: 'on target', color: t.muted, position: 'insideStartTop' }, data: [{ yAxis: 0 }] },
            }],
          })}
        />
      </Card>

      <Card title="Sleep duration by weekday">
        <Chart height={260} deps={[days]} option={(t) => weekdayBoxOption(t, byWd, 'sleepMin')} />
      </Card>

      <Card title="Sleep score" span={3}>
        <Chart height={260} deps={[days]} option={(t) => trendOption(t, days, days.some((d) => d.sleepScore != null) ? 'sleepScore' : 'sleepEfficiency')} />
      </Card>
    </div>
  );
}
