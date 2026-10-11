import { useApp } from '../state';
import { Card } from '../components/ui';
import { METRICS, fmtMetric } from '../data/metrics';

export function DataView() {
  const { days } = useApp();
  const cols = METRICS.filter((m) => days.some((d) => d[m.key] != null));

  const download = () => {
    const head = ['date', ...cols.map((c) => c.key)];
    const lines = [head.join(','), ...days.map((d) => [d.date, ...cols.map((c) => d[c.key] ?? '')].join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pulse-lab-${days[0]?.date}_${days[days.length - 1]?.date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="grid">
      <Card title="Daily data" sub={`${days.length} days × ${cols.length} metrics`} span={3} actions={<button onClick={download}>Download CSV</button>}>
        <div className="table-wrap tall">
          <table className="data">
            <thead>
              <tr><th>Date</th>{cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  {cols.map((c) => <td key={c.key} className="num">{fmtMetric(c.key, d[c.key], false)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
