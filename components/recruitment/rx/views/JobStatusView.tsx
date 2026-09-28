'use client';
import * as React from 'react';
import { Icon } from '../icons';
import { RecruitmentHeader, RxPage } from '../Shell';
import { Badge, EmptyState, Help, Module, Track } from '../primitives';
import type { MrfVM } from '../logic/types';

/**
 * Replaces JobStatusTab's markup. `standing` MUST come from JobStatusTab's
 * existing calculation — this view only draws it. The recruiter performance
 * table is passed through as-is (its columns are whatever the tab computes today).
 * onShare calls the existing share-report route; onExport the existing export.
 */
export type Standing = 'FILLED' | 'ON_TRACK' | 'WATCH' | 'CRITICAL' | 'BREACHED' | 'NO_DEADLINE' | 'AWAITING' | 'CANCELLED';
const META: Record<Standing, { label: string; tone: 'pos' | 'info' | 'warn' | 'crit' | 'mute' | 'brand'; track?: 'pos' | 'warn' | 'crit' }> = {
  CRITICAL: { label: 'Critical', tone: 'crit', track: 'crit' }, BREACHED: { label: 'Breached', tone: 'crit', track: 'crit' },
  WATCH: { label: 'Watch', tone: 'warn', track: 'warn' }, ON_TRACK: { label: 'On track', tone: 'info' },
  AWAITING: { label: 'Awaiting', tone: 'brand' }, NO_DEADLINE: { label: 'No deadline', tone: 'mute' },
  FILLED: { label: 'Filled', tone: 'pos', track: 'pos' }, CANCELLED: { label: 'Cancelled', tone: 'mute' },
};
const ORDER: Standing[] = ['CRITICAL', 'BREACHED', 'WATCH', 'ON_TRACK', 'AWAITING', 'NO_DEADLINE', 'FILLED', 'CANCELLED'];

export function JobStatusView({ rail, rows, recruiterTable, onOpenMrf, onShare, onExport }: {
  rail?: React.ReactNode;
  rows: { m: MrfVM; standing: Standing; /** e.g. "5 days left" from the existing calc */ note: string; /** 0–100 of the validity window used */ elapsedPct: number }[];
  recruiterTable?: React.ReactNode; onOpenMrf: (id: string) => void; onShare?: () => void; onExport?: () => void;
}) {
  const [f, setF] = React.useState<Standing | '*'>('*');
  const count = (s: Standing) => rows.filter((r) => r.standing === s).length;
  const shown = rows.filter((r) => f === '*' || r.standing === f).sort((a, b) => ORDER.indexOf(a.standing) - ORDER.indexOf(b.standing));
  return (
    <RxPage header={
      <RecruitmentHeader title="Job status" subtitle="Every requisition flagged by where it stands against its deadline, with recruiter performance and a shareable report."
        actions={<>{onShare && <button type="button" className="rx-btn" onClick={onShare}><Icon name="share" />Share report</button>}
          {onExport && <button type="button" className="rx-btn p" onClick={onExport}><Icon name="download" />Export report</button>}</>} />}>
      <div className="rx-grid rx-stag">
        <Module className="s12" title="Deadlines" icon="target" actions={<Help label="What the flags mean" align="right">
          <p><b>Critical</b>: a week or less to the validity date.</p><p><b>Watch</b>: three weeks or less.</p>
          <p><b>Breached</b>: past validity and still unfilled.</p><p><b>Awaiting</b>: not approved yet.</p></Help>}>
          <div role="group" aria-label="Filter by deadline standing" className="rx-stiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(9, minmax(0, 1fr))', gap: 10 }}>
            <button type="button" className="rx-std rx-stile" aria-pressed={f === '*'} onClick={() => setF('*')}><Badge tone="dark" dot={false}>All</Badge><span className="rx-kpi-v">{rows.length}</span></button>
            {ORDER.map((s) => (
              <button key={s} type="button" className="rx-std rx-stile" aria-pressed={f === s} disabled={count(s) === 0} onClick={() => setF(s)}>
                <Badge tone={META[s].tone}>{META[s].label}</Badge><span className="rx-kpi-v">{count(s)}</span>
              </button>
            ))}
          </div>
          <div className="rx-sep" style={{ margin: '18px 0 6px' }} />
          {shown.length === 0 ? <EmptyState title="Nothing here" /> : (
            <div className="rx-list">{shown.map(({ m, standing, note, elapsedPct }) => (
              <button key={m.id} type="button" className="rx-li" onClick={() => onOpenMrf(m.id)} style={{ padding: '14px 10px', background: 'none', border: 0, font: 'inherit', color: 'inherit', textAlign: 'left', width: '100%', cursor: 'pointer' }}>
                <span style={{ width: 280, display: 'block' }}><span className="rx-name" style={{ display: 'block' }}>{m.title}</span><span className="rx-meta">{m.code}</span></span>
                <span style={{ width: 130 }}><Badge tone={META[standing].tone}>{META[standing].label}</Badge></span>
                <span style={{ flex: 1, display: 'block' }}><Track label={`${m.title}: validity window used`} pct={elapsedPct} tone={META[standing].track} /><span className="rx-meta" style={{ fontSize: 12, marginTop: 6, display: 'block' }}>{note}</span></span>
                <span className="rx-meta rx-num" style={{ width: 90, textAlign: 'right' }}>{m.filled} of {m.openings} filled</span>
              </button>))}</div>
          )}
        </Module>
        {recruiterTable && <Module className="s12" title="Recruiter performance" icon="users"><div style={{ overflowX: 'auto' }}>{recruiterTable}</div></Module>}
      </div>
    </RxPage>
  );
}
