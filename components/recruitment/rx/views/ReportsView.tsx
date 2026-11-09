'use client';
import * as React from 'react';
import { Icon } from '../icons';
import { RecruitmentHeader, RxPage } from '../Shell';
import { Badge, Callout, Module } from '../primitives';
import type { IconName } from '../logic/types';
import { authHeaders } from '@/lib/auth-headers';

/**
 * Recruitment → Reports. Every report is an Excel download built on the server
 * (app/api/recruitment/reports) from the data the viewer may see — the same company and
 * assigned-MRF scoping the rest of Recruitment uses. The catalogue shows how many rows each
 * report holds for the chosen dates, so an empty download is never a surprise.
 */
type Report = { key: string; title: string; group: string; desc: string; rows: number };
const GROUPS: { k: string; icon: IconName; hint: string }[] = [
  { k: 'Requisitions', icon: 'file', hint: 'MRFs, their ageing and the funnel behind each' },
  { k: 'Candidates', icon: 'users', hint: 'Who is in the pipeline and where they came from' },
  { k: 'Interviews', icon: 'cal', hint: 'Rounds held and how fast interviewers respond' },
  { k: 'Offers', icon: 'coin', hint: 'Negotiation, approval and acceptance' },
  { k: 'Joining', icon: 'door', hint: 'Documents and the road to day one' },
  { k: 'Team', icon: 'chart', hint: 'Recruiter performance and the audit trail' },
];
const PRESETS: { k: string; label: string; days: number | null }[] = [
  { k: 'all', label: 'All time', days: null }, { k: '30', label: 'Last 30 days', days: 30 },
  { k: '90', label: 'Last 90 days', days: 90 }, { k: 'fy', label: 'This financial year', days: -1 },
];
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function presetRange(k: string): { from: string; to: string } {
  const p = PRESETS.find((x) => x.k === k);
  if (!p || p.days === null) return { from: '', to: '' };
  const now = new Date();
  if (p.days === -1) { const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return { from: `${y}-04-01`, to: iso(now) }; }
  return { from: iso(new Date(now.getTime() - p.days * 86400000)), to: iso(now) };
}

