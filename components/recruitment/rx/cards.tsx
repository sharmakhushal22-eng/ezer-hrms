'use client';
import * as React from 'react';
import { Icon } from './icons';
import { ApprovalChain, Avatar, Badge, Chip, MRF_LABEL, MRF_TONE, NextStepLine, Ring, initialsOf, toneFor } from './primitives';
import { chainProgress, daysUntil, experienceLabel, formatLakh, mrfNextStep, noticeLabel } from './logic/derive';
import type { CandidateVM, MrfVM, NextStep } from './logic/types';

/* ── Requisition card ─────────────────────────────────────────────────
   Buttons call the tab's EXISTING handlers:
   onView → opens the current detail drawer, onEdit → the inline ten-step
   form (edit path), onMore → whatever the card menu does today (delete etc.). */
export function MrfCard({ m, onView, onEdit, onMore, canEdit = true, onReview, onCloseMrf, onReopen, onDelete }: {
  m: MrfVM; onView: () => void; onEdit?: () => void; onMore?: () => void; canEdit?: boolean;
  /* The four status-conditional actions the pre-redesign card carried. They are
     optional so a caller can omit them, but the MRF tab passes all four: the
     kit's original three slots (View / Edit / More) had nowhere to put Review,
     Close, Re-open and Delete, and quietly losing them would have removed
     working functionality rather than restyling it. */
  onReview?: () => void; onCloseMrf?: () => void; onReopen?: () => void; onDelete?: () => void;
}) {
  const { done, total } = chainProgress(m);
  const pct = m.openings ? Math.round((m.filled / m.openings) * 100) : 0;
  const d = daysUntil(m.targetDate);
  const urgent = m.status === 'APPROVED' && d !== null && d <= 7 && m.filled < m.openings;
  // Only the facts this requisition actually has, so a sparse MRF shows a short
  // row rather than a line of em dashes.
  const facts = [
    m.employmentType,
    m.workMode,
    m.grade && `Grade ${m.grade}`,
    m.experienceRequired && `Exp ${m.experienceRequired}`,
    m.durationMonths ? `${m.durationMonths} month${m.durationMonths === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[];
  const where = [m.company, m.department, m.location, m.businessUnit].filter(Boolean).join(' · ');
  return (
    <article className="rx-mod rx-lift" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="rx-row" style={{ justifyContent: 'space-between' }}>
        <span className="rx-meta rx-num">{m.code}</span>
        <div className="rx-row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Badge tone={m.lane === 'Full MRF' ? 'brand' : 'mute'} dot={false}>{m.lane}</Badge>
          <Badge tone={MRF_TONE[m.status]}>{MRF_LABEL[m.status]}</Badge>
          {m.expired && <Badge tone="crit" title="Past its validity date">Expired</Badge>}
        </div>
      </div>
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{m.title}</h3>
        <p className="rx-meta" style={{ marginTop: 4 }}>{where || '—'}</p>
      </div>
      <div className="rx-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {/* budgetLabel is pre-formatted by the tab with its own compOf/payAmount,
            so a stipend stays "Stipend ₹15,000/mo" instead of being rendered as
            an annual lakh figure. formatLakh is only the fallback. */}
        {m.budgetLabel ? <Chip>{m.budgetLabel}</Chip>
          : m.budgetMaxRupees != null ? <Chip>{formatLakh(m.budgetMaxRupees, 1)} max</Chip> : null}
        {m.priority && <Chip>Priority {m.priority.toLowerCase()}</Chip>}
        {facts.map((f) => <Chip key={f}>{f}</Chip>)}
        {urgent ? <Badge tone="crit" live>{d! < 0 ? 'Past target date' : `${d} days left`}</Badge>
          : <Chip>{m.targetDate ? `Target ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(m.targetDate))}` : 'No target date'}</Chip>}
      </div>
      {m.skills && <p className="rx-meta" style={{ marginTop: -4 }}>Skills: {m.skills}</p>}
      {m.status === 'REJECTED' && m.remarks && (
        <p className="rx-meta" style={{ marginTop: -4, color: 'var(--ez-critical)' }}>Rejected: {m.remarks}</p>
      )}
      {m.chain.length > 0 && (
        <div style={{ padding: 12, borderRadius: 14, background: 'var(--ez-sunken)', border: '1px solid var(--ez-line)' }}>
          <div className="rx-row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="rx-label">Approval chain</span><span className="rx-meta rx-num">{done} of {total}</span>
          </div>
          <ApprovalChain steps={m.chain} />
        </div>
      )}
      <div className="rx-row" style={{ justifyContent: 'space-between' }}>
        <div className="rx-row">
          <Ring pct={pct} label={`${m.filled}/${m.openings}`} tone={pct >= 50 ? 'pos' : undefined} />
          <div><div className="rx-name">{m.candidates} candidates</div><div className="rx-meta">positions filled</div></div>
        </div>
        {/* Migration 037 keeps the single assigned_recruiter email for display
            while the id array holds the real assignment, so fall back to the
            email rather than claiming "Unassigned" when only the legacy field
            is set. */}
        <div className="rx-stack">
          {m.recruiterInitials.length ? m.recruiterInitials.map((r, i) => <Avatar key={i} initials={r} tone={toneFor(r)} size="sm" />)
            : m.recruiterEmail ? <span className="rx-meta">{m.recruiterEmail}</span>
            : <span className="rx-meta rx-dim">Unassigned</span>}
        </div>
      </div>
      <NextStepLine step={mrfNextStep(m)} />
      <div className="rx-row" style={{ gap: 8, borderTop: '1px solid var(--ez-line)', paddingTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="rx-btn sm" onClick={onView}><Icon name="eye" />View</button>
        {onReview && (m.status === 'SUBMITTED' || m.status === 'ON_HOLD') && (
          <button type="button" className="rx-btn sm p" onClick={onReview}><Icon name="check" />Review &amp; Approve</button>)}
        {onCloseMrf && m.status === 'APPROVED' && (
          <button type="button" className="rx-btn sm g" onClick={onCloseMrf}><Icon name="lock" />Close MRF</button>)}
        {onReopen && m.status === 'CLOSED' && (
          <button type="button" className="rx-btn sm ok" onClick={onReopen}><Icon name="door" />Re-open</button>)}
        {canEdit && onEdit && <button type="button" className="rx-btn sm" onClick={onEdit}><Icon name="edit" />Edit</button>}
        <span style={{ flex: 1 }} />
        {/* .d is the kit's own destructive variant. The pre-redesign Delete was
            an unlabelled empty box; it keeps a word here for the same reason. */}
        {onDelete && <button type="button" className="rx-btn sm d" onClick={onDelete}><Icon name="x" />Delete</button>}
        {onMore && <button type="button" className="rx-btn sm ic g" aria-label="More actions" onClick={onMore}><Icon name="more" /></button>}
      </div>
    </article>
  );
}

/* ── Candidate card (pipeline board) ──────────────────────────────── */
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
