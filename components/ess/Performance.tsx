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
import {
  EMP_TABS, DashboardTab, KraTab, OneToOneTab, SelfRatingTab, ResultTab,
  AnalyticsTab, type EmpTab, type Who, type SelfRow,
} from '@/components/pms/EmployeeTabs'
import {
  MGR_TABS, HOD_TABS, TeamTab, ApproveTab, RateTab, PipRequestTab,
  TeamAnalyticsTab, FinaliseTab, FeedbackTab,
  type MgrTab, type HodTab, type RateRow, type BenefitType,
} from '@/components/pms/ManagerTabs'
import { type TeamMember } from '@/lib/pms/team'
import { type Kra, type Category } from '@/lib/pms/kra'
import { canLockWeightage, canPublishResult, type Log } from '@/lib/pms/oneToOne'
import { type Line } from '@/lib/pms/scoring'
import { stageStates, currentStage, settled, STAGES, DEFAULT_RULES,
         type Progress, type StageKey } from '@/lib/pms/cycle'
import { type Flag } from '@/lib/pms/employment'

const MISSING_TABLE = 'PGRST205'

interface Period { id: string; period_code: string; status: string }
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
      .select('company_id').eq('id', employeeId).maybeSingle()
    const companyId = (me.data as { company_id?: string } | null)?.company_id ?? null

    let q = supabase.from('pms_periods')
      .select('id,period_code,status')
      .not('status', 'in', '("CLOSED","SCHEDULED")')
    if (companyId) q = q.eq('company_id', companyId)
    const p = await q.order('period_start', { ascending: false }).limit(1).maybeSingle()
    if (p.error || !p.data) { setPeriod(null); setOverall(null); setLoading(false); return }
    setPeriod(p.data as Period)

    const o = await supabase.from('pms_overall_rating')
      .select('workflow_status,self_score,final_rating,final_rating_code,is_readonly')
      .eq('employee_id', employeeId).eq('period_id', p.data.id).maybeSingle()
    setOverall(o.error ? null : (o.data as Overall | null))
    setLoading(false)
  }, [employeeId])

  useEffect(() => { reload() }, [reload])
  return { period, overall, loading, reload }
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

  return (
    <div className="pms">
      <CycleHeader
        employeeId={employeeId}
        roles={{ isEmployee: true, isRM: roles.isRM, isHOD: roles.isHOD }}
        onGo={() => setScope('me')}
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
  const { period, overall, loading, reload } = usePeriod(employeeId)
  const [who, setWho] = useState<Who>({ name: '', code: '' })
  const [goals, setGoals] = useState<Record<string, unknown>[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [reviews, setReviews] = useState<Record<string, unknown>[]>([])
  const [feedback, setFeedback] = useState<Record<string, unknown> | null>(null)
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

    const l = await supabase.from('pms_one_to_one')
      .select('id,discussion_type,discussion_date,mode,discussion_points,employee_ack,manager_ack')
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
  }, [employeeId, period])
  useEffect(() => { loadPeriodData() }, [loadPeriodData])

  const kras: Kra[] = draftKras ?? (goals.length
    ? goals.map(g => ({
        seq_no: Number(g.seq_no), kra_title: String(g.kra_title ?? ''),
        kpi_metric: String(g.kpi_metric ?? ''), target_value: String(g.target_value ?? ''),
        category: (String(g.category ?? 'BUSINESS')) as Category,
        weightage: Number(g.weightage) || 0,
      }))
    : Array.from({ length: DEFAULT_RULES.minKra }, (_, i) => blankKra(i + 1)))

  const lockGate = canLockWeightage(logs)
  const publishGate = canPublishResult(logs)
  const locked = goals.length > 0 && goals.every(g => g.status === 'LOCKED')
  const selfSubmitted = !!(overall?.workflow_status && overall.workflow_status !== 'NOT_STARTED'
    && overall.self_score != null)
  const published = !!feedback?.visible_to_employee || overall?.final_rating != null

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
    // period_id was missing here before, so a saved set could never be read
    // back: every other query filters on it. The KRAs went in and vanished.
    const { error } = await supabase.from('pms_employee_goals').insert(
      kras.map(k => ({ ...k, employee_id: employeeId, period_id: period.id,
                       status: 'PENDING_RM_APPROVAL' })))
    setSaving(false)
    setMsg(error
      ? ((error as { code?: string }).code === MISSING_TABLE
          ? 'The performance module is not live yet — migration 066 has not been applied.'
          : error.message)
      : 'Sent to your reporting manager.')
    if (!error) { setDraftKras(null); loadPeriodData() }
  }

  const submitSelf = async () => {
    setSaving(true); setMsg(null)
    const rows = selfRows.map(r => ({
      period_id: period.id, employee_id: employeeId, goal_id: r.goalId,
      rater_id: employeeId, rater_role: 'SELF',
      achievement_value: r.achievement || null, rating: r.rating,
      comments: r.comment || null, submitted: true,
      submitted_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('pms_reviews')
      .upsert(rows, { onConflict: 'period_id,employee_id,goal_id,rater_role' })
    setSaving(false)
    if (error) { setMsg(error.message); return }
    setSelfDraft(null); reload(); loadPeriodData()
  }

  const logDiscussion = async (l: Log) => {
    setSaving(true)
    const { error } = await supabase.from('pms_one_to_one').insert({
      period_id: period.id, employee_id: employeeId,
      discussion_type: l.discussion_type, discussion_date: l.discussion_date,
      mode: l.mode, discussion_points: l.discussion_points,
      employee_ack: true, employee_ack_at: new Date().toISOString(),
    })
    setSaving(false)
    if (error) setMsg(error.message); else loadPeriodData()
  }

  return (
    <>
      {msg && <div className="banner b-blue"><span aria-hidden="true">ℹ️</span><div>{msg}</div></div>}

      {tab === 'dashboard' && (
        <DashboardTab
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
          actionNote={ACTION_NOTE[stage] ?? ''} />
      )}
      {tab === 'kras' && (
        <KraTab kras={kras} onChange={setDraftKras} locked={locked}
                lockGate={lockGate} onSubmit={submitKras} saving={saving} />
      )}
      {tab === 'oneToOne' && (
        <OneToOneTab logs={logs} managerName="your manager"
                     onLog={logDiscussion} saving={saving} />
      )}
      {tab === 'self' && (
        !locked
          ? <div className="banner b-amber"><span aria-hidden="true">🔒</span><div>
              Self rating opens once your weightages are locked. {lockGate.because}
            </div></div>
          : <SelfRatingTab rows={selfRows} onChange={setSelfDraft} submitted={selfSubmitted}
                           onSubmit={submitSelf} saving={saving} />
      )}
      {tab === 'result' && (
        <ResultTab
          published={published} lines={lines}
          finalRating={overall?.final_rating ?? null}
          finalisedBy={null} finalisedOn={null} deptAverage={null}
          appreciation={feedback?.appreciation_remark as string | undefined}
          improvement={feedback?.improvement_feedback as string | undefined}
          benefits={[]} publishGate={publishGate} />
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
const ACTION_NOTE: Record<StageKey, string> = {
  kra: `${DEFAULT_RULES.minKra} to ${DEFAULT_RULES.maxKra}, totalling ${DEFAULT_RULES.totalWeightage}`,
  oneToOne: 'Both of you have to acknowledge it',
  lock: 'They lock the weightages once acknowledged',
  self: 'Rate every KRA, then submit — it locks',
  review: 'Nothing owed from you right now',
  finalise: 'Nothing owed from you right now',
  result: 'Acknowledge once you have read it',
}

// ── the manager's side ───────────────────────────────────────────────────

/** Reads the frozen chain, not a live reporting lookup. */
function useRoster(employeeId: string, period: Period | null, as: 'rm' | 'hod') {
  const [rows, setRows] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!period) { setRows([]); setLoading(false); return }
    setLoading(true)
    const q = supabase.from('pms_overall_rating')
      .select('employee_id,workflow_status,kra_count,total_weightage,self_score,rm_l1_score,rm_l2_score,final_rating,rm_l1_id,rm_l2_id,employment_flag')
      .eq('period_id', period.id)
    const { data } = as === 'hod'
      ? await q.eq('hod_id', employeeId)
      : await q.or(`rm_l1_id.eq.${employeeId},rm_l2_id.eq.${employeeId}`)
    if (!data?.length) { setRows([]); setLoading(false); return }

    const ids = data.map(d => d.employee_id)
    const { data: emps } = await supabase.from('employees')
      .select('id,emp_code,full_name,date_of_leaving').in('id', ids)
    const byId = new Map((emps ?? []).map(e => [e.id, e as Record<string, unknown>]))

    setRows(data.map(d => {
      const e = byId.get(d.employee_id)
      return {
        employeeId: String(d.employee_id),
        code: String(e?.emp_code ?? ''),
        name: String(e?.full_name ?? 'Unknown'),
        dateOfLeaving: (e?.date_of_leaving as string | null) ?? null,
        flagOverride: (d.employment_flag as Flag | null) ?? null,
        kraCount: Number(d.kra_count) || 0,
        totalWeightage: Number(d.total_weightage) || 0,
        oneToOneDone: String(d.workflow_status ?? '') !== 'NOT_STARTED'
                   && Number(d.total_weightage) === DEFAULT_RULES.totalWeightage,
        selfSubmitted: d.self_score != null,
        selfScore: d.self_score == null ? null : Number(d.self_score),
        rmL1Score: d.rm_l1_score == null ? null : Number(d.rm_l1_score),
        rmL2Score: d.rm_l2_score == null ? null : Number(d.rm_l2_score),
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
  const { period, loading: pLoading } = usePeriod(employeeId)
  const { rows, loading } = useRoster(employeeId, period, 'rm')
  const [picked, setPicked] = useState<string | null>(null)
  const [rateRows, setRateRows] = useState<RateRow[]>([])
  const [overall, setOverall] = useState('')
  const today = localToday()

  const member = useMemo(
    () => rows.find(r => r.employeeId === picked) ?? null, [rows, picked])

  if (pLoading || loading) return <div className="k">Loading…</div>
  if (!period) return <NoPeriod />

  return (
    <>
      {tab === 'team' && <TeamTab members={rows} today={today} managerName="your team" />}
      {tab === 'approve' && <ApproveTab members={rows} today={today} />}
      {tab === 'rate' && (
        <RateTab member={member} rows={rateRows} onChange={setRateRows}
                 onSubmit={() => {}} overallComment={overall}
                 onOverallComment={setOverall} />
      )}
      {tab === 'pip' && <PipRequestTab members={rows} today={today} />}
      {tab === 'analytics' && (
        <TeamAnalyticsTab members={rows} today={today} lines={[]}
                          deptAverage={null} companyAverage={null} scopeLabel="your team" />
      )}
    </>
  )
}

function DeptSide({ employeeId, tab }: { employeeId: string; tab: HodTab }) {
  const { period, loading: pLoading } = usePeriod(employeeId)
  const { rows, loading } = useRoster(employeeId, period, 'hod')
  const [picked] = useState<string | null>(null)
  const today = localToday()
  const member = rows.find(r => r.employeeId === picked) ?? null

  if (pLoading || loading) return <div className="k">Loading…</div>
  if (!period) return <NoPeriod />

  return (
    <>
      {tab === 'finalise' && (
        <FinaliseTab members={rows} today={today} role="HOD"
                     chain="SELF_RM1_RM2_HOD" whoCanFinalise="RM1_RM2_HOD"
                     deptName="your department" />
      )}
      {tab === 'feedback' && (
        <FeedbackTab member={member} rating={member?.finalRating ?? null}
                     appreciation="" improvement=""
                     benefits={[] as { type: BenefitType; note: string }[]}
                     logs={[]} onChange={() => {}} />
      )}
      {tab === 'deptAnalytics' && (
        <TeamAnalyticsTab members={rows} today={today} lines={[]}
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
        configuration, and everybody eligible is enrolled at that moment — there is
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
          It is handed to Nayan rather than run from here — this project does not
          apply schema changes itself. Nothing on this page is broken; it is waiting.
        </div>
      </div>
    </div>
  )
}
