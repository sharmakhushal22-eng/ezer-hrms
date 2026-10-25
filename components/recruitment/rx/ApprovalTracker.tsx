'use client';
import * as React from 'react';
import { Icon } from './icons';
import { initialsOf } from './primitives';

/* ── MRF approval tracker ─────────────────────────────────────────────
   READ-ONLY. It answers "where is this requisition now, and who has it?"
   and nothing else — no control on it approves, rejects or advances the
   chain. Deciding happens in the approver's own review screen (MRF →
   Approvals, reached from ESS Tasks & Approvals or the card's Review button,
   which is offered to the current approver only), and /api/ess/mrf refuses
   anybody who is not the pending approver.

   The previous strip on the card was a row of tick-shaped dots next to a
   blue tick BUTTON that approved the whole chain in one direct write. This
   replaces the dots' meaning with words, and the button is gone. */

export interface TrackerStep {
  role: string;
  approverId?: string | null;
  approverName: string;
  approverCode?: string | null;
  /** Raw approval_chain status: APPROVED · PENDING · WAITING · REJECTED · REVISION. */
  status: string;
  actedAt?: string | null;
  comment?: string | null;
  /** Set when somebody other than the named approver recorded the decision (admin override). */
  actedByName?: string | null;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

/** approval_chain JSON (array, or a JSON string from an older SDK) → ordered steps. */
export function trackerStepsOf(raw: unknown, nameOf?: (id: string) => string): TrackerStep[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } }
  if (!Array.isArray(arr)) return [];
  return (arr as Row[]).map((s) => {
    const id = str(s.approver_id);
    const resolved = id && nameOf ? nameOf(id) : '';
    return {
      role: str(s.role) ?? 'Approver',
      approverId: id,
      approverName: str(s.approver_name) ?? str(s.actor) ?? (resolved && resolved !== '—' && resolved !== '-' ? resolved : 'Not resolved'),
      approverCode: str(s.approver_code),
      status: (str(s.status) ?? 'PENDING').toUpperCase(),
      actedAt: str(s.acted_at),
      comment: str(s.comment) ?? str(s.comments),
      actedByName: str(s.acted_by_name),
    };
  });
}

/** Chain role codes → words. Unknown roles (older chains) pass through as written. */
export function roleLabel(role: string): string {
  const r = String(role || '').toUpperCase();
  if (r === 'RM2') return 'RM2 · skip-level manager';
  if (r === 'RM1') return 'Reporting manager';
  if (r === 'HR_HEAD') return 'HR Head';
  if (r === 'HOD') return 'Department head';
  if (r === 'HIRING_MANAGER') return 'Hiring manager';
  return role;
}
const roleShort = (role: string) => {
  const r = String(role || '').toUpperCase();
  return r === 'HR_HEAD' ? 'HR Head' : r === 'HIRING_MANAGER' ? 'Hiring manager' : role;
};

// Month names by hand, as derive.ts's fullDate does: en-IN prints September as
// "Sept" in some ICU builds and "Sep" in others.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function trackerDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MON[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/** MRF statuses in which the chain is live, i.e. a PENDING step really is waiting on someone. */
const LIVE = new Set(['SUBMITTED', 'ON_HOLD']);

type StepState = 'done' | 'now' | 'later' | 'rejected' | 'sentback' | 'unrecorded';

function stateOf(s: TrackerStep, mrfStatus: string): StepState {
  if (s.status === 'APPROVED') return 'done';
  if (s.status === 'REJECTED') return 'rejected';
  if (s.status === 'REVISION') return 'sentback';
  const live = LIVE.has(mrfStatus);
  if (s.status === 'PENDING') return live ? 'now' : (mrfStatus === 'APPROVED' || mrfStatus === 'CLOSED') ? 'unrecorded' : 'later';
  // WAITING (or anything unknown) — a later step the chain has not reached.
  return (mrfStatus === 'APPROVED' || mrfStatus === 'CLOSED') ? 'unrecorded' : 'later';
}

