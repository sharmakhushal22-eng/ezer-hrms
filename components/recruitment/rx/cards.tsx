'use client';
import * as React from 'react';
import { Icon } from './icons';
import { Avatar, Badge, Chip, MRF_COLOR, MRF_LABEL, MRF_TONE, NextStepLine, Ring, initialsOf, toneFor } from './primitives';
import { useTilt } from './logic/hooks';
import { daysUntil, experienceLabel, formatLakh, mrfNextStep, noticeLabel } from './logic/derive';
import { ApprovalTracker } from './ApprovalTracker';
import type { CandidateVM, MrfVM, NextStep } from './logic/types';

/* ── Requisition card ─────────────────────────────────────────────────
   Buttons call the tab's EXISTING handlers:
   onView → opens the current detail drawer, onEdit → the inline ten-step
   form (edit path), onMore → whatever the card menu does today (delete etc.).

   APPROVAL IS NOT A CARD ACTION. This card used to carry a blue tick button
   that opened a modal which stamped every step of the chain APPROVED in one
   direct write — anyone who could see the card could approve it. The card
   now shows a read-only tracker (who has it, since when) and offers
   "Review request" ONLY when the tab says the viewer is the current approver
   (`canReview`). That opens the approver's review screen, which decides
   through /api/ess/mrf — the server refuses anyone who is not the pending
   approver. */
