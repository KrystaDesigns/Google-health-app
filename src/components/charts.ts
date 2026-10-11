import type { EChartsOption } from 'echarts';
import type { DailyRecord, NumericKey } from '../data/types';
import { META, fmtMetric } from '../data/metrics';
import { rolling, mean } from '../lib/stats';
import type { Tokens } from './theme';

const axisTooltip = { trigger: 'axis' as const, axisPointer: { type: 'line' as const } };

export const fmtAxis = (k: NumericKey) => (v: number) =>
  META[k]?.unit === 'clock' ? fmtMetric(k, v) : Math.abs(v) >= 10000 ? `${+(v / 1000).toFixed(1)}k` : String(+v.toFixed(Math.min(2, META[k]?.decimals ?? 2)));

/** Daily values + 7-day and 28-day rolling means, optional personal-normal-range band & goal line. */
export function trendOption(t: Tokens, days: DailyRecord[], k: NumericKey, opts: { bars?: boolean; band?: boolean; goal?: number; markDates?: string[] } = {}): EChartsOption {
  const x = days.map((d) => d.date);
  const y = days.map((d) => d[k] ?? null);
  const r7 = rolling(y, 7, 3);
  const r28 = rolling(y, 28, 10);
  const series: any[] = [];
  if (opts.band) {
    // "Your normal range": median ± 2·MAD of the previous 60 days (robust to outliers)
    const lo: (number | null)[] = [];
    const width: (number | null)[] = [];
    for (let i = 0; i < y.length; i++) {
      const prior = y.slice(Math.max(0, i - 60), i).filter((v): v is number => v != null);
      if (prior.length < 14) {
        lo.push(null);
        width.push(null);
        continue;
      }
      const sorted = [...prior].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const dev = prior.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
      const spread = Math.max(2 * 1.4826 * dev[Math.floor(dev.length / 2)], Math.abs(med) * 0.02);
      lo.push(med - spread);
      width.push(2 * spread);
    }
    series.push(
      { name: 'band-lo', type: 'line', data: lo, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, itemStyle: { color: t.series[0] }, tooltip: { show: false }, silent: true },
      { name: 'Your normal range', type: 'line', data: width, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, itemStyle: { color: t.seq[t.dark ? 2 : 1] }, areaStyle: { color: t.series[0], opacity: 0.1 }, tooltip: { show: false }, silent: true },
    );
  }
  series.push(
    opts.bars
      ? { name: META[k].label, type: 'bar', data: y, itemStyle: { color: t.seq[t.dark ? 2 : 1], borderRadius: [3, 3, 0, 0] }, barCategoryGap: '20%' }
      : { name: META[k].label, type: 'line', data: y, showSymbol: false, symbolSize: 8, lineStyle: { width: 1, color: t.muted }, itemStyle: { color: t.muted }, connectNulls: false },
    { name: '7-day avg', type: 'line', data: r7, showSymbol: false, smooth: 0.3, lineStyle: { width: 2, color: t.series[0] }, itemStyle: { color: t.series[0] } },
    { name: '28-day avg', type: 'line', data: r28, showSymbol: false, smooth: 0.3, lineStyle: { width: 2, color: t.series[1], type: 'dashed' }, itemStyle: { color: t.series[1] } },
  );
  const lines: any[] = [];
  if (opts.goal) lines.push({ yAxis: opts.goal, lineStyle: { color: t.good, type: 'dotted', width: 1.5 }, label: { formatter: `Goal ${opts.goal.toLocaleString()}`, color: t.ink2, position: 'insideEndTop' } });
  for (const d of opts.markDates ?? []) lines.push({ xAxis: d, lineStyle: { color: t.critical, type: 'solid', width: 1, opacity: 0.5 }, label: { show: false } });
  if (lines.length) series[series.length - 3].markLine = { symbol: 'none', silent: true, data: lines };
  return {
    legend: { data: [META[k].label, '7-day avg', '28-day avg', ...(opts.band ? ['Your normal range'] : [])] },
    tooltip: {
      ...axisTooltip,
      formatter: (ps: any) => {
        const arr = (Array.isArray(ps) ? ps : [ps]).filter((p: any) => !String(p.seriesName).startsWith('band') && p.seriesName !== 'Your normal range');
        return `<b>${arr[0]?.axisValue}</b><br/>` + arr.map((p: any) => `${p.marker} ${p.seriesName}: <b>${fmtMetric(k, p.value)}</b>`).join('<br/>');
      },
    },
    dataZoom: [{ type: 'inside' }],
    xAxis: { type: 'category', data: x, axisLabel: { hideOverlap: true }, boundaryGap: !!opts.bars },
    yAxis: { type: 'value', scale: !opts.bars, axisLabel: { formatter: fmtAxis(k) }, ...(META[k].unit === 'clock' ? { inverse: false } : {}) },
    series,
  };
}

