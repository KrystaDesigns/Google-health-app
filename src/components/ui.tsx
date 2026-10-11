import type { ReactNode } from 'react';
import type { NumericKey } from '../data/types';
import { METRICS, META, fmtMetric } from '../data/metrics';
import type { Insight } from '../lib/insights';
import { Chart } from './Chart';

export function Card({ title, sub, children, actions, span = 1 }: { title?: string; sub?: ReactNode; children: ReactNode; actions?: ReactNode; span?: 1 | 2 | 3 }) {
  return (
    <section className={`card span-${span}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <p className="sub">{sub}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ k, value, prev, spark, label }: { k: NumericKey; value: number | null; prev: number | null; spark: (number | null)[]; label?: string }) {
  const m = META[k];
  const delta = value != null && prev != null ? value - prev : null;
  const pct = delta != null && prev ? (delta / Math.abs(prev)) * 100 : null;
  const good = delta == null || m.better === 0 || Math.abs(pct ?? 0) < 1 ? null : Math.sign(delta) === m.better;
  return (
    <div className="kpi">
      <div className="kpi-label">{label ?? m.label}</div>
      <div className="kpi-value">{fmtMetric(k, value)}</div>
      <div className={`kpi-delta ${good == null ? '' : good ? 'up' : 'down'}`}>
        {delta == null ? 'no prior data' : (
          <>
            <span aria-hidden>{delta > 0 ? '▲' : delta < 0 ? '▼' : '■'}</span> {pct != null ? `${Math.abs(pct).toFixed(1)}%` : fmtMetric(k, Math.abs(delta))} vs prev. period
          </>
        )}
      </div>
      <Chart
        height={44}
        deps={[spark]}
        option={(t) => ({
          animation: false,
          grid: { left: 0, right: 0, top: 4, bottom: 0 },
          xAxis: { type: 'category', show: false, data: spark.map((_, i) => i) },
          yAxis: { type: 'value', show: false, scale: true },
          series: [{ type: 'line', data: spark, showSymbol: false, connectNulls: true, smooth: 0.3, lineStyle: { width: 2, color: t.series[0] }, areaStyle: { color: t.series[0], opacity: 0.08 } }],
        })}
      />
    </div>
  );
}

export function MetricSelect({ value, onChange, keys }: { value: NumericKey; onChange: (k: NumericKey) => void; keys?: NumericKey[] }) {
  const list = keys ? METRICS.filter((m) => keys.includes(m.key)) : METRICS;
  const groups = [...new Set(list.map((m) => m.group))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as NumericKey)}>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {list.filter((m) => m.group === g).map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const ICON: Record<Insight['tone'], string> = { good: '✓', warning: '!', serious: '▲', critical: '⚠', info: 'i' };
const TONE_LABEL: Record<Insight['tone'], string> = { good: 'Positive', warning: 'Watch', serious: 'Attention', critical: 'Alert', info: 'Pattern' };

export function InsightCard({ i, onOpen }: { i: Insight; onOpen?: () => void }) {
  return (
    <article className={`insight tone-${i.tone}`} onClick={onOpen} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}>
      <div className="insight-badge"><span className="ico" aria-hidden>{ICON[i.tone]}</span>{TONE_LABEL[i.tone]}</div>
      <h4>{i.title}</h4>
      <p>{i.body}</p>
    </article>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={o.v === value} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}
