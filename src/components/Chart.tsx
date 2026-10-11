import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { useTokens, type Tokens } from './theme';

interface Props {
  option: (t: Tokens) => EChartsOption;
  height?: number;
  onClick?: (params: any) => void;
  deps?: unknown[];
}

/** Thin ECharts wrapper: themed chrome, resize-aware, crosshair tooltips by default. */
export function Chart({ option, height = 300, onClick, deps = [] }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const t = useTokens();

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    inst.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    const c = inst.current;
    if (!c) return;
    c.setOption(withChrome(option(t), t), { notMerge: true });
    c.off('click');
    if (onClick) c.on('click', onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, ...deps]);

  return <div ref={el} style={{ width: '100%', height }} />;
}

function withChrome(o: EChartsOption, t: Tokens): EChartsOption {
  const axisCommon = {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
    nameTextStyle: { color: t.muted, fontSize: 11 },
  };
  const style = (ax: unknown) =>
    Array.isArray(ax) ? ax.map((a) => deepMerge(axisCommon, a)) : ax ? deepMerge(axisCommon, ax) : ax;
  return {
    backgroundColor: 'transparent',
    color: t.series,
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: t.ink2 },
    animationDuration: 400,
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    ...o,
    tooltip: o.tooltip === undefined ? undefined : deepMerge(
      {
        backgroundColor: t.surface,
        borderColor: t.axis,
        borderWidth: 1,
        textStyle: { color: t.ink, fontSize: 12 },
        extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.15); border-radius: 8px;',
        axisPointer: { lineStyle: { color: t.muted }, crossStyle: { color: t.muted } },
      },
      o.tooltip,
    ),
    xAxis: style(o.xAxis) as EChartsOption['xAxis'],
    yAxis: style(o.yAxis) as EChartsOption['yAxis'],
    ...(o.legend
      ? { legend: deepMerge({ textStyle: { color: t.ink2, fontSize: 12 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10, top: 0, left: 0 }, o.legend) }
      : {}),
  } as EChartsOption;
}

function deepMerge(a: any, b: any): any {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out: any = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  }
  return out;
}
