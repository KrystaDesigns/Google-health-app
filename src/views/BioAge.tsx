import { useMemo } from 'react';
import { useApp } from '../state';
import { Card, Empty, Seg, Stat } from '../components/ui';
import { Chart } from '../components/Chart';
import { bioAgeSeries, estimateBioAge, fitnessAge, type Sex } from '../lib/bioage';
import { mean, addDays } from '../lib/stats';
import { lowerLabel } from '../data/metrics';

const yrs = (v: number) => `${Math.abs(v).toFixed(1)} year${Math.abs(v) >= 0.95 && Math.abs(v) < 1.05 ? '' : 's'}`;

export function BioAge() {
  const { ds, settings, setSettings, today } = useApp();
  const sex: Sex = settings.sex ?? 'female';
  const est = useMemo(() => estimateBioAge(ds, today, settings.age, sex), [ds, today, settings.age, sex]);
  const series = useMemo(() => bioAgeSeries(ds, today, settings.age, sex), [ds, today, settings.age, sex]);
  const vo2 = mean(Array.from({ length: 30 }, (_, i) => ds.days[addDays(today, -i)]?.vo2max));
  const change = series.pts.length >= 2 ? series.pts[series.pts.length - 1].bioAge - series.pts[0].bioAge : null;
  const fAge = vo2 != null ? fitnessAge(vo2, sex) : null;

  const setup = (
    <div className="row wrap">
      <label className="row">Age <input type="number" min={18} max={100} value={settings.age} onChange={(e) => setSettings({ ...settings, age: +e.target.value || settings.age })} style={{ width: 80 }} /></label>
      <Seg value={sex} onChange={(v) => setSettings({ ...settings, sex: v })} options={[{ v: 'female', l: 'Female' }, { v: 'male', l: 'Male' }]} />
    </div>
  );

  if (!est) return <Card title="Biological age" actions={setup}><Empty>Needs at least 14 days with steps or heart-rate data in the last 30 days.</Empty></Card>;
  const younger = est.delta < 0;
  const factors = [...est.factors].sort((a, b) => Number(!!a.missing) - Number(!!b.missing) || a.years - b.years);
  const shown = factors.filter((f) => !f.missing);
  const worst = [...shown].sort((a, b) => b.years - a.years).filter((f) => f.years > 0.05).slice(0, 3);

  return (
    <div className="grid">
      <Card title="Biological age" sub="Estimated from your last 30 days of activity, fitness, heart and sleep data" span={3} actions={setup}>
        <div className="bio-hero">
          <div className="bio-age">
            <div className="muted small">Your estimated body age</div>
            <div className="bio-num">{est.bioAge.toFixed(1)}</div>
            <div className={younger ? 'good-text' : 'bad-text'}>
              <b>{younger ? '▼' : '▲'} {yrs(est.delta)} {younger ? 'younger' : 'older'}</b> than your age ({settings.age})
            </div>
          </div>
          <div className="stats compact" style={{ flex: 1 }}>
            <Stat label="Pace of aging" value={series.pace != null ? `${series.pace.toFixed(1)}×` : '–'} hint={series.pace == null ? 'needs ~8 weeks of history' : `${series.pace < 1 ? 'slower' : series.pace > 1 ? 'faster' : 'same'} than the calendar · ${change != null ? `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(1)} y bio age over ${series.pts.length} weeks` : ''}`} />
            <Stat label="Fitness age" value={fAge != null ? (fAge < 20 ? '< 20' : Math.round(fAge)) : '–'} hint={fAge != null ? `from VO₂ max ${vo2!.toFixed(1)}` : 'needs VO₂ max'} />
            <Stat label="Data coverage" value={`${Math.round(est.coverage * 100)}%`} hint={`${shown.length} of ${est.factors.length} factors`} />
          </div>
        </div>
        {worst.length > 0 && (
          <p className="small"><b>Biggest opportunities:</b> {worst.map((w) => `${lowerLabel(w.label)} (+${w.years.toFixed(1)} y)`).join(', ')}.</p>
        )}
      </Card>

      <Card title="What adds or removes years" sub="Each factor's effect before overlap adjustment. Green bars make you younger, red older." span={2}>
        <Chart
          height={Math.max(220, shown.length * 34 + 50)}
          deps={[shown]}
          option={(t) => ({
            tooltip: { trigger: 'item', formatter: (p: any) => { const f = shown[p.dataIndex]; return `<b>${f.label}</b><br/>${f.value}<br/>target ${f.target}<br/>${f.years > 0 ? '+' : '−'}${Math.abs(f.years).toFixed(1)} years`; } },
            grid: { left: 8, right: 30, top: 8, bottom: 24, containLabel: true },
            xAxis: { type: 'value', name: 'years', nameLocation: 'middle', nameGap: 22, min: (v: any) => Math.min(-2, Math.floor(v.min)), max: (v: any) => Math.max(2, Math.ceil(v.max)) },
            yAxis: { type: 'category', inverse: true, data: shown.map((f) => f.label), splitLine: { show: false } },
            series: [{
              type: 'bar', barWidth: 14,
              data: shown.map((f) => ({ value: +f.years.toFixed(2), itemStyle: { color: Math.abs(f.years) < 0.05 ? t.axis : f.years < 0 ? t.good : t.critical, borderRadius: 3 } })),
              label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: any) => `${p.value > 0 ? '+' : ''}${p.value.toFixed(1)}` },
              markLine: { symbol: 'none', silent: true, lineStyle: { color: t.muted }, label: { show: false }, data: [{ xAxis: 0 }] },
            }],
          })}
        />
      </Card>

      <Card title="Trend" sub="Weekly estimate (30-day rolling window)">
        {series.pts.length > 1 ? (
          <Chart
            height={Math.max(220, shown.length * 34 + 50)}
            deps={[series]}
            option={(t) => ({
              legend: {},
              tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '–' : Number(v).toFixed(1)) },
              xAxis: { type: 'category', data: series.pts.map((p) => p.date.slice(5)), boundaryGap: false },
              yAxis: { type: 'value', scale: true },
              series: [
                { name: 'Biological age', type: 'line', data: series.pts.map((p) => p.bioAge), showSymbol: false, smooth: 0.3, lineStyle: { width: 2, color: t.series[0] }, itemStyle: { color: t.series[0] } },
                { name: 'Calendar age', type: 'line', data: series.pts.map((p) => +(p.bioAge - p.delta).toFixed(1)), showSymbol: false, lineStyle: { width: 1.5, type: 'dashed', color: t.muted }, itemStyle: { color: t.muted } },
              ],
            })}
          />
        ) : <Empty>Builds up as you collect more weeks of data.</Empty>}
      </Card>

      <Card title="Factor details & how to improve" span={3}>
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table>
            <thead><tr><th>Factor</th><th>You (30 days)</th><th>Target</th><th className="num">Effect</th><th>How to gain years</th></tr></thead>
            <tbody>
              {factors.map((f) => (
                <tr key={f.id}>
                  <td>{f.label}</td>
                  <td>{f.value}</td>
                  <td className="muted">{f.target}</td>
                  <td className={`num ${f.missing || Math.abs(f.years) < 0.05 ? 'muted' : f.years < 0 ? 'good-text' : 'bad-text'}`}>{f.missing ? 'no data' : Math.abs(f.years) < 0.05 ? '0.0 y' : `${f.years > 0 ? '+' : '−'}${Math.abs(f.years).toFixed(1)} y`}</td>
                  <td className="wrap-cell small">{f.tip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="How this is calculated" span={3}>
        <p className="small">Each factor is matched to its effect on all-cause mortality in large population studies (steps: Paluch 2022; fitness: Kodama 2009; resting HR: Zhang 2016; sleep duration: Cappuccio 2010; sleep regularity: Windred 2024; activity: Lee 2022 and Wang 2021; strength training: Momma 2022). Risk is converted to years using the fact that mortality risk roughly doubles every 8 years of age. Because these factors overlap, the total is scaled by 0.6 and capped at ±12 years. VO₂ max is compared with the median for your age and sex.</p>
        <p className="small muted">This is an educational estimate inspired by WHOOP Age, not WHOOP's proprietary model and not a medical test. It's most useful for tracking your own direction over time.</p>
      </Card>
    </div>
  );
}
