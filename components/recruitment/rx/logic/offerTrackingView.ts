/**
 * View models for the redesigned Offer Tracking stage
 * (tab key `offers`, component `OffersTab`).
 *
 * PRESENTATION ONLY.
 *  - Nothing here reads or writes. The eligibility rule (HR-Head approved, or
 *    an offer already sent), the three reply writes (markAccepted,
 *    markRevision, markBackout) and every filter stay in `OffersTab`.
 *  - `offerState` itself is NOT duplicated here. The container keeps deriving
 *    the state from the fields the Candidate interface declares, and passes the
 *    answer in -- so the ordering subtlety it documents (awaiting is tested
 *    before revision, because a re-sent revised offer carries both) stays in
 *    one place.
 *
 * The trail uses the same four step states as the Offer Approval screen, so the
 * one set of `.rxn-trail-i[data-state]` rules paints both.
 */

/** The five states `offerState` in the container can return. */
export type OtState = 'notsent' | 'awaiting' | 'accepted' | 'revision' | 'backout';

export type OtStepState = 'done' | 'now' | 'blocked' | 'todo';

export interface OtTrailStep {
  label: string;
  note: string;
  state: OtStepState;
}

export interface OtCandidateVM {
  id: string;
  name: string;
  /** Current employer, as the old card showed it. */
  currentCompany: string;
  /** Pre-formatted by the container, so the lakh wording stays identical. */
  expectedCtcLabel: string;
  mrfNumber: string | null;
  stage: string;
  revised: boolean;
  blacklisted: boolean;

  state: OtState;
  /** True only while the reply can still be recorded -- the container decides. */
  canRecordReply: boolean;
  trail: OtTrailStep[];
}

export type OtTone = 'brand' | 'warn' | 'pos' | 'crit' | 'mute';

export interface OtGroup {
  key: OtState;
  title: string;
  hint: string;
  tone: OtTone;
  rows: OtCandidateVM[];
}

/** One read-out in the band. Counts only -- this screen has never filtered. */
export interface OtCount {
  key: OtState;
  label: string;
  count: number;
  tone: OtTone;
}

/**
 * Two steps, because that is the whole of this stage: it goes out, they reply.
 *
 * A revision or a backout marks the reply step `blocked` rather than `done`:
 * something came back, but not an acceptance, and the two should not read alike
 * at a glance.
 */
export function otTrail(state: OtState, sentOn: string | null): OtTrailStep[] {
  const sent = state !== 'notsent';
  const replyNote =
    state === 'accepted' ? 'Accepted'
    : state === 'backout' ? 'Backed out'
    : state === 'revision' ? 'Revision asked'
    : state === 'awaiting' ? 'Awaiting reply'
    : 'Not yet';
  const replyState: OtStepState =
    state === 'accepted' ? 'done'
    : state === 'backout' || state === 'revision' ? 'blocked'
    : state === 'awaiting' ? 'now'
    : 'todo';
  return [
    { label: 'Sent', note: sent ? (sentOn ?? 'Sent') : 'Not yet', state: sent ? 'done' : 'now' },
    { label: 'Candidate reply', note: replyNote, state: replyState },
  ];
}

/**
 * Most actionable first: offers out with the candidate, then the ones that came
 * back needing something, then what has not gone yet, then the closed ones.
 */
const GROUP_ORDER: { key: OtState; title: string; hint: string; tone: OtTone }[] = [
  {
    key: 'awaiting',
    title: 'Awaiting the candidate’s reply',
    hint: 'The letter has gone out. Record the reply here when it arrives.',
    tone: 'brand',
  },
  {
    key: 'revision',
    title: 'Revision asked',
    hint: 'Back with the HR Head for re-approval, and the requisition is open again.',
    tone: 'warn',
  },
  {
    key: 'notsent',
    title: 'Not sent yet',
    hint: 'Approved by the HR Head. The letter itself goes out from Offer Letters.',
    tone: 'mute',
  },
  {
    key: 'accepted',
    title: 'Accepted',
    hint: 'Moved to Pre-onboarding.',
    tone: 'pos',
  },
  {
    key: 'backout',
    title: 'Backed out',
    hint: 'The candidate declined. The requisition was reopened for hiring.',
    tone: 'crit',
  },
];

/** Buckets the rows, dropping any group that would render empty. */
export function otGroups(rows: OtCandidateVM[]): OtGroup[] {
  return GROUP_ORDER.map(g => ({
    ...g,
    rows: rows.filter(r => r.state === g.key),
  })).filter(g => g.rows.length > 0);
}

/** The tone each read-out carries, keyed by state. */
export const OT_COUNT_TONE: Record<OtState, OtTone> = {
  notsent: 'mute',
  awaiting: 'brand',
  accepted: 'pos',
  revision: 'warn',
  backout: 'crit',
};
