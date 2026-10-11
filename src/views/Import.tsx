import { useRef, useState } from 'react';
import type { Dataset, Settings } from '../data/types';
import type { WorkerOut } from '../data/import.worker';
import type { ParseReport } from '../data/takeout';
import { Card, Seg } from '../components/ui';
import type { SyncState } from '../App';

interface Props {
  ds: Dataset | null;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onImported: (ds: Dataset, merge: boolean) => void;
  onDemo: () => void;
  onClear: () => void;
  sync: SyncState;
  onSync: (full?: boolean) => void;
  onDisconnect: () => void;
}

export function Import({ ds, settings, setSettings, onImported, onDemo, onClear, sync, onSync, onDisconnect }: Props) {
  const [busy, setBusy] = useState<{ done: number; total: number; label: string } | null>(null);
  const [report, setReport] = useState<ParseReport | null>(null);
  const [error, setError] = useState('');
  const [merge, setMerge] = useState(true);
  const [drag, setDrag] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  const run = (files: File[]) => {
    if (!files.length) return;
    setError('');
    setReport(null);
    setBusy({ done: 0, total: 1, label: 'Starting…' });
    const w = new Worker(new URL('../data/import.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') setBusy({ done: m.done, total: m.total, label: m.label });
      else if (m.type === 'done') {
        setBusy(null);
        setReport(m.report as ParseReport);
        const result = m.dataset as Dataset;
        if (!Object.keys(result.days).length) setError('No Fitbit data was recognised in those files. Make sure you selected the Takeout ZIP or the extracted "Fitbit" folder.');
        else onImported(result, merge && !!ds && !ds.source.includes('Demo data'));
        w.terminate();
      } else {
        setBusy(null);
        setError(m.message);
        w.terminate();
      }
    };
    w.postMessage({ files: files.map((f) => ({ file: f, path: (f as any).webkitRelativePath || f.name })), intradayOffsetHours: settings.intradayOffsetHours });
  };

  const connected = !!settings.googleLastSync;
  const liveCard = (
    <Card
      title="Live sync with Google Health"
      sub="Pull your latest Fitbit Air data straight from your Google account. Read-only; data goes from Google to this browser only."
      span={3}
    >
      <div className="gh-status">
        <span className={`dot ${connected ? 'on' : ''}`} aria-hidden />
        {connected ? <>Connected · last synced {new Date(settings.googleLastSync!).toLocaleString()}</> : <>Not connected yet</>}
      </div>
      <div className="row">
        <button className="primary" onClick={() => onSync()} disabled={sync.busy || !settings.googleClientId}>
          {sync.busy ? 'Syncing…' : connected ? 'Sync now' : 'Connect & sync'}
        </button>
        {connected && <button onClick={() => onSync(true)} disabled={sync.busy}>Re-sync full history window</button>}
        {connected && <button className="danger" onClick={onDisconnect} disabled={sync.busy}>Disconnect</button>}
      </div>
      {!connected && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted small">First sync covers the last</span>
          <Seg value={settings.googleFirstSyncDays} onChange={(v) => setSettings({ ...settings, googleFirstSyncDays: v })} options={[30, 90, 180, 365].map((v) => ({ v, l: `${v} days` }))} />
        </div>
      )}
      {sync.busy && (
        <div className="progress">
          <div className="bar"><div style={{ width: `${(sync.done / Math.max(1, sync.total)) * 100}%` }} /></div>
          <span className="muted small">{sync.done} / {sync.total} · {sync.label}</span>
        </div>
      )}
      {sync.error && <p className="error">{sync.error}</p>}
      {sync.report && (
        <p className="muted small">
          Synced: {sync.report.ok.join(', ') || 'nothing'}.
          {sync.report.failed.length > 0 && <> Unavailable: {sync.report.failed.map((f) => `${f.what} (${f.error})`).join('; ')}.</>}
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={!!settings.googleExtraScopes} onChange={(e) => setSettings({ ...settings, googleExtraScopes: e.target.checked })} />
        Also sync menstrual cycle, moods &amp; symptoms <span className="muted small">(first add the <code>reproductive_health.readonly</code> and <code>logged_symptoms.readonly</code> scopes in Google Cloud → Data access)</span>
      </label>
      <details className="small" style={{ marginTop: 10 }}>
        <summary className="muted">Advanced: OAuth client ID</summary>
        <div className="form" style={{ marginTop: 8 }}>
          <input className="wide" value={settings.googleClientId} onChange={(e) => setSettings({ ...settings, googleClientId: e.target.value.trim() })} />
          <span className="muted">Google shows an "unverified app" warning because this is your personal test app — click <b>Continue</b>. Sign-ins last about an hour; just click Sync again after that.</span>
        </div>
      </details>
    </Card>
  );

  return (
    <div className="grid">
      {liveCard}
      <Card title="Or import a Google Takeout export" sub="Full history including minute-level data. Processed locally in your browser; nothing is uploaded." span={2}>
        <div
          className={`drop ${drag ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); run([...e.dataTransfer.files]); }}
        >
          <div className="drop-icon" aria-hidden>⬇</div>
          <p><b>Drop your Google Takeout .zip here</b><br /><span className="muted">or individual .json / .csv files from it</span></p>
          <div className="row center">
            <button className="primary" onClick={() => zipInput.current?.click()} disabled={!!busy}>Choose ZIP / files</button>
            <button onClick={() => dirInput.current?.click()} disabled={!!busy}>Choose extracted folder</button>
          </div>
          <input ref={zipInput} type="file" hidden multiple accept=".zip,.json,.csv" onChange={(e) => run([...(e.target.files ?? [])])} />
          <input ref={dirInput} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => run([...(e.target.files ?? [])])} />
          {ds && !ds.source.includes('Demo data') && (
            <label className="check"><input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} /> Merge with existing data (otherwise replace)</label>
          )}
        </div>

        {busy && (
          <div className="progress">
            <div className="bar"><div style={{ width: `${(busy.done / Math.max(1, busy.total)) * 100}%` }} /></div>
            <span className="muted small">{busy.done} / {busy.total} · {busy.label}</span>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {report && (
          <div className="report">
            <h4>Imported</h4>
            <ul>{Object.entries(report.recognised).map(([k, n]) => <li key={k}>{k} <span className="muted">· {n} file{n > 1 ? 's' : ''}</span></li>)}</ul>
            <p className="muted small">{report.skipped} files skipped (not recognised).{report.errors.length ? ` ${report.errors.length} errors: ${report.errors.slice(0, 3).join('; ')}` : ''}</p>
          </div>
        )}
      </Card>

      <Card title="How to export from Google">
        <ol className="steps">
          <li>Go to <a href="https://takeout.google.com" target="_blank" rel="noreferrer">takeout.google.com</a> while signed in to the Google account linked to your Fitbit.</li>
          <li>Click <b>Deselect all</b>, then tick <b>Fitbit</b> (and <b>Google Health</b> if listed).</li>
          <li>Choose <b>Export once</b>, file type <b>.zip</b>, then <b>Create export</b>.</li>
          <li>When the e-mail arrives, download the ZIP and drop it here. Large exports may take a minute to parse.</li>
        </ol>
        <p className="muted small">Already extracted? Use “Choose extracted folder” and pick the <code>Fitbit</code> folder.</p>
      </Card>

      <Card title="Settings" span={2}>
        <div className="form">
          <label>
            <span>Age <span className="muted small">(for heart-rate zones: max HR ≈ 220 − age)</span></span>
            <input type="number" min={10} max={100} value={settings.age} onChange={(e) => setSettings({ ...settings, age: +e.target.value || 35 })} />
          </label>
          <label>
            <span>Intraday time offset (hours) <span className="muted small">Fitbit stores minute-level heart rate &amp; steps in UTC in some exports. If your hourly charts look shifted, set your UTC offset (e.g. +1, −5) and re-import.</span></span>
            <input type="number" min={-14} max={14} step={0.5} value={settings.intradayOffsetHours} onChange={(e) => setSettings({ ...settings, intradayOffsetHours: +e.target.value || 0 })} />
          </label>
          <label>
            <span>Theme</span>
            <select value={settings.theme} onChange={(e) => setSettings({ ...settings, theme: e.target.value as Settings['theme'] })}>
              <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </Card>

      <Card title="Data on this device">
        {ds ? (
          <p>{Object.keys(ds.days).length} days · {ds.sleep.length} sleep logs · {ds.workouts.length} workouts<br /><span className="muted small">Source: {ds.source.join(', ')}</span></p>
        ) : <p className="muted">No data loaded.</p>}
        <div className="row">
          <button onClick={onDemo}>Load demo data</button>
          {ds && <button className="danger" onClick={() => confirm('Delete all imported data from this browser?') && onClear()}>Delete data</button>}
        </div>
      </Card>
    </div>
  );
}
