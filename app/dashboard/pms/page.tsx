'use client'
// app/dashboard/pms/page.tsx — Performance Management, HR Admin side.
//
// HR Admin is not a step in the approval chain. The chain is
//   Employee -> RM L1 -> RM L2 -> HOD (finalises)
// and this screen sits across all of it: chasing people who have not written
// their KRAs, consolidating ratings into results, coordinating RM/HOD/MD, and
// correcting KRA sets that were raised wrongly.
//
// THIS SCREEN RUNS BEFORE ITS TABLES EXIST
//
// Migration 066 creates the 15 pms_* tables and has not been applied — Nayan
// owns the database. So every load can legitimately come back "table not
// found" (PostgREST PGRST205), and that is a state to render, not an error to
// swallow. A blank page here would read as a broken feature rather than a
// pending migration, and someone would spend an afternoon debugging the app.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useGrant } from '@/lib/rms/client'
import { companyFilter, canSeeScreen, canManage } from '@/lib/rms/resolve'
import { C as TK, F, W, S, R, E, numeric,
         IconPerformance, IconHome, IconSliders, IconAdmin, IconPolicies,
         IconEmployees, IconAward, IconReports, IconUpload, IconAlert,
         IconDownload, IconOrgChart, IconCalendar, IconBell,
         type IconProps } from '@/lib/ui'
import { ReadinessBanner, FillDistribution, DepartmentTable } from '@/components/pms/AdminOverview'
import { rollUp, byDepartment, type FillRow, type Rollup, type DeptRollup } from '@/lib/pms/rollup'
import { PERIOD_OPEN } from '@/lib/pms/status'
import { nameThePeriod, frequencyPhrase, type PeriodNaming } from '@/lib/pms/language'
import { ADMIN_TABS, ConfigTab, PolicyTab, FillTab, PublishTab, SummaryTab,
         UploadTab, PipTab, ReportsTab, FlowTab, type AdminTab, type PipRow,
         type PolicyConfig, type PublishRow } from '@/components/pms/AdminTabs'
import { mayWritePostFinal, postFinalNote, pmsRoleOf,
         type PostFinalOwner } from '@/lib/pms/postFinal'
import AdminEditor from '@/components/pms/AdminEditor'
import '@/components/pms/pms.css'
import { withoutFreshCols, type Frequency, type Policy } from '@/lib/pms/policy'
import { localToday } from '@/components/pms/CycleHeader'
import { chainAsksByEmployee, type ChainAsks,
         type RecRowDb } from '@/lib/pms/hrQueue'
import { pipFromRow, type PipRowDb } from '@/lib/pms/pip'
import { type HrStatus } from '@/lib/pms/training'
import { canSettleFinal, finalPatch, checkFinal,
         type FinalIntent } from '@/lib/pms/hrFinal'
import { canActDirect, checkDirect, directStamp, whyNotDirect,
         suggestedFinal, type DirectIntent } from '@/lib/pms/hrDirect'
import { publishFaults } from '@/lib/pms/publishGate'

// Spec §6 names six tabs. 'overview' and 'chain' are kept alongside them:
// the roll-up is what an admin opens first, and routing coverage is the thing
// that decides whether an appraisal can move at all — neither belongs inside
// one of the six.
type Tab = 'overview' | AdminTab | 'chain'

/** PostgREST's code for "that relation does not exist". */
const MISSING_TABLE = 'PGRST205'

/** The HR PIP queue reads pms_pip, which arrives with 066. Empty rather than
 *  sample rows: a made-up name in an action queue is something somebody tries
 *  to act on. Module scope so it is not a fresh array on every render. */
/**
 * THE PIP QUEUE IS REAL NOW.
 *
 * This was a hardcoded empty array: raters could raise a PIP request and the
 * HR tab that exists to review them always rendered "No PIP requests". The
 * write had no reader. It is loaded with the publish workspace, because the
 * two answer the same question about the same people.
 */

interface Coverage {
  total: number; l1: number; l2: number
  /** HOD resolved from either source. -1 while the department source is unavailable. */
  hodResolved: number
  hodOverride: number      // employees.hod_id — matrix / dotted-line exceptions
  hodDept: number          // departments.hod_employee_id — the primary source
  deptSourceReady: boolean // false until migration 067 adds the column
}

/**
 * WHICH SEEDED SCREEN PERMISSION GOVERNS A TAB.
 *
 * canSeeScreen denies any key absent from the seeded screen config — line 203
 * returns true only while a module has NO config at all, and PMS has one. So a
 * tab introduced with a brand-new key is invisible to everybody, including
 * admins, until somebody seeds the key. 'publish' is such a tab.
 *
 * Seeding a key means writing to the roles and permissions module, which is
 * load-bearing for every other module in the product and is deliberately left
 * alone here. So Publish Results borrows 'pms.upload' instead: that key
 * already means "may set final ratings in bulk", which §2 grants to HR alone
 * (bulk_upload_ratings is ✅ for HR Manager, HR Head and Admin and — for
 * everyone else). Publishing is a strictly weaker action in the same family —
 * it releases a rating HR cannot change — so no permission is widened by
 * this, and nobody gains a screen they could not already reach.
 *
 * Everything not listed governs itself, which is every pre-existing tab.
 */
/**
 * NOTHING BORROWS ANY MORE. Both entries here used to point a tab at a
 * different tab's seeded key, because a brand-new key is denied to any role
 * the module is configured for — and PMS is configured for L1_MANAGER,
 * L2_MANAGER and HOD.
 *
 * That workaround over-granted. 'pms.upload' is held by those three roles,
 * so Publish Results — HR's workspace, where the feedback an employee reads
 * is written and the result released — was reachable by every line manager.
 * 'pms.fill' did the same for the cross-company Ratings Summary.
 *
 * They are registered screens now (lib/rms/screens.ts), which both makes
 * them switchable in Roles & Access and gives them their own answer:
 *
 *   L1 / L2 / HOD   module configured, no row for the new key  → hidden
 *   HR Head / HR Manager / Admin   module unconfigured          → visible
 *
 * WHICH IS WHY NO MIGRATION SEEDS ANYTHING. The roles that should keep
 * these tabs are the ones with no PMS rows at all, and adding rows for them
 * would configure the module for those roles and start hiding every tab
 * they do not have a row for — a privilege removal disguised as a grant,
 * which is the trap migration 142 documents.
 */
/**
 * EVERY COLUMN toConfig READS, in one place so the 211 retry can drop one
 * from it rather than restate the list and drift.
 */
/**
 * The embedded chain row, whichever shape PostgREST sent it in.
 *
 * A to-one embed arrives as an object or as a one-element array depending on
 * how the relationship is inferred. Reading one shape only is how a composed
 * chain silently shows as the preset — see effectiveChain, which handles the
 * same two shapes for the same reason.
 */
function chainRowOf(p: Record<string, unknown>):
    { name?: string; rungs?: string[] } | null {
  const e = p.pms_chain as
    { name?: string; rungs?: string[] } | { name?: string; rungs?: string[] }[] | null | undefined
  const row = Array.isArray(e) ? e[0] : e
  return row ?? null
}

const POLICY_SELECT =
  'id, company_id, policy_name, frequency, is_active, min_kra_count, max_kra_count,'
  + ' total_weightage, min_weightage_per_kra, who_can_finalise,'
  + ' kra_created_by, one_to_one_mandatory, mid_period_checkin,'
  + ' final_review_one_to_one, approval_chain, rating_scale_type,'
  // 218: the composed chain this policy points at, with the chain itself.
  // Without it the Config panel shows the PRESET to a company running a
  // composed chain — the configuration screen disagreeing with the cycle.
  + ' chain_id, pms_chain(name, rungs),'
  + ' self_rating_mandatory, new_joiner_cutoff_days, post_final_owner,'
  + ' publish_scope, hr_head_final_rating,'
  // 221: how many KPIs one KRA may hold. The Config tab has to show the same
  // numbers the KRA form enforces, or the two screens disagree about the rule.
  + ' min_kpi_per_kra, max_kpi_per_kra,'
  + ' include_notice_period, include_exited'


const SCREEN_KEY: Partial<Record<Tab, string>> = {}
const screenKeyOf = (t: Tab) => SCREEN_KEY[t] ?? 'pms.' + t

/**
 * TABS THAT CONFIGURE THE MODULE, which HR does not do.
 *
 * Setup & Controls is the write surface for the policy, the KRA library, the
 * rating scale and the period calendar. Every one of its saves goes through
 * /api/pms/admin, which requires canManage('Performance') — so for anyone
 * else the tab could only ever render a refusal.
 *
 * It is HIDDEN rather than left to refuse because the screen permission that
 * governs it is default-visible: HR roles have no PMS screen rows at all, so
 * canSeeScreen says yes to a tab whose every action says no.
 *
 * NOT the final rating upload. That looks like an admin screen and is not:
 * bulk_upload_ratings is HR's under §2, and the route now gates it on being
 * HR rather than on managing the module.
 *
 * This reads the SAME canManage the API enforces, so the navigation and the
 * server cannot disagree. Nothing is written to the roles module to achieve
 * it — adding rows for a role there would start hiding every tab it has no
 * row for, which is the privilege removal migration 142 warns about.
 */
const CONFIGURES_THE_MODULE = new Set<Tab>(['setup'])

/**
 * HOW THE RAIL IS DRAWN — presentation only.
 *
 * Which tabs a person may open is decided below exactly as before, by the
 * same canSeeScreen / canManage pair the API enforces. This only says which
 * group a visible tab is drawn in and which icon it wears, so eleven tabs
 * read as five errands rather than eleven competing words. A tab missing
 * from this map is still drawn, in the last group — a new tab can never
 * vanish because nobody gave it an icon.
 */
/**
 * THE GROUP ORDER REPRODUCES THE ORIGINAL TAB ORDER EXACTLY.
 *
 * The tabs were, and still are:
 *   This cycle · PMS Configuration · Setup & Controls · Policy Builder ·
 *   Fill Status Tracker · Publish Results · Ratings Summary ·
 *   Final Rating Upload · PIP Management · Reports & Export · Flow & Hierarchy
 *
 * Grouping them is a drawing decision and must not become a reordering one:
 * people navigate by position, and a tab that moves is a tab somebody hunts
 * for. PIP sits between Final Rating Upload and Reports, so it gets its own
 * group rather than being folded in beside Fill Status Tracker — which would
 * have moved it from ninth to sixth.
 *
 * "Improvement" is also the honester label for it: a PIP is not something you
 * run the cycle with, it is what follows a result.
 */
