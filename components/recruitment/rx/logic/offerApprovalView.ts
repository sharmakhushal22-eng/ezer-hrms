/**
 * View models for the redesigned Offer Approval stage
 * (tab key `offerapproval`, component `OfferApprovalTab`).
 *
 * PRESENTATION ONLY.
 *  - Nothing here reads or writes: no Supabase, no fetch, no route. Every
 *    loader, the eligibility rule (`acceptedIds`), the re-create gate
 *    (`activeReq`) and the filters stay in `OfferApprovalTab`.
 *  - No arithmetic. The container composes each status sentence with its
 *    existing wording and hands it over as a node.
 *
 * The three-step trail below mirrors `chainFor` in the container exactly,
 * including its one subtlety: a sent-back request leaves the third step blank
 * rather than current, because nothing is waiting to be sent.
 */

import type { ReactNode } from 'react';

/** `offer_approval_requests.status`, plus NONE for "no request raised yet". */
export type OaStatus =
  | 'NONE'
  | 'SUBMITTED'
  | 'HR_HEAD_APPROVED'
  | 'OFFER_SENT'
  | 'HR_HEAD_REJECTED';

/** How one step of the Raised → HR Head → Ready to send trail is drawn. */
export type OaStepState = 'done' | 'now' | 'blocked' | 'todo';

export interface OaTrailStep {
  label: string;
  /** What happened, or who it waits on. Never a bare dash. */
  note: string;
  state: OaStepState;
}

export interface OaCandidateVM {
  id: string;
  name: string;
  /** Designation, already resolved by the container. */
  role: string;
  stage: string;
  mrfNumber: string | null;
  /** `candidate.offer_revised`. */
  revised: boolean;

  status: OaStatus;
  /** The container's own STATUS_LABEL entry, unchanged. */
  statusLabel: string;
  /** The container's status sentence, with its wording and bold runs intact. */
  statusDetail: ReactNode;

  /** False once a request is live — the re-create gate, decided by the container. */
  canRaise: boolean;
  /** 'Create request' or 'Re-create request', as the container decides. */
  raiseLabel: string;

  trail: OaTrailStep[];
}

export type OaGroupKey = 'back' | 'raise' | 'waiting' | 'done';
export type OaTone = 'crit' | 'brand' | 'warn' | 'pos';

export interface OaGroup {
  key: OaGroupKey;
  title: string;
  hint: string;
  tone: OaTone;
  rows: OaCandidateVM[];
}

/** Which bucket a status belongs to. Urgency order is fixed by GROUP_ORDER. */
export function oaGroupOf(status: OaStatus): OaGroupKey {
  if (status === 'HR_HEAD_REJECTED') return 'back';
  if (status === 'NONE') return 'raise';
  if (status === 'SUBMITTED') return 'waiting';
  return 'done';
}

/** Most urgent first: what came back to you, then what you have not raised. */
const GROUP_ORDER: { key: OaGroupKey; title: string; hint: string; tone: OaTone }[] = [
  {
    key: 'back',
    title: 'Sent back to you',
    hint: 'The HR Head returned these. Address the comment, then raise it again.',
    tone: 'crit',
  },
  {
    key: 'raise',
    title: 'Raise the request',
    hint: 'The candidate accepted their salary. Send it for sign-off.',
    tone: 'brand',
  },
  {
    key: 'waiting',
    title: 'Waiting on the HR Head',
    hint: 'Nothing for you to do until they act.',
    tone: 'warn',
  },
  {
    key: 'done',
    title: 'Signed off',
    hint: 'Approved. The letter itself goes out from Offer Letters.',
    tone: 'pos',
  },
];

/** Buckets the rows, dropping any group that would render empty. */
export function oaGroups(rows: OaCandidateVM[]): OaGroup[] {
  return GROUP_ORDER.map(g => ({
    ...g,
    rows: rows.filter(r => oaGroupOf(r.status) === g.key),
  })).filter(g => g.rows.length > 0);
}

/**
 * The request's own journey, as the three steps it passes through.
 *
 * Mirrors `chainFor` in the container: HR Head is REJECTED / APPROVED /
 * PENDING, and "Ready to send" stays `todo` behind a rejection rather than
 * becoming current — nothing is waiting to be sent on a request that was
 * turned down.
 */
export function oaTrail(status: OaStatus, raisedOn: string): OaTrailStep[] {
  const signedOff = status === 'HR_HEAD_APPROVED' || status === 'OFFER_SENT';
  const rejected = status === 'HR_HEAD_REJECTED';
  const raised = status !== 'NONE';
  return [
    {
      label: 'Raised',
      note: raised ? raisedOn : 'Not raised yet',
      state: raised ? 'done' : 'now',
    },
    {
      label: 'HR Head',
      note: rejected ? 'Sent back' : signedOff ? 'Approved' : raised ? 'Awaiting sign-off' : 'Not yet',
      state: rejected ? 'blocked' : signedOff ? 'done' : raised ? 'now' : 'todo',
    },
    {
      label: 'Ready to send',
      note: status === 'OFFER_SENT' ? 'Offer sent' : signedOff ? 'In Offer Letters' : 'Not yet',
      state: status === 'OFFER_SENT' ? 'done' : signedOff ? 'now' : 'todo',
    },
  ];
}

/** One counter in the band. `value` is the filter key the container already uses. */
export interface OaCount {
  value: string;
  label: string;
  count: number;
}
