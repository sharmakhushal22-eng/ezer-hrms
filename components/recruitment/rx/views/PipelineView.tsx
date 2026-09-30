'use client';
import * as React from 'react';
import { Icon } from '../icons';
import { RecruitmentHeader, RxPage } from '../Shell';
import { CandidateCard } from '../cards';
import { Avatar, Badge, EmptyState, Help, NextStepLine, SearchBox, Segmented, initialsOf, toneFor } from '../primitives';
import { REJECTED, experienceLabel, formatLakh, noticeLabel } from '../logic/derive';
import { useListControls, useSlashFocus } from '../logic/hooks';
import type { CandidateVM, NextStep } from '../logic/types';

/**
 * Replaces PipelineTab's card list with a stage board + list view.
 * - `candidates` is what PipelineTab already shows (row scoping and the
 *   opening/filter-bar filters already applied — pass `openingSelect` and
 *   `filterBar` through unchanged).
 * - Clicking a card calls onOpen(id), which opens CandidateInterviewModal as today.
 * - onAddCandidate opens the existing eight-section form with its knockout questions.
 * There is no drag-and-drop on purpose: every stage move still goes through
 * moveStage inside the modal, so forward-only and the feedback gate cannot be bypassed.
 */
export function PipelineView({ rail, candidates, stages, nextStepFor, onOpen, onAddCandidate, openingSelect, filterBar, onShowRejected }: {
  rail?: React.ReactNode; candidates: CandidateVM[]; stages: readonly string[]; nextStepFor: (c: CandidateVM) => NextStep;
  onOpen: (id: string) => void; onAddCandidate: () => void; openingSelect?: React.ReactNode; filterBar?: React.ReactNode; onShowRejected?: () => void;
}) {
  const active = candidates.filter((c) => c.stage !== REJECTED);
  const rejected = candidates.length - active.length;
  const ctl = useListControls(active, { text: (c) => `${c.name} ${c.currentRole ?? ''} ${c.source ?? ''}`, defaultView: 'board' as 'board' | 'list' });
  const search = React.useRef<HTMLInputElement>(null);
  useSlashFocus(search);
  const flow = stages.filter((s) => s !== REJECTED);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const CAP = 4;
  const caps = ['var(--ez-ramp-1)', 'var(--ez-ramp-2)', 'var(--ez-ramp-3)', 'var(--ez-ramp-4)', 'var(--ez-ramp-5)', 'var(--ez-ramp-6)'];

  return (
    <RxPage header={
      <RecruitmentHeader title="Candidate pipeline" subtitle="Each card says what to do next; open it to schedule rounds, record feedback and move them on."
        help={<Help label="How stages work">
          <p>Candidates move <b>left to right only</b>. You can skip ahead, but you cannot send someone back a stage.</p>
          <p><b>Moving past Shortlisted</b> needs feedback on every round you scheduled.</p>
          <p><b>Rejected</b> is an outcome, so it sits outside the board.</p>
        </Help>}
        actions={<button type="button" className="rx-btn p" onClick={onAddCandidate}><Icon name="plus" />Add candidate</button>} />}>
      <div className="rx-bar rx-stag" style={{ gap: 10 }}>
        {openingSelect}
        <SearchBox ref={search} value={ctl.query} onChange={ctl.setQuery} placeholder="Search candidate, current role or source" label="Search candidates" />
        {filterBar}
        <Segmented label="Layout" value={ctl.view} onChange={ctl.setView} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
        {onShowRejected && <button type="button" className="rx-filter" onClick={onShowRejected}>Rejected <b>{rejected}</b></button>}
      </div>

      {ctl.visible.length === 0 ? (
        <EmptyState title={active.length ? 'No candidates match' : 'No candidates yet'}
          hint={active.length ? 'Search looks at name, current role and source.' : 'Add one by hand or from AI Screening.'}
          action={active.length ? <button type="button" className="rx-btn sm" onClick={ctl.clear}>Clear search</button> : <button type="button" className="rx-btn sm p" onClick={onAddCandidate}>Add candidate</button>} />
      ) : ctl.view === 'board' ? (
        <>
          <div className="rx-board" role="list" aria-label="Pipeline by stage">
            {flow.map((stage, i) => {
              const inStage = ctl.visible.filter((c) => c.stage === stage);
              const shown = expanded[stage] ? inStage : inStage.slice(0, CAP);
              return (
                <section key={stage} className="rx-col" role="listitem" aria-label={`${stage}, ${inStage.length}`} style={{ ['--rx-cap' as string]: i >= flow.indexOf('Shortlisted') && flow.indexOf('Shortlisted') >= 0 ? 'var(--ez-positive)' : caps[Math.min(i, caps.length - 1)] }}>
                  <div className="rx-col-h"><span>{stage}</span><Badge tone="mute" dot={false}>{inStage.length}</Badge></div>
                  {shown.length === 0 && <div className="rx-meta" style={{ textAlign: 'center', padding: '28px 8px', border: '1px dashed var(--ez-line-strong)', borderRadius: 12 }}>No one here yet.</div>}
                  {shown.map((c) => <CandidateCard key={c.id} c={c} next={nextStepFor(c)} onOpen={() => onOpen(c.id)} />)}
                  {inStage.length > CAP && (
                    <button type="button" className="rx-btn sm g" style={{ width: '100%' }} onClick={() => setExpanded({ ...expanded, [stage]: !expanded[stage] })}>
                      {expanded[stage] ? 'Show fewer' : `Show ${inStage.length - CAP} more`}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
          <p className="rx-hint" style={{ marginTop: -6 }}>Scroll the board sideways, or hold Shift and use the mouse wheel, to reach later stages.</p>
        </>
      ) : (
        <section className="rx-mod" style={{ padding: 12 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="rx-table">
              <thead><tr><th>Candidate</th><th>Current role</th><th>Stage</th><th>Experience</th><th>Expects</th><th>Notice</th><th>AI score</th><th>Next step</th></tr></thead>
              <tbody>{ctl.visible.map((c) => (
                <tr key={c.id}>
                  <td><button type="button" className="rx-row" onClick={() => onOpen(c.id)} style={{ gap: 10, background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}><Avatar initials={initialsOf(c.name)} tone={toneFor(c.name)} size="sm" /><b style={{ color: 'var(--ez-ink)' }}>{c.name}</b></button></td>
                  <td>{c.currentRole ?? '—'}</td>
                  <td><Badge tone="brand" dot={false}>{c.stage}</Badge></td>
                  <td className="rx-num">{experienceLabel(c.experienceYears)}</td>
                  <td className="rx-num">{formatLakh(c.expectedCtcRupees, 1)}</td>
                  <td>{noticeLabel(c.noticeDays)}</td>
                  <td>{c.aiScore != null ? <b className="rx-num">{c.aiScore}</b> : <span className="rx-dim">None</span>}</td>
                  <td><NextStepLine step={nextStepFor(c)} compact /></td>
                </tr>))}</tbody>
            </table>
          </div>
        </section>
      )}
    </RxPage>
  );
}
