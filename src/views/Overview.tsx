import { useMemo, useState } from 'react';
import { useApp, col } from '../state';
import type { NumericKey } from '../data/types';
import { mean } from '../lib/stats';
import { buildInsights } from '../lib/insights';
import { Card, InsightCard, Kpi, MetricSelect } from '../components/ui';
import { Chart } from '../components/Chart';
import { calendarOption, trendOption } from '../components/charts';
import { META } from '../data/metrics';

const KPIS: NumericKey[] = ['steps', 'azm', 'sleepMin', 'sleepScore', 'restingHr', 'hrv', 'readiness', 'spo2'];

export function Overview() {
  const { ds, days, prevDays, goto } = useApp();
  const [calKey, setCalKey] = useState<NumericKey>('steps');
  const [trendKey, setTrendKey] = useState<NumericKey>('restingHr');
  const insights = useMemo(() => buildInsights(ds, days), [ds, days]);
  const kpis = KPIS.filter((k) => days.some((d) => d[k] != null));

  return (
    <div className="grid">
      <div className="kpis span-3">
        {kpis.map((k) => (
          <Kpi key={k} k={k} value={mean(col(days, k))} prev={mean(col(prevDays, k))} spark={col(days, k)} />
        ))}
      </div>

      <Card title="Top insights" sub="Auto-detected from your data in this range" span={3} actions={<button className="link" onClick={() => goto('insights')}>All insights →</button>}>
        <div className="insights">
          {insights.slice(0, 6).map((i) => <InsightCard key={i.id} i={i} />)}
          {!insights.length && <p className="muted">Not enough data in this range for insights yet.</p>}
        </div>
      </Card>

      <Card title="Trend" sub="Daily value with 7- and 28-day rolling averages and a ±1σ band" span={2} actions={<MetricSelect value={trendKey} onChange={setTrendKey} />}>
        <Chart height={300} deps={[days, trendKey]} option={(t) => trendOption(t, days, trendKey, { band: true })} />
      </Card>

      <Card title="Data coverage" sub="Days with data per metric">
        <div className="coverage">
          {(['steps', 'restingHr', 'sleepMin', 'hrv', 'spo2', 'skinTemp', 'readiness', 'weightKg'] as NumericKey[]).map((k) => {
            const n = days.filter((d) => d[k] != null).length;
            const pct = days.length ? (n / days.length) * 100 : 0;
            return (
              <div key={k} className="cov-row">
                <span>{META[k]?.label ?? 'Skin temperature'}</span>
                <div className="cov-bar"><div style={{ width: `${pct}%` }} /></div>
                <span className="num">{Math.round(pct)}%</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Calendar" sub="Each square is one day; darker = higher" span={3} actions={<MetricSelect value={calKey} onChange={setCalKey} />}>
        <Chart height={Math.max(180, 60 + Math.ceil(days.length / 365) * 130)} deps={[days, calKey]} option={(t) => calendarOption(t, days, calKey)} />
      </Card>
    </div>
  );
}
