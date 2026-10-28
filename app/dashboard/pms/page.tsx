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
import { companyFilter, canSeeScreen } from '@/lib/rms/resolve'
import { C as TK, F, W, S, R, E, numeric } from '@/lib/ui'
import { ReadinessBanner, FillDistribution, DepartmentTable } from '@/components/pms/AdminOverview'
import { rollUp, byDepartment, type FillRow, type Rollup, type DeptRollup } from '@/lib/pms/rollup'
import { PERIOD_OPEN } from '@/lib/pms/status'
import { nameThePeriod, frequencyPhrase, type PeriodNaming } from '@/lib/pms/language'
import { ADMIN_TABS, ConfigTab, PolicyTab, FillTab, PublishTab, SummaryTab,
         UploadTab, PipTab, ReportsTab, FlowTab, type AdminTab, type PipRow,
         type PolicyConfig, type PublishRow } from '@/components/pms/AdminTabs'
import { mayWritePostFinal, postFinalNote, type PostFinalOwner } from '@/lib/pms/postFinal'
import AdminEditor from '@/components/pms/AdminEditor'
import '@/components/pms/pms.css'
import { type Frequency, type Policy } from '@/lib/pms/policy'
import { localToday } from '@/components/pms/CycleHeader'

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
const PIP_QUEUE: PipRow[] = []

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
const SCREEN_KEY: Partial<Record<Tab, string>> = {
  publish: 'pms.upload',
  // Ratings Summary reads what Fill Status reads, so it rides the same seeded
  // key. Same reasoning as publish: a new 'pms.summary' key would be absent
  // from the seeded config and the tab invisible to everybody.
  summary: 'pms.fill',
}
const screenKeyOf = (t: Tab) => SCREEN_KEY[t] ?? 'pms.' + t

