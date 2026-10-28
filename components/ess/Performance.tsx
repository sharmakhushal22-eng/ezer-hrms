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
  AnalyticsTab, type EmpTab, type Who, type SelfRow, type KraSelf,
} from '@/components/pms/EmployeeTabs'
import {
  MGR_TABS, HOD_TABS, TeamTab, ApproveTab, RateTab, PipRequestTab,
  TeamAnalyticsTab, FinaliseTab, FeedbackTab,
  BENEFIT_LABEL,
  type MgrTab, type HodTab, type RateRow, type BenefitType,
} from '@/components/pms/ManagerTabs'
import { type TeamMember } from '@/lib/pms/team'
import { type Chain, type Finaliser } from '@/lib/pms/hierarchy'
import { diffKras, type Kra, type Category, type KraChange } from '@/lib/pms/kra'
import { canLockWeightage, canPublishResult, type Log } from '@/lib/pms/oneToOne'
import { reached, WORKFLOW } from '@/lib/pms/status'
import { bandsFromScale, type Band, type Line, type ScaleRow } from '@/lib/pms/scoring'
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
              + 'new_joiner_cutoff_days')
        .eq('id', pid).maybeSingle()
      if (po.error) console.error('[pms] could not read the policy:', po.error)
      setPolicy(po.error ? null : (po.data as Policy | null))
    } else {
      setPolicy(null)
    }

    const o = await supabase.from('pms_overall_rating')
      .select('workflow_status,self_score,final_rating,final_rating_code,is_readonly')
      .eq('employee_id', employeeId).eq('period_id', p.data.id).maybeSingle()
    setOverall(o.error ? null : (o.data as Overall | null))

    // THE SCALE THE ADMIN EDITED. Scoped to the company, because the bands are
    // per company and per policy; an error or an empty table leaves this empty
    // and the screens use the built-in fallback.
    if (companyId) {
      const sc = await supabase.from('pms_rating_scale')
        .select('rating_value,rating_code,rating_label,score_from,score_to,min_comment_chars,improvement_feedback_mandatory,sort_order,is_active')
        .eq('company_id', companyId)
      if (sc.error) console.error('[pms] could not read the rating scale:', sc.error)
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
  const { period, overall, loading, reload, companyId, managerId, bands, rules } = usePeriod(employeeId)
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
    if (!(g.data ?? []).length && companyId) {
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
    if (bn.error) console.error('[pms] could not read recognition:', bn.error)
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
      console.error('[pms] acknowledgement refused:', error)
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
      if (tail.error) console.error('[pms] could not remove trailing KRAs:', tail.error)
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
          console.error('[pms] self rating refused:', rv.error)
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
        console.error('[pms] KRA change log refused:', audit.error)
        logWarning = ' The change log could not be written, though — tell HR.'
      }
    }
    setSaving(false)
    setMsg(error
      ? ((error as { code?: string }).code === MISSING_TABLE
          ? 'The performance module is not live yet: migration 066 has not been applied.'
          : (console.error('[pms] KRA insert refused:', error), SAVE_FAILED('KRAs')))
      : [
          kraLocked ? 'Your ratings are in with your manager.'
                    : 'Sent to your reporting manager.',
          ratedCount && !kraLocked
            ? `${ratedCount} ${ratedCount === 1 ? 'rating' : 'ratings'} went with it.` : '',
          changes.length ? `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} recorded against the one-to-one.` : '',
          ratingWarning, logWarning,
        ].filter(Boolean).join(' '))
    if (!error) { setDraftKras(null); setSelfBySeq(null); loadPeriodData(); reload() }
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
    if (error) { console.error('[pms] self rating refused:', error); setMsg(SAVE_FAILED('self rating')); return }
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
    if (error) { console.error('[pms] one-to-one insert refused:', error); setMsg(SAVE_FAILED('discussion')); return }
    loadPeriodData()
  }

  return (
    <>
      {msg && <div className="banner b-blue"><span aria-hidden="true">ℹ️</span><div>{msg}</div></div>}

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
                lockGate={lockGate} onSubmit={submitKras} saving={saving} />
      )}
      {tab === 'oneToOne' && (
        <OneToOneTab kras={kras.map(k => ({ seq_no: k.seq_no, kra_title: k.kra_title, weightage: k.weightage }))}
                     logs={logs} managerName="your manager"
                     onLog={logDiscussion} saving={saving} />
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
      .select('employee_id,workflow_status,self_score,rm_l1_score,rm_l2_score,final_rating,rm_l1_id,rm_l2_id,employment_flag')
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
    const goalsBy = new Map<string, { n: number; wt: number }>()
    for (const g of goals ?? []) {
      const k = String((g as { employee_id: string }).employee_id)
      const cur = goalsBy.get(k) ?? { n: 0, wt: 0 }
      cur.n += 1
      cur.wt += Number((g as { weightage?: number }).weightage) || 0
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
      .select('employee_id,discussion_type,employee_ack,manager_ack')
      .eq('period_id', period.id)
      .in('discussion_type', ['KRA_SETTING', 'FINAL_REVIEW'])
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

    setRows(data.map(d => {
      const e = byId.get(d.employee_id)
      const g = goalsBy.get(String(d.employee_id)) ?? { n: 0, wt: 0 }
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
        oneToOneDone: bothAcked.has(String(d.employee_id)),
        finalReviewDone: finalAcked.has(String(d.employee_id)),
        finalReviewLogged: finalLogged.has(String(d.employee_id)),
        selfSubmitted: d.self_score != null,
        selfScore: d.self_score == null ? null : Number(d.self_score),
        rmL1Score: d.rm_l1_score == null ? null : Number(d.rm_l1_score),
        rmL2Score: d.rm_l2_score == null ? null : Number(d.rm_l2_score),
        rmL1Id: (d.rm_l1_id as string | null) ?? null,
        rmL2Id: (d.rm_l2_id as string | null) ?? null,
        finalRating: d.final_rating == null ? null : Number(d.final_rating),
        finalised: d.final_rating != null,
      }
    }))
    setLoading(false)
  }, [employeeId, period, as])

  useEffect(() => { load() }, [load])
  return { rows, loading, reload: load }
}

