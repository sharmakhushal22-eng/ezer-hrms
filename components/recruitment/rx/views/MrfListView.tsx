'use client';
import * as React from 'react';
import { Icon } from '../icons';
import { RecruitmentHeader, RxPage } from '../Shell';
import { MrfCard } from '../cards';
import { Badge, EmptyState, Help, MRF_COLOR, MRF_LABEL, MRF_TONE, Module, NextStepLine, SearchBox, Segmented } from '../primitives';
import type { IconName } from '../logic/types';

const STATUS_ICON: Record<string, IconName> = { DRAFT: 'edit', SUBMITTED: 'send', ON_HOLD: 'hourglass', APPROVED: 'check', REJECTED: 'x', CLOSED: 'lock' };
import { formatINR, mrfNextStep } from '../logic/derive';
import { useListControls, useSlashFocus } from '../logic/hooks';
import type { MrfVM } from '../logic/types';

/**
 * Replaces MRFTab's list markup. Every action is the tab's existing handler:
 *  onCreate → opens MrfForm (create path) exactly as today
 *  onEdit   → opens the inline ten-step form (edit path) exactly as today
 *  onView   → opens the existing detail drawer
 *  onMore   → the existing card menu (delete etc.)
 * `filterBar` is the existing company/department/position/location filter bar —
 * pass it through unchanged so its behaviour and any query it drives stay the same.
 *
 * `onReview` / `onCloseMrf` / `onReopen` / `onDelete` are the status-conditional
 * actions the pre-redesign card carried. They are optional here, but the MRF tab
 * passes all four: the redesign restyles the screen, it does not remove what the
 * screen could do.
 *
 * `status` / `onStatusChange` make the status filter CONTROLLED. The tab needs
 * that because its "N awaiting approval · Show them" banner sets the filter from
 * outside this component.
 */