export default function PmsPage() {
  const { grant, loading: grantLoading } = useGrant()
  const [tab, setTab] = useState<Tab>('overview')
  useEffect(() => {
    const vis = (['overview','config','setup','policies','fill','publish','summary','upload','pip','reports','chain'] as Tab[]).filter(k => canSeeScreen(grant, screenKeyOf(k)))
    if (vis.length && !vis.includes(tab)) setTab(vis[0])
  }, [grant, tab])
  const [ready, setReady] = useState<boolean | null>(null)   // null = still checking
  const [loading, setLoading] = useState(true)
  const [cov, setCov] = useState<Coverage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [fill, setFill] = useState<FillRow[] | null>(null)
  /** What has reached HR's rung — see the loader. */
  const [pubRows, setPubRows] = useState<PublishRow[] | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
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
    const per = await perQ
      .order('period_start', { ascending: false }).limit(1).maybeSingle()

    const row = (per.data ?? null) as unknown as (Record<string, string | null> & { id: string }) | null
    setPeriodId(row?.id ?? null)
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
        .select('id, policy_name, frequency, is_active, min_kra_count, max_kra_count,'
              + ' total_weightage, min_weightage_per_kra, who_can_finalise,'
              + ' kra_created_by, one_to_one_mandatory, mid_period_checkin,'
              + ' final_review_one_to_one, approval_chain, rating_scale_type,'
              + ' self_rating_mandatory, new_joiner_cutoff_days, post_final_owner,'
              + ' include_notice_period, include_exited')
      if (co) polQ = polQ.eq('company_id', co)
      // ORDER BY, because "the first policy" was meaningless without one.
      // Postgres makes no promise about unordered row order, and an UPDATE
      // physically moves a row — so saving a policy could change which one
      // this screen called first. Ordered by company then name, which is also
      // the order the selector lists them in.
      const pol = await polQ.order('company_id').order('policy_name').limit(50)
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
          kraCreatedBy: (p.kra_created_by as string) ?? null,
          oneToOneMandatory: p.one_to_one_mandatory as boolean ?? null,
          midPeriodCheckin: p.mid_period_checkin as boolean ?? null,
          finalReviewOneToOne: p.final_review_one_to_one as boolean ?? null,
          approvalChain: (p.approval_chain as string) ?? null,
          whoCanFinalise: (p.who_can_finalise as string) ?? null,
          ratingScaleType: (p.rating_scale_type as string) ?? null,
          selfRatingMandatory: p.self_rating_mandatory as boolean ?? null,
          newJoinerCutoffDays: p.new_joiner_cutoff_days == null
            ? null : Number(p.new_joiner_cutoff_days),
          includeNoticePeriod: p.include_notice_period as boolean ?? null,
          includeExited: p.include_exited as boolean ?? null,
          postFinalOwner: (p.post_final_owner as string) ?? 'HR',
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
          setCompanyNames(Object.fromEntries(
            ((cos.data ?? []) as unknown as { id: string; company_name?: string }[])
              .map(c => [String(c.id), String(c.company_name ?? '')])))
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
      const pub = await supabase.from('pms_overall_rating')
        .select('employee_id, final_rating, final_rating_code, finalised_by_role,'
              + 'finalised_at, chain_stage, workflow_status, employee_ack')
        .eq('period_id', row.id)
        .limit(2000)
      if (pub.error) {
        // Before 197 is applied there is no chain_stage column at all, and
        // that is a waiting state rather than a fault: every other tab works.
        console.error('[pms] publish queue unavailable:', pub.error)
        setPubRows([])
      } else {
        /**
         * Cast because chain_stage is NOT in the generated database types: 197
         * adds it, and the types are generated from the applied schema. Without
         * this the whole row type collapses to GenericStringError and every
         * field read below is a type error — eleven of them, which is how this
         * was found rather than guessed. The same `as unknown as` the fill
         * query above uses, for the same reason.
         */
        const pubData = (pub.data ?? []) as unknown as {
          employee_id: string
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
          supabase.from('employees').select('id, emp_code, full_name, department_id').in('id', ids),
          supabase.from('pms_feedback')
            .select('employee_id, appreciation_remark, improvement_feedback')
            .eq('period_id', row.id).in('employee_id', ids),
          supabase.from('pms_additional_benefits')
            .select('employee_id, benefit_type, benefit_note')
            .eq('period_id', row.id).in('employee_id', ids),
          supabase.from('pms_one_to_one')
            .select('employee_id, employee_ack, manager_ack')
            .eq('period_id', row.id).eq('discussion_type', 'FINAL_REVIEW')
            .in('employee_id', ids),
        ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }] as const
        const fbBy = new Map((fbs.data ?? []).map(x => {
          const r = x as { employee_id: string; appreciation_remark?: string; improvement_feedback?: string }
          return [String(r.employee_id), r]
        }))
        const benBy = new Map<string, { type: string; note: string }[]>()
        for (const b of bens.data ?? []) {
          const r = b as { employee_id: string; benefit_type: string; benefit_note?: string }
          const k = String(r.employee_id)
          benBy.set(k, [...(benBy.get(k) ?? []),
                        { type: String(r.benefit_type), note: String(r.benefit_note ?? '') }])
        }
        // 200's gate: BOTH acknowledgements. A row with no final review at all
        // is NOT signed, which is the honest answer — the trigger will refuse
        // it for exactly that reason.
        const signed = new Set((frs.data ?? [])
          .filter(x => (x as { employee_ack?: boolean }).employee_ack
                    && (x as { manager_ack?: boolean }).manager_ack)
          .map(x => String((x as { employee_id: string }).employee_id)))
        const byId = new Map((emps.data ?? []).map(e => {
          const r = e as { id: string; emp_code?: string; full_name?: string; department_id?: string }
          return [r.id, r]
        }))
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
            appreciation: fbBy.get(String(r.employee_id))?.appreciation_remark ?? null,
            improvement: fbBy.get(String(r.employee_id))?.improvement_feedback ?? null,
            benefits: benBy.get(String(r.employee_id)) ?? [],
            signedOff: signed.has(String(r.employee_id)),
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
  const myHrRole = grant.isSuperAdmin ? 'ADMIN' : 'HR_MGR'
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
  const saveFeedback = useCallback(async (employeeId: string, patch: {
    appreciation: string; improvement: string
    benefits: { type: string; note: string }[]
  }) => {
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
  }, [periodId, grant, load])

  const publishOne = useCallback(async (employeeId: string) => {
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
  }, [periodId, load])

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

  // Every rule in pms.css is scoped under .pms so its very generic class names
  // (.card, .stat, .pill, .btn) cannot leak into another module. That scoping
  // means the class below is not decoration — without it the whole stylesheet
  // is dead on this page, which is exactly what happened: the preview harness
  // set it, the real screen did not, and the harness looked perfect while the
  // product rendered unstyled.
  return (
    <div className="pms" style={{ padding: `${S.lg}px ${S.xl}px ${S.huge}px`, maxWidth: 1440, margin: '0 auto' }}>

      <div className="ez-page-head" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: F.page, fontWeight: W.bold, color: TK.ink, letterSpacing: '-.02em' }}>
            Performance
          </h1>
          <div style={{ marginTop: 3, fontSize: F.small, color: TK.muted }}>
            {naming
              ? <>Running now: <strong style={{ color: TK.ink }}>{naming.title}</strong> · {naming.sub}</>
              : <>KRAs, the appraisal cycle and ratings. You are not a step in the chain:
                 it runs Employee → manager → second manager → HOD, and you keep it moving.</>}
          </div>
        </div>
        {ready === true && (
          <span style={{ fontSize: F.micro, fontWeight: W.semi, padding: '5px 11px', borderRadius: 999,
                         background: TK.positiveTint, color: TK.positive }}>Module live</span>
        )}
      </div>

      {/* The mockup's tab strip: an underline, not a row of filled pills. With
          eight tabs, eight filled chips read as eight competing buttons; an
          underline puts the weight on the one you are in. */}
      <div className="tabs">
        {TABS.filter(t => canSeeScreen(grant, screenKeyOf(t.k))).map(t => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)}
                  className={tab === t.k ? 'on' : undefined}
                  aria-current={tab === t.k ? 'page' : undefined}>
            {t.label}
          </button>
        ))}
      </div>
      {/* The hint belongs on the page, not in a tooltip: a title attribute is
          invisible to touch and to anyone not hovering. */}
      <div style={{ fontSize: F.micro, color: TK.faint, marginTop: -10, marginBottom: 16 }}>
        {TABS.find(t => t.k === tab)?.hint}
      </div>

      {commitNote && (
        <Card>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span aria-hidden="true">✓</span>
            <div style={{ fontSize: F.small, lineHeight: 1.6 }}>
              {commitNote}
              <button type="button" onClick={() => setCommitNote(null)}
                      style={{ marginLeft: 10, background: 'none', border: 'none',
                               color: TK.muted, cursor: 'pointer', fontSize: F.small,
                               textDecoration: 'underline', padding: 0 }}>
                dismiss
              </button>
            </div>
          </div>
        </Card>
      )}
      {loading && <Card><div style={{ color: TK.muted, fontSize: F.small }}>Loading…</div></Card>}

      {!loading && err && (
        <Card tone="critical">
          <strong style={{ color: TK.critical }}>Could not read the performance module.</strong>
          <div style={{ fontSize: F.small, color: TK.muted, marginTop: 6 }}>{err}</div>
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
                               note={postFinalNote(postFinalOwner, myHrRole)} />}
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
                               onCommitted={m => { setCommitNote(m); load() }} />}
          {tab === 'pip'      && <PipTab queue={PIP_QUEUE} />}
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

