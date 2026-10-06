/**
 * Pure display helpers for the redesign.
 *
 * RULE: nothing in this file decides anything the application enforces.
 * The authorities stay where they are in page.tsx:
 *   - moveStage()                → forward-only pipeline + feedback gate
 *   - QUICK_HIRE_CAP check       → lane validation in the MRF form
 *   - canSeeScreen()             → tab visibility
 *   - loadAll() query filters    → row scoping (oversight vs assigned)
 *   - deadline standing          → JobStatusTab's existing calculation
 * These helpers only describe that state to the user, so a wrong answer here
 * can mislabel a card but can never allow an action the app would refuse.
 */
import type { CandidateVM, MrfVM, NextStep, RoundVM, TodoItem } from './types';
// The one place that decides Shortlisted and the offer-flow stages, shared with
// the server route that performs the write. Imported so the reason the picker
// shows is the server's reason rather than a second opinion that can drift.
import { stageGate, type ShortlistFacts } from '@/lib/recruitment/pipeline-gates';

/* ── Money and units ─────────────────────────────────────────────────── */

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹8,04,000 — Indian digit grouping. Input in RUPEES. */
export function formatINR(rupees: number | null | undefined): string {
  if (rupees == null || Number.isNaN(rupees)) return '—';
  return '₹' + inr.format(Math.round(rupees));
}

/** ₹8.04L — compact lakh label. Input in RUPEES. */
export function formatLakh(rupees: number | null | undefined, digits = 2): string {
  if (rupees == null || Number.isNaN(rupees)) return '—';
  const l = rupees / 100000;
  const txt = l.toFixed(digits).replace(/\.?0+$/, ''); // 9.00 → 9, 8.20 → 8.2, 8.04 → 8.04
  return '₹' + txt + 'L';
}

/** The candidate form captures ₹ lakh p.a.; the database stores rupees (DATA-FLOW.md). */
export const lakhToRupees = (lakh: number) => Math.round(lakh * 100000);

/** Monthly stipends are annualised before the Quick Hire comparison (CORE-WORKING.md). */
export const annualise = (amount: number, basis: 'annual' | 'monthly') => (basis === 'monthly' ? amount * 12 : amount);

/** Display-only mirror of the lane rule. The form's own check stays authoritative. */
export function laneFor(annualRupees: number, quickHireCap: number): 'Quick Hire' | 'Full MRF' {
  return annualRupees <= quickHireCap ? 'Quick Hire' : 'Full MRF';
}

export function noticeLabel(days: number | null | undefined): string {
  if (days == null) return '—';
  return days === 0 ? 'Immediate' : `${days} days`;
}

export function experienceLabel(years: number | null | undefined): string {
  if (years == null) return '—';
  return `${years} yr${years === 1 ? '' : 's'}`;
}

/** Both inputs in RUPEES. Convert candidate lakh inputs first with lakhToRupees. */
export function budgetFit(offerRupees: number, budgetMaxRupees: number | null | undefined) {
  if (!budgetMaxRupees) return { known: false as const };
  const diff = offerRupees - budgetMaxRupees;
  return { known: true as const, within: diff <= 0, diff: Math.abs(diff), pctOfCeiling: Math.round((offerRupees / budgetMaxRupees) * 100) };
}

export function hikePct(currentRupees: number | null | undefined, offeredRupees: number): number | null {
  if (!currentRupees) return null;
  return Math.round(((offeredRupees - currentRupees) / currentRupees) * 1000) / 10;
}

/* ── Dates ───────────────────────────────────────────────────────────── */

/**
 * Date-only strings from Postgres `date` columns ("2026-10-02") are calendar
 * days, not instants. `new Date("2026-10-02")` reads them as UTC midnight,
 * which lands on the previous day anywhere west of UTC. Parse them as local.
 */
export function toLocalDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}

