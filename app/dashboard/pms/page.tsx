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
// Migration 055 creates the 15 pms_* tables and has not been applied — Nayan
// owns the database. So every load can legitimately come back "table not
// found" (PostgREST PGRST205), and that is a state to render, not an error to
// swallow. A blank page here would read as a broken feature rather than a
// pending migration, and someone would spend an afternoon debugging the app.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { C as TK, F, W, S, R, E, numeric } from '@/lib/ui'

type Tab = 'overview' | 'fill' | 'kra' | 'setup'

/** PostgREST's code for "that relation does not exist". */
const MISSING_TABLE = 'PGRST205'

interface Coverage {
  total: number; l1: number; l2: number
  /** HOD resolved from either source. -1 while the department source is unavailable. */
  hodResolved: number
  hodOverride: number      // employees.hod_id — matrix / dotted-line exceptions
  hodDept: number          // departments.hod_employee_id — the primary source
  deptSourceReady: boolean // false until migration 055 adds the column
}

export default function PmsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [ready, setReady] = useState<boolean | null>(null)   // null = still checking
  const [loading, setLoading] = useState(true)
  const [cov, setCov] = useState<Coverage | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)

    // Does the module exist yet? One cheap probe against the root table.
    const probe = await supabase.from('pms_policies').select('id').limit(1)
    if (probe.error) {
      if ((probe.error as { code?: string }).code === MISSING_TABLE) { setReady(false); setLoading(false); return }
      setErr(probe.error.message); setReady(false); setLoading(false); return
    }
    setReady(true)

    // Chain coverage is worth showing whether or not the module is live: it is
    // the thing that decides if an appraisal can actually route to anybody.
    setLoading(false)
  }, [])

  // Coverage reads `employees`, which exists regardless of the migration, so it
  // is loaded separately and still works while the module is pending.
  //
  // HOD resolves in a fixed order and never guesses:
  //   1. employees.hod_id            explicit override (matrix / dotted-line)
  //   2. departments.hod_employee_id primary source
  //   3. BLOCK
  //
  // The department column arrives with migration 055, so until that runs only
  // the override source can be counted. That is reported as a distinct state
  // rather than folded into "0 mapped", which would misdescribe the problem.
  const loadCoverage = useCallback(async () => {
    const count = async (col?: 'l1_manager_id' | 'l2_manager_id' | 'hod_id') => {
      let q = supabase.from('employees').select('id', { count: 'exact', head: true })
      if (col) q = q.not(col, 'is', null)
      const { count: n } = await q
      return n || 0
    }

    const total = await count()
    const l1 = await count('l1_manager_id')
    const l2 = await count('l2_manager_id')
    const hodOverride = await count('hod_id')

    // Does the department source exist yet?
    const dept = await supabase.from('departments').select('id,hod_employee_id').limit(400)
    if (dept.error) {
      setCov({ total, l1, l2, hodOverride, hodDept: 0, hodResolved: hodOverride, deptSourceReady: false })
      return
    }
    const mapped = new Set(
      (dept.data || []).filter(d => d.hod_employee_id).map(d => d.id as string),
    )
    // Employees covered by their department having an HOD
    const { count: byDept } = mapped.size
      ? await supabase.from('employees').select('id', { count: 'exact', head: true })
          .in('department_id', [...mapped]).is('hod_id', null)
      : { count: 0 }
    setCov({
      total, l1, l2, hodOverride,
      hodDept: byDept || 0,
      hodResolved: hodOverride + (byDept || 0),
      deptSourceReady: true,
    })
  }, [])

  useEffect(() => { load(); loadCoverage() }, [load, loadCoverage])

  const TABS: { k: Tab; label: string }[] = [
    { k: 'overview', label: 'Overview' },
    { k: 'fill',     label: 'Fill Status' },
    { k: 'kra',      label: 'KRA Oversight' },
    { k: 'setup',    label: 'Setup' },
  ]

  return (
    <div style={{ padding: `${S.lg}px ${S.xl}px ${S.huge}px`, maxWidth: 1440, margin: '0 auto' }}>

      <div className="ez-page-head" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: F.page, fontWeight: W.bold, color: TK.ink, letterSpacing: '-.02em' }}>
            Performance
          </h1>
          <div style={{ marginTop: 3, fontSize: F.small, color: TK.muted }}>
            KRAs, appraisal cycle and ratings · Employee → RM L1 → RM L2 → HOD, managed here
          </div>
        </div>
        {ready === true && (
          <span style={{ fontSize: F.micro, fontWeight: W.semi, padding: '5px 11px', borderRadius: 999,
                         background: TK.positiveTint, color: TK.positive }}>Module live</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className="ez-tab" data-on={tab === t.k ? '1' : '0'}
            style={{ padding: '7px 13px', borderRadius: 10, cursor: 'pointer',
                     fontSize: F.tiny, fontWeight: tab === t.k ? W.semi : W.medium, fontFamily: 'inherit',
                     background: tab === t.k ? TK.brand : 'transparent',
                     color: tab === t.k ? TK.onAccent : TK.muted,
                     border: `1px solid ${tab === t.k ? TK.brand : TK.line}` }}>
            {t.label}
          </button>
        ))}
      </div>

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
          {tab === 'overview' && <Overview cov={cov} />}
          {tab !== 'overview' && (
            <Card>
              <div style={{ fontSize: F.small, color: TK.muted }}>
                This tab is next in the build. The module is live, so it will read real data
                once wired.
              </div>
            </Card>
          )}
        </>
      )}

      {/* Chain coverage is the thing that decides whether an appraisal can route
          at all, so it is shown even while the module is pending — it is data
          work that can start today and does not wait on the migration. */}
      {!loading && cov && <ChainCoverage cov={cov} />}
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
        Waiting on migration 055
      </div>
      <div style={{ fontSize: F.small, color: TK.muted, marginTop: 8, lineHeight: 1.6, maxWidth: 720 }}>
        The performance module's tables do not exist in the database yet. The screens and the
        approval flow are built; they have nothing to read until{' '}
        <code style={{ background: TK.sunken, padding: '1px 6px', borderRadius: 6, fontSize: F.micro }}>
          supabase/migrations/055_pms_module.sql
        </code>{' '}
        is applied. That file creates 15 tables, 9 functions, 10 views and 2 triggers.
      </div>
      <div style={{ fontSize: F.small, color: TK.muted, marginTop: 10, lineHeight: 1.6, maxWidth: 720 }}>
        It is handed to Nayan rather than run from here — this project does not apply schema
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
        No active period yet. Create a policy in Setup and periods generate from its frequency —
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
            <code>employees.hod_id</code> — explicit override for matrix and dotted-line cases
            {' · '}<strong style={{ color: TK.ink }}>{cov.hodOverride}</strong> set
          </li>
          <li>
            <code>departments.hod_employee_id</code> — the primary source
            {' · '}
            {cov.deptSourceReady
              ? <><strong style={{ color: TK.ink }}>{cov.hodDept}</strong> covered this way</>
              : <span style={{ color: TK.warning }}>column arrives with migration 055</span>}
          </li>
          <li>
            Otherwise <strong style={{ color: TK.critical }}>blocked</strong> — no guess is made
          </li>
        </ol>
      </div>

      {blocked > 0 && (
        <div style={{ fontSize: F.small, color: TK.muted, marginTop: 12, lineHeight: 1.6 }}>
          <strong style={{ color: TK.ink }}>{blocked} of {cov.total}</strong> employees cannot reach
          the finalise step today.{' '}
          {cov.deptSourceReady
            ? 'Set an HOD on their department, or an override on the individual where reporting is matrix.'
            : 'Once 055 is applied, setting an HOD per department covers most of them in one pass — the per-employee override is only for exceptions.'}
        </div>
      )}
    </Card>
  )
}