function TeamSide({ employeeId, tab }: { employeeId: string; tab: MgrTab }) {
  // employeeId here is the MANAGER. The person being acted on is `picked`.
  const { period, loading: pLoading, companyId, reload, bands, rules, flagRules } = usePeriod(employeeId)
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
      if (g.error) { console.error('[pms] could not read the KRAs to rate:', g.error); return }
      const goalRows = (g.data ?? []) as Record<string, unknown>[]

      // Their own rating per KRA, and the manager's own earlier one if this is
      // a revisit — a half-finished rating must come back as it was left.
      // RM_L2 IS READ TOO. It used to ask only for SELF and RM_L1, so an RM L2
      // returning to a half-finished rating saw an empty form and would have
      // started again. And "mine" is matched on rater_id rather than on a role
      // string: the row this person authored is theirs whichever rung of the
      // chain they are on, which needs no guess about which that is.
      const r = await supabase.from('pms_reviews')
        .select('goal_id,rater_id,rater_role,rating,comments,achievement_value')
        .eq('employee_id', picked).eq('period_id', period.id)
        .in('rater_role', ['SELF', 'RM_L1', 'RM_L2'])
      if (r.error) console.error('[pms] could not read the ratings:', r.error)
      const byGoal = new Map<string, Record<string, Record<string, unknown>>>()
      for (const row of (r.data ?? []) as Record<string, unknown>[]) {
        const k = String(row.goal_id)
        const slot = String(row.rater_role) === 'SELF' ? 'SELF'
          : String(row.rater_id) === employeeId ? 'MINE' : 'OTHER'
        byGoal.set(k, { ...(byGoal.get(k) ?? {}), [slot]: row })
      }

      if (!live) return
      setRateRows(goalRows.map(gr => {
        const seen = byGoal.get(String(gr.id)) ?? {}
        const self = seen.SELF, mine = seen.MINE
        return {
          goalId: String(gr.id),
          title: String(gr.kra_title ?? ''),
          category: String(gr.category ?? 'BUSINESS') as Category,
          weightage: Number(gr.weightage) || 0,
          achievement: String(self?.achievement_value ?? mine?.achievement_value ?? ''),
          selfRating: self?.rating == null ? null : Number(self.rating),
          selfComment: String(self?.comments ?? ''),
          myRating: mine?.rating == null ? null : Number(mine.rating),
          myComment: String(mine?.comments ?? ''),
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
    setSaving(true); setMsg(null)
    const ack = await supabase.from('pms_one_to_one')
      .update({ manager_ack: true, manager_ack_at: new Date().toISOString() })
      .eq('employee_id', id).eq('period_id', period!.id)
      .eq('discussion_type', 'KRA_SETTING')
      .select('id')
    if (ack.error) {
      console.error('[pms] manager acknowledge refused:', ack.error)
      setSaving(false); setMsg(SAVE_FAILED('acknowledgement')); return
    }
    if (!ack.data?.length) {
      setSaving(false)
      setMsg('There is no KRA-setting discussion logged for them yet, so there is nothing to acknowledge. They log it from their own Performance screen.')
      return
    }
    const lock = await supabase.rpc('pms_lock_kras',
      { p_employee_id: id, p_period_id: period!.id, p_manager_id: employeeId })
    setSaving(false)
    if (lock.error) {
      console.error('[pms] pms_lock_kras failed:', lock.error)
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
  const acknowledgeFinalReview = async (id: string) => {
    setSaving(true); setMsg(null)
    const ack = await supabase.from('pms_one_to_one')
      .update({ manager_ack: true, manager_ack_at: new Date().toISOString() })
      .eq('employee_id', id).eq('period_id', period!.id)
      .eq('discussion_type', 'FINAL_REVIEW')
      .select('id')
    setSaving(false)
    if (ack.error) {
      console.error('[pms] final review acknowledge refused:', ack.error)
      setMsg(SAVE_FAILED('acknowledgement')); return
    }
    if (!ack.data?.length) {
      setMsg('There is no final review discussion logged for them yet, so there is nothing to acknowledge. They log it from their own One-to-One Log.')
      return
    }
    setMsg('Final review acknowledged. The HOD can settle their rating now.')
    reloadRoster()
  }

  /** Hand the set back for the employee to rebuild. Their own screen reads
   *  sent_back_reason, so the reason is the whole point of the action. */
  const sendBack = async (id: string, reason: string) => {
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('pms_employee_goals')
      .update({ status: 'SENT_BACK', sent_back_reason: reason })
      .eq('employee_id', id).eq('period_id', period!.id)
    setSaving(false)
    if (error) { console.error('[pms] send back refused:', error); setMsg(SAVE_FAILED('note')); return }
    setMsg('Sent back, with your reason.')
    reloadRoster()
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

  const submitRating = async () => {
    if (!picked) return
    setSaving(true); setMsg(null)
    if (!myRaterRole) {
      setSaving(false)
      setMsg('This period’s chain does not record you as either of their managers, so your rating has nowhere to go. Ask HR to check the chain for this period.')
      return
    }
    if (!companyId) { setSaving(false); setMsg(NO_COMPANY); return }
    /**
     * A SETTLED RATING IS NOT REWRITABLE FROM HERE.
     *
     * pms_reviews has no guard against this, and trg_pms_sync_role_score
     * fires on every upsert, so re-submitting on a finalised record silently
     * recomputes rm_l1_score — on a PUBLISHED one, that is the number the
     * employee has already read, changing underneath them with no audit trail
     * and nobody told. Rule 12's read-only lock only covers employees who
     * have EXITED, so an active employee's published appraisal was wide open.
     *
     * Observed live: Shreya Singh's appraisal was finalised at 4 and
     * published, and her RM's rating screen still accepted a submission and
     * reported "Your rating has been sent."
     *
     * Refused here rather than hidden: the queue no longer offers the button,
     * but a stale tab still holds one, and the honest place to say no is the
     * write. The real fix is a DB-level guard — this is the client half.
     */
    if (member?.finalised) {
      setSaving(false)
      setMsg('Their rating has already been finalised, so it cannot be changed here. If it is wrong, ask HR to reopen the period — that keeps a record of why it changed.')
      return
    }
    // An empty set would upsert nothing and report success, which is how a
    // screen comes to lie about having saved. Nothing loads rateRows yet —
    // there is no way to pick a reportee — so this is the honest state.
    if (!rateRows.length) {
      setSaving(false)
      setMsg('Their KRAs have not loaded, so there is nothing to rate yet.')
      return
    }
    const unrated = rateRows.filter(r => r.myRating == null)
    if (unrated.length) {
      setSaving(false)
      setMsg(`${unrated.length} of ${rateRows.length} KRAs still have no rating from you. Rate every one before you send it.`)
      return
    }
    const { error } = await supabase.from('pms_reviews').upsert(
      rateRows.map(r => ({
        company_id: companyId, period_id: period!.id, employee_id: picked,
        goal_id: r.goalId, rater_id: employeeId, rater_role: myRaterRole,
        achievement_value: r.achievement || null, rating: r.myRating,
        comments: r.myComment || null, submitted: true,
        submitted_at: new Date().toISOString(),
      })),
      { onConflict: 'period_id,employee_id,goal_id,rater_role' })
    if (error) {
      setSaving(false)
      console.error('[pms] manager rating refused:', error); setMsg(SAVE_FAILED('rating')); return
    }

    // THE OVERALL COMMENT HAD NOWHERE TO GO, and was being collected and
    // dropped — the manager believed the words their reportee would read had
    // been saved.
    //
    // pms_reviews holds one row per KRA, so a comment about the whole
    // appraisal does not belong there. pms_feedback is the only table that
    // takes prose, and it is UNIQUE (period_id, employee_id) — ONE row per
    // person per period, with given_by and given_by_role recording the author.
    // So the schema's own design is a single feedback record passed along the
    // chain, and this writes the RM's half of it.
    //
    // visible_to_employee stays false: §3.5 says nothing is shown before the
    // result is published, and that flag is what holds it back.
    //
    // IT GETS ITS OWN COLUMN (189). This used to write appreciation_remark,
    // which §5.2 gives to the HOD. Same row, same conflict target, so whoever
    // saved last erased the other — and since the RM comments first and the
    // HOD publishes afterwards, the RM always lost, silently. given_by stays
    // the HOD's; rm_overall_by records who wrote this half.
    if (overall.trim()) {
      const fb = await supabase.from('pms_feedback').upsert({
        company_id: companyId, period_id: period!.id, employee_id: picked,
        rm_overall_comment: overall.trim(),
        rm_overall_by: employeeId, given_by_role: myRaterRole,
        visible_to_employee: false,
      }, { onConflict: 'period_id,employee_id' })
      if (fb.error) {
        setSaving(false)
        console.error('[pms] overall comment refused:', fb.error)
        setMsg('The ratings were saved, but your overall comment was not. Try sending it again.')
        return
      }
    }
    setSaving(false)
    setMsg('Your rating has been sent.')
    reloadRoster()
  }

  if (pLoading || loading) return <div className="k">Loading…</div>
  if (!period) return <NoPeriod />

  return (
    <>
      {msg && <div className="banner b-blue"><span aria-hidden="true">ℹ️</span><div>{msg}</div></div>}
      {tab === 'team' && <TeamTab flagRules={flagRules} rules={rules} members={rows} today={today} managerName="your team" />}
      {tab === 'approve' && <ApproveTab flagRules={flagRules} rules={rules} members={rows} today={today}
                                        onAcknowledge={acknowledge} onSendBack={sendBack}
                                        onAcknowledgeFinalReview={acknowledgeFinalReview} />}
      {tab === 'rate' && (
        <RateTab flagRules={flagRules} rules={rules} bands={bands.length ? bands : undefined}
                 members={rows} onPick={setPicked} today={today}
                 member={member} rows={rateRows} onChange={setRateRows}
                 onSubmit={submitRating} saving={saving} overallComment={overall}
                 onOverallComment={setOverall} />
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
      console.error('[pms] pms_finalise failed:', r.error)
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
      console.error('[pms] feedback publish refused:', fb.error)
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
        console.error('[pms] recognition refused:', ben.error)
        setMsg('The feedback saved, but the recognition rows did not. Add them again before telling them it is published.')
        return
      }
    }

    const st = await supabase.from('pms_overall_rating')
      .update({ workflow_status: 'PUBLISHED', published_at: new Date().toISOString() })
      .eq('employee_id', picked).eq('period_id', period.id)
    setSaving(false)
    if (st.error) {
      console.error('[pms] publish status refused:', st.error)
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
                     onFinalise={finalise} saving={saving} />
      )}
      {tab === 'feedback' && (
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
                {rows.filter(r => r.finalised).map(r => (
                  <option key={r.employeeId} value={r.employeeId}>
                    {r.code} · {r.name} — rated {r.finalRating}
                  </option>
                ))}
              </select>
            </div>
            {!rows.some(r => r.finalised) && (
              <div className="k" style={{ marginTop: 6, lineHeight: 1.6 }}>
                Nobody in your department has been finalised yet. Settle a rating on
                Review &amp; Finalise first — feedback is published with the result,
                not before it.
              </div>
            )}
          </div>
          <FeedbackTab bands={bands.length ? bands : undefined}
                       member={member} rating={member?.finalRating ?? null}
                       appreciation={draft.appreciation} improvement={draft.improvement}
                       benefits={draft.benefits} logs={logs}
                       onChange={patch => setDraft(d => ({ ...d, ...patch }))}
                       onPublish={publishResult} saving={saving} />
        </>
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
