'use client'
// components/ess/Performance.tsx — PMS inside the employee portal.
//
// Three audiences share this one screen, and which tabs appear is decided by
// data rather than by a role table:
//
//   Everyone   My KRAs — write 4 to 10, weightage totalling exactly 100
//   RM L1/L2   My Team — approve reportees' KRAs, then rate them
//   HOD        Department — finalise and publish
//
// WHY ROLES ARE DERIVED, NOT LOOKED UP
//
// user_roles has 0 rows, so there is nothing to read. But the org columns are
// already populated and mean exactly the same thing: somebody is an RM because
// people report to them, and an HOD because a department points at them. That
// is more truthful than a role flag anyway — a role flag can disagree with the
// hierarchy, this cannot.
//
// THE TABLES DO NOT EXIST YET
//
// Migrations 055 and 056 are written and handed to Nayan, not applied. Every
// pms_* read can legitimately come back PGRST205, and that is a state to render
// rather than an error to swallow — otherwise this looks broken when it is
// merely waiting.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { C as TK, F, W, R, numeric } from '@/lib/ui'

const MISSING_TABLE = 'PGRST205'

/** Spec §3.2 — these drive the category analytics later. */
const CATEGORIES = ['BUSINESS', 'PROCESS', 'PEOPLE', 'CUSTOMER', 'COMPLIANCE', 'LEARNING'] as const
type Category = typeof CATEGORIES[number]

const KRA_MIN = 4, KRA_MAX = 10, WEIGHT_TOTAL = 100, WEIGHT_MIN_PER_KRA = 5

interface Kra {
  id?: string
  seq_no: number
  kra_title: string
  kpi_metric: string
  target_value: string
  category: Category
  weightage: number
}

interface Roles { isRM: boolean; isHOD: boolean; reportees: number; deptCount: number }

const blankKra = (seq: number): Kra => ({
  seq_no: seq, kra_title: '', kpi_metric: '', target_value: '',
  category: 'BUSINESS', weightage: 0,
})

