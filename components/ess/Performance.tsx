'use client'
// components/ess/Performance.tsx — PMS inside the employee portal.
// Spec §3 (employee), §4 (RM L1/L2) and §5 (HOD).
//
// THREE AUDIENCES, ONE SCREEN
//
// The mockup switches role with a control at the top and then shows that
// role's tabs. This does the same, except the switch only offers the roles
// you actually hold — showing an empty "My Team" to somebody with no
// reportees is a dead end, and hiding it entirely is one fewer thing to
// explain.
//
// WHY ROLES ARE DERIVED, NOT LOOKED UP
//
// user_roles has 0 rows, so there is nothing to read. The org columns are
// populated and mean exactly the same thing: somebody is an RM because people
// report to them, and an HOD because a department points at them. That is
// more truthful than a role flag anyway — a flag can disagree with the
// hierarchy; this cannot.
//
// THE FROZEN CHAIN
//
// Whose appraisals are mine comes from pms_overall_rating's rm_l1_id /
// rm_l2_id / hod_id snapshot, NOT from a live lookup of who reports to me. A
// reorg mid-cycle must not move half-rated appraisals between managers, and
// pms_finalise reads the same snapshot.
//
// THE TABLES DO NOT EXIST YET
//
// Migration 066 is written and handed to Nayan, not applied. Every pms_* read
// can legitimately come back PGRST205, and that is a state to render rather
// than an error to swallow — otherwise this looks broken when it is waiting.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import '@/components/pms/pms.css'
import CycleHeader from '@/components/pms/CycleHeader'
import type { ActionTab } from '@/lib/pms/cycle'
import {
  EMP_TABS, DashboardTab, KraTab, OneToOneTab, SelfRatingTab, ResultTab,
  AnalyticsTab, ChainBanner, type EmpTab, type Who, type SelfRow, type KraSelf,
} from '@/components/pms/EmployeeTabs'
import {
  MGR_TABS, HOD_TABS, TeamTab, ApproveTab, RateTab, PipRequestTab, CHAIN_RATERS,
  TeamAnalyticsTab, FinaliseTab, FeedbackTab, PublishedResultsTab, KraDetail,
  BENEFIT_LABEL,
  type MgrTab, type HodTab, type RateRow, type BenefitType,
  type PublishedResult, type KraLine,
} from '@/components/pms/ManagerTabs'
import { type TeamMember } from '@/lib/pms/team'
import { type Chain, type Finaliser } from '@/lib/pms/hierarchy'
import { rungFor, heldBy, approvalFinalises } from '@/lib/pms/chain'
import { showFinaliserFeedbackTab, type PostFinalOwner } from '@/lib/pms/postFinal'
import { autoLogFor, CONFIRM_LABEL, CONFIRM_WHY, type ConfirmStage } from '@/lib/pms/oneToOne'
import { diffKras, type Kra, type Category, type KraChange } from '@/lib/pms/kra'
import { canLockWeightage, canPublishResult, type Log } from '@/lib/pms/oneToOne'
import { reached, WORKFLOW } from '@/lib/pms/status'
import { bandsFromScale, compareRatings,
         type Band, type Line, type ScaleRow, type RaterRole } from '@/lib/pms/scoring'
import { stageStates, currentStage, settled, STAGES, DEFAULT_RULES,
         type Progress, type StageKey, type Rules } from '@/lib/pms/cycle'
import { DEFAULT_FLAG_RULES, type Flag, type FlagRules } from '@/lib/pms/employment'

const MISSING_TABLE = 'PGRST205'

/** WHAT A REFUSAL SAYS TO THE PERSON WHO HIT IT.
 *
 *  Every write here used to put `error.message` on the screen, so somebody who
 *  had just written four KRAs was shown
 *
 *      null value in column "company_id" of relation "pms_employee_goals"
 *      violates not-null constraint
 *
 *  which names a relation and a constraint and offers nothing to do about
 *  either. The real error still goes to the console, because whoever maintains
 *  this needs the constraint name that the employee does not. */
const NO_COMPANY =
  'We could not tell which company your record belongs to, so this was not sent. Ask HR to check your employee record.'
const SAVE_FAILED = (what: string) =>
  `Your ${what} could not be saved. Nothing was lost — try again, and tell HR if it keeps happening.`

interface Period { id: string; period_code: string; status: string; policy_id?: string | null
                   period_start?: string | null; period_end?: string | null }
/** The three policy columns the review screens have to agree with pms_finalise
 *  about. Widened from the CHECK constraints in 066 rather than from memory. */
interface Policy {
  approval_chain: Chain
  who_can_finalise: Finaliser
  final_review_one_to_one: boolean
  /** §8's NEW_JOINER cutoff. Configurable per policy and, until now,
   *  enforced nowhere — DEFAULT_FLAG_RULES's 30 days always won. */
  new_joiner_cutoff_days?: number | null
  /** §13.2(3): carry the previous period's locked KRAs forward. Default true
   *  in the schema, so an absent value means ON rather than OFF. */
  carry_forward_kras?: boolean | null
  /** 202: who runs the appraisal after the rating is settled. */
  post_final_owner?: string | null
  /** Whether the KRA one-to-one is required at all. A policy that does not
   *  ask for the conversation must not block a submission on confirming it. */
  one_to_one_mandatory?: boolean | null
  /** The KRA rules. DEFAULT_RULES (4/10/100/5) was being used as though it
   *  were the live rule in the employee screen, the manager's approve check
   *  and the cycle header — so an admin could change min_kra_count and
   *  nothing anywhere would change. Reported from the admin screen. */
  min_kra_count: number
  max_kra_count: number
  total_weightage: number
  min_weightage_per_kra: number
}
interface Overall {
  workflow_status?: string | null
  self_score?: number | null
  final_rating?: number | null
  final_rating_code?: string | null
  is_readonly?: boolean | null
  // 197. workflow_status says how far the ratings have got; chain_stage says
  // whose move it is. The employee needs the second one to know whether they
  // are waiting or being waited for.
  chain_stage?: string | null
  sent_back_to?: string | null
  sent_back_reason?: string | null
  sent_back_at?: string | null
  /**
   * The FROZEN RM L1. Carried so the employee's one-to-one tick records the
   * manager their appraisal is actually routed to.
   *
   * employees.l1_manager_id is the live value and the two diverge: three of
   * the 395 enrolments changed manager mid-cycle, so their appraisal routes to
   * Ishaan Gupta while the live field names Yash Dhawan. Every gate reads the
   * snapshot, so the log has to as well.
   */
  rm_l1_id?: string | null
}
interface Roles { isRM: boolean; isHOD: boolean; reportees: number; deptCount: number }

type Scope = 'me' | 'team' | 'dept'

const blankKra = (seq: number): Kra => ({
  seq_no: seq, kra_title: '', kpi_metric: '', target_value: '',
  category: 'BUSINESS', weightage: 0,
})

/** The active period and this employee's row in it. Shared so that every view
 *  says the same thing about "nothing here" instead of inventing its own. */
function usePeriod(employeeId: string) {
  const [period, setPeriod] = useState<Period | null>(null)
  const [overall, setOverall] = useState<Overall | null>(null)
  const [loading, setLoading] = useState(true)
  /** The employee's company and reporting manager, resolved here because the
   *  period lookup already reads this row — and KEPT, because every write in
   *  the module needs one or both.
   *
   *  EVERY pms_* TABLE DECLARES company_id NOT NULL WITH NO DEFAULT, and not
   *  one of the client writes supplied it. The value was being fetched a line
   *  above and thrown away. pms_one_to_one additionally requires manager_id,
   *  which was never fetched at all. Measured, not guessed: the required
   *  columns of all six tables were read out of 066 and compared against each
   *  call site. */
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [managerId, setManagerId] = useState<string | null>(null)
  /** The rating bands this company actually configured. Empty until loaded, and
   *  empty if the table cannot be read — callers fall back to DEFAULT_BANDS
   *  rather than blanking the screen. See scoring.ts for why this is not a
   *  constant: the hardcoded list and pms_rating_scale disagreed, and the
   *  hardcoded one was winning. */
  const [bands, setBands] = useState<Band[]>([])
  /** This period's policy workflow rules. Null until loaded, and null when the
   *  period has no policy — in which case pms_finalise refuses outright (188),
   *  so the screens fall back to the schema defaults purely to render. */
  const [policy, setPolicy] = useState<Policy | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    // THE PERIOD MUST BE THIS EMPLOYEE'S COMPANY'S PERIOD.
    //
    // Every company runs its own policy and therefore its own periods —
    // there are currently three open Q2 rows in the live database, one per
    // company. Selecting with limit(1) and no company filter picked whichever
    // sorted first, so two employees out of three were shown a period that
    // was not theirs, and every read hung off it did the same.
    const me = await supabase.from('employees')
      .select('company_id,l1_manager_id').eq('id', employeeId).maybeSingle()
    const row = me.data as { company_id?: string; l1_manager_id?: string } | null
    const companyId = row?.company_id ?? null
    setCompanyId(companyId)
    setManagerId(row?.l1_manager_id ?? null)

    let q = supabase.from('pms_periods')
      .select('id,period_code,status,policy_id,period_start,period_end')
      .not('status', 'in', '("CLOSED","SCHEDULED")')
    if (companyId) q = q.eq('company_id', companyId)
    const p = await q.order('period_start', { ascending: false }).limit(1).maybeSingle()
    if (p.error || !p.data) { setPeriod(null); setOverall(null); setLoading(false); return }
    setPeriod(p.data as Period)

    // THE WORKFLOW RULES OF THIS PERIOD'S POLICY, not a constant.
    //
    // approval_chain and who_can_finalise are both columns an admin can set,
    // with four and three legal values. The finalise screen was passing the
    // schema defaults as literals, so a company on HOD_ONLY was still shown
    // RM L2 as a finaliser, and a company on SELF_RM1 was told to wait for an
    // RM L2 the chain does not contain. pms_finalise reads the real policy and
    // would have refused — the screen would simply have disagreed with it.
    const pid = (p.data as { policy_id?: string }).policy_id
    if (pid) {
      const po = await supabase.from('pms_policies')
        .select('approval_chain,who_can_finalise,final_review_one_to_one,'
              + 'min_kra_count,max_kra_count,total_weightage,min_weightage_per_kra,'
              + 'new_joiner_cutoff_days,carry_forward_kras,post_final_owner,'
              + 'one_to_one_mandatory')
        .eq('id', pid).maybeSingle()
      if (po.error) logFail('could not read the policy', po.error)
      setPolicy(po.error ? null : (po.data as Policy | null))
    } else {
      setPolicy(null)
    }

    const o = await supabase.from('pms_overall_rating')
      .select('workflow_status,self_score,final_rating,final_rating_code,is_readonly,chain_stage,sent_back_to,sent_back_reason,sent_back_at,rm_l1_id')
      .eq('employee_id', employeeId).eq('period_id', p.data.id).maybeSingle()
    setOverall(o.error ? null : (o.data as Overall | null))

    // THE SCALE THE ADMIN EDITED. Scoped to the company, because the bands are
    // per company and per policy; an error or an empty table leaves this empty
    // and the screens use the built-in fallback.
    if (companyId) {
      const sc = await supabase.from('pms_rating_scale')
        .select('rating_value,rating_code,rating_label,score_from,score_to,min_comment_chars,improvement_feedback_mandatory,sort_order,is_active')
        .eq('company_id', companyId)
      if (sc.error) logFail('could not read the rating scale', sc.error)
      setBands(sc.error ? [] : bandsFromScale(sc.data as ScaleRow[]))
    }
    setLoading(false)
  }, [employeeId])

  useEffect(() => { reload() }, [reload])
  /**
   * The KRA rules this period is actually run under.
   *
   * Falls back to DEFAULT_RULES only when no policy has loaded — the constant
   * is a fallback, not the rule. Everything that validates or describes a KRA
   * set reads this, so changing min_kra_count in the admin screen now changes
   * what the employee is held to, which it previously did not.
   */
  const rules: Rules = useMemo(() => policy ? {
    minKra: Number(policy.min_kra_count) || DEFAULT_RULES.minKra,
    maxKra: Number(policy.max_kra_count) || DEFAULT_RULES.maxKra,
    totalWeightage: Number(policy.total_weightage) || DEFAULT_RULES.totalWeightage,
    minWeightagePerKra: Number(policy.min_weightage_per_kra) || DEFAULT_RULES.minWeightagePerKra,
  } : DEFAULT_RULES, [policy])

  /** §8's eligibility rules, from the policy rather than the constant. */
  const flagRules: FlagRules = useMemo(() => ({
    newJoinerCutoffDays: Number(policy?.new_joiner_cutoff_days)
      || DEFAULT_FLAG_RULES.newJoinerCutoffDays,
    // §8 measures the cut-off against the period END, not today.
    periodEnd: period?.period_end ?? null,
  }), [policy, period])

  return { period, overall, loading, reload, companyId, managerId, bands, policy, rules, flagRules }
}

/** Today, in the browser's own zone. An ISO slice of a UTC timestamp is
 *  yesterday for anybody east of Greenwich after 05:30 IST, and these dates
 *  decide whether a window is open. */
/**
 * Log a Supabase failure so the message actually reaches the console.
 *
 * `console.error('…', error)` on a PostgrestError prints `{}` in the Next
 * dev overlay — the fields do not survive its serialisation — so a real
 * refusal arrived as an empty object with no cause and no code. That is
 * exactly what happened to a final-review acknowledgement blocked by 199's
 * trigger: a P0001 with a full sentence explaining itself, reported as `{}`.
 *
 * code and message are what identify a Postgres refusal; details and hint
 * carry the rest when there is any.
 */
function logFail(where: string, e: unknown) {
  const x = (e ?? {}) as { message?: string; code?: string; details?: string; hint?: string }
  console.error(`[pms] ${where}:`,
    x.code ? `[${x.code}] ` : '', x.message ?? String(e),
    x.details ? `| ${x.details}` : '', x.hint ? `| hint: ${x.hint}` : '')
}

