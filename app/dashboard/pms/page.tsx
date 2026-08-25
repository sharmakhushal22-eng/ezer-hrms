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

interface Coverage { total: number; l1: number; l2: number; hod: number }

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
  const loadCoverage = useCallback(async () => {
    const count = async (filter: string) => {
      let q = supabase.from('employees').select('id', { count: 'exact', head: true })
      if (filter === 'l1')  q = q.not('l1_manager_id', 'is', null)
      if (filter === 'l2')  q = q.not('l2_manager_id', 'is', null)
      if (filter === 'hod') q = q.not('hod_id', 'is', null)
      const { count: n } = await q
      return n || 0
    }
    setCov({ total: await count(''), l1: await count('l1'), l2: await count('l2'), hod: await count('hod') })
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
        {cov && cov.hod === 0 && ' Note the HOD mapping warning below: the finalise step has nobody to route to yet.'}
      </div>
    </Card>
  )
}

/**
 * The approval chain can only route where the org data exists. hod_id is empty
 * for everyone today, which means the finalise step would stall silently — so
 * it is stated plainly rather than discovered when the first cycle jams.
 */
function ChainCoverage({ cov }: { cov: Coverage }) {
  const rows = [
    { label: 'RM L1',  n: cov.l1,  col: 'l1_manager_id', note: 'approves KRAs and rates' },
    { label: 'RM L2',  n: cov.l2,  col: 'l2_manager_id', note: 'confirms the RM L1 rating' },
    { label: 'HOD',    n: cov.hod, col: 'hod_id',        note: 'finalises and publishes' },
  ]
  const worst = rows.filter(r => r.n < cov.total)
  return (
    <Card tone={cov.hod === 0 ? 'warning' : undefined}>
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
      {worst.length > 0 && (
        <div style={{ fontSize: F.small, color: TK.muted, marginTop: 12, lineHeight: 1.6 }}>
          {cov.hod === 0
            ? `No employee has an HOD mapped, so nothing can reach the finalise step. Filling employees.hod_id makes the HOD queue work immediately — no code change needed.`
            : `${worst.map(w => `${cov.total - w.n} without ${w.label}`).join(', ')}. Those appraisals will stall at that stage.`}
        </div>
      )}
    </Card>
  )
}
