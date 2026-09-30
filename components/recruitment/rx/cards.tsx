'use client';
import * as React from 'react';
import { Icon } from './icons';
import { Avatar, Badge, Chip, MRF_COLOR, MRF_LABEL, MRF_TONE, NextStepLine, Ring, initialsOf, toneFor } from './primitives';
import { useTilt } from './logic/hooks';
import { chainProgress, daysUntil, experienceLabel, formatLakh, mrfNextStep, noticeLabel } from './logic/derive';
import type { CandidateVM, MrfVM, NextStep } from './logic/types';

/* ── Requisition card ─────────────────────────────────────────────────
   Buttons call the tab's EXISTING handlers:
   onView → opens the current detail drawer, onEdit → the inline ten-step
   form (edit path), onMore → whatever the card menu does today (delete etc.). */
export function MrfCard({ m, onView, onEdit, onMore, canEdit = true, candidatesNote, onReview, onCloseMrf, onReopen, onDelete }: {
  m: MrfVM; onView: () => void; onEdit?: () => void; onMore?: () => void; canEdit?: boolean;
  /** Optional short line under the candidate count, from data already loaded. */
  candidatesNote?: string;
  /* The four status-conditional actions the pre-redesign card carried. The kit's
     v2 footer offers only View / Edit / More, so they are re-added here as icon
     buttons: the redesign restyles the screen, it does not remove what the
     screen could do. Each keeps the status condition it had before. */
  onReview?: () => void; onCloseMrf?: () => void; onReopen?: () => void; onDelete?: () => void;
}) {
  const tilt = useTilt<HTMLElement>();
  const { done, total, waiting, refused } = chainProgress(m);
  const pct = m.openings ? Math.round((m.filled / m.openings) * 100) : 0;
  const d = daysUntil(m.targetDate);
  const urgent = m.status === 'APPROVED' && d !== null && d <= 7 && m.filled < m.openings;
  const next = mrfNextStep(m);
  const chainText = m.status === 'DRAFT' ? <>Not submitted yet</>
    : refused ? <><b>{refused.approverName}</b> ({refused.role}) put it on hold</>
    : waiting ? <>Waiting on <b>{waiting.approverName}</b>, {waiting.role}</>
    : total ? <><b>Approved</b> by all {done}</> : <>No approval chain</>;
  return (
    <article ref={tilt} className="rx-mc" style={{ ['--st' as string]: MRF_COLOR[m.status] }}>
      <div className="rx-mc-in">
        <div className="rx-mc-top">
          <span className="rx-mc-code">{m.code}</span>
          {/* Wraps, because this row carries FOUR badges here, not the kit's
              three: `expired` is kept so a compact card still warns that a
              requisition is past its validity date. Four nowrap badges ran the
              card 5px past the viewport — the pre-redesign card wrapped this
              row for the same reason and v2 dropped it. */}
          <div className="rx-row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {urgent && <Badge tone="crit" live>{d! < 0 ? 'Past target' : `${d} days left`}</Badge>}
            {/* Past its validity date: a warning the compact card must still carry. */}
            {m.expired && <Badge tone="crit" title="Past its validity date">Expired</Badge>}
            <Badge tone={m.lane === 'Full MRF' ? 'brand' : 'mute'} dot={false}>{m.lane}</Badge>
            <Badge tone={MRF_TONE[m.status]}>{MRF_LABEL[m.status]}</Badge>
          </div>
        </div>
        <h3 className="rx-mc-t">{m.title}</h3>
        <div className="rx-mc-sub"><span><Icon name="building" />{m.department}</span><span><Icon name="pin" />{m.location}</span></div>
        <div className="rx-mc-tiles">
          <div className="rx-mt"><span className="rx-mt-l"><Icon name="target" />Filled</span><b>{m.filled}<small>/{m.openings}</small></b><span className="rx-mt-bar" role="progressbar" aria-label={`${m.title}: ${m.filled} of ${m.openings} filled`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></span></div>
          <div className="rx-mt"><span className="rx-mt-l"><Icon name="users" />Candidates</span><b>{m.candidates}</b>{candidatesNote && <span className="rx-mt-s">{candidatesNote}</span>}</div>
          {/* budgetLabel is pre-formatted by the tab with its own compOf/payAmount,
              so a stipend stays "Stipend ₹15,000/mo" rather than being rendered as
              an annual lakh figure. formatLakh is only the fallback. */}
          <div className="rx-mt"><span className="rx-mt-l"><Icon name="wallet" />Budget</span><b>{m.budgetLabel ?? (m.budgetMaxRupees != null ? formatLakh(m.budgetMaxRupees, 1) : '—')}</b>{!m.budgetLabel && m.budgetMaxRupees != null && <span className="rx-mt-s">max per year</span>}</div>
        </div>
        <div className="rx-mc-chain">
          <div className="rx-cd">{m.chain.map((s, i) => {
            const cls = s.status === 'APPROVED' ? 'ok' : s.status === 'REJECTED' ? 'no' : s === waiting ? 'now' : '';
            return <span key={i} className={cls} title={`${s.role}: ${s.approverName}`}>{cls === 'ok' ? <Icon name="check" /> : cls === 'no' ? <Icon name="x" /> : initialsOf(s.approverName)}</span>;
          })}</div>
          <div className="rx-cd-t">{chainText}</div>
          {/* Migration 037 keeps the single assigned_recruiter email for display
              while the id array holds the real assignment, so fall back to the
              email rather than claiming nothing when only the legacy field is set. */}
          {m.recruiterInitials.length > 0
            ? <div className="rx-stack" style={{ marginLeft: 'auto' }} title="Assigned recruiters">
                {m.recruiterInitials.map((r, i) => <Avatar key={i} initials={r} tone={toneFor(r)} size="sm" />)}</div>
            : m.recruiterEmail ? <span className="rx-meta" style={{ marginLeft: 'auto' }}>{m.recruiterEmail}</span> : null}
        </div>
        {m.status === 'REJECTED' && m.remarks && (
          <p className="rx-meta" style={{ color: 'var(--ez-critical)' }}>Rejected: {m.remarks}</p>
        )}
        <div className="rx-mc-foot">
          <NextStepLine step={next} />
          <div className="rx-mc-act">
            <button type="button" className="rx-btn g" onClick={onView} aria-label={`View ${m.title}`} title="View"><Icon name="eye" /></button>
            {onReview && (m.status === 'SUBMITTED' || m.status === 'ON_HOLD') && (
              <button type="button" className="rx-btn p" onClick={onReview} aria-label={`Review and approve ${m.title}`} title="Review & Approve"><Icon name="check" /></button>)}
            {onCloseMrf && m.status === 'APPROVED' && (
              <button type="button" className="rx-btn g" onClick={onCloseMrf} aria-label={`Close ${m.title}`} title="Close MRF"><Icon name="lock" /></button>)}
            {onReopen && m.status === 'CLOSED' && (
              <button type="button" className="rx-btn g" onClick={onReopen} aria-label={`Re-open ${m.title}`} title="Re-open"><Icon name="door" /></button>)}
            {canEdit && onEdit && <button type="button" className="rx-btn g" onClick={onEdit} aria-label={`Edit ${m.title}`} title="Edit"><Icon name="edit" /></button>}
            {onDelete && <button type="button" className="rx-btn d" onClick={onDelete} aria-label={`Delete ${m.title}`} title="Delete"><Icon name="x" /></button>}
            {onMore && <button type="button" className="rx-btn g" onClick={onMore} aria-label="More actions" title="More"><Icon name="more" /></button>}
          </div>
        </div>
      </div>
    </article>
  );
}

export function CandidateCard({ c, next, onOpen }: { c: CandidateVM; next: NextStep; onOpen: () => void }) {
  return (
    <button type="button" className="rx-card" onClick={onOpen} style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
      <span className="rx-row" style={{ gap: 10 }}>
        <Avatar initials={initialsOf(c.name)} tone={toneFor(c.name)} />
        <span style={{ minWidth: 0, flex: 1, display: 'block' }}>
          <span className="rx-name" style={{ fontSize: 13.5, display: 'block' }}>{c.name}</span>
          <span className="rx-meta" style={{ fontSize: 12, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.currentRole ?? '—'}</span>
        </span>
      </span>
      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--ez-sunken)' }}>
        <span className="rx-kv"><span>Experience</span><b>{experienceLabel(c.experienceYears)}</b></span>
        <span className="rx-kv"><span>Expects</span><b>{formatLakh(c.expectedCtcRupees, 1)}</b></span>
        <span className="rx-kv"><span>Notice</span><b>{noticeLabel(c.noticeDays)}</b></span>
      </span>
      <span className="rx-row" style={{ justifyContent: 'space-between' }}>
        <span className="rx-meta" style={{ fontSize: 12 }}>{c.source ?? ''}</span>
        {c.aiScore != null && <Badge tone="pos" dot={false}>AI {c.aiScore}</Badge>}
      </span>
      <NextStepLine step={next} />
    </button>
  );
}

/* ── AI screening result ─────────────────────────────────────────────
   CORRECTION: the kit's note here said `result` is "exactly what screen-resumes
   returns today". It is not, and following that would have blanked every card.
   The route returns snake_case with different names entirely —
   candidate_name / file_name / match_tag / matched_skills / missing_skills /
   interview_questions — so ScreeningTab maps them explicitly.

   It also returns four things this card originally had nowhere to put, all of
   which are on screen today: reasoning (the AI's own justification — the whole
   point of an AI screen), ats_score, experience_match and education_match.
   They are optional fields below rather than dropped.

   `existing` is kept for API compatibility but CANNOT fire here: it comes from
   existingCandidate(), which matches on email within an MRF, and screen-resumes
   never returns an email. The tab's own `added` flag drives that state instead. */
export interface ScreenResult {
  fileName: string; name?: string | null; email?: string | null; score: number;
  tag: 'STRONG' | 'PARTIAL' | 'NOT_SUITABLE'; matched: string[]; missing: string[]; questions: string[]; error?: string | null;
  reasoning?: string | null;
  atsScore?: number | null;
  experienceMatch?: string | null;
  educationMatch?: string | null;
  /** Set by the tab once the candidate has been inserted into the pipeline. */
  added?: boolean;
}
export function ScreeningResultCard({ r, existing, onAdd, onOpenExisting, onRetry }: {
  r: ScreenResult; existing?: CandidateVM | null; onAdd: () => void; onOpenExisting?: () => void; onRetry?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const tone = r.tag === 'STRONG' ? 'pos' : r.tag === 'PARTIAL' ? 'warn' : 'crit';
  const tagLabel = r.tag === 'STRONG' ? 'Strong' : r.tag === 'PARTIAL' ? 'Partial' : 'Not suitable';
  if (r.error) {
    return (
      <div className="rx-mod" style={{ padding: '16px 18px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <span className="rx-errico"><Icon name="alert" /></span>
        <div style={{ flex: 1 }}><div className="rx-row" style={{ gap: 8 }}><span className="rx-name">{r.fileName}</span><Badge tone="crit">Not suitable</Badge></div>
          <p className="rx-meta" style={{ marginTop: 4 }}>{r.error}. The rest of the batch carried on; re-upload this file to try again.</p></div>
        {onRetry && <button type="button" className="rx-btn sm" onClick={onRetry}><Icon name="upload" />Retry file</button>}
      </div>
    );
  }
  return (
    <div className="rx-mod rx-lift" style={{ padding: '16px 18px', display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      <Ring pct={r.score} label={String(r.score)} tone={tone} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="rx-row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="rx-row" style={{ gap: 8 }}><span className="rx-name" style={{ fontSize: 15 }}>{r.name ?? r.fileName}</span><Badge tone={tone}>{tagLabel}</Badge></div>
            <div className="rx-meta" style={{ marginTop: 3 }}><Icon name="doc" /> {r.fileName}</div>
          </div>
          <div className="rx-row" style={{ gap: 8 }}>
            {r.questions.length > 0 && <button type="button" className="rx-btn sm g" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide questions' : `Questions (${r.questions.length})`}</button>}
            {/* `added` first: it is the state this screen can actually observe.
                `existing` stays for API compatibility but never fires here —
                screen-resumes returns no email for existingCandidate to match. */}
            {r.added
              ? <Badge tone="pos">Added to pipeline</Badge>
              : existing
                ? <><Badge tone="info" title="Matched on email to an existing candidate">Already in pipeline at {existing.stage}</Badge>{onOpenExisting && <button type="button" className="rx-btn sm" onClick={onOpenExisting}>Open candidate</button>}</>
                : <button type="button" className="rx-btn sm p" onClick={onAdd}><Icon name="plus" />Add to pipeline</button>}
          </div>
        </div>
        {/* The AI's own justification. An AI screening tool that hides its
            reasoning is just an unexplained number, so this is not optional
            detail — it is the output. */}
        {r.reasoning && <p className="rx-meta" style={{ margin: 0 }}>{r.reasoning}</p>}
        {(r.atsScore != null || r.experienceMatch || r.educationMatch) && (
          <div className="rx-row" style={{ gap: 14, flexWrap: 'wrap' }}>
            {r.atsScore != null && <span className="rx-meta">Skills match <b className="rx-num">{r.atsScore}%</b> · overall <b className="rx-num">{r.score}</b></span>}
            {r.experienceMatch && <span className="rx-meta">Experience: {r.experienceMatch}</span>}
            {r.educationMatch && <span className="rx-meta">Education: {r.educationMatch}</span>}
          </div>
        )}
        <div className="rx-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {r.matched.length > 0 && <span className="rx-group-l">Matched</span>}
          {r.matched.map((s) => <Chip key={s} variant="ok">{s}</Chip>)}
          {r.missing.length > 0 && <span className="rx-group-l" style={{ marginLeft: 6 }}>Missing</span>}
          {r.missing.map((s) => <Chip key={s} variant="miss">{s}</Chip>)}
        </div>
        {open && <div className="rx-qs">{r.questions.map((q, i) => <div key={i}><b>{i + 1}</b><span>{q}</span></div>)}</div>}
      </div>
    </div>
  );
}
