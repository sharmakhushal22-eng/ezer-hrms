'use client';
import * as React from 'react';
import { Icon } from '../icons';
import { RecruitmentHeader, RxPage } from '../Shell';
import { StageRiver } from '../StageRiver';
import { Help, KpiCard, MRF_LABEL, MRF_TONE, MiniBars, Module, PropBar, Ring, Badge } from '../primitives';
import { countByStage, relativeDay, shortTime } from '../logic/derive';
import type { CandidateVM, InterviewVM, MrfVM, TodoItem } from '../logic/types';

/**
 * Replaces DashTab's markup. Read-only: everything comes from loadAll props.
 * The four KPIs keep DashTab's existing definitions:
 *   Total MRFs · Active openings (on approved MRFs) · In pipeline · Joined this month
 * Pass `joinedThisMonth` from DashTab's current calculation rather than recomputing it.
 */
export function DashboardView(props: {
  mrfs: MrfVM[];
  candidates: CandidateVM[];
  stages: readonly string[];
  joinedThisMonth: number;
  todos: TodoItem[];
  /** Optional (NEW): needs an interview_rounds read. Omit to hide the module. */
  interviews?: InterviewVM[];
  onTab: (key: string) => void;
  onOpenCandidate: (id: string) => void;
  onRaiseMrf: () => void;
  onExport?: () => void;
  /** The <TabRail/> element page.tsx builds once. */
  rail: React.ReactNode;
}) {
  const { rail, mrfs, candidates, stages, joinedThisMonth, todos, interviews, onTab, onOpenCandidate, onRaiseMrf, onExport } = props;
  const approved = mrfs.filter((m) => m.status === 'APPROVED');
  const activeOpenings = approved.reduce((a, m) => a + m.openings, 0);
  const filledOnApproved = approved.reduce((a, m) => a + m.filled, 0);
  const pending = mrfs.filter((m) => m.status === 'SUBMITTED').length;
  const { counts, rejected } = countByStage(candidates, stages);
  const inPipeline = counts.reduce((a, c) => a + c.count, 0);
  const statuses = ['APPROVED', 'SUBMITTED', 'ON_HOLD', 'DRAFT', 'REJECTED', 'CLOSED'] as const;
  const color: Record<string, string> = { APPROVED: 'var(--ez-positive)', SUBMITTED: 'var(--ez-info)', ON_HOLD: 'var(--ez-warning)', DRAFT: 'var(--ez-ramp-2)', REJECTED: 'var(--ez-critical)', CLOSED: 'var(--ez-line-strong)' };
  const spread = statuses.map((s) => ({ s, n: mrfs.filter((m) => m.status === s).length }));
  const recent = mrfs.slice(0, 5); // loadAll already orders by created_at desc

  return (
    <RxPage rail={rail} header={
      <RecruitmentHeader
        title="Hiring at a glance"
        subtitle="Every open requisition and every candidate in motion, for the companies you can see."
        help={<Help label="How hiring flows here">
          <p><b>1. Raise an MRF.</b> It goes through its approval chain.</p>
          <p><b>2. Find candidates.</b> Screen resumes with AI or add them by hand, then interview through the stages.</p>
          <p><b>3. Make the offer.</b> Negotiate, get HR Head approval, send it.</p>
          <p><b>4. Bring them in.</b> Collect documents and confirm the joining date.</p>
        </Help>}
        actions={<>{onExport && <button type="button" className="rx-btn" onClick={onExport}><Icon name="download" />Export</button>}
          <button type="button" className="rx-btn p" onClick={onRaiseMrf}><Icon name="plus" />Raise MRF</button></>}
      />}>
      <div className="rx-grid rx-stag">
        {todos.length > 0 && (
          <Module className="s12" tone="dark" title="Your next steps" icon="bolt" meta={`${todos.length} thing${todos.length === 1 ? '' : 's'}, most urgent first`}>
            <div className="rx-todos" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, todos.length)}, minmax(0, 1fr))`, gap: 10 }}>
              {todos.map((t, i) => (
                <button key={i} type="button" className="rx-todo" onClick={() => onTab(t.tab)}>
                  <span className="n" style={{ color: t.tone === 'crit' ? '#F87171' : '#FBBF24' }}>{t.count}</span>
                  <span className="t">{t.title}<span>{t.detail}</span></span>
                  <span className="go">{t.actionLabel}</span>
                </button>
              ))}
            </div>
          </Module>
        )}
        <div className="s3"><KpiCard icon="file" label="Total MRFs" value={mrfs.length} sub={`${approved.length} approved, ${pending} awaiting sign-off`}
          viz={<Ring pct={mrfs.length ? (approved.length / mrfs.length) * 100 : 0} label={`${approved.length}/${mrfs.length}`} tone="pos" />} onClick={() => onTab('mrf')} /></div>
        <div className="s3"><KpiCard icon="brief" iconTone="info" label="Active openings" value={activeOpenings} sub={`${filledOnApproved} filled so far, on approved requisitions`}
          viz={<Ring pct={activeOpenings ? (filledOnApproved / activeOpenings) * 100 : 0} label={`${filledOnApproved}/${activeOpenings}`} />} onClick={() => onTab('jobstatus')} /></div>
        <div className="s3"><KpiCard icon="users" label="In pipeline" value={inPipeline} sub={`${rejected} rejected so far`} viz={<MiniBars values={counts.map((c) => c.count)} />} onClick={() => onTab('pipeline')} /></div>
        <div className="s3"><KpiCard icon="door" iconTone="pos" label="Joined this month" value={joinedThisMonth} valueTone="pos" sub="candidates at the Joined stage" onClick={() => onTab('preonboarding')} /></div>

        <Module className="s12" title="Where candidates are right now" icon="flow"
          actions={<button type="button" className="rx-btn sm" onClick={() => onTab('pipeline')}>Open pipeline</button>}>
          <p className="rx-mod-m" style={{ marginTop: -8, marginBottom: 14 }}>Stages run left to right and a candidate only ever moves forward. Bars are scaled to the busiest stage.</p>
          <StageRiver candidates={candidates} stages={stages} onStage={() => onTab('pipeline')} />
        </Module>

        <Module className="s7" title="Recent requisitions" icon="file" actions={<button type="button" className="rx-btn sm g" onClick={() => onTab('mrf')}>See all</button>}>
          <div className="rx-list">
            {recent.map((m) => (
              <div className="rx-li" key={m.id}>
                <Ring pct={m.openings ? (m.filled / m.openings) * 100 : 0} label={`${m.filled}/${m.openings}`} tone={m.filled * 2 >= m.openings && m.filled > 0 ? 'pos' : undefined} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="rx-row" style={{ gap: 8 }}><span className="rx-name">{m.title}</span><Badge tone={MRF_TONE[m.status]}>{MRF_LABEL[m.status]}</Badge><Badge tone={m.lane === 'Full MRF' ? 'brand' : 'mute'} dot={false}>{m.lane}</Badge></div>
                  <div className="rx-meta" style={{ marginTop: 3 }}>{m.code} in {m.department}, {m.openings} opening{m.openings === 1 ? '' : 's'}</div>
                </div>
                <div className="rx-meta" style={{ textAlign: 'right' }}>{m.candidates} candidates</div>
              </div>
            ))}
          </div>
        </Module>

        <div className="s5" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {interviews && (
            <Module title="Interviews coming up" icon="cal" meta="next 7 days">
              {interviews.length === 0 ? <p className="rx-meta">Nothing scheduled this week.</p> : (
                <div className="rx-list">
                  {interviews.map((iv, i) => {
                    const rel = relativeDay(iv.at);
                    const soon = rel === 'Today' || rel === 'Tomorrow';
                    const d = new Date(iv.at);
                    return (
                      <button key={i} type="button" className="rx-li" onClick={() => onOpenCandidate(iv.candidateId)} style={{ background: 'none', border: 0, font: 'inherit', color: 'inherit', textAlign: 'left', width: '100%', cursor: 'pointer' }}>
                        <span className={soon ? 'rx-date now' : 'rx-date'}><b>{d.getDate()}</b><span>{new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(d)}</span></span>
                        <span style={{ flex: 1, minWidth: 0 }}><span className="rx-name" style={{ fontSize: 13.5, display: 'block' }}>{iv.candidateName}</span><span className="rx-meta" style={{ fontSize: 12 }}>{iv.roundName} with {iv.interviewer}</span></span>
                        <span style={{ textAlign: 'right' }}><span className="rx-num" style={{ fontWeight: 650, fontSize: 13, display: 'block' }}>{shortTime(iv.at)}</span><span className="rx-meta" style={{ fontSize: 11.5 }}>{rel}</span></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Module>
          )}
          <Module title="Requisition status" icon="chart" meta={`${mrfs.length} total`}>
            <PropBar parts={spread.map(({ s, n }) => ({ value: n, color: color[s], label: MRF_LABEL[s] }))} />
            <div style={{ marginTop: 12 }}>
              {spread.map(({ s, n }) => (
                <div key={s} className="rx-row" style={{ justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--ez-line)' }}>
                  <span className="rx-row" style={{ gap: 9, fontSize: 13 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: color[s] }} />{MRF_LABEL[s]}</span>
                  <b className="rx-num" style={{ fontSize: 14 }}>{n}</b>
                </div>
              ))}
            </div>
          </Module>
        </div>
      </div>
    </RxPage>
  );
}
