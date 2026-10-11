import { useMemo } from 'react';
import { useApp } from '../state';
import { buildInsights, strainFlags } from '../lib/insights';
import { Card, Empty, InsightCard } from '../components/ui';
import { META, fmtMetric, lowerLabel } from '../data/metrics';
import { tagEffects, effectSentence } from '../lib/journal';
import { normAlerts, describeAlert } from '../lib/norms';

export function Insights() {
  const { ds, days, journal, today, goto } = useApp();
  const insights = useMemo(() => buildInsights(ds, days), [ds, days]);
  const habits = useMemo(() => tagEffects(journal, ds).filter((e) => e.p < 0.05 && e.good != null).sort((a, b) => a.p - b.p).slice(0, 6), [journal, ds]);
  const alerts = useMemo(() => normAlerts(ds, today), [ds, today]);
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

      {alerts.length > 0 && (
        <Card title="Outside your normal range" sub="Metrics that have stayed outside your personal 60-day range for 2+ recent days" span={3}>
          <div className="insights">
            {alerts.map((a) => (
              <InsightCard key={a.metric} i={{ id: a.metric, tone: a.bad ? 'warning' : 'good', title: `${a.dir === 'high' ? 'Higher' : 'Lower'} than usual`, body: describeAlert(a), score: 0 }} />
            ))}
          </div>
        </Card>
      )}

      <Card title="From your journal" sub="Habits with a statistically clear effect on your sleep or next-day recovery" span={3} actions={<button className="link" onClick={() => goto('journal')}>Open journal →</button>}>
        {habits.length ? (
          <div className="insights">
            {habits.map((e) => (
              <InsightCard key={e.tag + e.metric} i={{ id: e.tag + e.metric, tone: e.good ? 'good' : 'serious', title: `${e.tag}: ${e.diff > 0 ? 'higher' : 'lower'} ${lowerLabel(META[e.metric].label)}`, body: effectSentence(e), score: 0 }} />
            ))}
          </div>
        ) : <p className="muted">Log a couple of weeks in the Journal to discover which habits help or hurt you.</p>}
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