/**
 * Record the one-to-one for a stage, from a tick.
 *
 * ONE FUNCTION FOR ALL FOUR STAGES, because they are the same act seen from
 * different sides and the first version of this was four near-copies. The
 * employee's tick and RM L1's tick land on the SAME KRA_SETTING row — one
 * conversation, two acknowledgements, which is exactly what pms_lock_kras
 * checks. RM L2 and the HOD get their own rows because they are different
 * conversations.
 *
 * WHY THE TICK AND NOT A FORM. Requested: the log should be automatic, a
 * mandatory checkbox at each stage rather than a separate screen. The form is
 * why FINAL_REVIEW rows existed for 7 of 395 enrolments and why a HOD could
 * be blocked by a gate only the employee could open — a form nobody is
 * standing in front of does not get filled. The detailed log still exists for
 * the duration, the discussion points and the agreed weightage changes; this
 * is the floor, not the ceiling.
 *
 * IDEMPOTENT. Ticking twice must not create a second row: the finalise gate
 * counts rows carrying both acknowledgements, so duplicates would not break
 * it, but two records of one meeting is a mess in the log and the other party
 * would not know which to acknowledge.
 */
async function recordOneToOne(o: {
  companyId: string; periodId: string; employeeId: string
  /**
   * The OTHER party, by id.
   *
   * For the employee's own tick this must be the FROZEN RM L1 from
   * pms_overall_rating, not employees.l1_manager_id. Three of the 395
   * enrolments have those pointing at different people — Meera Singh, Meera
   * Verma and Amit Gupta changed manager mid-cycle, so their appraisals still
   * route to Ishaan Gupta while the live field names Yash Dhawan. Every gate
   * in the module reads the snapshot; a log that names the live manager
   * records the conversation against somebody the appraisal was never with.
   */
  managerId: string
  stage: ConfirmStage
  today: string
}): Promise<'RECORDED' | 'ALREADY' | 'ERROR'> {
  const spec = autoLogFor(o.stage)
  const ackCol = spec.side === 'employee' ? 'employee_ack' : 'manager_ack'
  const atCol = spec.side === 'employee' ? 'employee_ack_at' : 'manager_ack_at'

  const existing = await supabase.from('pms_one_to_one')
    .select(`id,${ackCol}`)
    .eq('employee_id', o.employeeId).eq('period_id', o.periodId)
    .eq('discussion_type', spec.discussion_type).limit(1)

  if (existing.data?.length) {
    const row = existing.data[0] as Record<string, unknown>
    if (row[ackCol] === true) return 'ALREADY'
    const up = await supabase.from('pms_one_to_one')
      .update({ [ackCol]: true, [atCol]: new Date().toISOString() })
      .eq('id', String(row.id))
    if (up.error) { logFail('one-to-one ack refused', up.error); return 'ERROR' }
    return 'RECORDED'
  }

  // manager_id and discussion_points are both NOT NULL, and manager_role has
  // never been written by anything: every row in the database says RM_L1
  // because that is the column default, including FINAL_REVIEW rows a HOD
  // logged. A log that cannot say which stage it belongs to is most of the way
  // to not being a log.
  const ins = await supabase.from('pms_one_to_one').insert({
    company_id: o.companyId, period_id: o.periodId, employee_id: o.employeeId,
    manager_id: o.managerId,
    manager_role: spec.manager_role,
    discussion_type: spec.discussion_type,
    discussion_date: o.today,
    mode: 'IN_PERSON',
    discussion_points: spec.discussion_points,
    [ackCol]: true, [atCol]: new Date().toISOString(),
  })
  if (ins.error) { logFail('one-to-one insert refused', ins.error); return 'ERROR' }
  return 'RECORDED'
}