type NavGroup = 'cycle' | 'setup' | 'run' | 'results' | 'improvement' | 'insight'
const NAV_GROUPS: { key: NavGroup; label: string }[] = [
  { key: 'cycle',       label: 'Cycle' },
  { key: 'setup',       label: 'Set up' },
  { key: 'run',         label: 'Run' },
  { key: 'results',     label: 'Results' },
  { key: 'improvement', label: 'Improvement' },
  { key: 'insight',     label: 'Insight' },
]
const NAV: Partial<Record<Tab, { group: NavGroup; icon: (p: IconProps) => React.ReactNode }>> = {
  overview: { group: 'cycle',   icon: IconHome },
  config:   { group: 'setup',   icon: IconSliders },
  setup:    { group: 'setup',   icon: IconAdmin },
  policies: { group: 'setup',   icon: IconPolicies },
  fill:     { group: 'run',     icon: IconEmployees },
  publish:  { group: 'results', icon: IconAward },
  summary:  { group: 'results', icon: IconReports },
  upload:   { group: 'results', icon: IconUpload },
  pip:      { group: 'improvement', icon: IconAlert },
  reports:  { group: 'insight', icon: IconDownload },
  chain:    { group: 'insight', icon: IconOrgChart },
}


/**
 * THE THREE STREAMS A RATER CAN OPEN, fetched together.
 *
 * Module-level rather than inside the component because two callers need
 * exactly the same reads: the full page load, and the focused refresh that
 * follows an HR decision. The second one exists because the tab block is
 * gated on `!loading` — a full reload UNMOUNTS the publish workspace, which
 * would close the card HR had open and bounce them back to the list after
 * deciding one of three proposals.
 *
 * TOLERANT OF 210 NOT HAVING RUN. `kind` is what tells a training suggestion
 * from a recognition proposal, and selecting a column PostgREST does not
 * know about fails the ENTIRE request with a 400 — which would empty the
 * publish workspace, not just this block. So the narrow select is tried
 * first and a failure retries without it. A row read without `kind` falls
 * back to TRAINING, which is right for every row that can exist before 210.
 */
const REC_SELECT = 'id, employee_id, period_id, kind, training_name, category, '
                 + 'details, recommended_by, recommended_by_role, recommended_at, '
                 + 'hr_status, hr_note'

async function fetchChainAsks(
  periodIds: string[],
  ids: string[],
  people: Map<string, { emp_code?: string; full_name?: string }>,
): Promise<{ asks: Record<string, ChainAsks>; queue: PipRow[] }> {
  if (!periodIds.length || !ids.length) return { asks: {}, queue: [] }

  const [recsTry, pipsR] = await Promise.all([
    supabase.from('pms_training_recommendation').select(REC_SELECT)
      .in('period_id', periodIds).in('employee_id', ids),
    supabase.from('pms_pip')
      .select('id, employee_id, period_id, requested_by, requested_by_role, '
            + 'requested_at, trigger_rating, request_reason, proposed_start, '
            + 'proposed_end, hr_status, status, employee_ack, final_outcome')
      .in('period_id', periodIds).in('employee_id', ids),
  ])
  const recsR = recsTry.error
    ? await supabase.from('pms_training_recommendation')
        .select(REC_SELECT.replace('kind, ', ''))
        .in('period_id', periodIds).in('employee_id', ids)
    : recsTry
  // A missing table reads as "nothing asked for" rather than as a screen
  // that quietly lost a section.
  const recRows = (recsR.data ?? []) as unknown as RecRowDb[]
  const pipRows = (pipsR.data ?? []) as unknown as PipRowDb[]

  // The raters' names. Seeded from the people already fetched for the
  // period, then topped up with anybody who only appears as a proposer — a
  // manager outside this period's roster still has to be nameable.
  const names: Record<string, string> = {}
  for (const [id, p] of people) if (p.full_name) names[id] = p.full_name
  const proposers = [...new Set([
    ...recRows.map(r => r.recommended_by), ...pipRows.map(r => r.requested_by),
  ].filter((x): x is string => !!x && !names[x]))]
  if (proposers.length) {
    const ps = await supabase.from('employees').select('id, full_name').in('id', proposers)
    for (const e of ps.data ?? []) {
      const r = e as { id: string; full_name?: string }
      if (r.full_name) names[r.id] = r.full_name
    }
  }

  return {
    asks: chainAsksByEmployee(recRows, pipRows, names),
    queue: pipRows.map(r => ({
      code: people.get(String(r.employee_id))?.emp_code ?? '',
      name: people.get(String(r.employee_id))?.full_name ?? 'Unknown',
      raisedBy: (r.requested_by && names[r.requested_by])
                || (r.requested_by_role ?? '').replace(/_/g, ' ') || 'a manager',
      pip: pipFromRow(r),
    })),
  }
}