export function MrfListView({ rail, mrfs, companyLabel, filterBar, banner, form, quickHireCap, status, onStatusChange,
  onCreate, onEdit, onView, onMore, onExport, canEdit, candidatesNote, onReview, onCloseMrf, onReopen, onDelete }: {
  rail?: React.ReactNode; mrfs: MrfVM[]; companyLabel?: string; filterBar?: React.ReactNode; banner?: React.ReactNode;
  /**
   * The tab's create/edit form. It has to render INSIDE this frame, between the
   * banner and the overview, because that is where it appears today — pushing it
   * below <MrfListView/> would drop it under the whole page instead of under the
   * "Raise MRF" button that opens it.
   */
  form?: React.ReactNode;
  quickHireCap: number;
  status?: string; onStatusChange?: (v: string) => void;
  onCreate: () => void; onEdit: (id: string) => void; onView: (id: string) => void; onMore?: (id: string) => void; onExport?: () => void;
  /** Optional short line under each card's candidate count, from data already loaded. */
  candidatesNote?: (m: MrfVM) => string | undefined;
  canEdit?: (m: MrfVM) => boolean;
  onReview?: (id: string) => void; onCloseMrf?: (id: string) => void; onReopen?: (id: string) => void; onDelete?: (id: string) => void;
}) {
  const ctl = useListControls(mrfs, {
    text: (m) => `${m.title} ${m.code} ${m.department} ${m.location}`,
    status: (m) => m.status,
    defaultView: 'cards' as 'cards' | 'table',
    statusValue: status,
    onStatusChange,
  });
  const search = React.useRef<HTMLInputElement>(null);
  useSlashFocus(search);
  const by = (s: string) => mrfs.filter((m) => m.status === s).length;
  const statuses = ['DRAFT', 'SUBMITTED', 'ON_HOLD', 'APPROVED', 'REJECTED', 'CLOSED'];
  const openings = mrfs.reduce((a, m) => a + m.openings, 0);
  const filled = mrfs.reduce((a, m) => a + m.filled, 0);
  const cands = mrfs.reduce((a, m) => a + m.candidates, 0);

  return (
    <RxPage header={
      <RecruitmentHeader title="Manpower requisitions" subtitle="Raise, approve and track every hiring request."
        help={<Help label="Quick Hire or Full MRF?">
          <p><b>Quick Hire</b> is for roles up to {formatINR(quickHireCap)} a year.</p>
          <p><b>Full MRF</b> is for anything above that and runs the full approval chain.</p>
          <p>Monthly stipends are annualised before the check, and the form tells you before you submit if the salary does not match the lane.</p>
        </Help>}
        actions={<>{onExport && <button type="button" className="rx-btn" onClick={onExport}><Icon name="download" />Export</button>}
          <button type="button" className="rx-btn p" onClick={onCreate}><Icon name="plus" />Raise MRF</button></>} />}>
      <div className="rx-grid rx-stag">
        {banner && <div className="s12">{banner}</div>}
        {form && <div className="s12">{form}</div>}
        {/* The hero tile and the six status tiles ARE the status filter. They drive
            ctl.setStatus, which this view keeps CONTROLLED by the tab — the
            "N awaiting approval · Show them" banner sets the same filter from
            outside, and an uncontrolled hook would move the tiles without
            filtering anything. */}
        <div className="s12 rx-ov" role="group" aria-label="Filter by status">
          <button type="button" className="rx-hero" aria-pressed={ctl.status === '*'} onClick={() => ctl.setStatus('*')}>
            <span className="rx-hero-l">All requisitions{companyLabel ? `, ${companyLabel}` : ''}</span>
            <span className="rx-hero-n">{mrfs.length}</span>
            <span className="rx-hero-s"><div><b>{openings}</b><span>openings</span></div><div><b>{filled}</b><span>filled</span></div><div><b>{cands}</b><span>candidates</span></div></span>
          </button>
          {statuses.map((st) => (
            <button key={st} type="button" className="rx-stt" aria-pressed={ctl.status === st} disabled={by(st) === 0}
              onClick={() => ctl.setStatus(ctl.status === st ? '*' : st)} style={{ ['--st' as string]: MRF_COLOR[st] }}>
              <span className="rx-stt-ic"><Icon name={STATUS_ICON[st]} /></span>
              <span className="rx-stt-n">{by(st)}</span>
              <span className="rx-stt-l">{MRF_LABEL[st]}</span>
              <span className="rx-stt-bar"><i style={{ width: `${mrfs.length ? Math.round((by(st) / mrfs.length) * 100) : 0}%` }} /></span>
            </button>
          ))}
        </div>

        <div className="s12 rx-ctrl">
          <SearchBox ref={search} value={ctl.query} onChange={ctl.setQuery} placeholder="Search title, MRF number or department" label="Search requisitions" />
          {filterBar}
          <Segmented label="Layout" value={ctl.view} onChange={ctl.setView} options={[{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }]} />
        </div>
        <div className="s12 rx-active" aria-live="polite">
          {ctl.visible.length === ctl.total ? `Showing all ${ctl.total} requisitions` : `Showing ${ctl.visible.length} of ${ctl.total} requisitions`}
          {ctl.filtered && <button type="button" className="rx-btn sm g" onClick={ctl.clear}>Clear filters</button>}
        </div>

        {ctl.visible.length === 0 ? (
          <div className="s12"><EmptyState title="No requisitions match" hint="Try another status or clear the search."
            action={<button type="button" className="rx-btn sm" onClick={ctl.clear}>Clear filters</button>} /></div>
        ) : ctl.view === 'cards' ? (
          <div className="s12"><h2 className="sr-only">Requisitions</h2><div className="rx-grid">
            {ctl.visible.map((m) => (
              <div className="s4" key={m.id}>
                <MrfCard m={m} onView={() => onView(m.id)} onEdit={() => onEdit(m.id)} onMore={onMore ? () => onMore(m.id) : undefined} canEdit={canEdit ? canEdit(m) : true} candidatesNote={candidatesNote?.(m)}
                  onReview={onReview ? () => onReview(m.id) : undefined}
                  onCloseMrf={onCloseMrf ? () => onCloseMrf(m.id) : undefined}
                  onReopen={onReopen ? () => onReopen(m.id) : undefined}
                  onDelete={onDelete ? () => onDelete(m.id) : undefined} />
              </div>
            ))}
          </div></div>
        ) : (
          <Module className="s12" >
            <div style={{ overflowX: 'auto' }}>
              <table className="rx-table">
                <thead><tr><th>Requisition</th><th>Department</th><th>Lane</th><th>Status</th><th>Filled</th><th>Candidates</th><th>Recruiter</th><th>Next step</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{ctl.visible.map((m) => (
                  <tr key={m.id} style={{ ['--st' as string]: MRF_COLOR[m.status] }}>
                    <td><span className="rx-sdot" /><button type="button" onClick={() => onView(m.id)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 650, color: 'var(--ez-ink)', cursor: 'pointer' }}>{m.title}</button><div className="rx-meta" style={{ fontSize: 12 }}>{m.code}</div></td>
                    <td>{m.department}</td>
                    <td><Badge tone={m.lane === 'Full MRF' ? 'brand' : 'mute'} dot={false}>{m.lane}</Badge></td>
                    <td><Badge tone={MRF_TONE[m.status]}>{MRF_LABEL[m.status]}</Badge></td>
                    <td style={{ minWidth: 120 }}><div className="rx-row" style={{ gap: 8 }}><span className="rx-num" style={{ fontWeight: 650 }}>{m.filled}/{m.openings}</span><span className="rx-mt-bar" role="progressbar" aria-label={`${m.title}: ${m.filled} of ${m.openings} filled`} aria-valuenow={m.openings ? Math.round((m.filled / m.openings) * 100) : 0} aria-valuemin={0} aria-valuemax={100} style={{ flex: 1, margin: 0 }}><i style={{ width: `${m.openings ? (m.filled / m.openings) * 100 : 0}%` }} /></span></div></td>
                    <td className="rx-num">{m.candidates}</td>
                    {/* The pre-redesign table carried a Recruiter column; keeping it
                        means the list view loses nothing to the card view. */}
                    <td className="rx-meta">{m.recruiterEmail || (m.recruiterInitials.length ? m.recruiterInitials.join(', ') : '—')}</td>
                    <td><NextStepLine step={mrfNextStep(m)} compact /></td>
                    <td>
                      <div className="rx-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {/* Review was the pre-redesign table's only action; it stays. */}
                        {onReview && (m.status === 'SUBMITTED' || m.status === 'ON_HOLD') && (
                          <button type="button" className="rx-btn sm p" onClick={() => onReview(m.id)}><Icon name="check" />Review</button>)}
                        {(!canEdit || canEdit(m)) && <button type="button" className="rx-btn sm" onClick={() => onEdit(m.id)}><Icon name="edit" />Edit</button>}
                      </div>
                    </td>
                  </tr>))}</tbody>
              </table>
            </div>
          </Module>
        )}
      </div>
    </RxPage>
  );
}