export function ReportsView({ companies, canPickCompany }: {
  /** Companies the viewer may narrow to; only shown to a cross-company viewer. */
  companies?: { id: string; company_name?: string | null }[];
  canPickCompany?: boolean;
}) {
  const [preset, setPreset] = React.useState('all');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [reports, setReports] = React.useState<Report[] | null>(null);
  const [scope, setScope] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState<string>('');
  const [done, setDone] = React.useState('');

  const qs = React.useCallback((extra: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (from) p.set('from', from); if (to) p.set('to', to); if (company) p.set('company', company);
    return p.toString();
  }, [from, to, company]);

  React.useEffect(() => {
    let alive = true;
    setErr(''); setReports(null);
    (async () => {
      try {
        const r = await fetch(`/api/recruitment/reports?${qs({ counts: '1' })}`, { headers: await authHeaders(), cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Could not load the reports (${r.status})`);
        if (alive) { setReports(j.reports); setScope(j.scope || ''); }
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [qs]);

  const download = async (key: string, title: string) => {
    setBusy(key); setErr(''); setDone('');
    try {
      const r = await fetch(`/api/recruitment/reports?${qs({ report: key })}`, { headers: await authHeaders(), cache: 'no-store' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Download failed (${r.status})`); }
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || `Recruitment_${key}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setDone(`${title} downloaded.`);
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };

  const pick = (k: string) => { setPreset(k); const r = presetRange(k); setFrom(r.from); setTo(r.to); };
  const total = (reports || []).reduce((a, r) => a + r.rows, 0);
  const field: React.CSSProperties = { height: 38, padding: '0 10px', borderRadius: 10, border: '1px solid var(--ez-line-strong)', background: 'var(--ez-surface)', color: 'var(--ez-ink)', font: 'inherit', fontSize: 13 };

  return (
    <RxPage header={
      <RecruitmentHeader title="Reports" subtitle="Every recruitment report as an Excel workbook: requisitions, candidates, interviews, offers, documents, joining and the team."
        actions={<button type="button" className="rx-btn p" disabled={!!busy || !reports} onClick={() => download('all', 'All reports')}>
          <Icon name="download" />{busy === 'all' ? 'Preparing…' : 'Download all (one workbook)'}</button>} />}>
      <div className="rx-grid rx-stag">
        <Module className="s12" title="Filters" icon="filter" meta={scope ? <span className="rx-meta">Showing: {scope}</span> : undefined}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            <div role="group" aria-label="Date range" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESETS.map((p) => (
                <button key={p.k} type="button" className={`rx-btn sm${preset === p.k ? ' p' : ''}`} aria-pressed={preset === p.k} onClick={() => pick(p.k)}>{p.label}</button>
              ))}
            </div>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--ez-muted)', fontWeight: 600 }}>From
              <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} style={field} /></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--ez-muted)', fontWeight: 600 }}>To
              <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPreset('custom'); }} style={field} /></label>
            {canPickCompany && (companies || []).length > 1 && (
              <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--ez-muted)', fontWeight: 600 }}>Company
                <select value={company} onChange={(e) => setCompany(e.target.value)} style={{ ...field, minWidth: 200 }}>
                  <option value="">All companies</option>
                  {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select></label>
            )}
            <span className="rx-meta" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
              {reports ? `${reports.length} reports · ${total.toLocaleString('en-IN')} rows` : err ? '' : 'Counting…'}
            </span>
          </div>
          <p className="rx-meta" style={{ fontSize: 12, margin: '10px 0 0' }}>The dates filter each report by its own date: when the MRF was raised, the candidate applied, the interview was held, the offer was sent, and so on.</p>
        </Module>

        {err && <div className="s12"><Callout tone="crit" icon="alert">{err}</Callout></div>}
        {done && !err && <div className="s12"><Callout tone="pos" icon="check">{done}</Callout></div>}

        {GROUPS.map((g) => {
          const rs = (reports || []).filter((r) => r.group === g.k);
          if (reports && !rs.length) return null;
          return (
            <Module key={g.k} className="s12" title={g.k} icon={g.icon} meta={<span className="rx-meta">{g.hint}</span>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 12 }}>
                {(reports ? rs : [0, 1].map((i) => ({ key: `sk${g.k}${i}`, title: '', desc: '', rows: -1, group: g.k }))).map((r) => (
                  <div key={r.key} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 16px 14px', borderRadius: 14, border: '1px solid var(--ez-line)',
                    background: 'linear-gradient(180deg, color-mix(in srgb, var(--ez-brand) 5%, var(--ez-surface)), var(--ez-surface) 55%)', minHeight: 150 }}>
                    {r.rows < 0 ? <div className="rx-meta">Loading…</div> : <>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span aria-hidden style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0, background: 'var(--ez-positive-tint)', color: 'var(--ez-positive)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.02em' }}>XLS</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ez-ink)' }}>{r.title}</div>
                          <div style={{ marginTop: 3 }}><Badge tone={r.rows ? 'brand' : 'mute'} dot={false}>{r.rows.toLocaleString('en-IN')} row{r.rows === 1 ? '' : 's'}</Badge></div>
                        </div>
                      </div>
                      <p className="rx-meta" style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0, flex: 1 }}>{r.desc}</p>
                      <div><button type="button" className="rx-btn sm" disabled={!!busy} onClick={() => download(r.key, r.title)} aria-label={`Download ${r.title} as Excel`}>
                        <Icon name="download" />{busy === r.key ? 'Preparing…' : 'Download Excel'}</button></div>
                    </>}
                  </div>
                ))}
              </div>
            </Module>
          );
        })}
      </div>
    </RxPage>
  );
}
