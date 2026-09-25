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
export function MrfCard({ m, onView, onEdit, onMore, canEdit = true }: {
  m: MrfVM; onView: () => void; onEdit?: () => void; onMore?: () => void; canEdit?: boolean;
}) {
  const { done, total } = chainProgress(m);
  const pct = m.openings ? Math.round((m.filled / m.openings) * 100) : 0;
  const d = daysUntil(m.targetDate);
  const urgent = m.status === 'APPROVED' && d !== null && d <= 7 && m.filled < m.openings;
  return (
    <article className="rx-mod rx-lift" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="rx-row" style={{ justifyContent: 'space-between' }}>
        <span className="rx-meta rx-num">{m.code}</span>
        <div className="rx-row" style={{ gap: 6 }}>
          <Badge tone={m.lane === 'Full MRF' ? 'brand' : 'mute'} dot={false}>{m.lane}</Badge>
          <Badge tone={MRF_TONE[m.status]}>{MRF_LABEL[m.status]}</Badge>
        </div>
      </div>
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{m.title}</h3>
        <p className="rx-meta" style={{ marginTop: 4 }}>{m.department}, {m.location}</p>
      </div>
      <div className="rx-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {m.budgetMaxRupees != null && <Chip>{formatLakh(m.budgetMaxRupees, 1)} max</Chip>}
        {m.priority && <Chip>Priority {m.priority.toLowerCase()}</Chip>}
        {urgent ? <Badge tone="crit" live>{d! < 0 ? 'Past target date' : `${d} days left`}</Badge>
          : <Chip>{m.targetDate ? `Target ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(m.targetDate))}` : 'No target date'}</Chip>}
      </div>
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
        <div className="rx-stack">
          {m.recruiterInitials.length ? m.recruiterInitials.map((r, i) => <Avatar key={i} initials={r} tone={toneFor(r)} size="sm" />) : <span className="rx-meta rx-dim">Unassigned</span>}
        </div>
      </div>
      <NextStepLine step={mrfNextStep(m)} />
      <div className="rx-row" style={{ gap: 8, borderTop: '1px solid var(--ez-line)', paddingTop: 12 }}>
        <button type="button" className="rx-btn sm" onClick={onView}><Icon name="eye" />View</button>
        {canEdit && onEdit && <button type="button" className="rx-btn sm" onClick={onEdit}><Icon name="edit" />Edit</button>}
        <span style={{ flex: 1 }} />
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
   `result` is exactly what screen-resumes returns today. `existing` comes from
   existingCandidate() — when set, the card offers "Open candidate" instead of a
   second insert. onAdd is the tab's current "Add to pipeline" handler. */
export interface ScreenResult {
  fileName: string; name?: string | null; email?: string | null; score: number;
  tag: 'STRONG' | 'PARTIAL' | 'NOT_SUITABLE'; matched: string[]; missing: string[]; questions: string[]; error?: string | null;
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
            {existing
              ? <><Badge tone="info" title="Matched on email to an existing candidate">Already in pipeline at {existing.stage}</Badge>{onOpenExisting && <button type="button" className="rx-btn sm" onClick={onOpenExisting}>Open candidate</button>}</>
              : <button type="button" className="rx-btn sm p" onClick={onAdd}><Icon name="plus" />Add to pipeline</button>}
          </div>
        </div>
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
