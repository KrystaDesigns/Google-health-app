import { useEffect, useMemo, useState } from 'react';
import type { Dataset, Settings } from './data/types';
import { clearDataset, loadDataset, loadSettings, saveDataset, saveSettings } from './data/store';
import { makeDemo } from './data/demo';
import type { Journal } from './data/types';
import { emptyJournal, loadJournal, saveJournal } from './data/store';
import { loadSeries } from './lib/training';
import { Journal as JournalView } from './views/Journal';
import { Training } from './views/Training';
import { Goals } from './views/Goals';
import { Report } from './views/Report';
import { BioAge } from './views/BioAge';
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
import { ApiError, loadGis, signIn, signOut, syncRange, type SyncReport } from './data/googleHealth';
import { deriveSkinTempDelta } from './data/derive';

export interface SyncState {
  busy: boolean;
  done: number;
  total: number;
  label: string;
  error?: string;
  report?: SyncReport;
}

const VIEWS = [
  { id: 'overview', label: 'Overview', icon: '◎' },
  { id: 'insights', label: 'Insights', icon: '✦' },
  { id: 'bioage', label: 'Biological age', icon: '⌛' },
  { id: 'report', label: 'Weekly report', icon: '▤' },
  { id: 'goals', label: 'Goals', icon: '◉' },
  { id: 'journal', label: 'Journal', icon: '✎' },
  { id: 'activity', label: 'Activity', icon: '↗' },
  { id: 'training', label: 'Training load', icon: '⚡' },
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
  const [journal, setJournalState] = useState<Journal>(emptyJournal);
  const setJournal = (j: Journal) => {
    setJournalState(j);
    saveJournal(j);
  };
  const [sync, setSync] = useState<SyncState>({ busy: false, done: 0, total: 0, label: '' });

  useEffect(() => {
    loadJournal().then(setJournalState);
    loadDataset().then((d) => {
      setDs(d);
      setLoaded(true);
      if (!d) setView('import');
    });
    // Preload Google sign-in so the consent popup can open directly from a click.
    if (loadSettings().googleClientId) loadGis().catch(() => {});
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

  // Training load is derived for every day, then exposed like any other metric.
  const load = useMemo(() => {
    if (!ds) return [];
    const series = loadSeries(ds, settings.age);
    for (const p of series) if (p.load != null && ds.days[p.date]) ds.days[p.date].trainingLoad = p.load;
    return series;
  }, [ds, settings.age]);
  const days = useMemo(() => (ds ? denseDays(ds, effRange.from, effRange.to) : []), [ds, effRange, load]);
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
    // A demo journal must not leak into real data.
    if (journal.demo && !next.source.includes('Demo data')) setJournal(emptyJournal());
    setDs(next);
    saveDataset(next);
    setRange(null);
  };

  const runSync = async (full = false) => {
    if (sync.busy) return;
    if (!settings.googleClientId) {
      goto('import');
      return;
    }
    setSync({ busy: true, done: 0, total: 0, label: 'Signing in…' });
    try {
      await signIn(settings.googleClientId, !!settings.googleExtraScopes);
      const today = new Date();
      const to = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const live = ds?.source.includes('Google Health (live)');
      // Incremental: re-fetch from 2 days before the last sync (late-arriving data); otherwise the chosen backfill.
      const from = !full && live && settings.googleLastSync
        ? addDays(settings.googleLastSync.slice(0, 10), -2)
        : addDays(to, -(settings.googleFirstSyncDays - 1));
      const { dataset, report } = await syncRange(from, to, (done, total, label) => setSync((s) => ({ ...s, done, total, label })), { extra: !!settings.googleExtraScopes });
      if (!Object.keys(dataset.days).length && report.failed.length) throw new Error(report.failed[0].error);
      const base = ds && !ds.source.includes('Demo data') ? ds : null;
      const merged = base ? mergeDatasets(base, dataset) : dataset;
      deriveSkinTempDelta(merged);
      commit(merged);
      setSettings({ ...settings, googleLastSync: new Date().toISOString() });
      setSync({ busy: false, done: 0, total: 0, label: '', report });
    } catch (e) {
      let msg = (e as Error).message;
      if (e instanceof ApiError && e.status === 403) msg = `Google refused access (${msg}). Check that the Google Health API is enabled, your account is a test user, and you ticked all permissions on the consent screen.`;
      if (e instanceof ApiError && e.status === 401) msg = 'Your Google session expired — click Sync again.';
      setSync({ busy: false, done: 0, total: 0, label: '', error: msg });
    }
  };

  const disconnect = () => {
    signOut();
    setSettings({ ...settings, googleLastSync: undefined });
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
      case 'journal': return <JournalView />;
      case 'training': return <Training />;
      case 'goals': return <Goals />;
      case 'report': return <Report />;
      case 'bioage': return <BioAge />;
      case 'import':
        return (
          <Import
            ds={ds}
            settings={settings}
            setSettings={setSettings}
            onImported={(d, merge) => { commit(merge && ds ? mergeDatasets(ds, d) : d); goto('overview'); }}
            onDemo={() => { const { ds: demo, journal: dj } = makeDemo(); commit(demo); if (journal.demo || !Object.keys(journal.entries).length) setJournal(dj); goto('overview'); }}
            onClear={() => { clearDataset(); setDs(null); }}
            sync={sync}
            onSync={runSync}
            onDisconnect={disconnect}
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
            {settings.googleClientId && (ds?.source.includes('Google Health (live)') || settings.googleLastSync) && (
              <button className="sync-btn" onClick={() => runSync()} disabled={sync.busy} title={settings.googleLastSync ? `Last synced ${new Date(settings.googleLastSync).toLocaleString()}` : 'Sync with Google Health'}>
                <span className={sync.busy ? 'spin' : ''} aria-hidden>⟳</span> {sync.busy ? `Syncing ${sync.total ? Math.round((sync.done / sync.total) * 100) + '%' : '…'}` : 'Sync'}
              </button>
            )}
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
          {sync.error && current !== 'import' && <div className="banner error-banner">Sync failed: {sync.error} <button className="link" onClick={() => setSync({ ...sync, error: undefined })}>Dismiss</button></div>}
          {ds?.source.includes('Demo data') && current !== 'import' && (
            <div className="banner">You're viewing <b>synthetic demo data</b>. <button className="link" onClick={() => goto('import')}>Import your own Fitbit export →</button></div>
          )}
          {ds ? (
            <AppCtx.Provider value={{ ds, settings, setSettings, range: effRange, setRange, days, prevDays, bounds, goto, journal, setJournal, load, today: bounds.max }}>
              <ErrorBoundary resetKey={current}>{page}</ErrorBoundary>
            </AppCtx.Provider>
          ) : page}
        </main>
      </div>
    </ThemeCtx.Provider>
  );
}