function Card({ children, tone }: { children: React.ReactNode; tone?: 'critical' | 'warning' }) {
  const edge = tone === 'critical' ? TK.critical : tone === 'warning' ? TK.warning : TK.line
  const fill = tone === 'critical' ? TK.criticalTint : tone === 'warning' ? TK.warningTint : TK.surface
  return (
    <div style={{ background: fill, border: `1px solid ${edge}`, borderRadius: 14,
                  padding: '16px 18px', marginBottom: 14, boxShadow: 'var(--ez-shadow-flat)' }}>
      {children}
    </div>
  )
}

function MigrationPending() {
  return (
    <Card tone="warning">
      <div style={{ fontSize: F.body, fontWeight: W.bold, color: TK.ink }}>
        Waiting on migration 066
      </div>
      <div style={{ fontSize: F.small, color: TK.muted, marginTop: 8, lineHeight: 1.6, maxWidth: 720 }}>
        The performance module's tables do not exist in the database yet. The screens and the
        approval flow are built; they have nothing to read until{' '}
        <code style={{ background: TK.sunken, padding: '1px 6px', borderRadius: 6, fontSize: F.micro }}>
          supabase/migrations/066_pms_module.sql
        </code>{' '}
        is applied. That file creates 15 tables, 9 functions, 10 views and 2 triggers.
      </div>
      <div style={{ fontSize: F.small, color: TK.muted, marginTop: 10, lineHeight: 1.6, maxWidth: 720 }}>
        It is handed to Nayan rather than run from here. This project does not apply schema
        changes itself. Nothing on this page is broken; it is waiting.
      </div>
    </Card>
  )
}

