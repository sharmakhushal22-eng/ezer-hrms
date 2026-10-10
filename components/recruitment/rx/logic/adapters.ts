/**
 * Row → view-model adapters.
 *
 * Input: the exact arrays loadAll() already puts in state (manpower_requisitions,
 * candidates, departments, locations) plus whatever the tab already has.
 * Output: MrfVM / CandidateVM for the rx components.
 *
 * Column names confirmed by the module docs are used directly. Where the docs do
 * not name a column, `pick()` tries the likely names and every such spot is marked
 * VERIFY — check them once against the table schema and delete the guesses.
 */
import type { CandidateVM, ChainStepVM, Lane, MrfStatus, MrfVM, RoundVM } from './types';
import { laneFor } from './derive';

type Row = Record<string, unknown>;

function pick<T = unknown>(row: Row, keys: string[], fallback: T): T {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k] as T;
  return fallback;
}
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

export interface AdapterContext {
  departments: Row[];          // from loadAll
  locations: Row[];            // from loadAll
  candidates: Row[];           // from loadAll (already row-scoped)
  quickHireCap: number;        // pass QUICK_HIRE_CAP from page.tsx
  /** Resolve an employee/recruiter id to a display name. Use the tab's existing resolver. */
  nameOf: (id: string) => string;
  joinedStage?: string;        // defaults to 'Joined'
  /**
   * Which stages count as a filled position. Defaults to [joinedStage ?? 'Joined'].
   *
   * The MRF tab passes ['Offer Sent', 'Joined'] because that is what its card and
   * its overview have always counted. Leaving it at 'Joined' alone would silently
   * drop every candidate holding an offer out of "filled" — a number moving down
   * with nothing on screen to explain why.
   */
  filledStages?: string[];
  /** Optional: needed only for the company name on the MRF card. */
  companies?: Row[];
  /**
   * Optional: the tab's OWN money formatter. Budget wording depends on
   * employment type (salary p.a. vs stipend/fees per month) and on six currency
   * symbols, all of which live in page.tsx's compOf/payAmount. Re-deriving it
   * here with formatLakh would mislabel every intern and contractor row, so the
   * tab passes its existing formatter instead.
   */
  budgetLabelOf?: (row: Row) => string | null;
}

export function toMrfVM(row: Row, ctx: AdapterContext): MrfVM {
  const id = String(row.id);
  const dept = ctx.departments.find((d) => d.id === row.department_id);
  const loc = ctx.locations.find((l) => l.id === row.location_id);
  const comp = ctx.companies?.find((c) => c.id === row.company_id);
  const status = String(row.status ?? 'DRAFT').toUpperCase();
  const validity = pick<string | null>(row, ['validity_date'], null);
  const expired = !!validity && !['CLOSED', 'REJECTED'].includes(status)
    && new Date(validity) < new Date(new Date().toDateString());
  // RESOLVED: the foreign key is `mrf_id`. There is no `requisition_id` column —
  // loadAll itself scopes candidates with `c.mrf_id`.
  const mine = ctx.candidates.filter((c) => c.mrf_id === id);
  const budgetMax = num(row.budget_max);                                                 // rupees
  // RESOLVED: the stored lane column is `mrf_type`, holding exactly the strings
  // 'Quick Hire' | 'Full MRF'. The kit guessed intake_lane / lane / hire_type,
  // none of which exists, so every MRF would have fallen through to laneFor().
  const lane = pick<string | null>(row, ['mrf_type'], null);
  const chainRaw = (Array.isArray(row.approval_chain) ? row.approval_chain : []) as Row[]; // ordered steps
  const chain: ChainStepVM[] = chainRaw.map((s) => ({
    role: String(pick(s, ['role'], 'Approver')),
    // RESOLVED: steps carry `approver_name` OR `actor` (the page reads both),
    // falling back to resolving `approver_id`.
    approverName: String(pick(s, ['approver_name', 'actor'], '') || (s.approver_id ? ctx.nameOf(String(s.approver_id)) : '—')),
    status: String(pick(s, ['status'], 'PENDING')).toUpperCase(),
    actedAt: pick<string | null>(s, ['acted_at'], null),
  }));
  const recruiters = (Array.isArray(row.assigned_recruiter_ids) ? row.assigned_recruiter_ids : []) as string[];
  return {
    id,
    code: String(pick(row, ['mrf_number'], id.slice(0, 8))),                             // RESOLVED
    // RESOLVED: the page's own precedence is job_title || designation || position.
    // `position_title` and `title` do not exist on this table.
    title: String(pick(row, ['job_title', 'designation', 'position'], 'Untitled role')),
    department: String(dept?.dept_name ?? '—'),
    location: String(loc?.location_name ?? '—'),
    status: String(row.status ?? 'DRAFT').toUpperCase() as MrfStatus,                    // MRF_STATUSES
    lane: (lane === 'Quick Hire' || lane === 'Full MRF' ? lane : laneFor(budgetMax ?? 0, ctx.quickHireCap)) as Lane,
    priority: pick<string | null>(row, ['urgency'], null),                               // RESOLVED: `urgency`, not `priority`
    openings: Number(pick(row, ['no_of_openings', 'openings'], 0)),                      // RESOLVED: both columns are in use
    filled: mine.filter((c) => (ctx.filledStages ?? [ctx.joinedStage ?? 'Joined']).includes(String(c.stage))).length,
    candidates: mine.length,
    budgetMaxRupees: budgetMax,
    confidential: !!row.is_confidential,
    // RESOLVED, and these are two DIFFERENT fields the kit collapsed into one:
    //   target_joining_date = the intended date of joining  (what the card labels "Target")
    //   validity_date       = when the requisition itself expires
    // Job Status is unaffected either way: JobStatusView receives `standing` from
    // the tab's existing calculation, which already uses validity_date.
    targetDate: pick<string | null>(row, ['target_joining_date', 'validity_date'], null),
    chain,
    // nameOf returns '' for an id it cannot resolve and '—' for a missing
    // employee; initials() turns those into '' and '—'. MrfCard only tests
    // `recruiterInitials.length`, so either would render blank avatar circles
    // instead of the honest "Unassigned". Keep only initials with real letters.
    recruiterInitials: recruiters.map((r) => initials(ctx.nameOf(r))).filter((s) => /[a-z0-9]/i.test(s)),
    company: comp ? String(comp.company_name ?? comp.company_code ?? '—') : null,
    businessUnit: pick<string | null>(row, ['business_unit'], null),
    employmentType: pick<string | null>(row, ['employment_type'], null),
    workMode: pick<string | null>(row, ['work_mode'], null),
    grade: pick<string | null>(row, ['grade'], null),
    experienceRequired: pick<string | null>(row, ['experience_required'], null),
    durationMonths: num(pick(row, ['duration_months'], null)),
    skills: pick<string | null>(row, ['skills_required'], null),
    remarks: pick<string | null>(row, ['remarks'], null),
    expired,
    recruiterEmail: pick<string | null>(row, ['assigned_recruiter'], null),
    budgetLabel: ctx.budgetLabelOf ? ctx.budgetLabelOf(row) : null,
    raw: row,
  };
}