export default function PmsPage() {
  const { grant, loading: grantLoading } = useGrant()
  const [tab, setTab] = useState<Tab>('overview')
  useEffect(() => {
    const mayConfigure = canManage(grant, 'Performance')
    const canOpen = (k: Tab) => canSeeScreen(grant, screenKeyOf(k))
      && (mayConfigure || !CONFIGURES_THE_MODULE.has(k))
    const vis = (['overview','config','setup','policies','fill','publish','summary','upload','pip','reports','chain'] as Tab[]).filter(canOpen)
    if (vis.length && !vis.includes(tab)) setTab(vis[0])
  }, [grant, tab])
  const [ready, setReady] = useState<boolean | null>(null)   // null = still checking
  const [loading, setLoading] = useState(true)
  const [cov, setCov] = useState<Coverage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [fill, setFill] = useState<FillRow[] | null>(null)
  /** What has reached HR's rung — see the loader. */
  const [pubRows, setPubRows] = useState<PublishRow[] | null>(null)
  const [asks, setAsks] = useState<Record<string, ChainAsks>>({})
  const [settling, setSettling] = useState<string | null>(null)
  const [pipQueue, setPipQueue] = useState<PipRow[]>([])
  const [publishing, setPublishing] = useState<string | null>(null)
  /**
   * WHICH COMPANY THE PUBLISH WORKSPACE IS ACTING IN. 203.
   *
   * Seeded from the newest open period's company — the one the rest of this
   * screen already describes — so a single-company HR user never sees a
   * chooser and a cross-company one starts somewhere sensible rather than
   * alphabetically first.
   */
  const [pubCompany, setPubCompany] = useState<string | null>(null)
  const [naming, setNaming] = useState<PeriodNaming | null>(null)
  /** The open period's id — §6.4 commits against it. */
  const [periodId, setPeriodId] = useState<string | null>(null)
  /** Held HERE and not in UploadTab: committing reloads, the reload unmounts
   *  the tab block, and a banner inside it would vanish the moment it was
   *  set — which is what happened to the first successful commit. */
  const [commitNote, setCommitNote] = useState<string | null>(null)
  /**
   * §6.1's values, read from the policy rather than hardcoded — one entry per
   * policy, because there are three and they differ. `config` below is
   * whichever one the admin has chosen to look at.
   */
  const [configs, setConfigs] = useState<PolicyConfig[]>([])
  const [configPolicyId, setConfigPolicyId] = useState<string | null>(null)
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({})

  /**
   * The policy §6.1 is describing: the one the admin chose, or the first.
   *
   * Named here rather than stored, so a reload cannot leave the screen
   * describing a policy that no longer exists — and so the company name is
   * resolved in one place instead of being baked into each entry at fetch
   * time, when the names had not loaded yet.
   */
  const withCompany = useCallback((c: PolicyConfig): PolicyConfig => ({
    ...c, companyName: c.companyId ? companyNames[c.companyId] ?? null : null,
  }), [companyNames])

  const config = useMemo(() => {
    if (!configs.length) return null
    const hit = configs.find(c => c.policyId === configPolicyId) ?? configs[0]
    return withCompany(hit)
  }, [configs, configPolicyId, withCompany])

  /** Every policy, labelled, for the selector. */
  const configChoices = useMemo(
    () => configs.map(withCompany), [configs, withCompany])

  /**
   * The companies in scope, and which of them opted into a combined publish
   * list. Read from each company's OWN policy: a group where two are relaxed
   * and one is strict keeps the combined view for the two without dragging
   * the third into it.
   */
  const pubCompanies = useMemo(() => {
    const seen = new Map<string, boolean>()
    for (const c of configChoices) {
      const name = c.companyName
      if (!name) continue
      // If a company somehow has two policies, the STRICTER wins: opting in
      // has to be unanimous within a company, or one relaxed policy would
      // expose employees governed by the other.
      seen.set(name, (seen.get(name) ?? true) && c.publishScope === 'ALL')
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, allowsAll]) => ({ name, allowsAll }))
  }, [configChoices])

  const pubAllowAll = pubCompanies.some(c => c.allowsAll)
  const [deptNames, setDeptNames] = useState<Record<string, string>>({})
  const [freq, setFreq] = useState<Frequency>('QUARTERLY')
  const [policies, setPolicies] = useState<Policy[]>([])
  /** §6.4's validator reads the real scale, not a constant. Defaults only
   *  until the first load answers; an empty scale would reject every rating. */
  const [scale, setScale] = useState<number[]>([1, 2, 3, 4, 5])
  const [improvementAtOrBelow, setImprovementAtOrBelow] = useState<number | null>(2)
  /**
   * The configured scale WITH its labels, for the publish workspace and the
   * summary distribution.
   *
   * `scale` above is numbers only, which §6.4's validator wants; a screen that
   * prints "4 · Exceeds Expectations" and one that decides whether improvement
   * feedback is mandatory both need more than the number. Same query, kept
   * whole rather than reduced twice.
   */
  const [bandList, setBandList] = useState<{ value: number; label: string
                                             improvementMandatory?: boolean }[]>([])
  // The Indian financial year. Periods are generated from it, so the preview
  // has to start where the real thing starts.
  const fyStart = `${new Date().getMonth() >= 3 ? new Date().getFullYear()
                                                : new Date().getFullYear() - 1}-04-01`
  // "2026-27" — how an Indian FY is written everywhere else in the product.
  const fyYear = Number(fyStart.slice(0, 4))
  const fyLabel = `${fyYear}-${String((fyYear + 1) % 100).padStart(2, '0')}`

  const load = useCallback(async () => {
    setLoading(true); setErr(null)

    // Does the module exist yet? One cheap probe against the root table.
    const probe = await supabase.from('pms_policies').select('id').limit(1)
    if (probe.error) {
      if ((probe.error as { code?: string }).code === MISSING_TABLE) { setReady(false); setLoading(false); return }
      setErr(probe.error.message); setReady(false); setLoading(false); return
    }
    setReady(true)

    // The active period, named the way a person would say it rather than by
    // its filing code.
    const today = localToday()
    const co = companyFilter(grant, grant.companyId)
    let perQ = supabase.from('pms_periods')
      .select('id, period_name, period_code, financial_year, period_no, period_start, period_end,'
            + ' status, pms_policies(frequency)')
      .in('status', PERIOD_OPEN)
    if (co) perQ = perQ.eq('company_id', co)
    perQ = perQ.select('id, period_name, period_code, financial_year, period_no,'
                     + ' period_start, period_end, status, company_id,'
                     + ' pms_policies(frequency)')
    const per = await perQ.order('period_start', { ascending: false }).limit(50)

    /**
     * EVERY open period in scope, not one.
     *
     * The page header, the frequency preview and §6.4's upload commit are all
     * single-period ideas and still use `row` — the newest open period. But
     * Ratings Summary and Publish Results are HR's view of the whole
     * organisation, and an HR Head over three companies was seeing one
     * company's cycle: companyFilter returns NULL for a cross-company caller,
     * so the query was unfiltered and `.limit(1)` then picked whichever single
     * period sorted first. 395 enrolments exist and the summary could reach
     * about a third of them.
     *
     * Scoping is unchanged for everybody else. A company-pinned HR user still
     * gets companyFilter's eq(), so this widens nothing: it stops narrowing
     * where the caller was never meant to be narrowed.
     */
    const openPeriods = ((per.data ?? []) as unknown as
      (Record<string, string | null> & { id: string })[])
    const row = openPeriods[0] ?? null
    setPeriodId(row?.id ?? null)
    let coNames: Record<string, string> = {}
    if (row) {
      const freq = ((row as unknown as { pms_policies?: { frequency?: string } })
        .pms_policies?.frequency) ?? null
      const perYear = freq === 'MONTHLY' ? 12 : freq === 'QUARTERLY' ? 4
                    : freq === 'HALF_YEARLY' ? 2 : freq === 'ANNUAL' ? 1 : null
      setNaming(nameThePeriod({
        periodName: row.period_name, periodCode: row.period_code,
        financialYear: row.financial_year, periodStart: row.period_start,
        periodEnd: row.period_end, periodNo: row.period_no ? Number(row.period_no) : null,
        totalPeriods: perYear, frequency: freq,
      }, today))

      // vw_pms_fill_status already collapses ten workflow values into the five
      // states an admin chases. One CASE in SQL beats the same mapping
      // rewritten in every screen that needs it.
      // §6.1 shows all four config groups, so all four groups have to be
      // fetched. It was showing DEFAULT_RULES and the first entry of the
      // CHAINS/FINALISERS arrays instead of these columns.
      let polQ = supabase.from('pms_policies')
        // company_id IS NOT DECORATION. toConfig reads p.company_id, and a
        // column that is not named here arrives undefined — so every policy
        // got companyName null, pubCompanies came out empty, the publish
        // workspace had no company to narrow to, and it filtered out every
        // row and said "Nothing is waiting" while two finalised ratings sat
        // in it. MEASURED: 5 settled rows for this company, 0 shown.
        .select(POLICY_SELECT)
      if (co) polQ = polQ.eq('company_id', co)
      // ORDER BY, because "the first policy" was meaningless without one.
      // Postgres makes no promise about unordered row order, and an UPDATE
      // physically moves a row — so saving a policy could change which one
      // this screen called first. Ordered by company then name, which is also
      // the order the selector lists them in.
      const ordered = () => polQ.order('company_id').order('policy_name').limit(50)
      let pol = await ordered()
      /**
       * TOLERANT OF A MIGRATION NOT HAVING RUN — see FRESH_POLICY_COLS.
       *
       * Every young column is dropped together rather than one at a time.
       * Probing them individually would mean one round trip per column and,
       * worse, would stop at the first that succeeded: a database missing
       * both 211 and 221 would retry without hr_head_final_rating, fail
       * again on min_kpi_per_kra, and give up with the error it started with.
       *
       * toConfig defaults each stripped field to the SAFE reading — the gate
       * is on, the limits are the shipped 1 and 5 — because a policy read
       * before its migration must not read as "no rule applies".
       */
      if (pol.error) {
        const narrowed = withoutFreshCols(POLICY_SELECT)
        if (narrowed !== POLICY_SELECT) {
          polQ = supabase.from('pms_policies').select(narrowed)
          if (co) polQ = polQ.eq('company_id', co)
          pol = await ordered()
        }
      }
      if (!pol.error) {
        setPolicies(((pol.data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
          id: String(r.id), name: String(r.policy_name ?? 'Policy'),
          frequency: (r.frequency as Frequency) ?? 'QUARTERLY',
          isActive: r.is_active !== false,
          minKra: Number(r.min_kra_count) || 4, maxKra: Number(r.max_kra_count) || 10,
          totalWeightage: Number(r.total_weightage) || 100,
          minWeightagePerKra: Number(r.min_weightage_per_kra) || 5,
          whoCanFinalise: (r.who_can_finalise as Policy['whoCanFinalise']) ?? 'RM1_RM2_HOD',
        })))
        /**
         * ONE CONFIG PER POLICY, not one config full stop.
         *
         * THE BUG THIS FIXES, reported twice. Every company is seeded with a
         * policy called "Standard Quarterly" — three of them, one per company.
         * This screen built its config from row [0] of an UNORDERED query, and
         * companyFilter returns NULL for a cross-company admin, so the query
         * was unfiltered and [0] was whichever of the three Postgres handed
         * back first. Edit Sharma Sons' policy in Setup & Controls, come back
         * here, and you are looking at Sharma Trading's — unchanged, because
         * it was never the one you edited. The edit DID save; the screen was
         * reading a different row.
         *
         * Worse than merely arbitrary: an UPDATE rewrites a row and moves it
         * in the heap, so [0] can change identity after a save. The screen
         * could show you a different policy BECAUSE you saved.
         *
         * Two things were needed. An ORDER BY, so "first" means something
         * stable. And a way to look at the policy you actually edited, which
         * is what the selector below is for — companyName was already read by
         * ConfigTab and was hardcoded null with a comment claiming it was
         * "filled below", which nothing did.
         */
        const polRows = ((pol.data ?? []) as unknown as Record<string, unknown>[])
        const toConfig = (p: Record<string, unknown>): PolicyConfig => ({
          policyId: String(p.id),
          policyName: (p.policy_name as string) ?? null,
          companyName: null,   // filled in by the effect once companies load
          companyId: (p.company_id as string) ?? null,
          policyCount: polRows.length,
          minKra: Number(p.min_kra_count) || 4,
          maxKra: Number(p.max_kra_count) || 10,
          totalWeightage: Number(p.total_weightage) || 100,
          minWeightagePerKra: Number(p.min_weightage_per_kra) || 5,
          // 221. `||` not `??`: a 0 in either column is not a KPI rule, it is
          // a column the retry above stripped or a policy written before the
          // migration, and the shipped default is the honest answer.
          minKpi: Number(p.min_kpi_per_kra) || 1,
          maxKpi: Number(p.max_kpi_per_kra) || 5,
          kraCreatedBy: (p.kra_created_by as string) ?? null,
          oneToOneMandatory: p.one_to_one_mandatory as boolean ?? null,
          midPeriodCheckin: p.mid_period_checkin as boolean ?? null,
          finalReviewOneToOne: p.final_review_one_to_one as boolean ?? null,
          approvalChain: (p.approval_chain as string) ?? null,
          chainId: (p.chain_id as string) ?? null,
          chainName: chainRowOf(p)?.name ?? null,
          chainRungs: chainRowOf(p)?.rungs ?? null,
          whoCanFinalise: (p.who_can_finalise as string) ?? null,
          ratingScaleType: (p.rating_scale_type as string) ?? null,
          selfRatingMandatory: p.self_rating_mandatory as boolean ?? null,
          newJoinerCutoffDays: p.new_joiner_cutoff_days == null
            ? null : Number(p.new_joiner_cutoff_days),
          includeNoticePeriod: p.include_notice_period as boolean ?? null,
          includeExited: p.include_exited as boolean ?? null,
          postFinalOwner: (p.post_final_owner as string) ?? 'HR',
          publishScope: (p.publish_scope as string) ?? 'COMPANY',
          // 211. DEFAULTS TRUE, matching the column and the trigger: a
          // policy read before the migration runs must not read as "the
          // gate is off", which would let a result out unsettled.
          hrHeadFinalRating: p.hr_head_final_rating === undefined
            ? true : p.hr_head_final_rating as boolean,
        })
        setConfigs(polRows.map(toConfig))

        /**
         * THE COMPANY NAMES, which nothing had ever fetched.
         *
         * ConfigTab already renders `policy.companyName` beside the policy
         * name, and PolicyConfig has carried the field all along — it was
         * hardcoded to null with the comment "filled below once
         * department/company names load", and there was no such code anywhere
         * in this file. So the screen showed "Standard Quarterly" with nothing
         * to distinguish it from the other two policies of the same name, and
         * an admin had no way to notice they were looking at a different
         * company's settings than the ones they had just edited.
         */
        let coQ = supabase.from('companies').select('id, company_name')
        if (co) coQ = coQ.eq('id', co)
        const cos = await coQ.limit(200)
        if (!cos.error) {
          // Held in a local as well as in state: the publish/summary dataset is
          // assembled later in THIS SAME pass and needs the names now, and
          // React state is not readable synchronously after setting it.
          coNames = Object.fromEntries(
            ((cos.data ?? []) as unknown as { id: string; company_name?: string }[])
              .map(c => [String(c.id), String(c.company_name ?? '')]))
          setCompanyNames(coNames)
        }
        // The frequency preview follows whichever policy is being shown, which
        // the selector decides; seeded from the first so the screen is not
        // blank before anything is chosen.
        if (polRows[0]?.frequency) setFreq(polRows[0].frequency as Frequency)
      }

      // §6.3's export is specified as "all columns", so the columns have to be
      // fetched. Six were being selected and the export is expected to carry
      // thirteen. The view does not hold rm_l1_score / rm_l2_score /
      // hod_score at all — only self_score — so the per-rung manager ratings
      // the spec lists cannot be exported without widening the view itself.
      const f = await supabase.from('vw_pms_fill_status')
        .select('employee_name, employee_code, department_id, fill_status, kra_count, total_weightage,'
              + 'employment_flag, one_to_one_status, self_score, final_rating, final_rating_code,'
              + 'finalised_by_role, workflow_status, last_action_at, period_code')
        .eq('period_id', row.id).limit(2000)
      if (!f.error) setFill((f.data ?? []) as unknown as FillRow[])

      /**
       * WHAT HAS REACHED HR, for the Publish Results tab.
       *
       * NOT from vw_pms_fill_status, which the tab above uses. That view
       * carries no employee_id and no chain_stage, so it cannot say who a row
       * is or whether the chain has handed it over — and publishing needs
       * both: an id to write against, and the stage to know it is HR's to
       * release rather than a HOD's to finish. Widening the view would mean a
       * migration for something two columns of a table already answer.
       *
       * Read on chain_stage, not workflow_status. FINALISED says a rating
       * exists; stage HR says nobody below still holds it. DONE is included so
       * the tab can show what it has already published — otherwise a row
       * vanishes the instant it is released and HR cannot tell a successful
       * publish from a failed one.
       */
      /**
       * SELECTED ON workflow_status, NOT chain_stage.
       *
       * The first version filtered chain_stage IN ('HR','DONE'), which reads
       * naturally and misses two whole classes of row:
       *
       *   * anything finalised BEFORE 197 existed has chain_stage NULL. Nikhil
       *     Reddy (SRS9088) is finalised with a null stage, and an IN filter
       *     does not match NULL — so his settled rating was invisible to the
       *     only screen that can release it.
       *   * anything finalised through a path that did not move the stage.
       *     198 fixes that going forward, but a migration cannot reach rows
       *     that were already wrong.
       *
       * workflow_status is the honest question: FINALISED means a rating
       * exists and is settled, which is exactly when HR may publish it, and
       * PUBLISHED/ACKNOWLEDGED are the already-released rows the tab lists
       * underneath. chain_stage then only decides which of the two lists a row
       * falls into, which it does correctly whether it is NULL or not.
       */
      // EVERY enrolment, not only the settled ones. This set now feeds two
      // tabs: Publish Results, which filters to what is finalised, and
      // Ratings Summary, whose whole job is "all the employees" — including
      // the ones still in the chain, shown as such. Fetching twice would be
      // two queries disagreeing about the same period.
      const periodIds = openPeriods.map(x => x.id)
      /**
       * TOLERANT OF 211 NOT HAVING RUN, for the reason the policy select is:
       * one unknown column fails the WHOLE request, and this one feeds both
       * the publish workspace and the ratings summary. Without the retry,
       * adding the gate would have emptied two tabs on any database where
       * the migration had not been applied yet.
       */
      const PUB_HR = ', hr_final_confirmed_at, hr_final_confirmed_by,'
                   + ' hr_management_discussed, hr_final_reason, chain_final_rating,'
                   + ' hr_direct, hr_direct_reason'
      const PUB_BASE = 'employee_id, period_id, company_id, final_rating, final_rating_code,'
                     + 'finalised_by_role, finalised_at, chain_stage, workflow_status, employee_ack'
      const askPub = (sel: string) => supabase.from('pms_overall_rating')
        .select(sel).in('period_id', periodIds).limit(4000)
      let pub = await askPub(PUB_BASE + PUB_HR)
      if (pub.error) pub = await askPub(PUB_BASE)
      if (pub.error) {
        // Before 197 is applied there is no chain_stage column at all, and
        // that is a waiting state rather than a fault: every other tab works.
        console.error('[pms] publish queue unavailable:', pub.error)
        setPubRows([])
        setAsks({})
        setPipQueue([])
      } else {
        /**
         * Cast because chain_stage is NOT in the generated database types: 197
         * adds it, and the types are generated from the applied schema. Without
         * this the whole row type collapses to GenericStringError and every
         * field read below is a type error — eleven of them, which is how this
         * was found rather than guessed. The same `as unknown as` the fill
         * query above uses, for the same reason.
         */
        // Labels for the period and company each row belongs to, so a
        // cross-company summary can say which cycle a rating came from
        // instead of mixing three companies into one undifferentiated list.
        const periodLabelOf = new Map(openPeriods.map(x =>
          [String(x.id), String(x.period_code ?? x.period_name ?? '')]))
        const companyOf = new Map(Object.entries(coNames))
        /**
         * WHETHER A ROW'S POLICY REQUIRES THE HR HEAD'S SETTLEMENT (211).
         *
         * Defaults TRUE on every miss — an unknown period, an unknown
         * policy, a policy read before the migration. The gate must fail
         * CLOSED: reading "not required" when the database thinks otherwise
         * would show an enabled publish button that the trigger then throws
         * on, and the one time it did not throw, a result would go out
         * unsettled.
         */
        const gateOfPolicy = new Map(configs.map(c =>
          [String(c.policyId), c.hrHeadFinalRating !== false]))
        const policyOfPeriod = new Map(openPeriods.map(x =>
          [String(x.id), String((x as { policy_id?: string }).policy_id ?? '')]))
        const hrGateOf = (periodId: string) => {
          const pid = policyOfPeriod.get(periodId)
          if (!pid) return true
          const g = gateOfPolicy.get(pid)
          return g === undefined ? true : g
        }

        const pubData = (pub.data ?? []) as unknown as {
          employee_id: string
          period_id: string
          company_id?: string | null
          final_rating?: number | string | null
          final_rating_code?: string | null
          finalised_by_role?: string | null
          finalised_at?: string | null
          chain_stage?: string | null
          workflow_status?: string | null
          employee_ack?: boolean | null
        }[]
        const ids = pubData.map(r => String(r.employee_id))
        // Names, departments, the feedback HR writes, the recognition it
        // awards, and whether the final review is signed. Five reads for the
        // whole period rather than five per row — the publish workspace and
        // the summary both need all of it, and a per-row query would be
        // 390 x 5 against tables already keyed on (period, employee).
        const [emps, fbs, bens, frs] = ids.length ? await Promise.all([
          // location_id joins the select for the bulk-publish branch filter.
          // "Branch" in the request is the locations table: ten of them,
          // typed Factory, Branch, Head Office and Corporate Office.
          supabase.from('employees')
            .select('id, emp_code, full_name, department_id, location_id').in('id', ids),
          supabase.from('pms_feedback')
            .select('employee_id, period_id, appreciation_remark, improvement_feedback')
            .in('period_id', periodIds).in('employee_id', ids),
          supabase.from('pms_additional_benefits')
            .select('employee_id, period_id, benefit_type, benefit_note')
            .in('period_id', periodIds).in('employee_id', ids),
          supabase.from('pms_one_to_one')
            .select('employee_id, period_id, employee_ack, manager_ack')
            .in('period_id', periodIds).eq('discussion_type', 'FINAL_REVIEW')
            .in('employee_id', ids),
        ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }] as const

        // WHAT THE CHAIN ASKED FOR. Shared with the focused refresh a
        // decision triggers — see fetchChainAsks.
        const chain = await fetchChainAsks(periodIds, ids,
          new Map((emps.data ?? []).map(e => {
            const r = e as { id: string; emp_code?: string; full_name?: string }
            return [r.id, { emp_code: r.emp_code, full_name: r.full_name }] as const
          })))
        setAsks(chain.asks)
        setPipQueue(chain.queue)

        // KEYED ON (period, employee). Keying on the employee alone was safe
        // while this read one period; across several it silently shows one
        // period's feedback against another's rating.
        const K = (pid: unknown, eid: unknown) => `${String(pid)}|${String(eid)}`
        const fbBy = new Map((fbs.data ?? []).map(x => {
          const r = x as { employee_id: string; period_id: string
                           appreciation_remark?: string; improvement_feedback?: string }
          return [K(r.period_id, r.employee_id), r]
        }))
        const benBy = new Map<string, { type: string; note: string }[]>()
        for (const b of bens.data ?? []) {
          const r = b as { employee_id: string; period_id: string
                           benefit_type: string; benefit_note?: string }
          const k = K(r.period_id, r.employee_id)
          benBy.set(k, [...(benBy.get(k) ?? []),
                        { type: String(r.benefit_type), note: String(r.benefit_note ?? '') }])
        }
        // 200's gate: BOTH acknowledgements. A row with no final review at all
        // is NOT signed, which is the honest answer — the trigger will refuse
        // it for exactly that reason.
        // 207: THE MANAGER'S ACKNOWLEDGEMENT ALONE. It used to need the
        // employee's too, which left a finalised rating unpublishable while
        // the person it was about had not yet ticked a box about a
        // conversation their HOD had already confirmed. The employee's half
        // is still recorded; it no longer gates the result.
        const signed = new Set((frs.data ?? [])
          .filter(x => (x as { manager_ack?: boolean }).manager_ack)
          .map(x => { const r = x as { employee_id: string; period_id: string }
                      return K(r.period_id, r.employee_id) }))
        const byId = new Map((emps.data ?? []).map(e => {
          const r = e as { id: string; emp_code?: string; full_name?: string
                           department_id?: string; location_id?: string }
          return [r.id, r]
        }))
        /**
         * BRANCH NAMES, for the bulk filter.
         *
         * Read for the locations actually in play rather than the whole
         * table, and tolerant of the read failing: a filter that cannot be
         * labelled is worth losing, the publish workspace is not.
         */
        const locIds = [...new Set((emps.data ?? [])
          .map(e => (e as { location_id?: string }).location_id)
          .filter((x): x is string => !!x))]
        const locNames: Record<string, string> = {}
        if (locIds.length) {
          const lo = await supabase.from('locations')
            .select('id, location_name').in('id', locIds)
          for (const l of lo.data ?? []) {
            const r = l as { id: string; location_name?: string }
            if (r.location_name) locNames[r.id] = r.location_name
          }
        }
        setPubRows(pubData.map(r => {
          const e = byId.get(String(r.employee_id))
          return {
            employeeId: String(r.employee_id),
            name: e?.full_name ?? 'Unknown',
            code: e?.emp_code ?? '',
            // PostgREST returns numeric as a STRING, so Number() is not
            // decoration — a template literal on the raw value would read
            // "4.50" where the rest of the screen says 4.5.
            finalRating: r.final_rating == null ? null : Number(r.final_rating),
            finalRatingCode: r.final_rating_code ?? null,
            finalisedByRole: r.finalised_by_role ?? null,
            finalisedAt: r.finalised_at ?? null,
            departmentId: e?.department_id ?? null,
            periodId: String(r.period_id),
            periodLabel: periodLabelOf.get(String(r.period_id)) ?? null,
            companyName: companyOf.get(String(r.company_id ?? '')) ?? null,
            appreciation: fbBy.get(K(r.period_id, r.employee_id))?.appreciation_remark ?? null,
            improvement: fbBy.get(K(r.period_id, r.employee_id))?.improvement_feedback ?? null,
            benefits: benBy.get(K(r.period_id, r.employee_id)) ?? [],
            signedOff: signed.has(K(r.period_id, r.employee_id)),
            // 211. The row's own HR-final columns, and whether this row's
            // POLICY requires them — read per period, because HR Head spans
            // companies and each runs its own policy.
            hrFinal: {
              final_rating: r.final_rating == null ? null : Number(r.final_rating),
              chain_final_rating: (r as { chain_final_rating?: number | null }).chain_final_rating ?? null,
              hr_final_confirmed_at: (r as { hr_final_confirmed_at?: string | null }).hr_final_confirmed_at ?? null,
              hr_final_confirmed_by: (r as { hr_final_confirmed_by?: string | null }).hr_final_confirmed_by ?? null,
              hr_management_discussed: (r as { hr_management_discussed?: boolean | null }).hr_management_discussed ?? false,
              hr_final_reason: (r as { hr_final_reason?: string | null }).hr_final_reason ?? null,
            },
            hrFinalRequired: hrGateOf(String(r.period_id)),
            // 212. Carried so the screen can waive the sign-off fault
            // exactly where the database waives the rule.
            hrDirect: (r as { hr_direct?: boolean }).hr_direct === true,
            hrDirectReason: (r as { hr_direct_reason?: string | null }).hr_direct_reason ?? null,
            locationId: e?.location_id ?? null,
            locationName: e?.location_id ? (locNames[e.location_id] ?? null) : null,
            acknowledged: r.employee_ack === true,
            // Either marker counts. The stage is what this screen moves, the
            // status is what the employee's screen reads, and a row that has
            // one without the other is half-published — worth showing as
            // published so somebody looks, rather than offering the button
            // again.
            published: r.chain_stage === 'DONE'
                    || r.workflow_status === 'PUBLISHED'
                    || r.workflow_status === 'ACKNOWLEDGED',
          }
        }))
      }

      // THE SCALE THE COMPANY CONFIGURED, for §6.4's validator. It was
      // hardcoded [1,2,3,4,5] with improvement mandatory at or below 2, which
      // happens to match the seeded scale and would silently stop matching
      // the moment an admin edited it — the same hardcoding that was removed
      // from the rating screens. improvement_feedback_mandatory is a per-band
      // flag, so the threshold is the HIGHEST band that still demands it.
      let scQ = supabase.from('pms_rating_scale')
        .select('rating_value, rating_label, improvement_feedback_mandatory, is_active, sort_order')
      if (co) scQ = scQ.eq('company_id', co)
      const sc = await scQ
      if (!sc.error) {
        const bands = ((sc.data ?? []) as unknown as {
          rating_value: number; rating_label?: string
          improvement_feedback_mandatory: boolean; is_active?: boolean
        }[]).filter(b => b.is_active !== false)
        if (bands.length) {
          setScale(bands.map(b => Number(b.rating_value)).sort((a, b) => a - b))
          setBandList([...bands]
            .sort((a, b) => Number(b.rating_value) - Number(a.rating_value))
            .map(b => ({
              value: Number(b.rating_value),
              label: String((b as { rating_label?: string }).rating_label ?? b.rating_value),
              improvementMandatory: !!b.improvement_feedback_mandatory,
            })))
          const mandatory = bands.filter(b => b.improvement_feedback_mandatory)
            .map(b => Number(b.rating_value))
          setImprovementAtOrBelow(mandatory.length ? Math.max(...mandatory) : null)
        }
      }
    } else {
      setFill([])
    }

    setLoading(false)
  }, [grant]) // eslint-disable-line react-hooks/exhaustive-deps

  // Coverage reads `employees`, which exists regardless of the migration, so it
  // is loaded separately and still works while the module is pending.
  //
  // HOD resolves in a fixed order and never guesses:
  //   1. employees.hod_id            explicit override (matrix / dotted-line)
  //   2. departments.hod_employee_id primary source
  //   3. BLOCK
  //
  // The department column arrives with migration 067, so until that runs only
  // the override source can be counted. That is reported as a distinct state
  // rather than folded into "0 mapped", which would misdescribe the problem.
  const loadCoverage = useCallback(async () => {
    const co = companyFilter(grant, grant.companyId)
    const count = async (col?: 'l1_manager_id' | 'l2_manager_id' | 'hod_id') => {
      let q = supabase.from('employees').select('id', { count: 'exact', head: true })
      if (col) q = q.not(col, 'is', null)
      if (co) q = q.eq('company_id', co)
      const { count: n } = await q
      return n || 0
    }

    const total = await count()
    const l1 = await count('l1_manager_id')
    const l2 = await count('l2_manager_id')
    const hodOverride = await count('hod_id')

    // Does the department source exist yet?
    let deptQ = supabase.from('departments').select('id,hod_employee_id')
    if (co) deptQ = deptQ.eq('company_id', co)
    const dept = await deptQ.limit(400)
    if (dept.error) {
      setCov({ total, l1, l2, hodOverride, hodDept: 0, hodResolved: hodOverride, deptSourceReady: false })
      return
    }
    const mapped = new Set(
      (dept.data || []).filter(d => d.hod_employee_id).map(d => d.id as string),
    )
    // Employees covered by their department having an HOD
    const byDeptQ = mapped.size
      ? (() => { let q = supabase.from('employees').select('id', { count: 'exact', head: true })
                   .in('department_id', [...mapped]).is('hod_id', null)
                 if (co) q = q.eq('company_id', co); return q })()
      : null
    const { count: byDept } = byDeptQ ? await byDeptQ : { count: 0 }
    setCov({
      total, l1, l2, hodOverride,
      hodDept: byDept || 0,
      hodResolved: hodOverride + (byDept || 0),
      deptSourceReady: true,
    })
  }, [grant]) // eslint-disable-line react-hooks/exhaustive-deps

  // Department names, so the table says "Finance & Accounts" and not a uuid.
  useEffect(() => {
    (async () => {
      // dept_name, not name. `name` does not exist on this table, and asking
      // for it fails the whole select — so every department silently rendered
      // as "Unknown department" while the screen looked like it had loaded.
      const co = companyFilter(grant, grant.companyId)
      let dQ = supabase.from('departments').select('id, dept_name')
      if (co) dQ = dQ.eq('company_id', co)
      const d = await dQ.limit(400)
      if (d.error) return
      const m: Record<string, string> = {}
      for (const r of (d.data ?? []) as unknown as { id: string; dept_name: string }[]) {
        m[r.id] = r.dept_name
      }
      setDeptNames(m)
    })()
  }, [grant]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Keep the publish workspace pointed at a company that actually exists.
   *
   * Seeded from the newest open period's company, which is what the rest of
   * this screen already describes. Re-checked rather than set once: a reload
   * can change which companies are in scope, and a stale selection would
   * leave the workspace showing an empty list with no clue why.
   */
  useEffect(() => {
    if (!pubCompanies.length) return
    const valid = pubCompany === 'ALL'
      ? pubAllowAll
      : pubCompanies.some(c => c.name === pubCompany)
    if (valid) return
    const current = pubRows?.find(r => r.periodId === periodId)?.companyName
    setPubCompany(current ?? pubCompanies[0].name)
  }, [pubCompanies, pubCompany, pubAllowAll, pubRows, periodId])

  useEffect(() => { load(); loadCoverage() }, [load, loadCoverage])

  /**
   * HR RELEASES THE RESULT. The last move in the chain, and the only one on
   * this screen that writes.
   *
   * IT CHANGES NO RATING, by requirement: "hr manager and hr authorities can
   * not change the ratings and kras set for team through out the chain, they
   * just see it and publish it". So this touches three columns that are all
   * about delivery, and nothing about the number.
   *
   * Existing feedback is made visible in the same action. pms_feedback is
   * written by the finaliser with visible_to_employee, and the employee's
   * screen shows feedback only when the result is published AND that flag is
   * set — so publishing without flipping it would release a rating with the
   * feedback still hidden, which is §8's "result + feedback" half-delivered.
   * No row is created here: HR does not author feedback, and an upsert would
   * let them.
   *
   * chain_stage goes to DONE so the stage and the status agree. Leaving the
   * stage at HR would keep the employee's banner saying it is with HR to
   * publish while their Result tab showed the rating.
   */
  /**
   * The policy's post-finalisation owner, and whether this viewer is it.
   *
   * 202 defaults to 'HR', which is what was asked for: after the HOD settles
   * the rating, HR writes the feedback, awards recognition and publishes. A
   * company running docx Stage 6 sets FINALISER and these controls go back to
   * the HOD — the tab stays visible either way, read-only, because HR Admin
   * still needs to see where a cycle has got to.
   */
  const postFinalOwner = (config?.postFinalOwner ?? 'HR') as PostFinalOwner
  /**
   * THE VIEWER'S REAL ROLE, from the roles they hold.
   *
   * This was `grant.isSuperAdmin ? 'ADMIN' : 'HR_MGR'` — everybody who
   * reached this page was HR Manager, so mayWritePostFinal said yes to all
   * of them. Combined with Publish Results borrowing the seeded
   * 'pms.upload' key, which L1_MANAGER, L2_MANAGER and HOD all hold in
   * role_screen_access, a line manager could open HR's publish workspace,
   * write the feedback an employee reads, and release the result.
   *
   * pmsRoleOf reads role_code off the grant the roles module already
   * produces. Nothing in that module changes; this stops ignoring it.
   */
  const myHrRole = pmsRoleOf(grant.roles, grant.isSuperAdmin)
  const canRunPostFinal = mayWritePostFinal(postFinalOwner, myHrRole)

  /**
   * HR writes what the employee reads.
   *
   * UPSERT on pms_feedback and a replace on the benefits, which is the same
   * shape the HOD's own publish path has always used — one row of feedback per
   * (period, employee), and recognition rows that are a set rather than a log,
   * so editing means replacing.
   *
   * given_by_role records HR, not HOD. An appreciation remark written by HR
   * and one written by the manager who held the conversation are different
   * documents, and the column is the only place that difference survives.
   */
  /**
   * IS THIS ROW INSIDE THE CHOSEN SCOPE? 203.
   *
   * The handlers resolve rows from the full cross-company dataset, because
   * the summary needs it whole. Trusting the list to have narrowed it is one
   * refactor away from being wrong, and the act is irreversible — so the rule
   * is checked where the write happens, not only where the button is drawn.
   */
  const inPublishScope = useCallback((employeeId: string) => {
    const row = pubRows?.find(r => r.employeeId === employeeId)
    if (!row) return false
    if (pubCompany === 'ALL') {
      return pubCompanies.some(c => c.name === row.companyName && c.allowsAll)
    }
    return (row.companyName ?? '') === (pubCompany ?? '')
  }, [pubRows, pubCompany, pubCompanies])

  /**
   * HR'S DECISION ON ONE PROPOSAL.
   *
   * Writes only hr_status, the note and who decided — never the proposal
   * itself. A rater's words stay a rater's words; HR agreeing or not is a
   * separate column, which is the whole reason 208 gave these rows their own
   * lifecycle instead of filing them as awards.
   *
   * ACCEPTING DOES NOT AWARD ANYTHING. The recognition that actually reaches
   * the employee is the benefits list on the publish card, written by HR and
   * released by publishing. Making acceptance create a benefit row would mean
   * a rater's proposal could put an award in front of an employee with HR
   * having clicked once, and there would be no way to accept the intent while
   * wording the award differently.
   */
  const decideAsk = useCallback(async (id: string, status: HrStatus, note: string) => {
    setCommitNote(null)
    const { error } = await supabase.from('pms_training_recommendation')
      .update({
        hr_status: status,
        hr_note: note.trim() || null,
        hr_actioned_by: grant.employeeId ?? null,
        hr_actioned_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) {
      setCommitNote(`That decision was refused: ${error.message}`)
      return
    }
    /**
     * REFETCHED, NOT PATCHED IN PLACE, and NOT a full reload.
     *
     * Not patched, because the same row feeds the badge in the table, the
     * per-kind counts and the publish warnings — three hand-updated copies
     * is how one of them goes stale.
     *
     * Not load(), because the tab block is gated on `!loading`: a full
     * reload unmounts the publish workspace, and HR deciding the first of
     * three proposals would find the card closed and themselves back at the
     * list. This re-reads exactly what changed.
     */
    const rows = pubRows ?? []
    const periodIds = [...new Set(rows.map(r => r.periodId)
      .filter((x): x is string => !!x))]
    const people = new Map(rows.map(r =>
      [r.employeeId, { emp_code: r.code, full_name: r.name }]))
    const chain = await fetchChainAsks(periodIds, [...people.keys()], people)
    setAsks(chain.asks)
    setPipQueue(chain.queue)
  }, [grant.employeeId, pubRows])

  /**
   * THE HR HEAD SETTLING THE FINAL RATING (211).
   *
   * Re-checked HERE, not only in the component. The button is disabled
   * while checkFinal reports a fault, but a disabled button is a courtesy,
   * not a control — this is the write, and it is the last place in the
   * application that can refuse. The database refuses too, on the publish
   * rather than on this update, so all three have to agree.
   */
  const settleFinal = useCallback(async (employeeId: string, intent: FinalIntent) => {
    if (!canSettleFinal(myHrRole)) {
      setCommitNote('Only the HR Head can settle a final rating.')
      return
    }
    const row = pubRows?.find(r => r.employeeId === employeeId)
    const periodId = row?.periodId
    if (!periodId) return
    // The band the chain settled: what stands now, unless it has already
    // been replaced once, in which case the chain's own number is the one
    // kept aside.
    const chainRating = row?.hrFinal?.chain_final_rating ?? row?.finalRating ?? null
    const check = checkFinal(intent, chainRating, bandList.map(b => b.value))
    if (!check.ok) { setCommitNote(check.faults[0]); return }

    setSettling(employeeId); setCommitNote(null)
    const { error } = await supabase.from('pms_overall_rating')
      .update(finalPatch(intent, chainRating, grant.employeeId ?? null))
      .eq('employee_id', employeeId).eq('period_id', periodId)
    setSettling(null)
    if (error) { setCommitNote(`That could not be saved: ${error.message}`); return }

    /**
     * ONE ROW REFETCHED, NOT THE WHOLE PAGE.
     *
     * load() flips `loading` and the tab block sits behind `!loading`, so a
     * full reload unmounts the publish workspace — closing the open card
     * and throwing away an appreciation remark typed before settling.
     * Observed: text entered, rating settled, text gone.
     *
     * Refetched rather than patched from `intent`, because the database is
     * what decided the result: the trigger could have refused, and
     * chain_final_rating is only populated on an override. Reading the row
     * back is the only way the screen and the row agree.
     */
    const fresh = await supabase.from('pms_overall_rating')
      .select('final_rating, final_rating_code, chain_final_rating, hr_direct,'
            + ' hr_final_confirmed_at, hr_final_confirmed_by,'
            + ' hr_management_discussed, hr_final_reason, workflow_status')
      .eq('employee_id', employeeId).eq('period_id', periodId).limit(1)
    // The same `as unknown as` the other PMS selects use: columns added by
    // 211 and 212 are not in the generated types, so the row collapses to
    // GenericStringError without it.
    const got = ((fresh.data ?? []) as unknown as Record<string, unknown>[])[0]
    if (!got) { load(); return }
    setPubRows(rows => (rows ?? []).map(r =>
      r.employeeId === employeeId && r.periodId === periodId
        ? { ...r,
            finalRating: got.final_rating == null ? null : Number(got.final_rating),
            finalRatingCode: (got.final_rating_code as string) ?? r.finalRatingCode,
            hrDirect: got.hr_direct === true,
            hrFinal: {
              final_rating: got.final_rating == null ? null : Number(got.final_rating),
              chain_final_rating: got.chain_final_rating == null
                ? null : Number(got.chain_final_rating),
              hr_final_confirmed_at: (got.hr_final_confirmed_at as string) ?? null,
              hr_final_confirmed_by: (got.hr_final_confirmed_by as string) ?? null,
              hr_management_discussed: got.hr_management_discussed === true,
              hr_final_reason: (got.hr_final_reason as string) ?? null,
            } }
        : r))
  }, [myHrRole, pubRows, bandList, grant.employeeId, load])

  /**
   * WRITING AN APPRAISAL THE CHAIN NEVER PICKED UP (212).
   *
   * FOUR WRITES, AND THE ORDER IS LOAD-BEARING. 212's guard refuses the
   * stamp on a row that already has KRAs or a rating, so the stamp has to
   * go on FIRST, while the row is still untouched; everything after it is
   * the HR Head's own work on a row that is now marked as theirs. Writing
   * the goals first would make the guard refuse the very appraisal this
   * exists to create.
   *
   * It stops at the first failure rather than carrying on. A half-built
   * appraisal — stamped with no KRAs, or KRAs with no ratings — is worse
   * than none, because it looks finished on the publish queue. What it
   * cannot do is undo the steps that already succeeded: there is no
   * transaction across four PostgREST calls, so the sentence returned says
   * which step failed and the row is left where a second attempt can see
   * it. The guard then refuses a re-stamp, which is the honest outcome: the
   * record needs a look, not another blind write.
   */
  const saveDirect = useCallback(async (
    employeeCode: string, intent: DirectIntent,
  ): Promise<string | null> => {
    if (!canActDirect(myHrRole)) return 'Only the HR Head can do this.'
    const row = (fill ?? []).find(f => String(f.employee_code) === employeeCode)
    if (!row) return 'That employee is not in this period.'
    const why = whyNotDirect({
      final_rating: row.final_rating, workflow_status: row.workflow_status,
      kra_count: row.kra_count, self_score: row.self_score,
    })
    if (why) return why
    const check = checkDirect(intent, bandList.map(b => b.value))
    if (!check.ok) return check.faults[0]

    const emp = await supabase.from('employees')
      .select('id, company_id').eq('emp_code', employeeCode).limit(1)
    const e = (emp.data ?? [])[0] as { id?: string; company_id?: string } | undefined
    if (!e?.id || !periodId) return 'Could not resolve that employee.'
    const co = e.company_id ?? companyFilter(grant, grant.companyId)

    // 1. The stamp, while the row is still clean.
    const stamp = await supabase.from('pms_overall_rating')
      .update(directStamp(intent.reason ?? '', grant.employeeId ?? null))
      .eq('employee_id', e.id).eq('period_id', periodId)
    if (stamp.error) return `The appraisal could not be marked as direct: ${stamp.error.message}`

    // 2. The KRAs.
    const goals = await supabase.from('pms_employee_goals').insert(
      intent.kras.map(k => ({
        company_id: co, period_id: periodId, employee_id: e.id,
        seq_no: k.seq_no, kra_title: k.kra_title, kpi_metric: k.kpi_metric,
        target_value: k.target_value, category: k.category,
        weightage: k.weightage, source: 'MANUAL', status: 'LOCKED',
        locked_at: new Date().toISOString(), locked_by: grant.employeeId ?? null,
      }))).select('id, seq_no')
    if (goals.error) return `The KRAs could not be saved: ${goals.error.message}`

    const bySeq = new Map((goals.data ?? []).map(g => {
      const r = g as { id: string; seq_no: number }
      return [Number(r.seq_no), String(r.id)]
    }))

    // 3. ONE KPI PER KRA, carrying the KRA's whole weightage.
    //
    // 220 made a rating name its KPI rather than its KRA, and kpi_id is NOT
    // NULL — so without this the insert below is refused outright and the
    // HR Head cannot record a direct appraisal at all. The shape is 220's own
    // backfill: a KRA the Head typed in one box is one measure, and giving it
    // the full weightage keeps pms_validate_kpis balanced.
    const kpis = await supabase.from('pms_goal_kpi').insert(
      intent.kras.map(k => ({
        company_id: co, period_id: periodId, employee_id: e.id,
        goal_id: bySeq.get(k.seq_no), seq_no: 1,
        kpi_metric: k.kpi_metric || k.kra_title,
        target_value: k.target_value, weightage: k.weightage,
      }))).select('id, goal_id')
    if (kpis.error) return `The KPIs could not be saved: ${kpis.error.message}`
    const kpiByGoal = new Map((kpis.data ?? []).map(x => {
      const r = x as { id: string; goal_id: string }
      return [String(r.goal_id), String(r.id)]
    }))

    // 4. A rating against each, attributed to the HR Head.
    const reviews = await supabase.from('pms_reviews').insert(
      intent.kras.map(k => {
        const goalId = bySeq.get(k.seq_no)
        return {
          company_id: co, period_id: periodId, employee_id: e.id,
          goal_id: goalId, kpi_id: goalId ? kpiByGoal.get(goalId) : undefined,
          rater_id: grant.employeeId ?? null,
          rater_role: 'HR_HEAD', rating: intent.scores[k.seq_no] ?? null,
          submitted: true, submitted_at: new Date().toISOString(),
        }
      }))
    if (reviews.error) return `The ratings could not be saved: ${reviews.error.message}`

    // 5. The settled record. FINALISED, not PUBLISHED: it joins the publish
    // queue, where 211 asks the HR Head the attestation like everybody else.
    const fin = await supabase.from('pms_overall_rating').update({
      final_rating: Number(intent.finalRating),
      final_score: suggestedFinal(intent),
      workflow_status: 'FINALISED',
      chain_stage: 'HR',
      finalised_by: grant.employeeId ?? null,
      finalised_by_role: 'HR_HEAD',
      finalised_at: new Date().toISOString(),
      rating_source: 'HR_OVERRIDE',
      kra_count: intent.kras.length,
      total_weightage: intent.kras.reduce((t, k) => t + (Number(k.weightage) || 0), 0),
    }).eq('employee_id', e.id).eq('period_id', periodId)
    if (fin.error) return `The final rating could not be saved: ${fin.error.message}`

    /**
     * THE MESSAGE IS HELD BY THE PAGE, NOT BY THE FORM.
     *
     * load() flips `loading`, and the whole tab block sits behind
     * `!loading` — so the form unmounts and any banner it set disappears in
     * the same tick. Observed: the appraisal saved correctly and the screen
     * said nothing at all, which leaves the HR Head unable to tell a
     * success from a silent failure on the one action that creates a
     * result out of nothing.
     *
     * UploadTab already documents this trap on its onCommitted prop. Same
     * answer: whoever survives the reload holds the sentence.
     */
    setCommitNote(`${row.employee_name ?? 'That employee'} now has a full `
      + 'appraisal on record. It is waiting on Publish Results, where you '
      + 'confirm the final rating and release it.')
    load()
    return null
  }, [myHrRole, fill, bandList, periodId, grant, load])

  const saveFeedback = useCallback(async (employeeId: string, patch: {
    appreciation: string; improvement: string
    benefits: { type: string; note: string }[]
  }) => {
    if (!inPublishScope(employeeId)) {
      setCommitNote('That employee is not in the company you are working on. '
                  + 'Switch company above before writing their feedback.')
      return
    }
    // THE ROW'S PERIOD, not the page's. HR Head spans companies and each runs
    // its own cycle, so the page's "current period" is one of several — using
    // it would write another company's feedback against the wrong period, or
    // silently against nothing.
    const periodId = pubRows?.find(r => r.employeeId === employeeId)?.periodId
    if (!periodId) return
    setCommitNote(null)
    const co = companyFilter(grant, grant.companyId)

    const fb = await supabase.from('pms_feedback').upsert({
      company_id: co, period_id: periodId, employee_id: employeeId,
      appreciation_remark: patch.appreciation.trim() || null,
      improvement_feedback: patch.improvement.trim() || null,
      given_by_role: 'HR_MGR',
      // NOT visible yet. Publishing is what opens it, and that is a separate
      // deliberate act — writing the words must not release them.
      visible_to_employee: false,
    }, { onConflict: 'period_id,employee_id' })
    if (fb.error) {
      console.error('[pms] HR feedback save refused:', fb.error)
      setCommitNote('That feedback did not save. Try again before publishing.')
      return
    }

    const kept = patch.benefits.filter(b => b.note.trim() || b.type)
    await supabase.from('pms_additional_benefits')
      .delete().eq('period_id', periodId).eq('employee_id', employeeId)
    if (kept.length) {
      const ben = await supabase.from('pms_additional_benefits').insert(
        kept.map(b => ({
          company_id: co, period_id: periodId, employee_id: employeeId,
          benefit_type: b.type, benefit_note: b.note.trim() || null,
        })))
      if (ben.error) {
        console.error('[pms] HR recognition save refused:', ben.error)
        setCommitNote('The feedback saved but the recognition did not. Add it again before telling them it is published.')
        return
      }
    }
    setCommitNote('Saved. Not released to them until you publish.')
    load()
  }, [pubRows, grant, load, inPublishScope])

  /**
   * RELEASING A BATCH.
   *
   * ONE ROW AT A TIME, NOT ONE STATEMENT. A single UPDATE with `in` would
   * be fewer round trips and the wrong shape: the publish triggers RAISE,
   * so one unexpected refusal anywhere in the set would abort the whole
   * statement and release nobody. Per-row, a refusal costs that one person
   * and the other hundred still go out — which is what the owner chose
   * when they picked "publish the ready ones, list the rest".
   *
   * Each row is re-checked against the SAME gate the screen used, because
   * the list was built when the screen rendered and something may have
   * settled or unsettled since. The database is the final authority either
   * way; this just means the reported reason is a sentence rather than a
   * constraint name.
   *
   * It does NOT stop at the first failure, unlike the direct appraisal.
   * There the four writes build one record and half of it is worse than
   * none; here each publish is independent and stopping would strand the
   * rest for no reason.
   */
  const publishMany = useCallback(async (
    ids: string[], onDone: (n: number) => void,
  ): Promise<{ published: string[]; failed: { code: string; name: string; message: string }[] }> => {
    const published: string[] = []
    const failed: { code: string; name: string; message: string }[] = []
    let n = 0

    for (const employeeId of ids) {
      const row = pubRows?.find(r => r.employeeId === employeeId)
      const named = { code: row?.code ?? employeeId, name: row?.name ?? 'Unknown' }
      if (!row?.periodId) {
        failed.push({ ...named, message: 'No open period for this appraisal.' })
        onDone(++n); continue
      }
      if (!inPublishScope(employeeId)) {
        // 203 again: the company narrowing is not advisory.
        failed.push({ ...named, message: 'Not in the company you are working on.' })
        onDone(++n); continue
      }
      const faults = publishFaults({
        finalRating: row.finalRating, appreciation: row.appreciation,
        improvement: row.improvement,
        improvementRequired: !!bandList.find(b => b.value === row.finalRating)?.improvementMandatory,
        signedOff: row.signedOff, hrDirect: row.hrDirect,
        hrFinal: row.hrFinal, hrFinalRequired: row.hrFinalRequired,
      })
      if (faults.length) { failed.push({ ...named, message: faults[0] }); onDone(++n); continue }

      // Same two writes as publishOne, in the same order: the feedback is
      // opened first, so a failure there cannot leave a rating visible with
      // its words still hidden.
      const fb = await supabase.from('pms_feedback')
        .update({ visible_to_employee: true })
        .eq('period_id', row.periodId).eq('employee_id', employeeId)
      if (fb.error) console.error('[pms] bulk: feedback visibility failed', employeeId, fb.error)

      const st = await supabase.from('pms_overall_rating')
        .update({ workflow_status: 'PUBLISHED',
                  published_at: new Date().toISOString(),
                  chain_stage: 'DONE' })
        .eq('period_id', row.periodId).eq('employee_id', employeeId)
      if (st.error) failed.push({ ...named, message: st.error.message })
      else published.push(employeeId)
      onDone(++n)
    }

    /**
     * THE ROWS ARE UPDATED IN PLACE, NOT RELOADED.
     *
     * THIRD TIME THIS SESSION. load() flips `loading` and the tab block
     * sits behind `!loading`, so a reload unmounts the bulk screen — and
     * with it the outcome panel listing exactly who went out and who was
     * refused. Observed: a batch published correctly and the screen showed
     * nothing, which on a bulk irreversible action is the worst moment to
     * say nothing at all.
     *
     * Patched rather than refetched, and that is safe HERE where it was
     * not for the settlement: what changed is known exactly — these ids
     * are published — rather than decided by a trigger that might have
     * adjusted something. Anything refused is already in `failed`.
     */
    if (published.length) {
      const done = new Set(published)
      setPubRows(rows => (rows ?? []).map(r =>
        done.has(r.employeeId) ? { ...r, published: true } : r))
    }
    return { published, failed }
  }, [pubRows, bandList, inPublishScope])

  const publishOne = useCallback(async (employeeId: string) => {
    // 203: a result released to the wrong person cannot be unreleased.
    if (!inPublishScope(employeeId)) {
      setCommitNote('That employee is not in the company you are working on. '
                  + 'Nothing was published.')
      return
    }
    const periodId = pubRows?.find(r => r.employeeId === employeeId)?.periodId
    if (!periodId) return
    setPublishing(employeeId)
    setCommitNote(null)

    // Not fatal on its own: a period with no feedback row still has a rating
    // worth releasing, and `update` on no rows is a no-op rather than an error.
    const fb = await supabase.from('pms_feedback')
      .update({ visible_to_employee: true })
      .eq('period_id', periodId).eq('employee_id', employeeId)
    if (fb.error) console.error('[pms] making feedback visible failed:', fb.error)

    const st = await supabase.from('pms_overall_rating')
      .update({ workflow_status: 'PUBLISHED',
                published_at: new Date().toISOString(),
                chain_stage: 'DONE' })
      .eq('period_id', periodId).eq('employee_id', employeeId)
    setPublishing(null)
    if (st.error) {
      console.error('[pms] publish refused:', st.error)
      setCommitNote('That result could not be published. Try again, and tell the developer if it keeps failing.')
      return
    }
    setCommitNote(fb.error
      ? 'Published — the employee can see their rating. The feedback could not be opened to them, though; check it before telling them it is all there.'
      : 'Published. The employee can see their rating and feedback now.')
    load()
  }, [pubRows, load, inPublishScope])

  const roll: Rollup | null = fill ? rollUp(fill) : null
  const depts: DeptRollup[] = fill ? byDepartment(fill) : []
  const nameOf = (id: string | null) => id ? (deptNames[id] ?? 'Unknown department') : 'No department set'

  // Named for what you go there to DO. "KRA Oversight" told nobody what they
  // would find; "Who has not started" is the question somebody actually has.
  const TABS: { k: Tab; label: string; hint: string }[] = [
    { k: 'overview', label: 'This cycle', hint: 'where the whole organisation has got to' },
    ...ADMIN_TABS.map(t => ({ k: t.k as Tab, label: t.label, hint: t.blurb })),
    { k: 'chain',    label: 'Flow & Hierarchy',
      hint: 'the twelve steps, the reporting line, and who may do what' },
  ]

  // The rail. WHO MAY SEE WHICH TAB is the same two checks as before — the
  // screen permission and, for the configuring tab, canManage — and only the
  // tabs that pass are then grouped for drawing.
  const visibleTabs = TABS.filter(t => canSeeScreen(grant, screenKeyOf(t.k))
                        && (canManage(grant, 'Performance')
                            || !CONFIGURES_THE_MODULE.has(t.k)))
  const lastGroup = NAV_GROUPS[NAV_GROUPS.length - 1].key
  const navGroups = NAV_GROUPS
    .map(g => ({ ...g, tabs: visibleTabs.filter(t => (NAV[t.k]?.group ?? lastGroup) === g.key) }))
    .filter(g => g.tabs.length)

  // The hero's four numbers are the roll-up the overview already computes —
  // nothing new is fetched for them.
  const heroKpis = roll && roll.total > 0 ? [
    { l: 'In this cycle',  v: roll.total, share: 1 },
    { l: 'Not started',    v: roll.notStarted, share: roll.notStarted / roll.total },
    { l: 'With the chain', v: roll.counts.SUBMITTED + roll.counts.IN_REVIEW,
      share: (roll.counts.SUBMITTED + roll.counts.IN_REVIEW) / roll.total },
    { l: 'Finalised',      v: roll.counts.FINALISED, share: roll.done },
  ] : null

  // Every rule in pms.css is scoped under .pms so its very generic class names
  // (.card, .stat, .pill, .btn) cannot leak into another module. That scoping
  // means the class below is not decoration — without it the whole stylesheet
  // is dead on this page, which is exactly what happened: the preview harness
  // set it, the real screen did not, and the harness looked perfect while the
  // product rendered unstyled.
  return (
    <div className="pms" style={{ padding: `${S.lg}px ${S.xl}px ${S.huge}px`, maxWidth: 1440, margin: '0 auto' }}>

      <header className="pms-hero">
        <div className="pms-hero-main">
          <div className="pms-hero-eyebrow">
            <span className="pms-hero-ico" aria-hidden="true"><IconPerformance size={15} /></span>
            Performance management
          </div>
          <h1>Performance</h1>
          <div className="pms-hero-sub">
            {naming
              ? <>Running now: <strong>{naming.title}</strong> · {naming.sub}</>
              : <>KRAs, the appraisal cycle and ratings. You are not a step in the chain:
                 it runs Employee → manager → second manager → HOD, and you keep it moving.</>}
          </div>
          <div className="pms-hero-chips">
            {ready === true && <span className="pms-hero-chip pms-live">Module live</span>}
            <span className="pms-hero-chip"><IconCalendar size={13} /> FY {fyLabel}</span>
            {naming?.code && <span className="pms-hero-chip">{naming.code}</span>}
          </div>
        </div>
        {heroKpis && (
          <div className="pms-hero-kpis" aria-label="This cycle at a glance">
            {heroKpis.map(k => (
              <div key={k.l} className="pms-hero-kpi">
                <div className="pms-hk-v">{k.v}</div>
                <div className="pms-hk-l">{k.l}</div>
                <div className="pms-hk-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(Math.max(0, Math.min(1, k.share)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </header>

      {/* The rail: icon pills, grouped by errand. Still one <button> per tab,
          with aria-current on the open one — choosing a tab works exactly as
          it did. */}
      <nav className="pms-nav" aria-label="Performance sections">
        {navGroups.map(g => (
          <div key={g.key} className="pms-nav-group" role="group" aria-label={g.label}>
            <span className="pms-nav-label" aria-hidden="true">{g.label}</span>
            {g.tabs.map(t => {
              const Ico = NAV[t.k]?.icon
              return (
                <button key={t.k} type="button" onClick={() => setTab(t.k)}
                        className={tab === t.k ? 'on' : undefined}
                        aria-current={tab === t.k ? 'page' : undefined}>
                  {Ico && <Ico size={15} />}
                  {t.label}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      {/* The hint belongs on the page, not in a tooltip: a title attribute is
          invisible to touch and to anyone not hovering. */}
      {(() => {
        const cur = TABS.find(t => t.k === tab)
        const Ico = NAV[tab]?.icon
        return (
          <div className="pms-pagehead">
            {Ico && <span className="pms-pagehead-ico" aria-hidden="true"><Ico size={20} /></span>}
            <div style={{ minWidth: 0 }}>
              <h2 className="pms-pagehead-t">{cur?.label}</h2>
              <div className="pms-pagehead-d">{cur?.hint}</div>
            </div>
          </div>
        )
      })()}

      {commitNote && (
        <div className="pms-toast" role="status">
          <span className="pms-toast-ico" aria-hidden="true"><IconBell size={15} /></span>
          <div className="pms-toast-body">{commitNote}</div>
          <button type="button" className="pms-toast-x" onClick={() => setCommitNote(null)}>
            Dismiss
          </button>
        </div>
      )}
      {loading && (
        <div className="pms-skel" aria-busy="true" aria-label="Loading">
          <i /><i /><i />
        </div>
      )}

      {!loading && err && (
        <Card tone="critical" icon={<IconAlert size={18} />}
              title="Could not read the performance module.">
          {err}
        </Card>
      )}

      {!loading && !err && ready === false && <MigrationPending />}

      {!loading && !err && ready === true && (
        <>
          {tab === 'overview' && (
            roll ? (
              <>
                <ReadinessBanner r={roll} />
                <div style={{ display: 'grid', gap: S.sm, marginBottom: S.sm }}>
                  <FillDistribution r={roll} />
                </div>
              </>
            ) : <Overview cov={cov} />
          )}

          {tab === 'fill'     && <FillTab rows={fill} deptNames={deptNames} loading={loading}
                               totalWeightage={config?.totalWeightage} />}
          {tab === 'publish'  && <PublishTab rows={pubRows} loading={loading}
                               onPublish={publishOne} onSaveFeedback={saveFeedback}
                               publishing={publishing} periodLabel={naming?.title}
                               bands={bandList} canAct={canRunPostFinal}
                               note={postFinalNote(postFinalOwner, myHrRole)}
                               company={pubCompany} onCompany={setPubCompany}
                               companies={pubCompanies} allowAll={pubAllowAll}
                               asks={asks} onDecideAsk={canRunPostFinal ? decideAsk : undefined}
                               canSettleFinal={canSettleFinal(myHrRole)}
                               onSettleFinal={settleFinal} settling={settling}
                               onPublishMany={publishMany} deptNames={deptNames} />}
          {tab === 'summary'  && <SummaryTab rows={pubRows} loading={loading}
                               deptNames={deptNames} bands={bandList}
                               periodLabel={naming?.title} />}
          {tab === 'config'   && <ConfigTab policy={config} freq={freq} onFreq={setFreq} fyStart={fyStart}
                                            fyLabel={fyLabel} today={localToday()}
                                            choices={configChoices}
                                            onChoosePolicy={setConfigPolicyId} />}
          {tab === 'setup'    && <AdminEditor />}
          {tab === 'policies' && <PolicyTab policies={policies} people={[]} />}
          {tab === 'upload'   && <UploadTab rows={fill} scale={scale}
                               improvementAtOrBelow={improvementAtOrBelow}
                               periodId={periodId} periodLabel={naming?.title}
                               canBuildDirect={canActDirect(myHrRole)}
                               onDirect={saveDirect}
                               onCommitted={m => { setCommitNote(m); load() }} />}
          {tab === 'pip'      && <PipTab queue={pipQueue} />}
          {tab === 'reports'  && <ReportsTab />}
          {tab === 'chain'    && <FlowTab chainCoverage={cov ? <ChainCoverage cov={cov} /> : null} />}
        </>
      )}

      {/* Routing coverage is data work that can start TODAY: it reads employees
          and departments, not pms_*, so it is shown while the module is still
          pending rather than waiting on a migration to become useful. */}
      {!loading && ready === false && cov && <ChainCoverage cov={cov} />}
    </div>
  )
}

/**
 * The shell's own notice card — module pending, no period, coverage, errors.
 * An icon tile and a title on the left, the explanation beside it; the tone
 * tints the edge and the tile and nothing else.
 */
function Card({ children, tone, icon, title }: {
  children?: React.ReactNode; tone?: 'critical' | 'warning'
  icon?: React.ReactNode; title?: React.ReactNode
}) {
  const cls = tone === 'critical' ? 'pms-note pms-crit' : tone === 'warning' ? 'pms-note pms-warn' : 'pms-note'
  return (
    <div className={cls}>
      {icon && <span className="pms-note-ico" aria-hidden="true">{icon}</span>}
      <div style={{ minWidth: 0, flex: 1 }}>
        {title && <div className="pms-note-t">{title}</div>}
        {children != null && <div className="pms-note-d">{children}</div>}
      </div>
    </div>
  )
}

function MigrationPending() {
  return (
    <Card tone="warning" icon={<IconAlert size={18} />} title="Waiting on migration 066">
      The performance module's tables do not exist in the database yet. The screens and the
      approval flow are built; they have nothing to read until{' '}
      <code>supabase/migrations/066_pms_module.sql</code>{' '}
      is applied. That file creates 15 tables, 9 functions, 10 views and 2 triggers.
      <div style={{ marginTop: 10 }}>
        It is handed to Nayan rather than run from here. This project does not apply schema
        changes itself. Nothing on this page is broken; it is waiting.
      </div>
    </Card>
  )
}

function Overview({ cov }: { cov: Coverage | null }) {
  return (
    <Card icon={<IconCalendar size={18} />} title="Cycle overview">
      No active period yet. Create a policy in Setup and periods generate from its frequency:
      monthly, quarterly, half-yearly or annual.
      {cov && cov.hodResolved === 0 && ' Note the HOD warning below: the finalise step has nobody to route to yet.'}
    </Card>
  )
}

/**
 * The approval chain can only route where the org data exists, and the finalise
 * step is the one that has nobody today — so it is stated here rather than
 * discovered when the first cycle jams.
 *
 * HOD resolves in a fixed order and never guesses:
 *   1. employees.hod_id             explicit override (matrix / dotted-line)
 *   2. departments.hod_employee_id  primary source
 *   3. BLOCK
 *
 * No fallback to RM L2 or a parent department. A wrong finaliser signs off
 * somebody's appraisal, and a silent guess makes that impossible to notice.
 */
function ChainCoverage({ cov }: { cov: Coverage }) {
  const rows = [
    { label: 'RM L1', n: cov.l1, col: 'l1_manager_id', note: 'approves KRAs and rates' },
    { label: 'RM L2', n: cov.l2, col: 'l2_manager_id', note: 'confirms the RM L1 rating' },
    { label: 'HOD',   n: cov.hodResolved, col: 'resolved', note: 'finalises and publishes' },
  ]
  const blocked = cov.total - cov.hodResolved
  return (
    <Card tone={cov.hodResolved < cov.total ? 'warning' : undefined}
          icon={<IconOrgChart size={18} />} title="Approval chain coverage">
      An appraisal can only move to a stage that has somebody mapped to it.
      <div className="pms-cov">
        {rows.map(r => {
          const pct = cov.total ? Math.round((r.n / cov.total) * 100) : 0
          const bad = r.n === 0
          return (
            <div key={r.label} className="pms-cov-row">
              <div className="pms-cov-k">{r.label}</div>
              <div className="pms-cov-bar">
                <span style={{ width: `${pct}%`,
                               background: bad ? TK.critical : pct === 100 ? TK.positive : TK.warning }} />
              </div>
              <div className="pms-cov-n" style={{ ...numeric, color: bad ? TK.critical : TK.ink }}>
                {r.n} / {cov.total}
              </div>
              <div className="pms-cov-m">
                <code>{r.col}</code> · {r.note}
              </div>
            </div>
          )
        })}
      </div>
      {/* How the HOD number above was arrived at. Shown because "0 mapped" on
          its own does not tell anyone which of the two sources to go and fill. */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${TK.line}` }}>
        <div style={{ fontSize: F.micro, fontWeight: W.bold, letterSpacing: 0,
                       color: TK.faint, marginBottom: 8 }}>
          How HOD resolves
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: F.small, color: TK.muted, lineHeight: 1.8,
                     listStyle: 'decimal' }}>
          <li>
            <code>employees.hod_id</code>: explicit override for matrix and dotted-line cases
            {' · '}<strong style={{ color: TK.ink }}>{cov.hodOverride}</strong> set
          </li>
          <li>
            <code>departments.hod_employee_id</code>: the primary source
            {' · '}
            {cov.deptSourceReady
              ? <><strong style={{ color: TK.ink }}>{cov.hodDept}</strong> covered this way</>
              : <span style={{ color: TK.warning }}>column arrives with migration 067</span>}
          </li>
          <li>
            Otherwise <strong style={{ color: TK.critical }}>blocked</strong>, no guess is made
          </li>
        </ol>
      </div>

      {blocked > 0 && (
        <div style={{ fontSize: F.small, color: TK.muted, marginTop: 12, lineHeight: 1.6 }}>
          <strong style={{ color: TK.ink }}>{blocked} of {cov.total}</strong> employees cannot reach
          the finalise step today.{' '}
          {cov.deptSourceReady
            ? 'Set an HOD on their department, or an override on the individual where reporting is matrix.'
            : 'Once 067 is applied, setting an HOD per department covers most of them in one pass. The per-employee override is only for exceptions.'}
        </div>
      )}
    </Card>
  )
}