export function daysUntil(iso: string | null | undefined, today = new Date()): number | null {
  if (!iso) return null;
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const d = toLocalDate(iso); const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

const dFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const tFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
export const shortDate = (iso: string) => dFmt.format(toLocalDate(iso));
export const shortTime = (iso: string) => tFmt.format(toLocalDate(iso));

export function relativeDay(iso: string, today = new Date()): string {
  const n = daysUntil(iso, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n !== null && n > 1 && n < 7) return new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(toLocalDate(iso));
  return shortDate(iso);
}

/* ── Pipeline ────────────────────────────────────────────────────────── */

export const REJECTED = 'Rejected';

/** Counts per stage, in STAGES order. Rejected is excluded — it is an outcome, not a step. */
export function countByStage(candidates: CandidateVM[], stages: readonly string[]) {
  const flow = stages.filter((s) => s !== REJECTED);
  const counts = flow.map((s) => ({ stage: s, count: candidates.filter((c) => c.stage === s).length }));
  return { counts, rejected: candidates.filter((c) => c.stage === REJECTED).length, max: Math.max(1, ...counts.map((c) => c.count)) };
}

export interface MoveOption { stage: string; allowed: boolean; reason?: string }

/**
 * What the "Move to" picker SHOWS. Every target stays VISIBLE; the ones that are
 * not allowed carry the reason, so a user reads why rather than hunting for a
 * control that isn't there.
 *
 *  - earlier stages are never offered (forward-only)
 *  - Shortlisted and the offer-flow stages are decided by stageGate(), the same
 *    function the server calls — pass `facts` to get those answers
 *  - stages after Shortlisted additionally need feedback on every scheduled round
 *
 * Without `facts` this falls back to the old behaviour, which did not gate
 * Shortlisted at all. That gap, plus moveStage checking nothing but STAGES
 * order, is how a candidate reached Shortlisted after one Telephonic round and
 * Offer Sent with no negotiation. A caller that can measure the facts should
 * always pass them; this stays optional only so a display-only caller with no
 * requisition in hand is not forced to invent one.
 */
export function moveOptions(
  stages: readonly string[],
  current: string,
  rounds: RoundVM[],
  shortlisted = 'Shortlisted',
  facts?: ShortlistFacts,
): MoveOption[] {
  const flow = stages.filter((s) => s !== REJECTED);
  const cur = flow.indexOf(current);
  const gate = flow.indexOf(shortlisted);
  const pending = rounds.filter((r) => !r.hasFeedback);
  return flow.slice(cur + 1).map((stage) => {
    const idx = flow.indexOf(stage);
    // The policy module first: it owns Shortlisted and the offer-flow stages.
    if (facts) {
      const g = stageGate(stage, facts);
      if (!g.ok) return { stage, allowed: false, reason: g.reason };
    }
    if (gate >= 0 && idx > gate && pending.length) {
      return { stage, allowed: false, reason: `Record ${pending[0].name} feedback first` };
    }
    return { stage, allowed: true, reason: idx === cur + 1 ? 'Next stage' : undefined };
  });
}

/** One-line "what to do next" for a candidate card. Needs the candidate's interview_rounds. */
export function candidateNextStep(c: CandidateVM, rounds: RoundVM[] = [], today = new Date()): NextStep {
  const future = rounds.filter((r) => r.at && daysUntil(r.at, today)! >= 0).sort((a, b) => +toLocalDate(a.at!) - +toLocalDate(b.at!));
  const overdue = rounds.find((r) => r.at && daysUntil(r.at, today)! < 0 && !r.hasFeedback);
  if (c.stage === 'Joined') return { text: 'Joined', tone: 'pos', icon: 'check' };
  if (c.stage === 'Offer Sent') return { text: 'Waiting for the candidate to reply', tone: 'mute', icon: 'clock' };
  if (c.stage === 'Shortlisted') return { text: 'Start salary negotiation', tone: '', icon: 'coin' };
  if (overdue) return { text: `${overdue.name} feedback due`, tone: 'warn', icon: 'edit' };
  if (future[0]) return { text: `${future[0].name} ${relativeDay(future[0].at!, today).toLowerCase()} at ${shortTime(future[0].at!)}`, tone: 'mute', icon: 'clock' };
  if (rounds.length && rounds.every((r) => r.hasFeedback)) return { text: 'All feedback in. Ready to move on', tone: 'pos', icon: 'check' };
  return { text: 'Schedule the next round', tone: '', icon: 'cal' };
}

/* ── Requisitions ────────────────────────────────────────────────────── */

export function chainProgress(m: MrfVM) {
  const done = m.chain.filter((s) => s.status === 'APPROVED').length;
  const waiting = m.chain.find((s) => s.status === 'PENDING');
  const refused = m.chain.find((s) => s.status === 'REJECTED');
  return { done, total: m.chain.length, waiting, refused };
}

export function mrfNextStep(m: MrfVM, today = new Date()): NextStep {
  const { waiting, refused } = chainProgress(m);
  const left = Math.max(0, m.openings - m.filled);
  const d = daysUntil(m.targetDate, today);
  if (m.status === 'DRAFT') return { text: 'Draft. Finish the form and submit', tone: '', icon: 'edit' };
  if (m.status === 'SUBMITTED' && waiting) return { text: `Waiting on ${waiting.approverName} to approve as ${waiting.role}`, tone: 'warn', icon: 'clock' };
  if (m.status === 'ON_HOLD') return { text: refused ? `On hold after the ${refused.role} step` : 'On hold', tone: 'mute', icon: 'edit' };
  if (m.status === 'REJECTED') return { text: 'Rejected', tone: 'mute', icon: 'x' };
  if (m.status === 'CLOSED') return { text: 'Closed', tone: 'mute', icon: 'check' };
  if (left === 0) return { text: 'All openings filled', tone: 'pos', icon: 'check' };
  if (d !== null && d <= 7) return { text: `${d < 0 ? 'Past target date' : `${d} days left`}: move a candidate to offer`, tone: 'warn', icon: 'alert' };
  return { text: `${left} opening${left === 1 ? '' : 's'} left, ${m.candidates} candidate${m.candidates === 1 ? '' : 's'} in play`, tone: '', icon: 'flow' };
}

/**
 * "Your next steps" for the dashboard, from data loadAll already has.
 * offerRequestsPending is optional because offer_approval_requests is read by
 * the Offer Approval tab, not loadAll — pass it only if you already have it.
 */
export function dashboardTodos(args: {
  mrfs: MrfVM[];
  viewerName: string;
  offerRequestsPending?: number;
  today?: Date;
}): TodoItem[] {
  const { mrfs, viewerName, offerRequestsPending, today = new Date() } = args;
  const out: TodoItem[] = [];
  const urgent = mrfs.filter((m) => m.status === 'APPROVED' && m.filled < m.openings && (daysUntil(m.targetDate, today) ?? 99) <= 7);
  if (urgent.length) out.push({ count: urgent.length, title: urgent.length === 1 ? `Deadline in ${daysUntil(urgent[0].targetDate, today)} days` : 'Deadlines this week', detail: urgent.map((m) => m.title).join(', '), tone: 'crit', actionLabel: 'Open', tab: 'jobstatus' });
  const mine = mrfs.filter((m) => m.chain.some((s) => s.status === 'PENDING' && s.approverName === viewerName));
  if (mine.length) out.push({ count: mine.length, title: mine.length === 1 ? 'Approve a requisition' : 'Approve requisitions', detail: mine.map((m) => m.title).join(', '), tone: 'warn', actionLabel: 'Review', tab: 'mrf' });
  if (offerRequestsPending) out.push({ count: offerRequestsPending, title: 'Offers awaiting HR Head', detail: 'Pending in Offer Approval', tone: 'warn', actionLabel: 'View', tab: 'offerapproval' });
  return out;
}

/* ── Screening ───────────────────────────────────────────────────────── */

/** Duplicate guard for "Add to pipeline". Matches on email within the same MRF. */
export function existingCandidate(email: string | null | undefined, mrfId: string, candidates: CandidateVM[]) {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return candidates.find((c) => c.mrfId === mrfId && c.email?.trim().toLowerCase() === e) ?? null;
}

/* ── Pre-onboarding ──────────────────────────────────────────────────── */

export function missingDocuments(docs: { name: string; received: boolean }[]) {
  return docs.filter((d) => !d.received).map((d) => d.name);
}