const FINAL_REVIEW_LOGGED =
  'Final review confirmed and recorded against your name. The rating can be '
  + 'settled now; publishing it waits on the employee confirming the '
  + 'conversation too.'

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Performance({ employeeId }: { employeeId: string }) {
  const [roles, setRoles] = useState<Roles | null>(null)
  const [moduleReady, setModuleReady] = useState<boolean | null>(null)
  const [scope, setScope] = useState<Scope>('me')
  const [empTab, setEmpTab] = useState<EmpTab>('dashboard')
  const [mgrTab, setMgrTab] = useState<MgrTab>('team')
  const [hodTab, setHodTab] = useState<HodTab>('finalise')

  useEffect(() => {
    (async () => {
      const { count: reportees } = await supabase
        .from('employees').select('id', { count: 'exact', head: true })
        .or(`l1_manager_id.eq.${employeeId},l2_manager_id.eq.${employeeId}`)
        .is('date_of_leaving', null)

      // departments.hod_employee_id arrives with 067. Until then only the
      // per-employee override can identify an HOD.
      let deptCount = 0
      const d = await supabase.from('departments').select('id', { count: 'exact', head: true })
        .eq('hod_employee_id', employeeId)
      if (!d.error) deptCount = d.count || 0

      const { count: hodOf } = await supabase
        .from('employees').select('id', { count: 'exact', head: true })
        .eq('hod_id', employeeId).is('date_of_leaving', null)

      setRoles({
        isRM: (reportees || 0) > 0,
        isHOD: deptCount > 0 || (hodOf || 0) > 0,
        reportees: reportees || 0,
        deptCount,
      })
    })()
  }, [employeeId])

  useEffect(() => {
    (async () => {
      const probe = await supabase.from('pms_periods').select('id').limit(1)
      setModuleReady(!(probe.error && (probe.error as { code?: string }).code === MISSING_TABLE))
    })()
  }, [])

  if (moduleReady === false) return <ModulePending />
  if (!roles) return <div className="pms"><div className="k">Loading…</div></div>

  const scopes: { k: Scope; label: string }[] = [
    { k: 'me', label: 'Me' },
    ...(roles.isRM  ? [{ k: 'team' as const, label: `My team (${roles.reportees})` }] : []),
    ...(roles.isHOD ? [{ k: 'dept' as const, label: 'My department' }] : []),
  ]

  const tabs = scope === 'me' ? EMP_TABS : scope === 'team' ? MGR_TABS : HOD_TABS
  const activeKey = scope === 'me' ? empTab : scope === 'team' ? mgrTab : hodTab
  const pick = (k: string) => {
    if (scope === 'me') setEmpTab(k as EmpTab)
    else if (scope === 'team') setMgrTab(k as MgrTab)
    else setHodTab(k as HodTab)
  }

  /** Where each next-action CTA actually goes.
   *
   *  nextAction() names its destinations in its own vocabulary — 'mine',
   *  'oneone', 'dept', 'fill' — while the tab strips use theirs: 'kras',
   *  'oneToOne', 'finalise', 'deptAnalytics'. Nothing matched, and because
   *  Action.tab was typed `string` the compiler had nothing to say about it.
   *
   *  The old handler was `onGo={() => setScope('me')}`: it discarded the
   *  destination and set the scope to the one already selected, so EVERY
   *  call-to-action on the cycle header did nothing. "Add your first KRA" was
   *  the most visible, being the first thing a new employee is asked to do.
   *
   *  A CTA has to move both dials: the scope (Me / My team / My department)
   *  and the tab within it. */
  const GO_TO: Record<ActionTab, { scope: Scope; tab: string }> = {
    mine:   { scope: 'me',   tab: 'kras' },        // Write your KRAs
    self:   { scope: 'me',   tab: 'self' },        // Rate yourself
    oneone: { scope: 'me',   tab: 'oneToOne' },    // Confirm your one-to-one
    team:   { scope: 'team', tab: 'approve' },     // Open the approval queue
    dept:   { scope: 'dept', tab: 'finalise' },    // Open the finalisation queue
    // "See who is missing" — the HR admin's list of people with no KRAs yet.
    // Department analytics is the only surface that shows completion.
    fill:   { scope: 'dept', tab: 'deptAnalytics' },
  }

  const goToAction = (destination: string) => {
    const to = GO_TO[destination as ActionTab]
    // An unmapped destination must not silently do nothing — that is the bug
    // being replaced. Falling back to the person's own dashboard at least moves.
    const { scope: s, tab } = to ?? { scope: 'me' as Scope, tab: 'dashboard' }
    setScope(s)
    if (s === 'me') setEmpTab(tab as EmpTab)
    else if (s === 'team') setMgrTab(tab as MgrTab)
    else setHodTab(tab as HodTab)
  }

  return (
    <div className="pms">
      <CycleHeader
        employeeId={employeeId}
        roles={{ isEmployee: true, isRM: roles.isRM, isHOD: roles.isHOD }}
        onGo={goToAction}
      />

      {scopes.length > 1 && (
        <div className="chips" role="tablist" aria-label="Which side of the review"
             style={{ marginBottom: 4 }}>
          {scopes.map(s => (
            <button key={s.k} type="button" role="tab" aria-selected={scope === s.k}
                    className={scope === s.k ? 'chip sel' : 'chip'}
                    onClick={() => setScope(s.k)}>{s.label}</button>
          ))}
        </div>
      )}

      <div className="tabs">
        {tabs.map(t => (
          <button key={t.k} type="button" onClick={() => pick(t.k)}
                  className={activeKey === t.k ? 'on' : undefined}
                  aria-current={activeKey === t.k ? 'page' : undefined}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="k" style={{ marginTop: -10, marginBottom: 16 }}>
        {tabs.find(t => t.k === activeKey)?.blurb}
      </div>

      {scope === 'me'   && <MySide employeeId={employeeId} tab={empTab} />}
      {scope === 'team' && <TeamSide employeeId={employeeId} tab={mgrTab} />}
      {scope === 'dept' && <DeptSide employeeId={employeeId} tab={hodTab} />}
    </div>
  )
}

// ── the employee's own side ──────────────────────────────────────────────

function MySide({ employeeId, tab }: { employeeId: string; tab: EmpTab }) {
  const { period, overall, loading, reload, companyId, managerId, bands, rules, policy } = usePeriod(employeeId)
  /**
   * THE EMPLOYEE'S ONE-TO-ONE TICK. Mandatory before submitting when the
   * policy asks for the conversation — the log is recorded by ticking it
   * rather than by a separate form.
   *
   * Not persisted: it is a confirmation made at the moment of submitting, and
   * a half-remembered tick from a previous visit is not a confirmation. Once
   * the log exists, oneToOneAlready hides the box entirely.
   */
  const [confirmOneToOne, setConfirmOneToOne] = useState(false)
  const [who, setWho] = useState<Who>({ name: '', code: '' })
  const [goals, setGoals] = useState<Record<string, unknown>[]>([])
  /** Last period's locked KRAs, offered as this period's starting point.
   *  Null when there is nothing to carry or this period already has its own. */
  /** The employee's rating of each KRA while they write it, keyed by seq_no.
   *  Seeded from any SELF review already saved, so re-opening the tab shows
   *  what they rated last time rather than an empty form. */
  const [selfBySeq, setSelfBySeq] = useState<Record<number, KraSelf> | null>(null)
  const [carried, setCarried] = useState<{
    fromPeriodId: string; fromPeriodCode: string; kras: Kra[]
  } | null>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [reviews, setReviews] = useState<Record<string, unknown>[]>([])
  const [feedback, setFeedback] = useState<Record<string, unknown> | null>(null)
  /** §3.5's recognition list, already labelled for display. */
  const [benefits, setBenefits] = useState<{ type: string; note: string }[]>([])
  const [draftKras, setDraftKras] = useState<Kra[] | null>(null)
  const [selfDraft, setSelfDraft] = useState<SelfRow[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const today = localToday()

  useEffect(() => {
    (async () => {
      const e = await supabase.from('employees')
        .select('emp_code,full_name,designation').eq('id', employeeId).maybeSingle()
      if (!e.error && e.data) {
        const r = e.data as Record<string, unknown>
        setWho({ name: String(r.full_name ?? ''), code: String(r.emp_code ?? ''),
                 designation: r.designation ? String(r.designation) : null })
      }
    })()
  }, [employeeId])

  const loadPeriodData = useCallback(async () => {
    if (!period) return
    const g = await supabase.from('pms_employee_goals')
      .select('id,seq_no,kra_title,kpi_metric,target_value,category,weightage,status')
      .eq('employee_id', employeeId).eq('period_id', period.id).order('seq_no')
    setGoals(g.data ?? [])

    /**
     * CARRY-FORWARD. §3's update: last quarter's KRAs/KPIs remain the default.
     *
     * Only when this period has none of its own — a carried default must never
     * overwrite work the employee has already started. Taken from the previous
     * period's LOCKED set, because a draft or sent-back set from last quarter
     * was never agreed and carrying it would propagate something unfinished.
     *
     * The weightages come across as they were. They may well be changed in
     * the one-to-one, and that change is what pms_one_to_one.weightage_changes
     * now records.
     */
    // §13.2(3) makes this a policy choice defaulting to ON. `!== false` and
    // not `=== true`: the column is NOT NULL DEFAULT true, but the policy may
    // not have loaded yet on first paint, and treating "not loaded" as OFF
    // would flash an empty form at an employee whose KRAs were about to
    // appear.
    const mayCarry = policy?.carry_forward_kras !== false
    if (mayCarry && !(g.data ?? []).length && companyId) {
      const prev = await supabase.from('pms_periods')
        .select('id,period_code,period_start')
        .eq('company_id', companyId).lt('period_start', period.period_start ?? '9999-12-31')
        .order('period_start', { ascending: false }).limit(1).maybeSingle()
      const prevRow = prev.data as { id: string; period_code?: string } | null
      if (prevRow?.id) {
        const pg = await supabase.from('pms_employee_goals')
          .select('seq_no,kra_title,kpi_metric,target_value,category,weightage')
          .eq('employee_id', employeeId).eq('period_id', prevRow.id)
          .eq('status', 'LOCKED').order('seq_no')
        if (!pg.error && (pg.data ?? []).length) {
          setCarried({
            fromPeriodId: prevRow.id,
            fromPeriodCode: String(prevRow.period_code ?? ''),
            kras: (pg.data ?? []).map(k => ({
              seq_no: Number(k.seq_no), kra_title: String(k.kra_title ?? ''),
              kpi_metric: String(k.kpi_metric ?? ''), target_value: String(k.target_value ?? ''),
              category: (String(k.category ?? 'BUSINESS')) as Category,
              weightage: Number(k.weightage) || 0,
              source: 'CARRIED_FORWARD' as const,
              carried_from_period_id: prevRow.id,
            })),
          })
        } else setCarried(null)
      } else setCarried(null)
    } else setCarried(null)

    const l = await supabase.from('pms_one_to_one')
      .select('id,discussion_type,discussion_date,mode,discussion_points,employee_ack,manager_ack,duration_minutes,weightage_changes')
      .eq('employee_id', employeeId).eq('period_id', period.id)
      .order('discussion_date', { ascending: true })
    setLogs((l.data ?? []) as unknown as Log[])

    const r = await supabase.from('pms_reviews')
      .select('goal_id,rater_role,rating,achievement_value,comments')
      .eq('employee_id', employeeId).eq('period_id', period.id)
    setReviews(r.data ?? [])

    const f = await supabase.from('pms_feedback')
      .select('appreciation_remark,improvement_feedback,development_plan,visible_to_employee')
      .eq('employee_id', employeeId).eq('period_id', period.id).maybeSingle()
    setFeedback(f.error ? null : (f.data as Record<string, unknown> | null))

    // §3.5 lists additional benefits on the result alongside the remarks. The
    // result screen was passed a hardcoded empty array, so a HOD could award a
    // nomination, see it save, and the employee would read "Nothing recorded
    // for this period" — observed live on Ishaan Shah's published result after
    // a TRAINING_NOMINATION had been written. Same shape of fault as the
    // Acknowledge button: a built control with nothing feeding it.
    const bn = await supabase.from('pms_additional_benefits')
      .select('benefit_type,benefit_note')
      .eq('employee_id', employeeId).eq('period_id', period.id)
    if (bn.error) logFail('could not read recognition', bn.error)
    setBenefits((bn.data ?? []).map(b => ({
      // The label, not the enum: the result screen prints this verbatim and
      // 'TRAINING_NOMINATION' is a column value, not something to show anybody.
      type: BENEFIT_LABEL[(b as { benefit_type: BenefitType }).benefit_type]
            ?? String((b as { benefit_type: string }).benefit_type),
      note: String((b as { benefit_note?: string }).benefit_note ?? ''),
    })))
  }, [employeeId, period])
  useEffect(() => { loadPeriodData() }, [loadPeriodData])

  const kras: Kra[] = draftKras ?? (goals.length
    ? goals.map(g => ({
        seq_no: Number(g.seq_no), kra_title: String(g.kra_title ?? ''),
        kpi_metric: String(g.kpi_metric ?? ''), target_value: String(g.target_value ?? ''),
        category: (String(g.category ?? 'BUSINESS')) as Category,
        weightage: Number(g.weightage) || 0,
      }))
    // The policy's minimum, not the constant: on a policy of 5 an employee
    // was handed 4 blank rows and had to notice the shortfall themselves.
    // Carried forward beats blank rows: last quarter's agreed set is a far
    // better starting point than an empty form, and §3's update makes it the
    // documented default. Blanks only when there is nothing to carry.
    : carried?.kras.length
      ? carried.kras
      : Array.from({ length: rules.minKra }, (_, i) => blankKra(i + 1)))

  const lockGate = canLockWeightage(logs)
  const publishGate = canPublishResult(logs)
  const locked = goals.length > 0 && goals.every(g => g.status === 'LOCKED')
  /**
   * Is the employee's half of the KRA one-to-one already on record?
   *
   * Either from a previous submission's tick or from the detailed form, which
   * still exists. Nothing is gained by asking somebody to confirm the same
   * conversation twice, and a box that reappears after it has been satisfied
   * reads as though the first tick did not take.
   */
  const oneToOneAlready = logs.some(
    l => l.discussion_type === 'KRA_SETTING' && l.employee_ack === true)

  const selfSubmitted = !!(overall?.workflow_status && overall.workflow_status !== 'NOT_STARTED'
    && overall.self_score != null)
  /**
   * PUBLICATION IS AN EVENT, NOT A SIDE EFFECT OF BEING RATED.
   *
   * §3.5: "Result publish hone se pehle rating, comments — kuch bhi visible
   * nahi." This read `|| overall.final_rating != null`, so the instant a HOD
   * finalised, the employee's result screen said "✓ Published" and showed the
   * rating, the whole KRA-by-KRA chain and the appreciation remark — before
   * anybody had decided to publish, and before the feedback was written.
   * Observed live: Shreya Singh's result was fully readable while
   * workflow_status was still FINALISED and visible_to_employee was false.
   *
   * The workflow_status is the only thing that records the decision, and
   * reached() is the module's own way of asking about it: the column is an
   * ordered ladder, ACKNOWLEDGED is PUBLISHED plus the employee's tick, and
   * an unrecognised value sorts to the bottom rather than reading as further
   * along than it is — which is the right way for a visibility gate to fail.
   */
  const published = reached(overall?.workflow_status, WORKFLOW.PUBLISHED)
  // The feedback row carries its own flag, and it is not the same question:
  // the RM writes into this row during rating with visible_to_employee false,
  // so prose can exist long before anybody may read it. Both gates have to be
  // open, or the remark leaks the moment the result does.
  const feedbackVisible = published && !!feedback?.visible_to_employee

  /**
   * §3.5's Acknowledge button — the last rung of the ladder, and the only one
   * the employee owns. ResultTab has rendered this control all along behind
   * `{onAcknowledge && …}`, and nothing ever passed the handler, so the button
   * was never shown and pms_overall_rating.employee_ack / employee_ack_at and
   * the ACKNOWLEDGED status were dead columns. Same shape as FeedbackTab
   * earlier: a finished control with no caller.
   *
   * Guarded on `published` because acknowledging something you cannot see is
   * not a confirmation of anything.
   */
  const acknowledgeResult = async () => {
    if (!period || !published) return
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('pms_overall_rating')
      .update({ employee_ack: true, employee_ack_at: new Date().toISOString(),
                workflow_status: WORKFLOW.ACKNOWLEDGED })
      .eq('employee_id', employeeId).eq('period_id', period.id)
    setSaving(false)
    if (error) {
      logFail('acknowledgement refused', error)
      setMsg(SAVE_FAILED('acknowledgement')); return
    }
    loadPeriodData(); reload()
  }

  const ratingOf = (goalId: string, role: string) => {
    const row = reviews.find(r => String(r.goal_id) === goalId && r.rater_role === role)
    return row?.rating === null || row?.rating === undefined ? null : Number(row.rating)
  }

  const lines: Line[] = goals.map(g => ({
    goalId: String(g.id), title: String(g.kra_title ?? ''),
    category: String(g.category ?? 'BUSINESS') as Category,
    weightage: Number(g.weightage) || 0,
    self: ratingOf(String(g.id), 'SELF'),
    rmL1: ratingOf(String(g.id), 'RM_L1'),
    rmL2: ratingOf(String(g.id), 'RM_L2'),
    final: ratingOf(String(g.id), 'HOD') ?? ratingOf(String(g.id), 'RM_L2') ?? ratingOf(String(g.id), 'RM_L1'),
  }))

  /**
   * seq_no -> the employee's rating, seeded from pms_reviews.
   *
   * The join is goal.id -> review.goal_id, then re-keyed by seq_no, because
   * the KRA form works in seq_no (a row being typed has no id yet) while
   * pms_reviews is keyed by goal_id. One of the two has to translate, and it
   * is cheaper to do it here than to carry ids through the editing form.
   */
  const selfSeeded: Record<number, KraSelf> = useMemo(() => {
    const out: Record<number, KraSelf> = {}
    for (const g of goals) {
      const seq = Number(g.seq_no)
      const row = reviews.find(r => String(r.goal_id) === String(g.id) && r.rater_role === 'SELF')
      out[seq] = {
        achievement: String(row?.achievement_value ?? ''),
        rating: row?.rating === null || row?.rating === undefined ? null : Number(row.rating),
        comment: String(row?.comments ?? ''),
      }
    }
    return out
  }, [goals, reviews])
  const selfForKras = selfBySeq ?? selfSeeded

  const selfRows: SelfRow[] = selfDraft ?? goals.map(g => {
    const row = reviews.find(r => String(r.goal_id) === String(g.id) && r.rater_role === 'SELF')
    return {
      goalId: String(g.id), title: String(g.kra_title ?? ''),
      weightage: Number(g.weightage) || 0,
      category: String(g.category ?? 'BUSINESS') as Category,
      achievement: String(row?.achievement_value ?? ''),
      rating: row?.rating === null || row?.rating === undefined ? null : Number(row.rating),
      comment: String(row?.comments ?? ''),
    }
  })

  const progress: Progress = settled({
    kraCount: goals.length,
    weightageTotal: kras.reduce((s, k) => s + k.weightage, 0),
    kraSubmitted: goals.length > 0,
    kraApproved: locked,
    oneToOneLogged: logs.length > 0,
    oneToOneBothConfirmed: lockGate.open,
    selfSubmitted,
    rmL1Done: lines.some(l => l.rmL1 !== null),
    rmL2Done: lines.some(l => l.rmL2 !== null),
    finalised: overall?.final_rating != null,
    published,
  })
  const stage = currentStage(progress)
  // Computed above the `!period` guard because hooks and the values they feed
  // must not sit behind a conditional return.
  const states = stageStates({ label: period?.period_code ?? '' }, progress, today)

  if (loading) return <div className="k">Loading…</div>
  if (!period) return <NoPeriod />

  const submitKras = async () => {
    setSaving(true); setMsg(null)
    // EVERY NOT-NULL COLUMN HAS TO BE NAMED HERE, and two of them were learned
    // the hard way. period_id was missing first, so a saved set could never be
    // read back: every other query filters on it, and the KRAs went in and
    // vanished. company_id was missing after that, and it is NOT NULL with no
    // default, so the insert was refused outright — which is why
    // pms_employee_goals held zero rows for the whole life of the module while
    // the window sat open across three companies. Nobody saw a reason to look,
    // because the form validated perfectly right up to the moment it failed.
    if (!companyId) { setSaving(false); setMsg(NO_COMPANY); return }

    /**
     * §3's change log, from the FIRST ACKNOWLEDGEMENT ONWARD.
     *
     * The spec update asks for a JSON record of the old-to-new transition when
     * modifications are agreed in the one-to-one. Before anybody has
     * acknowledged, the employee is still drafting: logging every save then
     * would bury the handful of agreed changes under every typo correction,
     * and the noise would make the log useless for the thing it exists for.
     *
     * Read FRESH rather than trusting the `goals` state. That state was loaded
     * when the screen opened, and if a manager sent the set back or HR
     * corrected it in the meantime, the diff would report changes against a
     * version that is no longer there — inventing edits the employee never
     * made.
     */
    const ack = await supabase.from('pms_one_to_one')
      .select('employee_ack,manager_ack')
      .eq('employee_id', employeeId).eq('period_id', period.id)
      .eq('discussion_type', 'KRA_SETTING')
    const acknowledged = (ack.data ?? []).some(r =>
      (r as { employee_ack?: boolean }).employee_ack
      || (r as { manager_ack?: boolean }).manager_ack)

    /**
     * ONCE THE WEIGHTAGES ARE LOCKED, THIS SUBMISSION IS THE RATING ONLY.
     *
     * §1 Stage 3 locks the weightages; Stage 4 is the self-appraisal that
     * follows. The goals upsert below writes status PENDING_RM_APPROVAL, so
     * running it on a locked set would silently UNLOCK it — undoing the thing
     * the one-to-one gate exists to produce, and without anybody being told.
     * So a locked set is left entirely alone: no upsert, no tail delete, no
     * change log, because nothing about the KRAs has changed.
     */
    const kraLocked = goals.length > 0
      && goals.every(g => String((g as { status?: string }).status) === 'LOCKED')

    let changes: KraChange[] = []
    if (acknowledged && !kraLocked) {
      const before = await supabase.from('pms_employee_goals')
        .select('id,seq_no,kra_title,kpi_metric,target_value,category,weightage')
        .eq('employee_id', employeeId).eq('period_id', period.id)
      changes = diffKras((before.data ?? []) as unknown as Parameters<typeof diffKras>[0],
                         kras as unknown as Parameters<typeof diffKras>[1])
    }

    // UPSERT, NOT INSERT. The editable set is seeded from the rows already
    // saved (see `kras` above), so a second submit — which is the normal path
    // after a manager sends a set back — used to write a SECOND full set and
    // silently double every KRA. The table carries
    // UNIQUE (period_id, employee_id, seq_no), so keying on it makes a
    // re-submit a correction of the same rows.
    //
    // This was unreachable while nothing saved at all. Making the save work is
    // what exposed it, so it is fixed in the same breath.
    const { error } = kraLocked ? { error: null } : await supabase.from('pms_employee_goals').upsert(
      // NAMED COLUMNS, not { ...k }. The spread worked only because Kra
      // happened to contain exactly the columns this table has — the moment
      // somebody adds a UI-only field to Kra (a validation flag, an open/closed
      // state) the upsert would try to write a column that does not exist and
      // fail for reasons nowhere near the change that caused it.
      //
      // source and carried_from_period_id are what make §3's carry-forward
      // survive the save. Left undefined on a fresh KRA so the column default
      // 'MANUAL' applies rather than this code asserting it.
      kras.map(k => ({
        company_id: companyId, employee_id: employeeId, period_id: period.id,
        seq_no: k.seq_no, kra_title: k.kra_title, kpi_metric: k.kpi_metric,
        target_value: k.target_value, category: k.category, weightage: k.weightage,
        source: k.source ?? 'MANUAL',
        carried_from_period_id: k.carried_from_period_id ?? null,
        status: 'PENDING_RM_APPROVAL',
      })),
      { onConflict: 'period_id,employee_id,seq_no' })
    // A SHORTER SET LEAVES A TAIL. Going from six KRAs to four upserts rows
    // 1-4 and leaves 5 and 6 behind, which would still count towards the
    // maximum of ten and the total of a hundred — and the manager's screen
    // counts raw rows. Removed after the upsert rather than before: if the
    // write fails, the old set is still intact.
    if (!error && !kraLocked && kras.length) {
      const tail = await supabase.from('pms_employee_goals').delete()
        .eq('employee_id', employeeId).eq('period_id', period.id)
        .gt('seq_no', kras.length).neq('status', 'LOCKED')
      if (tail.error) logFail('could not remove trailing KRAs', tail.error)
    }
    /**
     * §3's merge: the self rating goes with the KRAs, in the same submission.
     *
     * It has to come AFTER the goals upsert, because pms_reviews.goal_id is a
     * real reference and a KRA being typed has no id until the upsert returns
     * one. So the ids are read back and matched on seq_no — the column
     * UNIQUE (period_id, employee_id, seq_no) makes that the identity of a KRA
     * within the period, and it is the same key the upsert itself used.
     *
     * Only rows the employee actually rated are written. A null rating is not
     * a rating of zero, and pms_reviews.rating has no NOT NULL to stop one
     * being stored as though it were.
     */
    let ratingWarning = ''
    let ratedCount = 0
    if (!error) {
      const saved = await supabase.from('pms_employee_goals')
        .select('id,seq_no').eq('employee_id', employeeId).eq('period_id', period.id)
      const idBySeq = new Map((saved.data ?? [])
        .map(g => [Number((g as { seq_no: number }).seq_no), String((g as { id: string }).id)]))
      const rated = kras
        .map(k => ({ k, sr: selfForKras[k.seq_no], goalId: idBySeq.get(k.seq_no) }))
        .filter(x => x.goalId && x.sr && x.sr.rating !== null)
      ratedCount = rated.length
      if (rated.length) {
        const rv = await supabase.from('pms_reviews').upsert(
          rated.map(({ sr, goalId }) => ({
            company_id: companyId, period_id: period.id, employee_id: employeeId,
            goal_id: goalId, rater_id: employeeId, rater_role: 'SELF',
            achievement_value: sr!.achievement || null, rating: sr!.rating,
            comments: sr!.comment || null, submitted: true,
            submitted_at: new Date().toISOString(),
          })),
          { onConflict: 'period_id,employee_id,goal_id,rater_role' })
        if (rv.error) {
          logFail('self rating refused', rv.error)
          ratingWarning = ' Your ratings did not save, though — send it again.'
        }
      }
    }

    // The log is written AFTER the change lands, so a refused save never
    // leaves a record of a modification that did not happen.
    let logWarning = ''
    if (!error && changes.length) {
      const audit = await supabase.from('pms_audit_log').insert(changes.map(c => ({
        period_id: period.id, employee_id: employeeId,
        table_name: 'pms_employee_goals', record_id: c.record_id,
        action: c.action, old_value: c.old_value, new_value: c.new_value,
        actor_id: employeeId, actor_role: 'EMPLOYEE',
      })))
      if (audit.error) {
        // Not fatal: the KRAs are the thing that had to be saved. But a silent
        // failure would leave the audit trail with a hole in it and nobody
        // aware, so it is said out loud.
        logFail('KRA change log refused', audit.error)
        logWarning = ' The change log could not be written, though — tell HR.'
      }
    }

    /**
     * INTO THE CHAIN. This is what makes the merged step a submission rather
     * than a save: pms_chain_submit parks the appraisal on the first reviewer
     * and clears any previous rejection, so a set sent back and resubmitted
     * stops looking rejected.
     *
     * AFTER the ratings, not before, and that order is load-bearing. The RPC
     * refuses without a self rating on record, and self_score only exists once
     * trg_pms_sync_role_score has seen the SELF reviews written above. Called
     * first, it would refuse every first-time submission.
     *
     * Only when a rating actually went in. An employee saving a draft set with
     * no ratings yet should not be handed to their manager — the RPC would
     * refuse anyway, but asking it would put a false "not submitted" warning
     * on a save that did exactly what the employee asked.
     *
     * A refusal here is reported, never swallowed: the KRAs are saved either
     * way, but "saved" and "with your manager" are different states and the
     * employee is the one who has to know which they are in.
     */
    /**
     * THE ONE-TO-ONE, RECORDED BY THE TICK.
     *
     * Before the chain submit, because pms_chain_submit hands the set to the
     * manager and the conversation that settled it should already be on
     * record by then. Before the lock too: pms_lock_kras counts a KRA_SETTING
     * row with BOTH acknowledgements, and this is the employee's half.
     *
     * The manager named is the FROZEN rm_l1_id, falling back to the live
     * l1_manager_id only when there is no snapshot — see the Overall type.
     */
    let oneToOneWarning = ''
    if (!error && confirmOneToOne && !oneToOneAlready) {
      const counterpart = overall?.rm_l1_id ?? managerId
      if (!counterpart) {
        oneToOneWarning = ' Your record does not say who your reporting manager is, '
          + 'so the discussion could not be logged — ask HR to set your manager.'
      } else {
        const rec = await recordOneToOne({
          companyId: companyId!, periodId: period.id, employeeId,
          managerId: counterpart, stage: 'EMPLOYEE', today,
        })
        if (rec === 'ERROR') {
          oneToOneWarning = ' The one-to-one could not be logged, though — '
            + 'your weightages cannot lock until it is. Tell HR.'
        }
      }
    }

    let chainWarning = ''
    if (!error && ratedCount && !ratingWarning) {
      const ch = await supabase.rpc('pms_chain_submit',
        { p_employee_id: employeeId, p_period_id: period.id })
      if (ch.error) {
        logFail('pms_chain_submit failed', ch.error)
        chainWarning = ' It is saved, but could not be sent on for approval — try again.'
      } else if (typeof ch.data === 'string' && ch.data.startsWith('BLOCKED')) {
        chainWarning = ' It is saved, but not sent on yet — '
          + ch.data.replace(/^BLOCKED:\s*/, '')
      }
    }
    setSaving(false)
    setMsg(error
      ? ((error as { code?: string }).code === MISSING_TABLE
          ? 'The performance module is not live yet: migration 066 has not been applied.'
          : (logFail('KRA insert refused', error), SAVE_FAILED('KRAs')))
      : [
          kraLocked ? 'Your ratings are in with your manager.'
                    : 'Sent to your reporting manager.',
          ratedCount && !kraLocked
            ? `${ratedCount} ${ratedCount === 1 ? 'rating' : 'ratings'} went with it.` : '',
          changes.length ? `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} recorded against the one-to-one.` : '',
          ratingWarning, logWarning, oneToOneWarning, chainWarning,
        ].filter(Boolean).join(' '))
    if (!error) { setDraftKras(null); setSelfBySeq(null); setConfirmOneToOne(false); loadPeriodData(); reload() }
  }

  const submitSelf = async () => {
    setSaving(true); setMsg(null)
    if (!companyId) { setSaving(false); setMsg(NO_COMPANY); return }
    const rows = selfRows.map(r => ({
      company_id: companyId,
      period_id: period.id, employee_id: employeeId, goal_id: r.goalId,
      rater_id: employeeId, rater_role: 'SELF',
      achievement_value: r.achievement || null, rating: r.rating,
      comments: r.comment || null, submitted: true,
      submitted_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('pms_reviews')
      .upsert(rows, { onConflict: 'period_id,employee_id,goal_id,rater_role' })
    setSaving(false)
    if (error) { logFail('self rating refused', error); setMsg(SAVE_FAILED('self rating')); return }

    // The separate Self Rating tab submits too — it is the same event as the
    // merged step's submission, so it enters the chain the same way. Without
    // this, an employee who rated from this tab instead would be saved and
    // never handed to anybody, which is the failure mode the merged step was
    // meant to remove rather than relocate.
    const ch = await supabase.rpc('pms_chain_submit',
      { p_employee_id: employeeId, p_period_id: period.id })
    if (ch.error) {
      logFail('pms_chain_submit failed', ch.error)
      setMsg('Your ratings are saved, but could not be sent on for approval — try again.')
    } else if (typeof ch.data === 'string' && ch.data.startsWith('BLOCKED')) {
      setMsg('Your ratings are saved, but not sent on yet — '
        + ch.data.replace(/^BLOCKED:\s*/, ''))
    } else {
      setMsg('Your ratings are in with your manager.')
    }
    setSelfDraft(null); reload(); loadPeriodData()
  }

  const logDiscussion = async (l: Log) => {
    setSaving(true); setMsg(null)
    if (!companyId) { setSaving(false); setMsg(NO_COMPANY); return }
    // manager_id IS NOT NULL TOO. The discussion is a record of two people
    // talking, so the table will not take it without naming the other one —
    // which is why fixing company_id alone would simply have failed one column
    // later. It is the L1 manager: the one-to-one that settles KRAs is held
    // with whoever approves them.
    if (!managerId) {
      setSaving(false)
      setMsg('Your record does not say who your reporting manager is, and a one-to-one is a record of two people. Ask HR to set your manager, then log it again.')
      return
    }
    const { error } = await supabase.from('pms_one_to_one').insert({
      company_id: companyId, manager_id: managerId,
      period_id: period.id, employee_id: employeeId,
      discussion_type: l.discussion_type, discussion_date: l.discussion_date,
      mode: l.mode, discussion_points: l.discussion_points,
      // Both of these columns have existed since 066 and nothing had ever
      // written them. The spec update asks the log to capture the duration and
      // any agreed weightage changes, and the weightage change in particular
      // CANNOT be reconstructed later — once the employee edits the goal the
      // old number is gone.
      duration_minutes: l.duration_minutes ?? null,
      weightage_changes: l.weightage_changes ?? null,
      employee_ack: true, employee_ack_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { logFail('one-to-one insert refused', error); setMsg(SAVE_FAILED('discussion')); return }
    loadPeriodData()
  }

  /**
   * THE EMPLOYEE'S HALF OF SOMEBODY ELSE'S LOG.
   *
   * logDiscussion above sets employee_ack as it inserts, so the only
   * acknowledged rows were ones the employee created themselves. A discussion
   * logged by a manager or HOD could never collect the employee's tick — and
   * pms_finalise requires BOTH, so a manager-logged final review would have
   * been a new dead end replacing the old one.
   *
   * Addressed by row id, not by discussion type: acking by type would tick
   * every discussion of that type at once, which is wrong the moment there is
   * more than one KRA_SETTING conversation in a period.
   */
  const acknowledgeDiscussion = async (logId: string) => {
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('pms_one_to_one')
      .update({ employee_ack: true, employee_ack_at: new Date().toISOString() })
      .eq('id', logId).eq('employee_id', employeeId)
    setSaving(false)
    if (error) {
      logFail('discussion acknowledge refused', error)
      setMsg(SAVE_FAILED('acknowledgement')); return
    }
    setMsg('Acknowledged.')
    loadPeriodData(); reload()
  }

  return (
    <>
      {msg && <div className="banner b-blue"><span aria-hidden="true">ℹ️</span><div>{msg}</div></div>}

      {/* Above the tabs, not inside one: a set that has come back needs saying
          wherever the employee happens to be looking. */}
      <ChainBanner stage={overall?.chain_stage}
                   sentBackReason={overall?.sent_back_reason}
                   sentBackAt={overall?.sent_back_at} />

      {tab === 'dashboard' && (
        <DashboardTab rules={rules} bands={bands.length ? bands : undefined}
          who={who}
          stages={STAGE_KEYS.map(k => ({ key: k, state: states[k],
                                         detail: k === 'kra' && goals.length
                                           ? `${goals.length} KRAs` : '' }))}
          current={stage}
          kraCount={goals.length}
          weightage={kras.reduce((s, k) => s + k.weightage, 0)}
          frequency="This period" periodLabel={period.period_code}
          lastRating={overall?.final_rating ?? null}
          lastScore={overall?.self_score ?? null}
          actionLabel={ACTION_LABEL[stage] ?? 'Nothing right now'}
          actionNote={actionNotes(rules)[stage] ?? ''} />
      )}
      {tab === 'kras' && (
        <KraTab rules={rules}
                carriedFrom={!goals.length && carried ? carried.fromPeriodCode : null}
                bands={bands.length ? bands : undefined}
                self={selfForKras}
                onSelfChange={(seq, patch) => setSelfBySeq(prev => ({
                  ...(prev ?? selfSeeded),
                  [seq]: { ...(prev ?? selfSeeded)[seq]
                             ?? { achievement: '', rating: null, comment: '' }, ...patch },
                }))}
                // Required only once the one-to-one is acknowledged: at that
                // point this submission is the final one the brief describes,
                // carrying the updated KRAs and the final self rating together.
                selfSubmitted={selfSubmitted}
                rateRequired={logs.some(l => l.discussion_type === 'KRA_SETTING'
                                          && (l.employee_ack || l.manager_ack))}
                kras={kras} onChange={setDraftKras} locked={locked}
                lockGate={lockGate} onSubmit={submitKras} saving={saving}
                // The tick that records the one-to-one. Required only where
                // the policy asks for the conversation at all.
                confirmOneToOne={confirmOneToOne}
                onConfirmOneToOne={setConfirmOneToOne}
                oneToOneRequired={policy?.one_to_one_mandatory !== false}
                oneToOneAlready={oneToOneAlready} />
      )}
      {tab === 'oneToOne' && (
        <OneToOneTab kras={kras.map(k => ({ seq_no: k.seq_no, kra_title: k.kra_title, weightage: k.weightage }))}
                     logs={logs} managerName="your manager"
                     onLog={logDiscussion} onAcknowledge={acknowledgeDiscussion}
                     saving={saving} />
      )}
      {tab === 'self' && (
        !locked
          ? <div className="banner b-amber"><span aria-hidden="true">🔒</span><div>
              Self rating opens once your weightages are locked. {lockGate.because}
            </div></div>
          : <SelfRatingTab bands={bands.length ? bands : undefined}
                           rows={selfRows} onChange={setSelfDraft} submitted={selfSubmitted}
                           onSubmit={submitSelf} saving={saving} />
      )}
      {tab === 'result' && (
        <ResultTab bands={bands.length ? bands : undefined}
          published={published} lines={lines}
          finalRating={overall?.final_rating ?? null}
          finalisedBy={null} finalisedOn={null} deptAverage={null}
          onAcknowledge={acknowledgeResult}
          acknowledged={overall?.workflow_status === WORKFLOW.ACKNOWLEDGED}
          appreciation={feedbackVisible ? feedback?.appreciation_remark as string | undefined : undefined}
          improvement={feedbackVisible ? feedback?.improvement_feedback as string | undefined : undefined}
          benefits={feedbackVisible ? benefits : []} publishGate={publishGate} />
      )}
      {tab === 'analytics' && (
        <AnalyticsTab lines={lines} trend={[]} published={published} />
      )}
    </>
  )
}

const STAGE_KEYS = STAGES.map(s => s.key)

const ACTION_LABEL: Record<StageKey, string> = {
  kra: 'Write your KRAs', oneToOne: 'The KRA discussion',
  lock: 'Waiting on your manager', self: 'Your self rating',
  review: 'With your manager', finalise: 'With the HOD', result: 'Read your result',
}
/** The stage chips' sub-labels.
 *
 *  A FUNCTION, because the KRA note quotes the policy's numbers and a module
 *  constant can only quote the fallback. It read "4 to 10, totalling 100" on
 *  a policy of 5, which is the same defect as the rest of this change, just
 *  in a place that looked too small to be wrong. */
const actionNotes = (rules: Rules): Record<StageKey, string> => ({
  kra: `${rules.minKra} to ${rules.maxKra}, totalling ${rules.totalWeightage}`,
  oneToOne: 'Both of you have to acknowledge it',
  lock: 'They lock the weightages once acknowledged',
  self: 'Rate every KRA, then submit (it locks)',
  review: 'Nothing owed from you right now',
  finalise: 'Nothing owed from you right now',
  result: 'Acknowledge once you have read it',
})

// ── the manager's side ───────────────────────────────────────────────────

/** Reads the frozen chain, not a live reporting lookup. */
function useRoster(employeeId: string, period: Period | null, as: 'rm' | 'hod') {
  const [rows, setRows] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!period) { setRows([]); setLoading(false); return }
    setLoading(true)
    const q = supabase.from('pms_overall_rating')
      // kra_count and total_weightage are deliberately NOT selected: nothing in
      // the schema writes them. See the comment below, and the test that keeps
      // them out.
      .select('employee_id,workflow_status,self_score,rm_l1_score,rm_l2_score,final_rating,rm_l1_id,rm_l2_id,hod_id,employment_flag,chain_stage,sent_back_to,sent_back_reason,published_at,employee_ack')
      .eq('period_id', period.id)
    const { data } = as === 'hod'
      ? await q.eq('hod_id', employeeId)
      : await q.or(`rm_l1_id.eq.${employeeId},rm_l2_id.eq.${employeeId}`)
    if (!data?.length) { setRows([]); setLoading(false); return }

    const ids = data.map(d => d.employee_id)
    const { data: emps } = await supabase.from('employees')
      .select('id,emp_code,full_name,date_of_leaving,date_of_resignation,company_doj').in('id', ids)
    const byId = new Map((emps ?? []).map(e => [e.id, e as Record<string, unknown>]))

    // HOW MANY KRAs, COUNTED FROM THE KRAs.
    //
    // pms_overall_rating carries kra_count and total_weightage, and NOTHING IN
    // THE SCHEMA EVER WRITES EITHER — no trigger, no function, no migration.
    // They were denormalised counters that stayed null because the module had
    // never held a goal. Reading them showed every manager "No KRAs written
    // yet. They cannot be rated at all until there are." for an employee whose
    // own screen said four KRAs totalling 100, which is the worst way for two
    // screens to disagree: both confident, one wrong, and the wrong one is the
    // one that decides whether anybody can act.
    const { data: goals } = await supabase.from('pms_employee_goals')
      .select('employee_id,weightage,status')
      .eq('period_id', period.id).in('employee_id', ids)
    const goalsBy = new Map<string, { n: number; wt: number; locked: boolean }>()
    for (const g of goals ?? []) {
      const k = String((g as { employee_id: string }).employee_id)
      const cur = goalsBy.get(k) ?? { n: 0, wt: 0, locked: false }
      cur.n += 1
      cur.wt += Number((g as { weightage?: number }).weightage) || 0
      // THE LOCK ITSELF, not the one-to-one it usually follows. 199 refuses a
      // finalise on unlocked weightages, and the two facts come apart: a
      // doubly acknowledged one-to-one whose pms_lock_kras call was refused
      // (bad KRA count, weightage not totalling the policy's figure) leaves
      // the goals editable. Inferring the lock from the acknowledgement would
      // offer a finalise the database then refuses.
      if ((g as { status?: string }).status === 'LOCKED') cur.locked = true
      goalsBy.set(k, cur)
    }

    // WHETHER THE ONE-TO-ONE HAPPENED, read from the one-to-one.
    //
    // This used to be inferred as "workflow_status is not NOT_STARTED and the
    // weightage totals 100", which is not what a one-to-one is — and rested on
    // the same counter that is never written, so it was false for everybody
    // always. pms_lock_kras asks the real question: a KRA_SETTING discussion
    // acknowledged by BOTH sides. Asking it the same way here means the screen
    // and the database agree about who is waiting on whom.
    // Both discussion types in one read, because the finalise gate needs the
    // FINAL_REVIEW one the same way the weightage lock needs the KRA_SETTING
    // one: pms_finalise refuses outright without it when the policy asks for
    // it, so a screen that does not look leaves the HOD guessing.
    const { data: talks } = await supabase.from('pms_one_to_one')
      .select('employee_id,discussion_type,manager_role,employee_ack,manager_ack')
      .eq('period_id', period.id)
      .in('discussion_type', ['KRA_SETTING', 'FINAL_REVIEW', 'ADHOC'])
      .in('employee_id', ids)
    const ackedOf = (kind: string) => new Set((talks ?? [])
      .filter(t => (t as { discussion_type?: string }).discussion_type === kind
                && (t as { employee_ack?: boolean }).employee_ack
                && (t as { manager_ack?: boolean }).manager_ack)
      .map(t => String((t as { employee_id: string }).employee_id)))
    const bothAcked = ackedOf('KRA_SETTING')
    const finalAcked = ackedOf('FINAL_REVIEW')
    const finalLogged = new Set((talks ?? [])
      .filter(t => (t as { discussion_type?: string }).discussion_type === 'FINAL_REVIEW')
      .map(t => String((t as { employee_id: string }).employee_id)))
    // The manager's half on its own, so the queue can tell "my turn" from
    // "waiting on them" and offer the right button rather than a dead label.
    const finalMgrAcked = new Set((talks ?? [])
      .filter(t => (t as { discussion_type?: string }).discussion_type === 'FINAL_REVIEW'
                && (t as { manager_ack?: boolean }).manager_ack)
      .map(t => String((t as { employee_id: string }).employee_id)))
    // RM L2's own confirmation. ADHOC is the type autoLogFor assigns that
    // rung: the schema allows KRA_SETTING, MID_PERIOD, FINAL_REVIEW and ADHOC,
    // and an L2's review conversation is none of the first three.
    const l2Confirmed = new Set((talks ?? [])
      .filter(t => (t as { discussion_type?: string }).discussion_type === 'ADHOC'
                && (t as { manager_role?: string }).manager_role === 'RM_L2'
                && (t as { manager_ack?: boolean }).manager_ack)
      .map(t => String((t as { employee_id: string }).employee_id)))

    setRows(data.map(d => {
      const e = byId.get(d.employee_id)
      const g = goalsBy.get(String(d.employee_id)) ?? { n: 0, wt: 0, locked: false }
      return {
        employeeId: String(d.employee_id),
        code: String(e?.emp_code ?? ''),
        name: String(e?.full_name ?? 'Unknown'),
        dateOfLeaving: (e?.date_of_leaving as string | null) ?? null,
        resignationDate: (e?.date_of_resignation as string | null) ?? null,
        dateOfJoining: (e?.company_doj as string | null) ?? null,
        /**
         * NOT pms_overall_rating.employment_flag.
         *
         * That column is NOT NULL DEFAULT 'ACTIVE' and is written only by
         * pms_finalise. Every one of the 395 rows in the database holds
         * 'ACTIVE' while the view computes EXITED for one and NOTICE_PERIOD
         * for another — and because the queue read it through `??`, which
         * cannot fall through on a non-null value, flagFor NEVER RAN. Every
         * employee appeared Active in every RM and HOD queue, so §4.1's
         * yellow and orange rows, the blue NEW_JOINER badge, the LWD
         * countdown and §8's notice-period priority sort had never once
         * shown. The feature was there; nothing could reach it.
         *
         * Left null deliberately so flagFor derives the flag from the dates
         * above, with the policy's cut-off and the period end — neither of
         * which the stored column or vw_pms_employment_flag knows about.
         */
        flagOverride: null,
        kraCount: g.n,
        totalWeightage: g.wt,
        kraLocked: g.locked,
        oneToOneDone: bothAcked.has(String(d.employee_id)),
        finalReviewDone: finalAcked.has(String(d.employee_id)),
        finalReviewLogged: finalLogged.has(String(d.employee_id)),
        finalReviewMgrAcked: finalMgrAcked.has(String(d.employee_id)),
        rmL2ConfirmedOneToOne: l2Confirmed.has(String(d.employee_id)),
        selfSubmitted: d.self_score != null,
        selfScore: d.self_score == null ? null : Number(d.self_score),
        rmL1Score: d.rm_l1_score == null ? null : Number(d.rm_l1_score),
        rmL2Score: d.rm_l2_score == null ? null : Number(d.rm_l2_score),
        rmL1Id: (d.rm_l1_id as string | null) ?? null,
        rmL2Id: (d.rm_l2_id as string | null) ?? null,
        hodId: (d.hod_id as string | null) ?? null,
        chainStage: (d.chain_stage as string | null) ?? null,
        sentBackTo: (d.sent_back_to as string | null) ?? null,
        sentBackReason: (d.sent_back_reason as string | null) ?? null,
        finalRating: d.final_rating == null ? null : Number(d.final_rating),
        finalised: d.final_rating != null,
        /**
         * PUBLISHED, read from the two facts that mean it rather than one.
         *
         * A publish writes workflow_status PUBLISHED and chain_stage DONE, and
         * an acknowledgement moves the status on to ACKNOWLEDGED. Reading only
         * the status would miss a row published before 197 existed; reading
         * only the stage would miss one whose stage was never advanced. Either
         * marker is enough, which is the same rule HR's publish queue uses to
         * split its two lists.
         */
        published: d.workflow_status === 'PUBLISHED'
                || d.workflow_status === 'ACKNOWLEDGED'
                || d.chain_stage === 'DONE',
        publishedAt: (d.published_at as string | null) ?? null,
        resultAcknowledged: d.employee_ack === true,
      }
    }))
    setLoading(false)
  }, [employeeId, period, as])

  useEffect(() => { load() }, [load])
  return { rows, loading, reload: load }
}

function TeamSide({ employeeId, tab }: { employeeId: string; tab: MgrTab }) {
  // employeeId here is the MANAGER. The person being acted on is `picked`.
  // policy for its approval_chain: which rung finalises depends on the chain,
  // and a hardcoded guess would put "Approve & finalise" on the wrong manager.
  const { period, loading: pLoading, companyId, reload, bands, rules, flagRules,
          policy } = usePeriod(employeeId)
  const { rows, loading, reload: reloadRoster } = useRoster(employeeId, period, 'rm')
  const [picked, setPicked] = useState<string | null>(null)
  const [rateRows, setRateRows] = useState<RateRow[]>([])
  const [overall, setOverall] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const today = localToday()

  const member = useMemo(
    () => rows.find(r => r.employeeId === picked) ?? null, [rows, picked])

  /**
   * The reportee's KRAs and their own ratings, side by side, for the one
   * person being rated.
   *
   * THIS IS WHAT MADE THE TAB A DEAD END. rateRows started as [] and nothing
   * ever filled it, so even reaching the screen showed a manager an empty
   * rating form — and submitRating had to refuse an empty set to avoid
   * upserting nothing and reporting success. Two reads: the goals, and the
   * SELF reviews keyed to them.
   */
  useEffect(() => {
    if (!picked || !period) { setRateRows([]); return }
    let live = true
    ;(async () => {
      const g = await supabase.from('pms_employee_goals')
        .select('id,seq_no,kra_title,category,weightage')
        .eq('employee_id', picked).eq('period_id', period.id)
        .neq('status', 'SENT_BACK').order('seq_no')
      if (g.error) { logFail('could not read the KRAs to rate', g.error); return }
      const goalRows = (g.data ?? []) as Record<string, unknown>[]

      // EVERY RUNG'S RATING, not just this viewer's.
      //
      // It used to read SELF, RM_L1 and RM_L2 and then sort them into
      // "mine" and "other" by rater_id, because this screen was a rating
      // form and only one row on it was editable. It is a record now — "how
      // much did R1, R2 and the HOD each give" is the question — so the
      // rows are kept apart by ROLE, which is also what pms_reviews is
      // unique on.
      const r = await supabase.from('pms_reviews')
        .select('goal_id,rater_id,rater_role,rating,comments,achievement_value')
        .eq('employee_id', picked).eq('period_id', period.id)
        .in('rater_role', ['SELF', ...CHAIN_RATERS])
      if (r.error) logFail('could not read the ratings', r.error)
      const byGoal = new Map<string, Partial<Record<RaterRole,
        { rating: number | null; comment: string; achievement?: string }>>>()
      for (const row of (r.data ?? []) as Record<string, unknown>[]) {
        const k = String(row.goal_id)
        const role = String(row.rater_role) as RaterRole
        byGoal.set(k, { ...(byGoal.get(k) ?? {}), [role]: {
          rating: row.rating == null ? null : Number(row.rating),
          comment: String(row.comments ?? ''),
          achievement: String(row.achievement_value ?? ''),
        } })
      }

      if (!live) return
      setRateRows(goalRows.map(gr => {
        const by = byGoal.get(String(gr.id)) ?? {}
        return {
          goalId: String(gr.id),
          title: String(gr.kra_title ?? ''),
          category: String(gr.category ?? 'BUSINESS') as Category,
          weightage: Number(gr.weightage) || 0,
          // Whoever recorded it. The employee writes it on their own form;
          // a rung can overwrite it on theirs, and the later one is the one
          // worth showing.
          achievement: by.SELF?.achievement
            || CHAIN_RATERS.map(x => by[x]?.achievement).find(Boolean) || '',
          by,
        }
      }))
    })()
    return () => { live = false }
  }, [picked, period])

  /**
   * The manager's half of the one-to-one, and the lock that follows it.
   *
   * BOTH SIDES HAVE TO ACKNOWLEDGE, and the database is the one that insists:
   * pms_lock_kras refuses unless a KRA_SETTING discussion exists with
   * employee_ack AND manager_ack both true, when the policy makes the
   * one-to-one mandatory. So this ticks the manager's side first and then asks
   * to lock — one press, because to a manager "I confirm we spoke" and "so
   * these are now the KRAs" are one decision.
   *
   * pms_lock_kras RETURNS A STRING, NOT AN ERROR. 'LOCKED', or
   * 'BLOCKED: <why>' — a validation failure comes back as a perfectly
   * successful call carrying a refusal in its payload. Checking only `error`
   * would report success while nothing had been locked, which is the exact
   * shape of bug this module has already had twice.
   */
  const acknowledge = async (id: string) => {
    if (!companyId) { setMsg(NO_COMPANY); return }
    setSaving(true); setMsg(null)
    /**
     * RM L1'S TICK, through the shared recorder.
     *
     * It used to UPDATE a KRA_SETTING row and refuse if none existed — "they
     * log it from their own Performance screen" — which made the manager
     * dependent on the employee having filled a form. The employee's tick
     * creates that row now, but the manager's tick must also be able to
     * create it: a conversation the manager held and the employee has not yet
     * confirmed is still a conversation, and the lock will simply wait for the
     * second acknowledgement rather than for a form.
     */
    const rec = await recordOneToOne({
      companyId, periodId: period!.id, employeeId: id,
      managerId: employeeId, stage: 'RM_L1', today,
    })
    if (rec === 'ERROR') {
      setSaving(false); setMsg(SAVE_FAILED('acknowledgement')); return
    }
    const lock = await supabase.rpc('pms_lock_kras',
      { p_employee_id: id, p_period_id: period!.id, p_manager_id: employeeId })
    setSaving(false)
    if (lock.error) {
      logFail('pms_lock_kras failed', lock.error)
      setMsg('Acknowledged, but the weightages could not be locked. Try again, and tell HR if it keeps happening.')
    } else if (typeof lock.data === 'string' && lock.data.startsWith('BLOCKED')) {
      // The reason is written for a manager, so it is worth showing verbatim.
      setMsg(`Acknowledged, but not locked yet — ${lock.data.replace(/^BLOCKED:\s*/, '')}.`)
    } else {
      setMsg('Acknowledged, and their weightages are locked.')
    }
    reload(); reloadRoster()
  }

  /**
   * THE OTHER ONE-TO-ONE THE CYCLE CANNOT FINISH WITHOUT.
   *
   * Where the policy sets final_review_one_to_one — the schema default, and
   * true for every company in the database — pms_finalise refuses until a
   * FINAL_REVIEW discussion exists with BOTH acknowledgements. The employee
   * logs it and self-acks in one step; nothing anywhere could supply the
   * manager's half, so the final gate was unopenable and the cycle had no
   * ending. Observed live: Arjun Malhotra's finalise returned "BLOCKED: final
   * review one-to-one not logged" with no screen able to clear it.
   *
   * No lock call here — that belongs to the KRA discussion, which is what
   * freezes weightages. This one only records that the conversation happened.
   */
  /**
   * LOG the final review, from the manager's or HOD's side.
   *
   * THE DEAD END THIS REMOVES. pms_finalise refuses until a FINAL_REVIEW
   * discussion exists with BOTH acknowledgements, and until now the ONLY code
   * anywhere that could create such a row was the employee's own one-to-one
   * form. acknowledgeFinalReview below can add the manager's tick to an
   * existing row; it cannot bring one into being. So if the employee never
   * logged a final review, the HOD was blocked permanently and the screen told
   * them to go and ask the employee to log it — for a meeting the HOD runs.
   *
   * Observed live, and this is what prompted it: Anil Verma (STC9030) had four
   * locked KRAs totalling 100, SELF, RM L1 and RM L2 ratings all in, and
   * chain_stage HOD. Kiran Patel is his frozen HOD and the policy is HOD_ONLY,
   * so every gate was satisfied except this one — and there was no screen in
   * the product that could satisfy it.
   *
   * ALREADY PERMITTED: §2's matrix gives log_one_to_one to RM L1, RM L2 and
   * HOD as well as the employee — [Y, Y, Y, Y, N, N, N]. The right to do this
   * was always there; only the button was missing.
   *
   * The manager's own tick goes on at the same time, because logging it IS the
   * manager asserting the conversation happened. The employee still has to
   * acknowledge, which is the point of a two-party record — so this does not
   * let a HOD finalise unilaterally, it gives the gate a second door.
   */
  /** See insertFinalReview at module scope for why this exists. */
  const logFinalReview = async (id: string, points: string) => {
    if (!companyId) { setMsg(NO_COMPANY); return }
    setSaving(true); setMsg(null)
    const r = await recordOneToOne({
      companyId, periodId: period!.id, employeeId: id,
      managerId: employeeId, stage: 'HOD', today,
    })
    setSaving(false)
    setMsg(r === 'RECORDED' ? FINAL_REVIEW_LOGGED
         : r === 'ALREADY' ? 'You have already confirmed the final review for them.'
         : SAVE_FAILED('final review'))
    reload(); reloadRoster()
  }

  const acknowledgeFinalReview = async (id: string) => {
    setSaving(true); setMsg(null)
    const ack = await supabase.from('pms_one_to_one')
      .update({ manager_ack: true, manager_ack_at: new Date().toISOString() })
      .eq('employee_id', id).eq('period_id', period!.id)
      .eq('discussion_type', 'FINAL_REVIEW')
      .select('id')
    setSaving(false)
    if (ack.error) {
      logFail('final review acknowledge refused', ack.error)
      setMsg(SAVE_FAILED('acknowledgement')); return
    }
    if (!ack.data?.length) {
      // No longer a dead end: logFinalReview above can create the row, and the
      // Finalise tab offers it on exactly these rows.
      setMsg('There is no final review discussion logged for them yet. Log it '
           + 'yourself from the Review & Finalise tab, or ask them to log it '
           + 'from their One-to-One Log.')
      return
    }
    setMsg('Final review acknowledged. Once they have acknowledged it too, the rating can be settled.')
    reloadRoster()
  }

  /**
   * WHICH RUNG OF THE CHAIN THE VIEWER IS ON FOR ONE EMPLOYEE.
   *
   * Resolved per employee, not once for the viewer. One manager is RM L1 to
   * their own reportees and HOD to a department at the same time — SRS9009 is
   * L1, L2 and HOD across his team — so a single rung computed once would be
   * wrong for part of the queue in both directions: hiding approvals that are
   * genuinely theirs and offering ones that are not.
   *
   * myRaterRole below answers a narrower question — which rater_role a rating
   * is written under — and returns null for a HOD, who rates through
   * hod_score rather than pms_reviews. The chain needs the wider answer: a HOD
   * approves and rejects like anybody else in the line.
   *
   * Read from the frozen chain on the row, same as everything else here.
   */
  /**
   * THE EMPLOYEE'S FILLED FORM, loaded on demand.
   *
   * On demand and not with the queue: a manager with 30 reportees would
   * otherwise pull 30 KRA sets and 30 sets of self ratings to render a table
   * of counts. Opened one at a time, which is how it is read.
   */
  const [kraFor, setKraFor] = useState<string | null>(null)
  const [kraLines, setKraLines] = useState<KraLine[] | null>(null)
  /**
   * THIS RATER'S SCORES, while the panel is open.
   *
   * Seeded from what they have already written, so reopening shows their own
   * work rather than an empty form — and a second visit after a send-back is
   * an edit, not a restart.
   */
  const [kraRate, setKraRate] = useState<Record<string, { rating: number | null; comment: string }>>({})
  const [kraFinal, setKraFinal] = useState('')
  /** The one-to-one tick, for the employee whose panel is open. */
  const [confirmKra, setConfirmKra] = useState(false)
  const openKras = useCallback(async (id: string) => {
    setKraFor(id); setKraLines(null)
    if (!period) return
    const [g, rv] = await Promise.all([
      supabase.from('pms_employee_goals')
        .select('id,seq_no,kra_title,kpi_metric,target_value,category,weightage,status,source')
        .eq('employee_id', id).eq('period_id', period.id).order('seq_no'),
      // The employee's OWN rating, which is the half a manager most needs to
      // read before approving: rater_role SELF, not their own rating of them.
      supabase.from('pms_reviews')
        .select('goal_id,achievement_value,rating,comments')
        .eq('employee_id', id).eq('period_id', period.id).eq('rater_role', 'SELF'),
    ])
    // What this rater has already said about each KRA. Loaded alongside the
    // employee's own ratings, in the same round trip.
    const mine = chainRoleFor(id)
    const mineRows = mine ? await supabase.from('pms_reviews')
      .select('goal_id,rating,comments')
      .eq('employee_id', id).eq('period_id', period.id).eq('rater_role', mine) : null
    setKraRate(Object.fromEntries((mineRows?.data ?? []).map(r => {
      const x = r as { goal_id: string; rating?: number; comments?: string }
      return [String(x.goal_id),
              { rating: x.rating == null ? null : Number(x.rating), comment: x.comments ?? '' }]
    })))
    setKraFinal('')

    const selfBy = new Map((rv.data ?? []).map(r => {
      const x = r as { goal_id: string; achievement_value?: string; rating?: number; comments?: string }
      return [String(x.goal_id), x]
    }))
    setKraLines((g.data ?? []).map(row => {
      const x = row as Record<string, unknown>
      const s = selfBy.get(String(x.id))
      return {
        goalId: String(x.id),
        seqNo: Number(x.seq_no), title: String(x.kra_title ?? ''),
        kpi: (x.kpi_metric as string) ?? null, target: (x.target_value as string) ?? null,
        category: (x.category as string) ?? null,
        weightage: Number(x.weightage) || 0,
        status: (x.status as string) ?? null, source: (x.source as string) ?? null,
        achievement: s?.achievement_value ?? null,
        selfRating: s?.rating == null ? null : Number(s.rating),
        selfComment: s?.comments ?? null,
      }
    }))
  }, [period])

  const chainRoleFor = useCallback((id: string) => {
    const m = rows.find(r => r.employeeId === id)
    return m ? rungFor(m, employeeId) : null
  }, [rows, employeeId])

  /**
   * Hand the set back, with a reason. Their own screen reads sent_back_reason,
   * so the reason is the whole point of the action.
   *
   * CHAIN-AWARE, and that changes where it goes. Before 197 this was always a
   * send-back to the EMPLOYEE, because nothing recorded where in the line the
   * appraisal had got to. Now an RM L2's rejection reaches RM L1 and only the
   * first rung's rejection reaches the employee — so the RPC decides the
   * destination, not this screen, and the screen reports what it chose.
   *
   * The direct-update path is kept for a row with no stage: appraisals already
   * in flight when 197 was applied have chain_stage NULL, and refusing to send
   * those back would strand them. It writes exactly what it always wrote.
   */
  const sendBack = async (id: string, reason: string) => {
    setSaving(true); setMsg(null)
    const row = rows.find(r => r.employeeId === id)
    const myRung = chainRoleFor(id)

    if (row?.chainStage && myRung) {
      const r = await supabase.rpc('pms_chain_reject', {
        p_employee_id: id, p_period_id: period!.id,
        p_actor_id: employeeId, p_actor_role: myRung, p_remark: reason,
      })
      setSaving(false)
      if (r.error) {
        logFail('pms_chain_reject failed', r.error)
        setMsg(SAVE_FAILED('rejection')); return
      }
      const out = String(r.data ?? '')
      if (out.startsWith('BLOCKED')) {
        // Written for a manager, so it is worth showing verbatim.
        setMsg(out.replace(/^BLOCKED:\s*/, 'Not sent back — '))
      } else {
        const to = out.split(':')[1]
        setMsg(to === 'EMPLOYEE'
          ? 'Sent back to the employee, with your reason.'
          : `Sent back to ${String(to).replace('_', ' ')}, with your reason.`)
      }
      reload(); reloadRoster()
      return
    }

    const { error } = await supabase.from('pms_employee_goals')
      .update({ status: 'SENT_BACK', sent_back_reason: reason })
      .eq('employee_id', id).eq('period_id', period!.id)
    setSaving(false)
    if (error) { logFail('send back refused', error); setMsg(SAVE_FAILED('note')); return }
    setMsg('Sent back, with your reason.')
    reloadRoster()
  }

  /**
   * Approve and pass it up the line — or, at the last rung, finalise.
   *
   * ONE CALL, because the two cannot be separated safely. pms_chain_approve
   * locks the weightages at the first rung and calls pms_finalise at the last,
   * both inside the one statement, so a half-done approval cannot be left
   * behind by a failed second request. The rating is only wanted at the rung
   * that finalises; everywhere else it is ignored, and passing it would be a
   * lie about who set the number.
   */
  /**
   * RATE, CONFIRM AND APPROVE — one act, in this order.
   *
   * They used to be two tabs, and the chain then stalled on its own rule:
   * 199 will not let a rung settle anything until every rung ahead has rated,
   * so a manager who approved without visiting Rate My Team passed the set up
   * and blocked it there with no sign of why.
   *
   * THE ORDER IS LOAD-BEARING TWICE OVER. The ratings go first because
   * trg_pms_sync_role_score turns them into rm_l1_score / rm_l2_score /
   * hod_score, and 199 reads those scores — written after the approval, the
   * approval would be refused for want of a number that is about to exist.
   * The one-to-one then precedes the approval for the same reason at RM L1,
   * where pms_lock_kras counts a row carrying both acknowledgements.
   *
   * A failure at any step stops the next. Half of this is worse than none of
   * it: a rating recorded against an appraisal that did not move is a number
   * the employee cannot see and the chain will not use.
   */
  const rateAndApprove = async (id: string, finalRating?: number) => {
    const myRung = chainRoleFor(id)
    if (!myRung) {
      setMsg('You are not recorded in this employee\u2019s chain for this period, so you cannot approve it.')
      return
    }
    if (!companyId) { setMsg(NO_COMPANY); return }
    const lines = kraLines ?? []
    const missing = lines.filter(l => l.goalId && kraRate[l.goalId]?.rating == null)
    if (!lines.length || missing.length) {
      setMsg(`Rate every KRA before sending it on — ${missing.length} of ${lines.length} still have no rating from you.`)
      return
    }
    // A DIFFERENCE FROM THEIR OWN RATING NEEDS A REASON. The panel disables
    // the button for this, but a disabled button is a suggestion: the state
    // can be stale by the time the click lands, and this is the function that
    // actually writes the row. Same check, from the same helper, so the two
    // cannot drift into disagreeing about what counts as unexplained.
    const unexplained = compareRatings(lines.filter(l => l.goalId).map(l => ({
      goalId: l.goalId!, title: `${l.seqNo}. ${l.title || 'untitled'}`,
      weightage: Number(l.weightage) || 0,
      self: l.selfRating ?? null,
      mine: kraRate[l.goalId!]?.rating ?? null,
      comment: kraRate[l.goalId!]?.comment ?? null,
    }))).missingReasons
    if (unexplained.length) {
      setMsg('Say why where your rating differs from theirs — '
        + `${unexplained.length} still unexplained: `
        + unexplained.map(m => m.title).join(', ') + '.')
      return
    }

    setSaving(true); setMsg(null)
    const rv = await supabase.from('pms_reviews').upsert(
      lines.map(l => ({
        company_id: companyId, period_id: period!.id, employee_id: id,
        goal_id: l.goalId, rater_id: employeeId, rater_role: myRung,
        rating: kraRate[l.goalId!]!.rating,
        comments: kraRate[l.goalId!]!.comment || null,
        submitted: true, submitted_at: new Date().toISOString(),
      })),
      { onConflict: 'period_id,employee_id,goal_id,rater_role' })
    if (rv.error) {
      setSaving(false)
      logFail('manager rating refused', rv.error)
      setMsg(SAVE_FAILED('rating')); return
    }
    // The prose half, same act. Written before the approval so a failure
    // here stops the chain moving rather than leaving the comment behind a
    // set that has already gone up.
    if (!(await saveOverall(id, myRung))) {
      setSaving(false)
      setMsg('The ratings were saved, but your overall comment was not. Try sending it again.')
      return
    }
    setSaving(false)
    await approveInChain(id, finalRating)
    setKraFor(null); setKraLines(null); setKraRate({}); setKraFinal(''); setOverall('')
  }

  const approveInChain = async (id: string, rating?: number) => {
    const myRung = chainRoleFor(id)
    if (!myRung) {
      setMsg('You are not recorded in this employee’s chain for this period, so you cannot approve it.')
      return
    }
    if (!companyId) { setMsg(NO_COMPANY); return }
    setSaving(true); setMsg(null)

    /**
     * THE TICK IS RECORDED BEFORE THE APPROVAL, not after.
     *
     * ChainApprovals will not call this until the checkbox is ticked, so the
     * confirmation is already given by the time we are here — but the ORDER
     * matters beyond bookkeeping. At RM L1 the approval calls pms_lock_kras,
     * which counts a KRA_SETTING row carrying BOTH acknowledgements; recording
     * afterwards would mean the lock looks for a row that does not exist yet
     * and refuses, and the manager would see "not locked" on an approval that
     * had just succeeded.
     *
     * A failure here stops the approval rather than being reported alongside
     * it: approving without the conversation on record is the thing the tick
     * exists to prevent.
     */
    const rec = await recordOneToOne({
      companyId, periodId: period!.id, employeeId: id,
      managerId: employeeId, stage: myRung, today,
    })
    if (rec === 'ERROR') {
      setSaving(false)
      setMsg('The one-to-one could not be recorded, so nothing was approved. Try again.')
      return
    }

    const r = await supabase.rpc('pms_chain_approve', {
      p_employee_id: id, p_period_id: period!.id,
      p_actor_id: employeeId, p_actor_role: myRung,
      p_rating: rating ?? null,
    })
    setSaving(false)
    if (r.error) {
      logFail('pms_chain_approve failed', r.error)
      setMsg(SAVE_FAILED('approval')); return
    }
    const out = String(r.data ?? '')
    if (out.startsWith('BLOCKED')) {
      setMsg(out.replace(/^BLOCKED:\s*/, 'Not approved — '))
    } else {
      const next = out.split(':')[1]
      setMsg(next === 'HR'
        ? 'Approved and settled. It is with HR to publish now.'
        : `Approved. It is with ${String(next).replace('_', ' ')} now.`)
    }
    reload(); reloadRoster()
  }

  /**
   * The manager's rating of one reportee, one row per KRA.
   *
   * WHICH MANAGER, read from the frozen chain rather than assumed. This used
   * to write rater_role: 'RM_L1' unconditionally. pms_reviews is keyed on
   * (period, employee, goal, rater_role), so an RM L2 rating written under
   * 'RM_L1' would not merely be mislabelled — the upsert would land on the
   * L1's row and DESTROY their rating. The same hardcoding also meant
   * pms_score(..., 'RM_L2') found nothing and the chain never advanced past
   * L1, which is the symptom somebody would have noticed first.
   *
   * The snapshot decides, not a live lookup — same reason pms_finalise reads
   * it: a reorg mid-cycle must not move half-rated appraisals.
   */
  /** ONE PERSON CAN HOLD BOTH RUNGS. In a small company the chain collapses:
   *  SRS9009 is RM L1, RM L2 and HOD for his whole team. Checking L1 first and
   *  stopping there meant he would write RM_L1 twice and the queue would say
   *  "With RM L2 now" for ever, because pms_score(..., 'RM_L2') had nothing to
   *  read. So the rung is the first one this person holds that is still
   *  unscored; once both are in, further edits land on whichever they hold,
   *  preferring L1, rather than being refused. */
  /**
   * WHICH RUNG THE VIEWER IS ON, decided against the frozen chain and not
   * against a guess, because the rating upsert keys on rater_role and writing
   * an L2's rating under 'RM_L1' overwrites the L1's.
   *
   * No both-rungs case to handle. pms_resolve_chain (067) will not store the
   * same person twice:
   *
   *   -- Same person at L1 and L2: drop L2, keep them as L1 reviewer
   *   IF v_l2 IS NOT NULL AND v_l2 = v_l1 THEN v_l2 := NULL; END IF;
   *
   * so a manager who is both is recorded as L1 alone, and the first match is
   * the only match. An earlier version here ordered the two tests by which
   * score was still unfilled, to let such a manager rate twice — that was
   * answering a question the database had already closed.
   */
  const myRaterRole = useMemo(() => {
    if (!member) return null
    if (member.rmL1Id && member.rmL1Id === employeeId) return 'RM_L1'
    if (member.rmL2Id && member.rmL2Id === employeeId) return 'RM_L2'
    return null
  }, [member, employeeId])

  /**
   * THE RM'S OVERALL COMMENT, written where the rating now is.
   *
   * It used to be collected by the rating tab and saved by submitRating.
   * That tab is a read-only record now, so this moved rather than went: the
   * capability belongs with the act that produces it, and deleting it would
   * have quietly dropped the one piece of prose an RM writes for their
   * reportee.
   *
   * pms_feedback is UNIQUE (period_id, employee_id) — ONE row per person per
   * period, passed along the chain — and this writes the RM's half of it.
   * IT GETS ITS OWN COLUMN (189): this used to write appreciation_remark,
   * which §5.2 gives to the HOD, so whoever saved last erased the other and
   * the RM always lost, silently.
   *
   * visible_to_employee stays false: §3.5 shows nothing before the result is
   * published, and that flag is what holds it back.
   */
  const saveOverall = async (id: string, role: string): Promise<boolean> => {
    if (!overall.trim() || !companyId) return true
    const fb = await supabase.from('pms_feedback').upsert({
      company_id: companyId, period_id: period!.id, employee_id: id,
      rm_overall_comment: overall.trim(),
      rm_overall_by: employeeId, given_by_role: role,
      visible_to_employee: false,
    }, { onConflict: 'period_id,employee_id' })
    if (fb.error) { logFail('overall comment refused', fb.error); return false }
    return true
  }

  if (pLoading || loading) return <div className="k">Loading…</div>
  if (!period) return <NoPeriod />

  return (
    <>
      {msg && <div className="banner b-blue"><span aria-hidden="true">ℹ️</span><div>{msg}</div></div>}
      {tab === 'team' && <TeamTab flagRules={flagRules} rules={rules} members={rows} today={today} managerName="your team" />}
      {tab === 'approve' && <ApproveTab flagRules={flagRules} rules={rules} members={rows} today={today}
                                        onAcknowledge={acknowledge} onSendBack={sendBack}
                                        onAcknowledgeFinalReview={acknowledgeFinalReview}
                                        viewerId={employeeId}
                                        chain={policy?.approval_chain as Chain | undefined ?? 'SELF_RM1_RM2_HOD'}
                                        onApprove={approveInChain}
                                        onOpenKras={openKras}
                                        kraDetail={kraFor && rows.find(r => r.employeeId === kraFor)
                                          ? (() => {
                                              const m = rows.find(r => r.employeeId === kraFor)!
                                              const rung = chainRoleFor(kraFor)
                                              // Only the rung HOLDING it may rate and approve;
                                              // anyone else gets the read-only record.
                                              const mine = rung && m.chainStage === rung
                                              const held = heldBy(m)
                                              return (
                                                <KraDetail member={m} lines={kraLines}
                                                  myRung={mine ? rung : null}
                                                  rate={kraRate}
                                                  onRate={(gid, patch) => setKraRate(p => {
                                                    const cur = p[gid] ?? { rating: null, comment: '' }
                                                    return { ...p, [gid]: { ...cur, ...patch } }
                                                  })}
                                                  bands={bands.length ? bands : undefined}
                                                  confirmed={confirmKra}
                                                  onConfirm={setConfirmKra}
                                                  alreadyConfirmed={
                                                    rung === 'RM_L1' ? m.oneToOneDone === true
                                                    : rung === 'HOD' ? m.finalReviewMgrAcked === true
                                                    : m.rmL2ConfirmedOneToOne === true}
                                                  finalises={!!rung && approvalFinalises(
                                                    (policy?.approval_chain as Chain | undefined) ?? 'SELF_RM1_RM2_HOD',
                                                    rung, held)}
                                                  finalRating={kraFinal}
                                                  onFinalRating={setKraFinal}
                                                  overallComment={overall}
                                                  onOverallComment={setOverall}
                                                  onApprove={fr => rateAndApprove(kraFor, fr)}
                                                  saving={saving}
                                                  onClose={() => { setKraFor(null); setKraLines(null)
                                                                   setKraRate({}); setKraFinal('') }} />
                                              )
                                            })()
                                          : null}
                                        bands={bands.length ? bands : undefined} />}
      {tab === 'rate' && (
        <RateTab flagRules={flagRules} rules={rules} bands={bands.length ? bands : undefined}
                 members={rows} onPick={setPicked} today={today}
                 member={member} rows={rateRows} />
      )}
      {tab === 'pip' && <PipRequestTab flagRules={flagRules} members={rows} today={today} />}
      {tab === 'analytics' && (
        <TeamAnalyticsTab flagRules={flagRules} bands={bands.length ? bands : undefined}
                          members={rows} today={today} lines={[]}
                          deptAverage={null} companyAverage={null} scopeLabel="your team" />
      )}
    </>
  )
}

function DeptSide({ employeeId, tab }: { employeeId: string; tab: HodTab }) {
  const { period, loading: pLoading, bands, policy, companyId, flagRules } = usePeriod(employeeId)
  const { rows, loading, reload: reloadRoster } = useRoster(employeeId, period, 'hod')
  const [picked, setPicked] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const today = localToday()
  const member = rows.find(r => r.employeeId === picked) ?? null

  /**
   * THE DOOR THE HOD DID NOT HAVE. pms_finalise refuses until the
   * final-review one-to-one carries both acknowledgements, and nothing on the
   * HOD's side could create that row or even tick their own half — the
   * Finalise queue printed the blocker as plain text. So a HOD with every
   * other gate satisfied was permanently stuck. Both handlers live here now,
   * next to the queue that needs them.
   *
   * See insertFinalReview at module scope for why this is allowed: §2's matrix
   * grants log_one_to_one to the HOD.
   */
  const logFinalReview = async (id: string) => {
    if (!companyId) { setMsg(NO_COMPANY); return }
    setSaving(true); setMsg(null)
    const r = await recordOneToOne({
      companyId, periodId: period!.id, employeeId: id,
      managerId: employeeId, stage: 'HOD', today,
    })
    setSaving(false)
    setMsg(r === 'RECORDED' ? FINAL_REVIEW_LOGGED
         : r === 'ALREADY' ? 'You have already confirmed the final review for them.'
         : SAVE_FAILED('final review'))
    reloadRoster()
  }

  const acknowledgeFinalReview = async (id: string) => {
    setSaving(true); setMsg(null)
    const ack = await supabase.from('pms_one_to_one')
      .update({ manager_ack: true, manager_ack_at: new Date().toISOString() })
      .eq('employee_id', id).eq('period_id', period!.id)
      .eq('discussion_type', 'FINAL_REVIEW')
      .select('id')
    setSaving(false)
    if (ack.error) {
      logFail('final review acknowledge refused', ack.error)
      setMsg(SAVE_FAILED('acknowledgement')); return
    }
    if (!ack.data?.length) {
      setMsg('There is no final review logged for them yet. Use “Log final review” on that row.')
      return
    }
    setMsg('Acknowledged. Once they acknowledge it too, you can settle the rating.')
    reloadRoster()
  }

  /**
   * WHAT WENT OUT WITH EACH PUBLISHED RESULT, for the read-only record.
   *
   * Loaded for the whole department at once rather than per person: the tab
   * is a list, and a query per row would make it N+1 against a table that is
   * already keyed on (period, employee). Only published rows are fetched —
   * unpublished feedback is a draft the employee has not seen, and it has no
   * business on a screen titled Published Results.
   */
  const [published, setPublished] = useState<PublishedResult[]>([])
  useEffect(() => {
    if (!period) { setPublished([]); return }
    const ids = rows.filter(r => r.published).map(r => r.employeeId)
    if (!ids.length) { setPublished([]); return }
    let live = true
    ;(async () => {
      const [fb, ben] = await Promise.all([
        supabase.from('pms_feedback')
          .select('employee_id,appreciation_remark,improvement_feedback')
          .eq('period_id', period.id).in('employee_id', ids),
        supabase.from('pms_additional_benefits')
          .select('employee_id,benefit_type,benefit_note')
          .eq('period_id', period.id).in('employee_id', ids),
      ])
      if (!live) return
      const benBy = new Map<string, { type: string; note: string }[]>()
      for (const b of ben.data ?? []) {
        const r = b as { employee_id: string; benefit_type: string; benefit_note?: string }
        const k = String(r.employee_id)
        benBy.set(k, [...(benBy.get(k) ?? []),
                      { type: String(r.benefit_type), note: String(r.benefit_note ?? '') }])
      }
      // Driven off the PUBLISHED ids, not off the feedback rows: somebody can
      // be published with no written feedback at all, and they still belong in
      // the list. Keying on the feedback would quietly drop them.
      setPublished(ids.map(id => {
        const f = (fb.data ?? []).find(x => String((x as { employee_id: string }).employee_id) === id) as
          { appreciation_remark?: string; improvement_feedback?: string } | undefined
        return {
          employeeId: id,
          appreciation: f?.appreciation_remark ?? null,
          improvement: f?.improvement_feedback ?? null,
          benefits: benBy.get(id) ?? [],
        }
      }))
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.id, rows])

  /** What the HOD is writing, and the one-to-ones that decide whether it can
   *  be published. Reloaded whenever the picked person changes — keeping one
   *  draft across two employees is how feedback ends up on the wrong record. */
  type Draft = { appreciation: string; improvement: string
                 benefits: { type: BenefitType; note: string }[] }
  const EMPTY_DRAFT: Draft = { appreciation: '', improvement: '', benefits: [] }
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [logs, setLogs] = useState<Log[]>([])

  useEffect(() => {
    let live = true
    if (!picked || !period) { setDraft(EMPTY_DRAFT); setLogs([]); return }
    ;(async () => {
      const [fb, oo, ben] = await Promise.all([
        supabase.from('pms_feedback')
          .select('appreciation_remark,improvement_feedback')
          .eq('employee_id', picked).eq('period_id', period.id).maybeSingle(),
        supabase.from('pms_one_to_one')
          .select('discussion_type,discussion_date,mode,discussion_points,employee_ack,manager_ack')
          .eq('employee_id', picked).eq('period_id', period.id),
        supabase.from('pms_additional_benefits')
          .select('benefit_type,benefit_note')
          .eq('employee_id', picked).eq('period_id', period.id),
      ])
      if (!live) return
      setDraft({
        appreciation: String(fb.data?.appreciation_remark ?? ''),
        improvement: String(fb.data?.improvement_feedback ?? ''),
        benefits: (ben.data ?? []).map(b => ({
          type: (b as { benefit_type: BenefitType }).benefit_type,
          note: String((b as { benefit_note?: string }).benefit_note ?? ''),
        })),
      })
      setLogs((oo.data ?? []) as Log[])
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, period?.id])

  /**
   * §5.1 — the HOD signs off. This is the last gate in the cycle and the one
   * that makes a rating real: pms_overall_rating goes to FINALISED, final_score
   * is written, and an exited employee's record becomes permanently read-only.
   *
   * 'HOD' is not a self-assertion here. useRoster's hod scope selects on
   * hod_id = employeeId, so every row on this screen already names the viewer
   * as its HOD in the FROZEN chain — which is the same column pms_finalise
   * checks before it will do anything. A mismatch is therefore impossible by
   * construction, and if it somehow happened the function refuses and says so.
   */
  const finalise = async (id: string, rating: number) => {
    if (!period) return
    setSaving(true); setMsg(null)
    const r = await supabase.rpc('pms_finalise', {
      p_employee_id: id, p_period_id: period.id,
      p_actor_id: employeeId, p_actor_role: 'HOD',
      p_rating: rating, p_reason: null,
    })
    setSaving(false)
    if (r.error) {
      logFail('pms_finalise failed', r.error)
      setMsg(SAVE_FAILED('final rating')); return
    }
    // 188 returns a sentence written for the person reading this screen —
    // which rung is missing, whose chain it is. Paraphrasing it here would
    // only lose the detail that tells them what to do next.
    if (typeof r.data === 'string' && r.data.startsWith('BLOCKED')) {
      setMsg(`Not finalised — ${r.data.replace(/^BLOCKED:\s*/, '')}`)
    } else {
      setMsg('Finalised. Their rating is settled for this period.')
    }
    reloadRoster()
  }

  /**
   * §5.2 — publishing the result, which is the event §3.5 hangs all employee
   * visibility on: before it, "rating, comments — kuch bhi visible nahi".
   *
   * Three writes, in the order that fails safe. The feedback row goes first
   * and carries visible_to_employee, so if the status update were to fail the
   * employee still sees nothing — pms_overall_rating.workflow_status is what
   * the result screen reads. Doing it the other way round would open the
   * result and leave the remarks hidden, which is the worse half to show.
   *
   * Benefits are deleted and re-inserted rather than diffed: the table has no
   * natural key per row (awarded_at is a timestamp, not an identity), so there
   * is nothing to upsert on, and a handful of recognition rows is not worth
   * inventing one for.
   */
  const publishResult = async () => {
    if (!period || !picked || !member) return
    if (!companyId) { setMsg(NO_COMPANY); return }
    setSaving(true); setMsg(null)

    const fb = await supabase.from('pms_feedback').upsert({
      company_id: companyId, period_id: period.id, employee_id: picked,
      appreciation_remark: draft.appreciation.trim() || null,
      improvement_feedback: draft.improvement.trim() || null,
      given_by: employeeId, given_by_role: 'HOD',
      visible_to_employee: true,
    }, { onConflict: 'period_id,employee_id' })
    if (fb.error) {
      setSaving(false)
      logFail('feedback publish refused', fb.error)
      setMsg(SAVE_FAILED('feedback')); return
    }

    const kept = draft.benefits.filter(b => b.note.trim())
    await supabase.from('pms_additional_benefits')
      .delete().eq('period_id', period.id).eq('employee_id', picked)
    if (kept.length) {
      const ben = await supabase.from('pms_additional_benefits').insert(
        kept.map(b => ({
          company_id: companyId, period_id: period.id, employee_id: picked,
          benefit_type: b.type, benefit_note: b.note.trim(), awarded_by: employeeId,
        })))
      if (ben.error) {
        setSaving(false)
        logFail('recognition refused', ben.error)
        setMsg('The feedback saved, but the recognition rows did not. Add them again before telling them it is published.')
        return
      }
    }

    /**
     * PUBLISHING IS THE LAST MOVE IN THE CHAIN, so it closes the stage out.
     *
     * Without chain_stage going to DONE, a published appraisal sits at 'HR'
     * for ever: the employee's banner keeps saying it is with HR to publish
     * while their Result tab shows the rating, and HR's own queue never
     * empties. Two screens confidently disagreeing, which is the failure the
     * stage column was added to end rather than create.
     *
     * Set here rather than in a function because publishing is the one chain
     * move with no approval to check — 197 deliberately gives HR no reject
     * path and no rating to set. trg_pms_readonly allows both of these columns
     * on a locked record (193 for the status, 197 for the stage), so this
     * works for an exited employee too, which is the whole point of §8's
     * "result copy before the login closes".
     */
    const st = await supabase.from('pms_overall_rating')
      .update({ workflow_status: 'PUBLISHED', published_at: new Date().toISOString(),
                chain_stage: 'DONE' })
      .eq('employee_id', picked).eq('period_id', period.id)
    setSaving(false)
    if (st.error) {
      logFail('publish status refused', st.error)
      setMsg('The feedback saved but the result was not opened to them. Try publishing again.'); return
    }
    setMsg(`Published. ${member.name} can see their rating and feedback now.`)
    reloadRoster()
  }

  if (pLoading || loading) return <div className="k">Loading…</div>
  if (!period) return <NoPeriod />

  return (
    <>
      {msg && <div className="card" style={{ marginBottom: 10 }}>{msg}</div>}
      {tab === 'finalise' && (
        <FinaliseTab flagRules={flagRules} bands={bands.length ? bands : undefined}
                     members={rows} today={today} role="HOD"
                     chain={policy?.approval_chain ?? 'SELF_RM1_RM2_HOD'}
                     whoCanFinalise={policy?.who_can_finalise ?? 'RM1_RM2_HOD'}
                     finalReviewRequired={policy?.final_review_one_to_one ?? false}
                     deptName="your department"
                     onFinalise={finalise}
                     onLogFinalReview={logFinalReview}
                     onAcknowledgeFinalReview={acknowledgeFinalReview}
                     saving={saving} />
      )}
      {tab === 'feedback' && !showFinaliserFeedbackTab(
        (policy?.post_final_owner ?? 'HR') as PostFinalOwner) && (
        /* 202: HR OWNS THIS STEP BY DEFAULT.
           The tab stays in the strip rather than vanishing — HOD_TABS is a
           module constant shared with the preview screen, and more to the
           point a HOD who remembers writing feedback here needs to be told
           where it went rather than finding one fewer tab and wondering. The
           controls are genuinely gone, not disabled: there is nothing to type
           into below. */
        <>
          <div className="banner b-blue">
            <span aria-hidden="true">📋</span>
            <div>
              <b>HR writes this now.</b> Once you settle a rating, HR writes the
              appreciation and improvement feedback, awards any recognition and
              publishes the result. What went out is on <b>Published Results</b>,
              read-only. Your part ends at the rating.
            </div>
          </div>
          <div className="card">
            <div className="k" style={{ lineHeight: 1.7 }}>
              If your company would rather the finaliser did all of it — the
              appreciation remark, the improvement feedback and the recognition
              awards, as the spec&rsquo;s Stage 6 describes — HR can switch this
              policy&rsquo;s <b>post-finalisation owner</b> back to the finaliser
              in Setup &amp; Controls, and these controls return here.
            </div>
          </div>
        </>
      )}
      {tab === 'feedback' && showFinaliserFeedbackTab(
        (policy?.post_final_owner ?? 'HR') as PostFinalOwner) && (
        <>
          {/* FeedbackTab writes about ONE person and has no way to choose
              them; the finalisation queue is a different tab. Without this
              the tab rendered its "Pick somebody" empty state permanently,
              because nothing could ever set picked. Only finalised people are
              offered: there is no result to publish before there is a rating,
              and §3.5 makes publication the moment everything becomes
              visible. */}
          <div className="card" style={{ marginBottom: 10 }}>
            <div className="fld">
              <label htmlFor="fb-who">Whose result</label>
              <select id="fb-who" value={picked ?? ''}
                      onChange={e => setPicked(e.target.value || null)}>
                <option value="">Choose somebody…</option>
                {/* FINALISED AND NOT YET PUBLISHED.
                    Once a result is out, the employee has read their rating
                    and their feedback — editing it here would change a
                    document they have already been shown, and possibly
                    formally acknowledged. They move to Published Results,
                    which has no inputs at all. Leaving them in this list was
                    the gap: publishing left somebody sitting in a feedback
                    form that could still be typed into. */}
                {rows.filter(r => r.finalised && !r.published).map(r => (
                  <option key={r.employeeId} value={r.employeeId}>
                    {r.code} · {r.name} — rated {r.finalRating}
                  </option>
                ))}
              </select>
            </div>
            {/* Two different empty states, because they need different
                advice. Nobody finalised means go and finalise; everybody
                finalised ALREADY PUBLISHED means there is nothing owed and
                the record is one tab away. One message for both would send a
                HOD back to a queue they have already cleared. */}
            {!rows.some(r => r.finalised) ? (
              <div className="k" style={{ marginTop: 6, lineHeight: 1.6 }}>
                Nobody in your department has been finalised yet. Settle a rating on
                Review &amp; Finalise first — feedback is published with the result,
                not before it.
              </div>
            ) : !rows.some(r => r.finalised && !r.published) && (
              <div className="k" style={{ marginTop: 6, lineHeight: 1.6 }}>
                Every settled result in your department has been published. They
                are on <b>Published Results</b>, where they cannot be edited —
                the employees have already read them.
              </div>
            )}
          </div>
          <FeedbackTab bands={bands.length ? bands : undefined}
                       member={member} rating={member?.finalRating ?? null}
                       appreciation={draft.appreciation} improvement={draft.improvement}
                       benefits={draft.benefits} logs={logs}
                       onChange={patch => setDraft(d => ({ ...d, ...patch }))}
                       onPublish={publishResult}
                       onAcknowledgeFinalReview={picked ? () => acknowledgeFinalReview(picked) : undefined}
                       saving={saving} />
        </>
      )}
      {tab === 'published' && (
        <PublishedResultsTab members={rows} bands={bands.length ? bands : undefined}
                             results={published} deptName="Your department" />
      )}
      {tab === 'deptAnalytics' && (
        <TeamAnalyticsTab flagRules={flagRules} bands={bands.length ? bands : undefined}
                          members={rows} today={today} lines={[]}
                          deptAverage={null} companyAverage={null}
                          scopeLabel="your department" />
      )}
    </>
  )
}

// ── shared empties ───────────────────────────────────────────────────────

function NoPeriod() {
  return (
    <div className="card">
      <h3>No period is open</h3>
      <div className="k" style={{ lineHeight: 1.7, maxWidth: 620 }}>
        Nothing is running right now. A period opens when HR publishes the cycle
        configuration, and everybody eligible is enrolled at that moment. There is
        nothing to do here until then.
      </div>
    </div>
  )
}

function ModulePending() {
  return (
    <div className="pms">
      <div className="card">
        <h3>Waiting on migration 066</h3>
        <div className="k" style={{ lineHeight: 1.7, maxWidth: 680 }}>
          The performance module&rsquo;s tables do not exist in the database yet. These
          screens and the whole approval flow are built; they have nothing to read
          until <code>supabase/migrations/066_pms_module.sql</code> is applied. That
          file creates 15 tables, 9 functions, 10 views and 2 triggers.
          <br /><br />
          It is handed to Nayan rather than run from here. This project does not
          apply schema changes itself. Nothing on this page is broken; it is waiting.
        </div>
      </div>
    </div>
  )
}