export function MrfCard({ m, onView, onEdit, onMore, canEdit = true, canDelete = true, canReview = false, canCloseReopen = true, viewerId, candidatesNote, onReview, onCloseMrf, onReopen, onDelete }: {
  m: MrfVM; onView: () => void; onEdit?: () => void; onMore?: () => void; canEdit?: boolean;
  /** Delete is gated separately from edit: the assigned hiring manager may edit
   *  a requisition they are running, but only the raiser or an admin may destroy
   *  it. Defaults true so existing callers are unchanged. */
  canDelete?: boolean;
  /** True only when the viewer is the approver the chain is waiting on (or an
   *  admin override the server will also accept). Defaults FALSE: a caller that
   *  forgets to decide must not hand everyone an approve button again. */
  canReview?: boolean;
  /** Close / re-open are the raiser's or the hiring manager's, not every viewer's. */
  canCloseReopen?: boolean;
  /** The viewer's employee id, so the tracker can say "Now with you". */
  viewerId?: string | null;
  /** Optional short line under the candidate count, from data already loaded. */
  candidatesNote?: string;
  onReview?: () => void; onCloseMrf?: () => void; onReopen?: () => void; onDelete?: () => void;
}) {
  const tilt = useTilt<HTMLElement>();
  const pct = m.openings ? Math.round((m.filled / m.openings) * 100) : 0;
  const d = daysUntil(m.targetDate);
  const urgent = m.status === 'APPROVED' && d !== null && d <= 7 && m.filled < m.openings;
  const next = mrfNextStep(m);
  const budgetAmount = m.budgetLabel ?? (m.budgetMaxRupees != null ? formatLakh(m.budgetMaxRupees, 1) : '-');
  const budgetCaption = m.budgetCaption ?? (m.budgetLabel ? null : m.budgetMaxRupees != null ? 'max per year' : 'Not set');
  const budgetTitle = [budgetAmount, budgetCaption].filter(Boolean).join(' · ');
  return (
    <article ref={tilt} className="rx-mc" style={{ ['--st' as string]: MRF_COLOR[m.status] }}>
      <div className="rx-mc-in">
        {/* The number and the status share the top row; every other badge gets
            its own wrapping row below. Four or five badges beside the number
            squeezed "MRF-2026-40572" onto two lines on a ~300px card. */}
        <div className="rx-mc-top">
          <span className="rx-mc-code" title={m.code}>{m.code}</span>
          <Badge tone={MRF_TONE[m.status] ?? 'mute'}>{MRF_LABEL[m.status] ?? m.status}</Badge>
        </div>
        <div className="rx-mc-flags">
          <Badge tone={m.lane === 'Full MRF' ? 'brand' : 'mute'} dot={false}>{m.lane}</Badge>
          {urgent && <Badge tone="crit" live>{d! < 0 ? 'Past target' : `${d} days left`}</Badge>}
          {/* Past its validity date: a warning the compact card must still carry. */}
          {m.expired && <Badge tone="crit" title="Past its validity date">Expired</Badge>}
          {m.confidential && <Badge tone="dark" dot={false} title="Confidential hiring: visible to the HR Head and HR Manager only">🔒 Confidential</Badge>}
        </div>
        <h3 className="rx-mc-t" title={m.title}>{m.title}</h3>
        <div className="rx-mc-sub"><span title={m.department}><Icon name="building" />{m.department}</span><span title={m.location}><Icon name="pin" />{m.location}</span></div>
        <div className="rx-mc-tiles">
          <div className="rx-mt"><span className="rx-mt-l"><Icon name="target" />Filled</span><b>{m.filled}<small>/{m.openings}</small></b><span className="rx-mt-bar" role="progressbar" aria-label={`${m.title}: ${m.filled} of ${m.openings} filled`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></span></div>
          <div className="rx-mt"><span className="rx-mt-l"><Icon name="users" />Candidates</span><b>{m.candidates}</b>{candidatesNote && <span className="rx-mt-s">{candidatesNote}</span>}</div>
          {/* Budget is a TWO-LINE value: the amount, then its basis ("Stipend ·
              max/mo"). It used to be one 21px string — "Stipend ₹1,00,000/mo
              max" — which ran past the card edge. budgetLabel is pre-formatted
              by the tab with its own compOf/payAmount; formatLakh is only the
              fallback. Both lines ellipsise, and the tile carries the full text
              as its tooltip. */}
          <div className="rx-mt rx-mt-money" title={budgetTitle}><span className="rx-mt-l"><Icon name="wallet" />Budget</span><b className="rx-mt-amt">{budgetAmount}</b>{budgetCaption && <span className="rx-mt-s">{budgetCaption}</span>}</div>
        </div>
        <div className="rx-mc-chain">
          <ApprovalTracker compact steps={m.chain} status={m.status} raisedAt={m.raisedAt} raisedBy={m.raisedBy} viewerId={viewerId}
            trailing={m.recruiterInitials.length > 0
              ? <div className="rx-stack rx-mc-rec" title="Assigned recruiters">{m.recruiterInitials.map((r, i) => <Avatar key={i} initials={r} tone={toneFor(r)} size="sm" />)}</div>
              /* Migration 037 keeps the single assigned_recruiter text for
                 display while the id array holds the real assignment. */
              : m.recruiterEmail ? <span className="rx-meta rx-mc-rec" title={`Assigned: ${m.recruiterEmail}`}>{m.recruiterEmail}</span> : null} />
        </div>
        {m.status === 'REJECTED' && m.remarks && (
          <p className="rx-meta rx-mc-remark" style={{ color: 'var(--ez-critical)' }} title={m.remarks}>Rejected: {m.remarks}</p>
        )}
        {m.status === 'NEEDS_REVISION' && m.remarks && (
          <p className="rx-meta rx-mc-remark" style={{ color: 'var(--ez-warning)' }} title={m.remarks}>Sent back: {m.remarks}</p>
        )}
        <div className="rx-mc-foot">
          {/* While it is in approval (or sent back / rejected / closed) the
              tracker above already says what is happening — repeating it here
              as "Waiting on Riya Nair…" was the same sentence twice. */}
          {(m.status === 'APPROVED' || m.status === 'DRAFT' || m.status === 'ON_HOLD') && (
            <span title={next.text} className="rx-mc-next"><NextStepLine step={next} /></span>)}
          <div className="rx-mc-act">
            {onReview && canReview && (
              <button type="button" className="rx-btn sm p" onClick={onReview} aria-label={`Review the approval request for ${m.title}`} title="It is waiting on you. Open the request to approve, send back or reject">Review request</button>)}
            <button type="button" className="rx-btn g" onClick={onView} aria-label={`View ${m.title}`} title="View"><Icon name="eye" /></button>
            {onCloseMrf && canCloseReopen && m.status === 'APPROVED' && (
              <button type="button" className="rx-btn g" onClick={onCloseMrf} aria-label={`Close ${m.title}`} title="Close MRF"><Icon name="lock" /></button>)}
            {onReopen && canCloseReopen && m.status === 'CLOSED' && (
              <button type="button" className="rx-btn g" onClick={onReopen} aria-label={`Re-open ${m.title}`} title="Re-open"><Icon name="door" /></button>)}
            {canEdit && onEdit && <button type="button" className="rx-btn g" onClick={onEdit} aria-label={`Edit ${m.title}`} title="Edit"><Icon name="edit" /></button>}
            {canDelete && onDelete && <button type="button" className="rx-btn d" onClick={onDelete} aria-label={`Delete ${m.title}`} title="Delete"><Icon name="x" /></button>}
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
          <span className="rx-meta" style={{ fontSize: 12, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.currentRole ?? '-'}</span>
        </span>
      </span>
      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--ez-sunken)' }}>
        <span className="rx-kv"><span>Experience</span><b>{experienceLabel(c.experienceYears)}</b></span>
        <span className="rx-kv"><span>Expects</span><b>{formatLakh(c.expectedCtcRupees, 1)}</b></span>
        <span className="rx-kv"><span>Notice</span><b>{noticeLabel(c.noticeDays)}</b></span>
      </span>
      <span className="rx-row" style={{ justifyContent: 'space-between' }}>
        <span className="rx-meta" style={{ fontSize: 12 }}>{c.source ?? ''}</span>
        <span className="rx-row" style={{ gap: 6 }}>
          {c.confidential && <Badge tone="dark" dot={false} title="Confidential hiring: visible to the HR Head and HR Manager only">🔒 Confidential</Badge>}
          {c.aiScore != null && <Badge tone="pos" dot={false}>AI {c.aiScore}</Badge>}
        </span>
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

/* ── Pipeline candidate card ─────────────────────────────────────────
   One grammar for every post-MRF screen (Send Offers, Offer letters,
   Negotiation, Pre-onboarding): name + MRF tag, a meta line, tags, a status
   line, then a footer pinned to the bottom (margin-top:auto) so the buttons of
   cards in the same grid row line up however much sits above them.
   Purely presentational — callers pass already-formatted content. */
export function MrfTag({ code }: { code?: string | null }) {
  return code ? <span className="rx-mrf" title={`Requisition ${code}`}>{code}</span> : null;
}

/** Joins the parts that exist with " · " — no leading or doubled separators when a field is blank. */
export const metaLine = (...parts: (string | number | null | undefined | false)[]) =>
  parts.filter((p) => p !== null && p !== undefined && p !== false && String(p).trim() !== '' && String(p).trim() !== '—' && String(p).trim() !== '-').join(' · ');

export function CandCard({ name, mrf, badges, meta, tags, status, statusTone, body, actions, onOpen, selected, label }: {
  name: string; mrf?: string | null; badges?: React.ReactNode; meta?: React.ReactNode;
  tags?: React.ReactNode; status?: React.ReactNode; statusTone?: 'pos' | 'warn' | 'crit' | 'info' | '';
  body?: React.ReactNode; actions?: React.ReactNode; onOpen?: () => void; selected?: boolean; label?: string;
}) {
  const click = onOpen ? {
    role: 'button' as const, tabIndex: 0, 'aria-label': label ?? `Open ${name}`,
    onClick: onOpen,
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(); } },
  } : {};
  return (
    <article className={['rx-cc', onOpen && 'is-click', selected && 'is-sel'].filter(Boolean).join(' ')} {...click}>
      <div className="rx-cc-h">
        <div className="rx-cc-id"><span className="rx-cc-n" title={name}>{name}</span><MrfTag code={mrf} /></div>
        {badges && <div className="rx-cc-b">{badges}</div>}
      </div>
      {meta ? <div className="rx-cc-m" title={typeof meta === 'string' ? meta : undefined}>{meta}</div> : null}
      {tags ? <div className="rx-cc-tags">{tags}</div> : null}
      {status ? <div className={['rx-cc-s', statusTone].filter(Boolean).join(' ')}>{status}</div> : null}
      {body}
      {actions ? <div className="rx-cc-f" onClick={(e) => e.stopPropagation()}>{actions}</div> : null}
    </article>
  );
}

/* ── Approval trail ───────────────────────────────────────────────────
   Where an approval sits right now, in one line ("With Riya Nair · HR Head"),
   and the whole chain — who raised it, who approved, who it waits on — in a
   click-open popover, so a tight card never has to carry a column of names. */
export interface TrailStep { label: string; who?: React.ReactNode; when?: string | null; state: 'done' | 'now' | 'no' | 'todo' }
export function ApprovalTrail({ steps, summary, align = 'left' }: { steps: TrailStep[]; summary?: React.ReactNode; align?: 'left' | 'right' }) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    const onDoc = (e: MouseEvent) => { if (el.open && !el.contains(e.target as Node)) el.open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && el.open) { el.open = false; el.querySelector('summary')?.focus(); } };
    document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  const now = steps.find((s) => s.state === 'now');
  const no = steps.find((s) => s.state === 'no');
  const line = summary ?? (no ? <>Sent back at <b>{no.label}</b>{no.who ? <> by <b>{no.who}</b></> : null}</>
    : now ? <>Waiting on <b>{now.who || now.label}</b>{now.who ? <> · {now.label}</> : null}</>
    : <>All steps complete</>);
  return (
    <details className="rx-trail" ref={ref} onClick={(e) => e.stopPropagation()}>
      <summary aria-label="Show the approval trail">
        <span className="rx-trail-dots" aria-hidden="true">{steps.map((s, i) => <i key={i} className={s.state} />)}</span>
        <span className="rx-trail-t">{line}</span>
        <span className="rx-trail-more">Trail</span>
      </summary>
      <div className={align === 'right' ? 'rx-trail-body r' : 'rx-trail-body'}>
        <div className="rx-trail-h">Approval trail</div>
        <ol>
          {steps.map((s, i) => (
            <li key={i} className={`rx-trail-step ${s.state}`}>
              <span className="rx-trail-d">{s.state === 'done' ? <Icon name="check" /> : s.state === 'no' ? <Icon name="x" /> : i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div className="rx-trail-l">{s.label}</div>
                {s.who ? <div className="rx-trail-w">{s.who}</div> : null}
                {s.when ? <div className="rx-trail-when">{s.when}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