function Overview({ cov }: { cov: Coverage | null }) {
  return (
    <Card>
      <div style={{ fontSize: F.body, fontWeight: W.bold, color: TK.ink, marginBottom: 4 }}>
        Cycle overview
      </div>
      <div style={{ fontSize: F.small, color: TK.muted, lineHeight: 1.6 }}>
        No active period yet. Create a policy in Setup and periods generate from its frequency:
        monthly, quarterly, half-yearly or annual.
        {cov && cov.hodResolved === 0 && ' Note the HOD warning below: the finalise step has nobody to route to yet.'}
      </div>
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
    <Card tone={cov.hodResolved < cov.total ? 'warning' : undefined}>
      <div style={{ fontSize: F.body, fontWeight: W.bold, color: TK.ink }}>Approval chain coverage</div>
      <div style={{ fontSize: F.small, color: TK.muted, marginTop: 4, marginBottom: 12 }}>
        An appraisal can only move to a stage that has somebody mapped to it.
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map(r => {
          const pct = cov.total ? Math.round((r.n / cov.total) * 100) : 0
          const bad = r.n === 0
          return (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ width: 60, fontSize: F.small, fontWeight: W.semi, color: TK.ink }}>{r.label}</div>
              <div style={{ flex: 1, minWidth: 160, height: 8, borderRadius: 999, background: TK.sunken, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%',
                              background: bad ? TK.critical : pct === 100 ? TK.positive : TK.warning }} />
              </div>
              <div style={{ ...numeric, width: 96, fontSize: F.small, color: bad ? TK.critical : TK.ink, fontWeight: W.semi }}>
                {r.n} / {cov.total}
              </div>
              <div style={{ fontSize: F.micro, color: TK.faint, minWidth: 180 }}>
                <code>{r.col}</code> · {r.note}
              </div>
            </div>
          )
        })}
      </div>
      {/* How the HOD number above was arrived at. Shown because "0 mapped" on
          its own does not tell anyone which of the two sources to go and fill. */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${TK.line}` }}>
        <div style={{ fontSize: F.micro, fontWeight: W.semi, letterSpacing: '.05em',
                      textTransform: 'uppercase', color: TK.faint, marginBottom: 8 }}>
          How HOD resolves
        </div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: F.small, color: TK.muted, lineHeight: 1.8 }}>
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
