import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Card, Empty, Seg } from '../components/ui';
import { Chart } from '../components/Chart';
import { addDays, WEEKDAYS, weekday } from '../lib/stats';
import { effectSentence, journalDates, tagEffects, tagsOn, type TagEffect } from '../lib/journal';
import { META, fmtMetric } from '../data/metrics';

export function Journal() {
  const { ds, journal, setJournal, today } = useApp();
  const now = new Date();
  const realToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [date, setDate] = useState(realToday > today ? realToday : today);
  const [newTag, setNewTag] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sig, setSig] = useState<'sig' | 'all'>('sig');

  const entry = journal.entries[date];
  const logged = ds.logged?.[date] ?? [];
  const toggle = (t: string) => {
    const cur = entry ?? [];
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
    setJournal({ ...journal, entries: { ...journal.entries, [date]: next } });
  };
  const addTag = () => {
    const t = newTag.trim();
    if (!t || journal.tags.includes(t)) return;
    setJournal({ ...journal, tags: [...journal.tags, t], entries: { ...journal.entries, [date]: [...(entry ?? []), t] } });
    setNewTag('');
  };
  const removeTag = (t: string) => {
    if (!confirm(`Remove “${t}” from your tag list? Past entries keep it.`)) return;
    setJournal({ ...journal, tags: journal.tags.filter((x) => x !== t) });
  };

  const effects = useMemo(() => tagEffects(journal, ds), [journal, ds]);
  const shown = effects.filter((e) => (sig === 'sig' ? e.p < 0.05 : e.p < 0.25)).sort((a, b) => a.p - b.p);
  const byTag = useMemo(() => {
    const m = new Map<string, TagEffect[]>();
    for (const e of shown) m.set(e.tag, [...(m.get(e.tag) ?? []), e]);
    return [...m.entries()];
  }, [shown]);

  const dates = journalDates(journal, ds);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of dates) for (const t of tagsOn(journal, ds, d)) c.set(t, (c.get(t) ?? 0) + 1);
    return c;
  }, [dates, journal, ds]);

  const strip = Array.from({ length: 14 }, (_, i) => addDays(date, i - 13));
  const heat = useMemo(() => {
    const tags = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)).slice(0, 12);
    const last = dates.slice(-60);
    const data: [number, number, number][] = [];
    last.forEach((d, x) => tags.forEach((t, y) => tagsOn(journal, ds, d).includes(t) && data.push([x, y, 1])));
    return { tags, last, data };
  }, [counts, dates, journal, ds]);

  return (
    <div className="grid">
      <Card
        title="Log your day"
        sub="Tap what applied today. Pulse Lab compares that night's sleep and next morning's recovery on days with and without each tag."
        span={2}
        actions={<input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}
      >
        <div className="day-strip">
          {strip.map((d) => {
            const n = (journal.entries[d] ?? []).length;
            return (
              <button key={d} className={`day-chip ${d === date ? 'on' : ''} ${journal.entries[d] ? 'logged' : ''}`} onClick={() => setDate(d)} title={d}>
                <span className="small muted">{WEEKDAYS[weekday(d)].slice(0, 2)}</span>
                <b>{+d.slice(8)}</b>
                <span className="dot-count">{journal.entries[d] ? n || '✓' : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="tags">
          {journal.tags.map((t) => (
            <button key={t} className={`tag ${entry?.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)} onContextMenu={(e) => { e.preventDefault(); removeTag(t); }}>
              {entry?.includes(t) ? '✓ ' : ''}{t}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input placeholder="Add your own tag (e.g. Sauna, Late workout)" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} style={{ flex: 1, minWidth: 180 }} />
          <button onClick={addTag}>Add tag</button>
          <button onClick={() => setJournal({ ...journal, entries: { ...journal.entries, [date]: entry ?? [] } })} disabled={!!entry}>
            {entry ? (entry.length ? `${entry.length} logged` : 'Logged: nothing special') : 'Nothing special today'}
          </button>
        </div>
        {logged.length > 0 && <p className="small muted">From Google Health: {logged.join(', ')}</p>}
        <p className="small muted">Log “nothing special” on ordinary days too — they are the comparison baseline. Long-press a tag to remove it from the list.</p>
      </Card>

      <Card title="Your logging" sub={`${dates.length} days logged`}>
        <ul className="records">
          {[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, showAll ? 99 : 8).map(([t, n]) => (
            <li key={t}><span>{t}</span><b>{n}×</b></li>
          ))}
          {!counts.size && <li className="muted">Nothing logged yet.</li>}
        </ul>
        {counts.size > 8 && <button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : 'Show all'}</button>}
        <p className="small muted">Each tag needs at least 4 days with it and 4 without before effects appear.</p>
      </Card>

      <Card
        title="What works for you"
        sub="Average next-morning outcome after days with vs without each tag (Welch t-test). Green = better for you, red = worse."
        span={3}
        actions={<Seg value={sig} onChange={setSig} options={[{ v: 'sig', l: 'Significant (p<0.05)' }, { v: 'all', l: 'Include trends (p<0.25)' }]} />}
      >
        {byTag.length ? (
          <div className="effects">
            {byTag.map(([tag, es]) => (
              <div key={tag} className="effect-group">
                <h4>{tag} <span className="muted small">· {es[0].n} days</span></h4>
                <ul>
                  {es.map((e) => (
                    <li key={e.metric} className={e.good == null ? '' : e.good ? 'good' : 'bad'}>
                      <span className="ico" aria-hidden>{e.good == null ? '•' : e.good ? '▲' : '▼'}</span>
                      <span>{effectSentence(e)}</span>
                      <span className="muted small"> p {e.p < 0.001 ? '<0.001' : '= ' + e.p.toFixed(3)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <Empty>{dates.length < 10 ? 'Keep logging — effects appear after about two weeks of entries.' : 'No clear effects yet at this threshold. Try “Include trends” or keep logging.'}</Empty>
        )}
        <p className="small muted">These are associations in your own data, not proof of cause. A tag that often co-occurs with another (e.g. alcohol & late meals) can share credit.</p>
      </Card>

      {heat.data.length > 0 && (
        <Card title="Tag timeline" sub="Last 60 logged days" span={3}>
          <Chart
            height={Math.max(180, heat.tags.length * 22 + 70)}
            deps={[heat]}
            option={(t) => ({
              tooltip: { formatter: (p: any) => `${heat.last[p.value[0]]}<br/><b>${heat.tags[p.value[1]]}</b>` },
              grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
              xAxis: { type: 'category', data: heat.last.map((d) => d.slice(5)), axisLabel: { interval: 6 }, splitLine: { show: false } },
              yAxis: { type: 'category', data: heat.tags, inverse: true, splitLine: { show: false } },
              series: [{ type: 'heatmap', data: heat.data, itemStyle: { color: t.series[0], borderColor: t.surface, borderWidth: 2, borderRadius: 3 } }],
            })}
          />
        </Card>
      )}

      {shown.length > 0 && (
        <Card title="Effect sizes" sub="Cohen's d for each tag × outcome shown above (0.2 small, 0.5 medium, 0.8 large)" span={3}>
          <Chart
            height={Math.max(220, shown.length * 22 + 60)}
            deps={[shown]}
            option={(t) => ({
              tooltip: { trigger: 'item', formatter: (p: any) => { const e = shown[p.dataIndex]; return `<b>${e.tag}</b> → ${META[e.metric].label}<br/>${fmtMetric(e.metric, e.withTag)} vs ${fmtMetric(e.metric, e.without)}<br/>d = ${e.d.toFixed(2)}`; } },
              grid: { left: 8, right: 24, top: 8, bottom: 24, containLabel: true },
              xAxis: { type: 'value', name: "Cohen's d", nameLocation: 'middle', nameGap: 22 },
              yAxis: { type: 'category', inverse: true, data: shown.map((e) => `${e.tag} → ${META[e.metric].label}`), axisLabel: { fontSize: 11 }, splitLine: { show: false } },
              series: [{ type: 'bar', barWidth: 12, data: shown.map((e) => ({ value: +e.d.toFixed(2), itemStyle: { color: e.good == null ? t.axis : e.good ? t.good : t.critical, borderRadius: 3 } })), markLine: { symbol: 'none', silent: true, lineStyle: { color: t.muted }, label: { show: false }, data: [{ xAxis: 0 }] } }],
            })}
          />
        </Card>
      )}
    </div>
  );
}
