/**
 * View models for the Recruitment & ATS redesign.
 *
 * These are PRESENTATION shapes only. Nothing here is read from or written to
 * Supabase directly — `adapters.ts` maps the rows that `loadAll` already loads
 * (page.tsx) into these shapes. The data flow does not change:
 *
 *   useGrant() → loadAll() → props → adapters → rx views
 */

export type MrfStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'ON_HOLD' | 'REJECTED' | 'CLOSED';
export type Lane = 'Quick Hire' | 'Full MRF';
export type Tone = '' | 'pos' | 'warn' | 'crit' | 'info' | 'mute';

export interface ChainStepVM {
  role: string;
  approverName: string;
  /** Raw status from approval_chain, e.g. APPROVED / PENDING / REJECTED. */
  status: string;
  actedAt?: string | null;
}

export interface MrfVM {
  id: string;
  code: string;
  title: string;
  department: string;
  location: string;
  status: MrfStatus;
  lane: Lane;
  priority?: string | null;
  openings: number;
  /** Candidates of this MRF at the Joined stage. */
  filled: number;
  /** Candidates of this MRF the viewer can see (row scoping already applied by loadAll). */
  candidates: number;
  budgetMaxRupees?: number | null;
  targetDate?: string | null;
  chain: ChainStepVM[];
  recruiterInitials: string[];
  raw: unknown;
}

export interface CandidateVM {
  id: string;
  mrfId: string | null;
  name: string;
  email?: string | null;
  currentRole?: string | null;
  source?: string | null;
  experienceYears?: number | null;
  /** Rupees, as stored. */
  currentCtcRupees?: number | null;
  /** Rupees, as stored. */
  expectedCtcRupees?: number | null;
  noticeDays?: number | null;
  stage: string;
  aiScore?: number | null;
  raw: unknown;
}

export interface RoundVM {
  name: string;
  interviewer: string;
  /** ISO datetime of the round, if scheduled. */
  at?: string | null;
  hasFeedback: boolean;
}

export interface NextStep {
  text: string;
  tone: Tone;
  icon: IconName;
}

export interface TodoItem {
  count: number;
  title: string;
  detail: string;
  tone: 'warn' | 'crit' | 'info';
  actionLabel: string;
  /** Tab key to switch to, from TABS in page.tsx. */
  tab: string;
}

export interface InterviewVM {
  candidateId: string;
  candidateName: string;
  roundName: string;
  interviewer: string;
  at: string;
}

export type IconName =
  | 'grid' | 'file' | 'spark' | 'flow' | 'coin' | 'check' | 'shield' | 'send' | 'mail' | 'door' | 'target'
  | 'plus' | 'search' | 'filter' | 'download' | 'upload' | 'clock' | 'users' | 'brief' | 'x' | 'lock'
  | 'alert' | 'info' | 'link' | 'copy' | 'cal' | 'eye' | 'edit' | 'more' | 'right' | 'chart' | 'share'
  | 'doc' | 'bolt' | 'trend';