export function toCandidateVM(row: Row): CandidateVM {
  const details = (row.application_details && typeof row.application_details === 'object' ? row.application_details : {}) as Row; // JSON, migration 121
  // RESOLVED: a candidate's current role is `designation` on the row itself.
  // There is no `current_designation` column; the kit's guess would always have
  // fallen through to application_details.
  const role = pick<string | null>(row, ['designation'], null) ?? pick<string | null>(details, ['designation', 'current_designation'], null);
  const company = pick<string | null>(row, ['current_company'], null) ?? pick<string | null>(details, ['current_company'], null);
  return {
    id: String(row.id),
    mrfId: pick<string | null>(row, ['mrf_id'], null),                                   // RESOLVED
    name: String(pick(row, ['full_name'], 'Unnamed')),                                   // RESOLVED
    email: pick<string | null>(row, ['email'], null),
    currentRole: [role, company].filter(Boolean).join(', ') || null,
    source: pick<string | null>(row, ['source'], null) ?? pick<string | null>(details, ['source'], null),
    experienceYears: num(row.experience_years),                                          // whole years
    currentCtcRupees: num(row.current_ctc),                                              // rupees
    expectedCtcRupees: num(row.expected_ctc),                                            // rupees
    // Both columns exist and the insert writes the same value to each.
    noticeDays: num(pick(row, ['notice_period_days', 'notice_period'], null)),
    stage: String(row.stage ?? 'Applied'),                                               // RESOLVED: `stage`
    aiScore: num(pick(row, ['ai_score'], null) ?? pick(details, ['ai_score'], null)),    // RESOLVED
    raw: row,
  };
}

/**
 * `interview_rounds` rows for one candidate → RoundVM.
 *
 * RESOLVED, and the kit's guess was wrong on both counts. There is no
 * `feedback` / `interviewer_feedback` / `feedback_notes` column on this table:
 * a round records feedback by moving to `status === 'done'` and stamping
 * `feedback_submitted_at` (see InterviewPipeline's submit path). Reading a
 * non-existent column would have reported EVERY round as awaiting feedback,
 * so moveOptions() would have locked every stage past Shortlisted permanently.
 *
 * Note this mirrors the ROUND-level rule. The candidate modal gates a move on
 * its own per-interviewer invite rows (`status === 'submitted'`), and that
 * check — blockedReason() — remains the authority. moveOptions() only labels.
 */
export function toRoundVM(row: Row, nameOf: (id: string) => string): RoundVM {
  const done = String(pick(row, ['status'], '')).toLowerCase() === 'done';
  const submittedAt = pick<string | null>(row, ['feedback_submitted_at'], null);
  return {
    name: String(pick(row, ['round_type'], 'Round')),                                    // RESOLVED: `round_type`
    interviewer: String(pick(row, ['interviewer_name'], '') || (row.interviewer_id ? nameOf(String(row.interviewer_id)) : '—')),
    at: pick<string | null>(row, ['scheduled_at'], null),                                // RESOLVED
    hasFeedback: done || (submittedAt != null && String(submittedAt).trim() !== ''),
  };
}