/** GitHub-style calendar heatmap for one metric. */
export function calendarOption(t: Tokens, days: DailyRecord[], k: NumericKey): EChartsOption {
  const data = days.filter((d) => d[k] != null).map((d) => [d.date, d[k]]);
  const vals = data.map((d) => d[1] as number);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const reversed = META[k].better === -1;
  const ramp = reversed ? [...t.seq].reverse() : t.seq;
  return {
    tooltip: { formatter: (p: any) => `${p.value[0]}<br/><b>${fmtMetric(k, p.value[1])}</b>` },
    visualMap: { min: isFinite(lo) ? lo : 0, max: isFinite(hi) ? hi : 1, calculable: false, orient: 'horizontal', left: 'right', top: 0, itemWidth: 10, itemHeight: 120, inRange: { color: ramp }, textStyle: { color: t.muted }, formatter: (v: any) => fmtMetric(k, +v, false) },
    calendar: {
      range: [days[0]?.date, days[days.length - 1]?.date],
      top: 44,
      left: 36,
      right: 8,
      cellSize: ['auto', 16],
      splitLine: { show: false },
      itemStyle: { color: t.dark ? '#232322' : '#f0efec', borderColor: t.surface, borderWidth: 2 },
      yearLabel: { show: false },
      dayLabel: { firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], color: t.muted, fontSize: 10 },
      monthLabel: { color: t.muted, fontSize: 10 },
    },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data }],
  };
}

export function histogramOption(t: Tokens, values: number[], k: NumericKey, bins = 24): EChartsOption {
  if (!values.length) return {};
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  const m = mean(values)!;
  return {
    tooltip: { trigger: 'axis', formatter: (ps: any) => `${fmtMetric(k, lo + ps[0].dataIndex * w)} – ${fmtMetric(k, lo + (ps[0].dataIndex + 1) * w)}<br/><b>${ps[0].value} days</b>` },
    xAxis: { type: 'category', data: counts.map((_, i) => fmtAxis(k)(lo + (i + 0.5) * w)), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', name: 'days' },
    series: [{
      type: 'bar', data: counts, barCategoryGap: '8%', itemStyle: { color: t.series[0], borderRadius: [3, 3, 0, 0] },
      markLine: { symbol: 'none', silent: true, lineStyle: { color: t.ink2, type: 'dashed' }, label: { formatter: `mean ${fmtMetric(k, m)}`, color: t.ink2 }, data: [{ xAxis: Math.min(bins - 1, Math.floor((m - lo) / w)) }] },
    }],
  };
}

/** Box plot by weekday (Mon…Sun). */
export function weekdayBoxOption(t: Tokens, groups: number[][], k: NumericKey): EChartsOption {
  const q = (a: number[], p: number) => {
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * p;
    return s[Math.floor(pos)] + (s[Math.ceil(pos)] - s[Math.floor(pos)]) * (pos - Math.floor(pos));
  };
  const data = groups.map((g) => (g.length ? [q(g, 0.05), q(g, 0.25), q(g, 0.5), q(g, 0.75), q(g, 0.95)] : [0, 0, 0, 0, 0]));
  return {
    tooltip: { trigger: 'item', formatter: (p: any) => `<b>${p.name}</b><br/>p95: ${fmtMetric(k, p.value[5])}<br/>p75: ${fmtMetric(k, p.value[4])}<br/>median: <b>${fmtMetric(k, p.value[3])}</b><br/>p25: ${fmtMetric(k, p.value[2])}<br/>p5: ${fmtMetric(k, p.value[1])}` },
    xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: fmtAxis(k) } },
    series: [{ type: 'boxplot', data, itemStyle: { color: t.series[0] + '33', borderColor: t.series[0], borderWidth: 1.5 } }],
  };
}
