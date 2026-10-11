import { useMemo } from 'react';
import { useApp } from '../state';
import { buildInsights, strainFlags } from '../lib/insights';
import { Card, Empty, InsightCard } from '../components/ui';
import { fmtMetric } from '../data/metrics';

export function Insights() {
  const { ds, days } = useApp();
  const insights = useMemo(() => buildInsights(ds, days), [ds, days]);
  const flags = useMemo(() => strainFlags(ds, days.map((d) => d.date)), [ds, days]);
  const records = useMemo(() => {
    const pick = (k: 'steps' | 'restingHr' | 'hrv' | 'sleepMin' | 'azm' | 'sleepScore', dir: 1 | -1, label: string) => {
      const withV = days.filter((d) => d[k] != null);
      if (!withV.length) return null;
      const best = withV.reduce((a, d) => ((d[k]! - a[k]!) * dir > 0 ? d : a));
      return { label, value: fmtMetric(k, best[k]), date: best.date };
    };
    return [
      pick('steps', 1, 'Most steps'),
      pick('azm', 1, 'Most Active Zone Minutes'),
      pick('restingHr', -1, 'Lowest resting HR'),
      pick('hrv', 1, 'Highest HRV'),
      pick('sleepMin', 1, 'Longest sleep'),
      pick('sleepScore', 1, 'Best sleep score'),
    ].filter(Boolean) as { label: string; value: string; date: string }[];
  }, [days]);

  if (!insights.length && !records.length) return <Empty>Not enough data in this range.</Empty>;

  return (
    <div className="grid">
      <Card title="Insights" sub="Statistical patterns detected in the selected range, strongest first" span={3}>
        <div className="insights">{insights.map((i) => <InsightCard key={i.id} i={i} />)}</div>
      </Card>

      <Card title="Personal records" sub="Within the selected range">
        <ul className="records">
          {records.map((r) => (
            <li key={r.label}><span>{r.label}</span><b>{r.value}</b><span className="muted small">{r.date}</span></li>
          ))}
        </ul>
      </Card>

      <Card title="Strain-flag days" sub="Two or more recovery signals out of line with your own 30-day baseline" span={2}>
        {flags.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th className="num">Score</th><th>Signals</th></tr></thead>
              <tbody>
                {flags.slice(0, 30).map((f) => (
                  <tr key={f.date}><td>{f.date}</td><td className="num">{f.score.toFixed(1)}</td><td>{f.reasons.join(' · ')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No days flagged — recovery signals stayed within your normal range.</p>}
        <p className="muted small">This is a pattern detector, not a diagnosis. Talk to a clinician about any health concern.</p>
      </Card>
    </div>
  );
}