export interface TrackerSummary {
  /** One line, plain text — also used as the tooltip. */
  text: string;
  tone: 'pos' | 'warn' | 'crit' | 'mute' | 'info';
  now?: TrackerStep | null;
  since?: string | null;
}

/** "Now with Riya Nair (HR Head) since 22 Oct" — or what happened instead. */
export function trackerSummary(steps: TrackerStep[], mrfStatus: string, opts: { raisedAt?: string | null; raisedBy?: string | null; viewerId?: string | null } = {}): TrackerSummary {
  const st = String(mrfStatus || '').toUpperCase();
  if (st === 'DRAFT') return { text: 'Draft: not sent for approval yet', tone: 'mute' };
  const rejected = steps.find((s) => s.status === 'REJECTED');
  const sentBack = [...steps].reverse().find((s) => s.status === 'REVISION');
  if (st === 'REJECTED') {
    return rejected
      ? { text: `Rejected by ${rejected.approverName} (${roleShort(rejected.role)})${rejected.actedAt ? ` on ${trackerDate(rejected.actedAt)}` : ''}`, tone: 'crit' }
      : { text: 'Rejected', tone: 'crit' };
  }
  if (st === 'NEEDS_REVISION') {
    const who = opts.raisedBy ? opts.raisedBy : 'the raiser';
    return { text: `Back with ${who} for changes${sentBack ? `, sent back by ${sentBack.approverName}${sentBack.actedAt ? ` on ${trackerDate(sentBack.actedAt)}` : ''}` : ''}`, tone: 'warn', since: sentBack?.actedAt ?? null };
  }
  if (LIVE.has(st)) {
    const idx = steps.findIndex((s) => s.status === 'PENDING');
    if (idx < 0) return { text: steps.length ? 'Waiting for approval: no step is marked pending' : 'Waiting for approval: no approver routed', tone: 'warn' };
    const now = steps[idx];
    const prevDone = [...steps.slice(0, idx)].reverse().find((s) => s.status === 'APPROVED' && s.actedAt);
    const since = prevDone?.actedAt ?? opts.raisedAt ?? null;
    const you = !!opts.viewerId && now.approverId === opts.viewerId;
    const hold = st === 'ON_HOLD' ? ' (on hold)' : '';
    return {
      text: `${you ? 'Now with you' : `Now with ${now.approverName}`} (${roleShort(now.role)})${since ? ` since ${trackerDate(since)}` : ''}${hold}`,
      tone: you ? 'info' : 'warn', now, since,
    };
  }
  if (st === 'APPROVED' || st === 'CLOSED') {
    const done = steps.filter((s) => s.status === 'APPROVED');
    const missing = steps.length - done.length;
    const last = [...done].reverse().find((s) => s.actedAt);
    const base = st === 'CLOSED' ? 'Closed' : 'Approved';
    if (!steps.length) return { text: `${base}: no approval chain recorded`, tone: 'mute' };
    if (missing > 0) return { text: `${base}: ${missing} of ${steps.length} approval step${steps.length === 1 ? '' : 's'} never recorded`, tone: 'warn' };
    return { text: `${base} by all ${done.length}${last?.actedAt ? ` · last on ${trackerDate(last.actedAt)}` : ''}`, tone: st === 'CLOSED' ? 'mute' : 'pos' };
  }
  return { text: st ? st.replace(/_/g, ' ').toLowerCase() : '-', tone: 'mute' };
}

const STATE_TEXT: Record<StepState, string> = {
  done: 'Approved', now: 'Waiting', later: 'Not reached yet', rejected: 'Rejected', sentback: 'Sent back', unrecorded: 'Never recorded',
};

