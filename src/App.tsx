import { useEffect, useMemo, useState } from 'react';
import type { Dataset, Settings } from './data/types';
import { clearDataset, loadDataset, loadSettings, saveDataset, saveSettings } from './data/store';
import { makeDemo } from './data/demo';
import { mergeDatasets } from './data/derive';
import { AppCtx, boundsOf, denseDays, type Range } from './state';
import { addDays, daysBetween } from './lib/stats';
import { DARK, LIGHT, ThemeCtx } from './components/theme';
import { Overview } from './views/Overview';
import { Activity } from './views/Activity';
import { Heart } from './views/Heart';
import { Sleep } from './views/Sleep';
import { Recovery } from './views/Recovery';
import { Correlations } from './views/Correlations';
import { Compare } from './views/Compare';
import { Workouts } from './views/Workouts';
import { Insights } from './views/Insights';
import { DataView } from './views/DataView';
import { Import } from './views/Import';
import { ErrorBoundary } from './components/ErrorBoundary';

const VIEWS = [
  { id: 'overview', label: 'Overview', icon: '◎' },
  { id: 'insights', label: 'Insights', icon: '✦' },
  { id: 'activity', label: 'Activity', icon: '↗' },
  { id: 'heart', label: 'Heart', icon: '♥' },
  { id: 'sleep', label: 'Sleep', icon: '☾' },
  { id: 'recovery', label: 'Recovery', icon: '↻' },
  { id: 'workouts', label: 'Workouts', icon: '⚑' },
  { id: 'correlations', label: 'Correlation lab', icon: '⋰' },
  { id: 'compare', label: 'Compare', icon: '⇄' },
  { id: 'data', label: 'Data table', icon: '▦' },
  { id: 'import', label: 'Import & settings', icon: '⚙' },
] as const;

const PRESETS = [
  { id: '7d', label: '7D', days: 7 },
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: '6m', label: '6M', days: 182 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All', days: 0 },
];

const viewFromHash = () => (location.hash.slice(1) || 'overview').split('/')[0];

export default function App() {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [view, setView] = useState(viewFromHash);
  const [range, setRange] = useState<Range | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    loadDataset().then((d) => {
      setDs(d);
      setLoaded(true);
      if (!d) setView('import');
    });
    const onHash = () => setView(viewFromHash());
    addEventListener('hashchange', onHash);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onMq);
    return () => {
      removeEventListener('hashchange', onHash);
      mq.removeEventListener('change', onMq);
    };
  }, []);

  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  };

  const bounds = useMemo(() => (ds ? boundsOf(ds) : { min: '', max: '' }), [ds]);
  const effRange: Range = useMemo(() => {
    if (!bounds.max) return { from: '', to: '', preset: '90d' };
    if (range && range.from >= bounds.min && range.to <= bounds.max) return range;
    return { from: addDays(bounds.max, -89) < bounds.min ? bounds.min : addDays(bounds.max, -89), to: bounds.max, preset: '90d' };
  }, [range, bounds]);

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    const from = p.days ? addDays(bounds.max, -(p.days - 1)) : bounds.min;
    setRange({ from: from < bounds.min ? bounds.min : from, to: bounds.max, preset: id });
  };

  const days = useMemo(() => (ds ? denseDays(ds, effRange.from, effRange.to) : []), [ds, effRange]);
  const prevDays = useMemo(() => {
    if (!ds) return [];
    const n = daysBetween(effRange.from, effRange.to) + 1;
    return denseDays(ds, addDays(effRange.from, -n), addDays(effRange.from, -1));
  }, [ds, effRange]);

  const goto = (v: string) => {
    location.hash = v;
    setView(v);
    setNavOpen(false);
  };

  const commit = (next: Dataset) => {
    setDs(next);
    saveDataset(next);
    setRange(null);
  };

  if (!loaded) return <div className="splash">Loading…</div>;

  const current = ds ? view : 'import';
  const page = (() => {
    switch (current) {
      case 'activity': return <Activity />;
      case 'heart': return <Heart />;
      case 'sleep': return <Sleep />;
      case 'recovery': return <Recovery />;
      case 'workouts': return <Workouts />;
      case 'correlations': return <Correlations />;
      case 'compare': return <Compare />;
      case 'insights': return <Insights />;
      case 'data': return <DataView />;
      case 'import':
        return (
          <Import
            ds={ds}
            settings={settings}
            setSettings={setSettings}
            onImported={(d, merge) => { commit(merge && ds ? mergeDatasets(ds, d) : d); goto('overview'); }}
            onDemo={() => { commit(makeDemo()); goto('overview'); }}
            onClear={() => { clearDataset(); setDs(null); }}
          />
        );
      default: return <Overview />;
    }
  })();

  const title = VIEWS.find((v) => v.id === current)?.label ?? 'Overview';

  return (
    <ThemeCtx.Provider value={dark ? DARK : LIGHT}>
      <div className={`app ${navOpen ? 'nav-open' : ''}`}>
        <aside className="nav">
          <div className="brand"><span className="logo" aria-hidden>💓</span> Pulse Lab</div>
          <nav>
            {VIEWS.map((v) => (
              <a key={v.id} href={`#${v.id}`} className={current === v.id ? 'active' : ''} onClick={(e) => { e.preventDefault(); goto(v.id); }} aria-disabled={!ds && v.id !== 'import'}>
                <span className="ico" aria-hidden>{v.icon}</span>{v.label}
              </a>
            ))}
          </nav>
          {ds && <div className="nav-foot muted small">{ds.source.join(', ')}<br />{bounds.min} → {bounds.max}</div>}
        </aside>
        <div className="scrim" onClick={() => setNavOpen(false)} />
        <main>
          <header className="top">
            <button className="menu" aria-label="Menu" onClick={() => setNavOpen(!navOpen)}>☰</button>
            <h1>{title}</h1>
            {ds && current !== 'import' && current !== 'compare' && (
              <div className="range">
                <div className="seg">
                  {PRESETS.map((p) => (
                    <button key={p.id} className={effRange.preset === p.id ? 'on' : ''} onClick={() => applyPreset(p.id)}>{p.label}</button>
                  ))}
                </div>
                <div className="dates">
                  <input type="date" value={effRange.from} min={bounds.min} max={effRange.to} onChange={(e) => e.target.value && setRange({ ...effRange, from: e.target.value, preset: 'custom' })} />
                  <span className="muted">→</span>
                  <input type="date" value={effRange.to} min={effRange.from} max={bounds.max} onChange={(e) => e.target.value && setRange({ ...effRange, to: e.target.value, preset: 'custom' })} />
                </div>
              </div>
            )}
          </header>
          {ds?.source.includes('Demo data') && current !== 'import' && (
            <div className="banner">You're viewing <b>synthetic demo data</b>. <button className="link" onClick={() => goto('import')}>Import your own Fitbit export →</button></div>
          )}
          {ds ? (
            <AppCtx.Provider value={{ ds, settings, setSettings, range: effRange, setRange, days, prevDays, bounds, goto }}>
              <ErrorBoundary resetKey={current}>{page}</ErrorBoundary>
            </AppCtx.Provider>
          ) : page}
        </main>
      </div>
    </ThemeCtx.Provider>
  );
}
