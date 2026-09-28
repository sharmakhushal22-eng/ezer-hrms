'use client';
import * as React from 'react';
import { Icon } from '../icons';
import { RecruitmentHeader, RxPage } from '../Shell';
import { MrfCard } from '../cards';
import { Badge, EmptyState, FilterPills, Help, MRF_LABEL, MRF_TONE, Module, NextStepLine, PropBar, SearchBox, Segmented } from '../primitives';
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
  onCreate, onEdit, onView, onMore, onExport, canEdit, onReview, onCloseMrf, onReopen, onDelete }: {
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
  const color: Record<string, string> = { APPROVED: 'var(--ez-positive)', SUBMITTED: 'var(--ez-info)', ON_HOLD: 'var(--ez-warning)', DRAFT: 'var(--ez-ramp-2)', REJECTED: 'var(--ez-critical)', CLOSED: 'var(--ez-line-strong)' };
  const openings = mrfs.reduce((a, m) => a + m.openings, 0);
  const filled = mrfs.reduce((a, m) => a + m.filled, 0);
  const cands = mrfs.reduce((a, m) => a + m.candidates, 0);
  const tiles: [string, number, string?][] = [['Total', mrfs.length], ['Approved', by('APPROVED'), 'var(--ez-positive)'], ['Pending approval', by('SUBMITTED'), 'var(--ez-warning)'], ['Openings', openings], ['Filled', filled, 'var(--ez-brand)'], ['Candidates', cands]];

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
        <Module className="s12" title="Requisition overview" icon="chart" meta={companyLabel && `Company: ${companyLabel}`}>
          <div className="rx-tiles6" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 16 }}>
            {tiles.map(([l, v, c]) => <div key={l} style={{ padding: '4px 0' }}><div className="rx-meta">{l}</div><div className="rx-kpi-v" style={{ fontSize: 36, marginTop: 6, color: c }}>{v}</div></div>)}
          </div>
          <div style={{ margin: '16px 0 14px' }}><PropBar parts={statuses.map((s) => ({ value: by(s), color: color[s], label: MRF_LABEL[s] }))} /></div>
          <FilterPills label="Filter by status" value={ctl.status} onChange={ctl.setStatus}
            options={[{ value: '*', label: 'All', count: mrfs.length }, ...statuses.map((s) => ({ value: s, label: MRF_LABEL[s], count: by(s) }))]} />
        </Module>

        <div className="s12 rx-bar" style={{ gap: 10 }}>
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
          <div className="s12"><div className="rx-grid">
            {ctl.visible.map((m) => (
              <div className="s4" key={m.id}>
                <MrfCard m={m} onView={() => onView(m.id)} onEdit={() => onEdit(m.id)} onMore={onMore ? () => onMore(m.id) : undefined} canEdit={canEdit ? canEdit(m) : true}
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
                  <tr key={m.id}>
                    <td><button type="button" onClick={() => onView(m.id)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 650, color: 'var(--ez-ink)', cursor: 'pointer' }}>{m.title}</button><div className="rx-meta" style={{ fontSize: 12 }}>{m.code}</div></td>
                    <td>{m.department}</td>
                    <td><Badge tone={m.lane === 'Full MRF' ? 'brand' : 'mute'} dot={false}>{m.lane}</Badge></td>
                    <td><Badge tone={MRF_TONE[m.status]}>{MRF_LABEL[m.status]}</Badge></td>
                    <td className="rx-num">{m.filled} of {m.openings}</td>
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