function StepRow({ s, state, since, viewerId }: { s: TrackerStep; state: StepState; since?: string | null; viewerId?: string | null }) {
  const you = !!viewerId && s.approverId === viewerId;
  const when = state === 'now' ? (since ? `since ${trackerDate(since)}` : '') : s.actedAt ? trackerDate(s.actedAt) : '';
  return (
    <li className={`rx-trk-step ${state}`}>
      <span className="rx-trk-dot" aria-hidden="true">
        {state === 'done' ? <Icon name="check" /> : state === 'rejected' ? <Icon name="x" /> : state === 'sentback' ? <Icon name="edit" /> : state === 'now' ? <Icon name="hourglass" /> : initialsOf(s.approverName)}
      </span>
      <span className="rx-trk-body">
        <span className="rx-trk-who">
          <b>{you ? 'You' : s.approverName}</b>{s.approverCode && !you ? <span className="rx-trk-code">{s.approverCode}</span> : null}
        </span>
        <span className="rx-trk-role">{roleLabel(s.role)}</span>
        <span className="rx-trk-st">
          <span className={`rx-trk-pill ${state}`}>{STATE_TEXT[state]}</span>{when && <span>{when}</span>}
        </span>
        {state === 'unrecorded' && <span className="rx-trk-note">The requisition was opened without this approver acting.</span>}
        {s.comment && <span className="rx-trk-note">“{s.comment}”</span>}
        {s.actedByName && <span className="rx-trk-note">Recorded by {s.actedByName} (admin override)</span>}
      </span>
    </li>
  );
}

/**
 * compact — the card: one summary line plus the dot strip; the step list opens
 * on click (a disclosure, not a popover, so it never clips at a card edge).
 * Otherwise — the drawer and the decision dialog: the full list, always open.
 */
export function ApprovalTracker({ steps, status, raisedAt, raisedBy, viewerId, compact, trailing }: {
  steps: TrackerStep[]; status: string; raisedAt?: string | null; raisedBy?: string | null; viewerId?: string | null;
  compact?: boolean; trailing?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(!compact);
  const st = String(status || '').toUpperCase();
  const sum = trackerSummary(steps, st, { raisedAt, raisedBy, viewerId });
  const listId = React.useId();
  const states = steps.map((s) => stateOf(s, st));
  const list = steps.length > 0 && (
    <ol className="rx-trk-list" id={listId} aria-label="Approval steps, in order">
      {steps.map((s, i) => <StepRow key={i} s={s} state={states[i]} since={states[i] === 'now' ? sum.since : null} viewerId={viewerId} />)}
    </ol>
  );
  if (!compact) {
    return (
      <div className="rx-trk full">
        <div className={`rx-trk-sum ${sum.tone}`}><Icon name={sum.tone === 'pos' ? 'check' : sum.tone === 'crit' ? 'x' : 'clock'} /><span>{sum.text}</span></div>
        {list || <p className="rx-meta" style={{ margin: 0 }}>No approvers were routed for this requisition.</p>}
      </div>
    );
  }
  return (
    <div className="rx-trk">
      <div className="rx-trk-head">
        <button type="button" className="rx-trk-tog" aria-expanded={open} aria-controls={steps.length ? listId : undefined}
          disabled={!steps.length} onClick={() => setOpen((o) => !o)} title={sum.text}>
          {steps.length > 0 && (
            <span className="rx-cd" aria-hidden="true">{steps.map((s, i) => {
              const k = states[i];
              const cls = k === 'done' ? 'ok' : k === 'rejected' ? 'no' : k === 'now' ? 'now' : k === 'sentback' ? 'back' : k === 'unrecorded' ? 'skip' : '';
              return <span key={i} className={cls}>{k === 'done' ? <Icon name="check" /> : k === 'rejected' ? <Icon name="x" /> : initialsOf(s.approverName)}</span>;
            })}</span>
          )}
          <span className="rx-trk-line">{sum.text}</span>
          {steps.length > 0 && <span className="rx-trk-chev" aria-hidden="true"><Icon name="right" /></span>}
          <span className="sr-only">{open ? 'Hide approval steps' : 'Show approval steps'}</span>
        </button>
        {trailing}
      </div>
      {open && list}
    </div>
  );
}