export default function Performance({ employeeId }: { employeeId: string }) {
  const [roles, setRoles] = useState<Roles | null>(null)
  const [moduleReady, setModuleReady] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'mine' | 'team' | 'dept'>('mine')

  // Who is this person, in org terms? Both reads work today — they hit
  // employees and departments, not pms_*.
  useEffect(() => {
    (async () => {
      const { count: reportees } = await supabase
        .from('employees').select('id', { count: 'exact', head: true })
        .or(`l1_manager_id.eq.${employeeId},l2_manager_id.eq.${employeeId}`)
        .is('date_of_leaving', null)

      // departments.hod_employee_id arrives with 056. Until then only the
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
  if (!roles) return <Muted>Loading…</Muted>

  const tabs: { k: typeof tab; label: string; hint: string }[] = [
    { k: 'mine', label: 'My KRAs', hint: 'what you are measured on' },
    ...(roles.isRM  ? [{ k: 'team' as const, label: `My Team (${roles.reportees})`, hint: 'approve and rate' }] : []),
    ...(roles.isHOD ? [{ k: 'dept' as const, label: 'Department', hint: 'finalise and publish' }] : []),
  ]

  return (
    <div>
      {tabs.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {tabs.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} className="ez-tab" data-on={tab === t.k ? '1' : '0'}
              title={t.hint}
              style={{ padding: '7px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                       fontSize: F.tiny, fontWeight: tab === t.k ? W.semi : W.medium,
                       background: tab === t.k ? TK.brand : 'transparent',
                       color: tab === t.k ? TK.onAccent : TK.muted,
                       border: `1px solid ${tab === t.k ? TK.brand : TK.line}` }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'mine' && <MyKras employeeId={employeeId} />}
      {tab === 'team' && <TeamQueue employeeId={employeeId} n={roles.reportees} />}
      {tab === 'dept' && <DeptQueue employeeId={employeeId} />}
    </div>
  )
}

// ── My KRAs ────────────────────────────────────────────────────────────────
//
// The validation is the substance of this screen. Spec §3.2: at least 4, at
// most 10, weightage totalling exactly 100, and no single KRA below 5. All of
// it is live — the employee should never be able to press Submit on a set that
// the database will reject, so the button stays disabled and says why.

function MyKras({ employeeId }: { employeeId: string }) {
  const [kras, setKras] = useState<Kra[]>(() =>
    Array.from({ length: KRA_MIN }, (_, i) => blankKra(i + 1)))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const total = kras.reduce((s, k) => s + (Number(k.weightage) || 0), 0)
  const filled = kras.filter(k => k.kra_title.trim()).length

  const problems: string[] = []
  if (kras.length < KRA_MIN) problems.push(`At least ${KRA_MIN} KRAs — you have ${kras.length}`)
  if (kras.length > KRA_MAX) problems.push(`At most ${KRA_MAX} KRAs`)
  if (filled < kras.length) problems.push(`${kras.length - filled} KRA${kras.length - filled === 1 ? '' : 's'} still need a title`)
  if (total !== WEIGHT_TOTAL) problems.push(`Weightage must total exactly ${WEIGHT_TOTAL} — currently ${total}`)
  const light = kras.filter(k => k.weightage > 0 && k.weightage < WEIGHT_MIN_PER_KRA).length
  if (light) problems.push(`${light} KRA${light === 1 ? '' : 's'} below the ${WEIGHT_MIN_PER_KRA} minimum`)

  const set = (i: number, patch: Partial<Kra>) =>
    setKras(ks => ks.map((k, n) => n === i ? { ...k, ...patch } : k))

  const add = () => setKras(ks => ks.length >= KRA_MAX ? ks : [...ks, blankKra(ks.length + 1)])
  const remove = (i: number) =>
    setKras(ks => ks.length <= KRA_MIN ? ks : ks.filter((_, n) => n !== i).map((k, n) => ({ ...k, seq_no: n + 1 })))

  const submit = async () => {
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('pms_employee_goals').insert(
      kras.map(k => ({ ...k, employee_id: employeeId, status: 'PENDING_RM_APPROVAL' })))
    setSaving(false)
    setMsg(error
      ? ((error as { code?: string }).code === MISSING_TABLE
          ? 'The performance module is not live yet — migration 055 has not been applied.'
          : error.message)
      : 'Sent to your reporting manager.')
  }

  return (
    <div>
      <WeightMeter total={total} count={kras.length} />

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {kras.map((k, i) => (
          <div key={i} style={{ border: `1px solid ${TK.line}`, borderRadius: 14, padding: 12,
                                background: TK.surface }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ ...numeric, width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                             background: TK.brandTint, color: TK.brandDeep, fontSize: F.micro,
                             fontWeight: W.bold, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {k.seq_no}
              </span>
              <input value={k.kra_title} onChange={e => set(i, { kra_title: e.target.value })}
                placeholder="What are you accountable for?"
                style={{ ...inp, flex: 1, fontWeight: W.semi }} />
              <button onClick={() => remove(i)} disabled={kras.length <= KRA_MIN}
                title={kras.length <= KRA_MIN ? `${KRA_MIN} is the minimum` : 'Remove'}
                style={{ ...ghost, opacity: kras.length <= KRA_MIN ? .4 : 1 }}>Remove</button>
            </div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
              <input value={k.kpi_metric} onChange={e => set(i, { kpi_metric: e.target.value })}
                placeholder="How it is measured" style={inp} />
              <input value={k.target_value} onChange={e => set(i, { target_value: e.target.value })}
                placeholder="Target" style={inp} />
              <select value={k.category} onChange={e => set(i, { category: e.target.value as Category })} style={inp}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c[0] + c.slice(1).toLowerCase()}</option>)}
              </select>
              <input type="number" min={0} max={100} value={k.weightage || ''}
                onChange={e => set(i, { weightage: Number(e.target.value) })}
                placeholder="Weightage"
                style={{ ...inp, ...numeric,
                         borderColor: k.weightage > 0 && k.weightage < WEIGHT_MIN_PER_KRA ? TK.warning : TK.line }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={add} disabled={kras.length >= KRA_MAX}
          title={kras.length >= KRA_MAX ? `${KRA_MAX} is the maximum` : 'Add another KRA'}
          style={{ ...ghost, opacity: kras.length >= KRA_MAX ? .4 : 1 }}>
          + Add KRA
        </button>
        <button onClick={submit} disabled={problems.length > 0 || saving}
          style={{ padding: '9px 18px', borderRadius: 10, cursor: problems.length ? 'not-allowed' : 'pointer',
                   fontFamily: 'inherit', fontSize: F.small, fontWeight: W.semi,
                   border: `1px solid ${problems.length ? TK.line : TK.brand}`,
                   background: problems.length ? TK.sunken : TK.brand,
                   color: problems.length ? TK.faint : TK.onAccent }}>
          {saving ? 'Sending…' : 'Send to manager'}
        </button>
      </div>

      {/* Why the button is off, rather than a disabled control with no
          explanation. */}
      {problems.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: F.small, color: TK.muted, lineHeight: 1.7 }}>
          {problems.map(p => <li key={p}>{p}</li>)}
        </ul>
      )}
      {msg && <div style={{ marginTop: 10, fontSize: F.small, color: TK.muted }}>{msg}</div>}
    </div>
  )
}

/** The weightage meter — red until it is exactly 100, because close is not valid. */
function WeightMeter({ total, count }: { total: number; count: number }) {
  const ok = total === WEIGHT_TOTAL
  return (
    <div style={{ border: `1px solid ${ok ? TK.positive : TK.warning}`, borderRadius: 14, padding: '12px 14px',
                  background: ok ? TK.positiveTint : TK.warningTint }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.small, fontWeight: W.semi, color: TK.ink }}>
          {count} KRA{count === 1 ? '' : 's'} · weightage {}
          <span style={{ ...numeric, color: ok ? TK.positive : TK.warning }}>{total}</span> / {WEIGHT_TOTAL}
        </span>
        <span style={{ fontSize: F.micro, color: TK.muted }}>
          {ok ? 'Ready to send' : total > WEIGHT_TOTAL ? `${total - WEIGHT_TOTAL} over` : `${WEIGHT_TOTAL - total} left to allocate`}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: TK.sunken, marginTop: 8, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, total)}%`, height: '100%',
                      background: ok ? TK.positive : total > WEIGHT_TOTAL ? TK.critical : TK.warning }} />
      </div>
    </div>
  )
}

// ── RM and HOD queues ──────────────────────────────────────────────────────
// Both read pms_overall_rating, which does not exist yet. They are structured
// so that wiring them up later is a query change, not a rewrite.

function TeamQueue({ employeeId, n }: { employeeId: string; n: number }) {
  return (
    <Muted>
      <strong style={{ color: TK.ink }}>{n} people report to you.</strong> Their KRAs will appear
      here for approval once a period is open. Nothing to review yet — no cycle has been started.
    </Muted>
  )
}

function DeptQueue({ employeeId }: { employeeId: string }) {
  return (
    <Muted>
      You are recorded as an HOD. Appraisals reach you for finalising after RM L1 and RM L2 have
      rated them. Nothing is waiting — no cycle has been started.
    </Muted>
  )
}

function ModulePending() {
  return (
    <div style={{ border: `1px solid ${TK.warning}`, background: TK.warningTint,
                  borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: F.body, fontWeight: W.bold, color: TK.ink }}>Performance is not live yet</div>
      <div style={{ fontSize: F.small, color: TK.muted, marginTop: 8, lineHeight: 1.6 }}>
        The screens are built, but the module's tables have not been created in the database yet.
        Nothing here is broken — it is waiting on migrations 055 and 056.
      </div>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${TK.line}`, background: TK.surface, borderRadius: 14,
                  padding: '16px 18px', fontSize: F.small, color: TK.muted, lineHeight: 1.6 }}>
      {children}
    </div>
  )
}

const inp: React.CSSProperties = {
  padding: '8px 10px', border: `1px solid ${TK.line}`, borderRadius: 10,
  fontSize: F.small, fontFamily: 'inherit', background: TK.surface, color: TK.ink,
  outline: 'none', boxSizing: 'border-box', width: '100%',
}

const ghost: React.CSSProperties = {
  padding: '8px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
  fontSize: F.tiny, fontWeight: W.semi, border: `1px solid ${TK.line}`,
  background: 'transparent', color: TK.muted,
}
