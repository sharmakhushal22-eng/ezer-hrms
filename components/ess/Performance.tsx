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

interface Period { id: string; period_code: string; status: string }
/** The employee's row for the period — scores, workflow status, read-only lock. */
interface Overall {
  workflow_status: string
  self_score: number | null
  final_rating: number | null
  final_rating_code: string | null
  is_readonly: boolean
}

/**
 * The active period and this employee's row in it.
 *
 * Everything past the KRA builder depends on a period existing. Rather than
 * each view discovering that separately and inventing its own flavour of
 * "nothing here", they share this and say the same thing.
 */
function usePeriod(employeeId: string) {
  const [period, setPeriod] = useState<Period | null>(null)
  const [overall, setOverall] = useState<Overall | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const p = await supabase.from('pms_periods')
      .select('id,period_code,status')
      .not('status', 'in', '("CLOSED","SCHEDULED")')
      .order('period_start', { ascending: false }).limit(1).maybeSingle()
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

/** 5-point scale — the spec's default, and what 055 seeds. */
const RATINGS = [
  { v: 5, label: 'Outstanding' },
  { v: 4, label: 'Exceeds' },
  { v: 3, label: 'Meets' },
  { v: 2, label: 'Partially meets' },
  { v: 1, label: 'Below expectations' },
]

const blankKra = (seq: number): Kra => ({
  seq_no: seq, kra_title: '', kpi_metric: '', target_value: '',
  category: 'BUSINESS', weightage: 0,
})

export default function Performance({ employeeId }: { employeeId: string }) {
  const [roles, setRoles] = useState<Roles | null>(null)
  const [moduleReady, setModuleReady] = useState<boolean | null>(null)
  const [tab, setTab] = useState<'mine' | 'oneone' | 'self' | 'result' | 'team' | 'dept'>('mine')

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
    { k: 'mine',   label: 'My KRAs',     hint: 'what you are measured on' },
    { k: 'oneone', label: 'One-to-One',  hint: 'discussions with your manager' },
    { k: 'self',   label: 'Self Rating', hint: 'rate your own delivery' },
    { k: 'result', label: 'My Result',   hint: 'once published' },
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

      {tab === 'mine'   && <MyKras employeeId={employeeId} />}
      {tab === 'oneone' && <OneToOne employeeId={employeeId} />}
      {tab === 'self'   && <SelfRating employeeId={employeeId} />}
      {tab === 'result' && <MyResult employeeId={employeeId} />}
      {tab === 'team'   && <TeamQueue employeeId={employeeId} n={roles.reportees} />}
      {tab === 'dept'   && <DeptQueue employeeId={employeeId} />}
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

// ── One-to-One ─────────────────────────────────────────────────────────────
//
// Spec §3.3. This is not a diary — it is a gate. Without both sides
// acknowledging a KRA_SETTING discussion the weightage cannot lock, and without
// a FINAL_REVIEW one the result cannot publish. pms_lock_kras() and
// pms_finalise() both refuse otherwise, so the screen states the rule rather
// than letting someone discover it at the point of being blocked.

function OneToOne({ employeeId }: { employeeId: string }) {
  const { period, loading } = usePeriod(employeeId)
  const [logs, setLogs] = useState<Record<string, unknown>[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!period) return
    const { data } = await supabase.from('pms_one_to_one')
      .select('id,discussion_type,discussion_date,mode,discussion_points,employee_ack,manager_ack')
      .eq('employee_id', employeeId).eq('period_id', period.id)
      .order('discussion_date', { ascending: false })
    setLogs(data || [])
  }, [employeeId, period])
  useEffect(() => { load() }, [load])

  // The employee can only acknowledge their own side. The manager's tick is
  // theirs to give, from their own screen.
  const ack = async (id: string) => {
    setBusy(id)
    await supabase.from('pms_one_to_one')
      .update({ employee_ack: true, employee_ack_at: new Date().toISOString() }).eq('id', id)
    setBusy(null); load()
  }

  if (loading) return <Muted>Loading…</Muted>
  if (!period)  return <NoPeriod />

  return (
    <div>
      <Muted>
        A KRA-setting discussion must be acknowledged by <strong style={{ color: TK.ink }}>both</strong> you
        and your manager before your weightage locks. The same applies to the final review before your
        result can be published. Your manager logs the discussion; you confirm it here.
      </Muted>

      {logs.length === 0 && (
        <div style={{ marginTop: 12 }}>
          <Muted>No discussions logged for {period.period_code} yet.</Muted>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {logs.map(l => {
          const both = Boolean(l.employee_ack) && Boolean(l.manager_ack)
          return (
            <div key={String(l.id)} style={{ border: `1px solid ${both ? TK.positive : TK.line}`,
                          background: TK.surface, borderRadius: 14, padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: F.micro, fontWeight: W.bold, padding: '3px 9px', borderRadius: 999,
                               background: TK.brandTint, color: TK.brandDeep }}>
                  {String(l.discussion_type).replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: F.small, color: TK.muted }}>{String(l.discussion_date)}</span>
                <span style={{ marginLeft: 'auto', fontSize: F.micro, color: both ? TK.positive : TK.warning,
                               fontWeight: W.semi }}>
                  {both ? 'Acknowledged by both' : l.employee_ack ? 'Waiting on your manager' : 'Waiting on you'}
                </span>
              </div>
              <div style={{ fontSize: F.small, color: TK.ink, marginTop: 8, lineHeight: 1.6 }}>
                {String(l.discussion_points || '')}
              </div>
              {!l.employee_ack && (
                <button onClick={() => ack(String(l.id))} disabled={busy === l.id}
                  style={{ ...ghost, marginTop: 10, borderColor: TK.brand, color: TK.brand }}>
                  {busy === l.id ? 'Confirming…' : 'I confirm this discussion happened'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Self Rating ────────────────────────────────────────────────────────────
//
// Spec §3.4. Two rules the screen has to respect rather than discover:
//   * KRAs must be LOCKED first — rating goals that can still change is
//     meaningless, and the weightage is what the score is computed from.
//   * On submit the self rating locks and the manager's unlocks. The database
//     enforces the ordering via trg_pms_self_first; this just does not offer
//     an edit afterwards.

function SelfRating({ employeeId }: { employeeId: string }) {
  const { period, overall, loading, reload } = usePeriod(employeeId)
  const [goals, setGoals] = useState<Record<string, unknown>[]>([])
  const [draft, setDraft] = useState<Record<string, { achievement: string; rating: number; comment: string }>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      if (!period) return
      const { data } = await supabase.from('pms_employee_goals')
        .select('id,seq_no,kra_title,kpi_metric,target_value,weightage,status')
        .eq('employee_id', employeeId).eq('period_id', period.id).order('seq_no')
      setGoals(data || [])
    })()
  }, [employeeId, period])

  if (loading) return <Muted>Loading…</Muted>
  if (!period)  return <NoPeriod />

  const locked = goals.length > 0 && goals.every(g => g.status === 'LOCKED')
  const submitted = overall?.workflow_status && overall.workflow_status !== 'NOT_STARTED'
    && overall.self_score != null

  if (!goals.length) return <Muted>No KRAs yet for {period.period_code}. Start in <strong style={{ color: TK.ink }}>My KRAs</strong>.</Muted>

  if (!locked) return (
    <Muted>
      Your KRAs are not locked yet, so self rating is not open. Weightage locks after you and your
      manager both acknowledge the KRA-setting discussion — see <strong style={{ color: TK.ink }}>One-to-One</strong>.
    </Muted>
  )

  if (submitted) return (
    <Muted>
      Self rating submitted for {period.period_code}, weighted score{' '}
      <strong style={{ ...numeric, color: TK.ink }}>{overall?.self_score}</strong>. It is locked now —
      your manager rates next, and you will see the outcome under <strong style={{ color: TK.ink }}>My Result</strong>.
    </Muted>
  )

  const ready = goals.every(g => draft[String(g.id)]?.rating)

  const submit = async () => {
    setSaving(true); setMsg(null)
    const rows = goals.map(g => ({
      period_id: period.id, employee_id: employeeId, goal_id: g.id,
      rater_id: employeeId, rater_role: 'SELF',
      achievement_value: draft[String(g.id)]?.achievement || null,
      rating: draft[String(g.id)]?.rating,
      comments: draft[String(g.id)]?.comment || null,
      submitted: true, submitted_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('pms_reviews').upsert(rows, { onConflict: 'period_id,employee_id,goal_id,rater_role' })
    setSaving(false)
    if (error) { setMsg(error.message); return }
    reload()
  }

  return (
    <div>
      <Muted>
        Rate each KRA on what you actually delivered. Once submitted this locks and your manager&apos;s
        rating opens — you cannot revise it afterwards, so finish before you send.
      </Muted>

      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {goals.map(g => {
          const d = draft[String(g.id)] || { achievement: '', rating: 0, comment: '' }
          const put = (patch: Partial<typeof d>) =>
            setDraft(x => ({ ...x, [String(g.id)]: { ...d, ...patch } }))
          return (
            <div key={String(g.id)} style={{ border: `1px solid ${TK.line}`, background: TK.surface,
                          borderRadius: 14, padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ ...numeric, fontSize: F.micro, fontWeight: W.bold, color: TK.brandDeep }}>
                  {String(g.seq_no)}
                </span>
                <strong style={{ fontSize: F.small, color: TK.ink }}>{String(g.kra_title)}</strong>
                <span style={{ ...numeric, marginLeft: 'auto', fontSize: F.micro, color: TK.faint }}>
                  weightage {String(g.weightage)}
                </span>
              </div>
              {Boolean(g.kpi_metric) && (
                <div style={{ fontSize: F.micro, color: TK.faint, marginTop: 3 }}>
                  {String(g.kpi_metric)}{g.target_value ? ` · target ${String(g.target_value)}` : ''}
                </div>
              )}
              <div style={{ display: 'grid', gap: 8, marginTop: 10,
                            gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
                <input value={d.achievement} onChange={e => put({ achievement: e.target.value })}
                  placeholder="What you achieved" style={inp} />
                <select value={d.rating || ''} onChange={e => put({ rating: Number(e.target.value) })} style={inp}>
                  <option value="">Your rating…</option>
                  {RATINGS.map(r => <option key={r.v} value={r.v}>{r.v} — {r.label}</option>)}
                </select>
              </div>
              <input value={d.comment} onChange={e => put({ comment: e.target.value })}
                placeholder="Anything your manager should know" style={{ ...inp, marginTop: 8 }} />
            </div>
          )
        })}
      </div>

      <button onClick={submit} disabled={!ready || saving}
        style={{ marginTop: 12, padding: '9px 18px', borderRadius: 10,
                 cursor: ready ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                 fontSize: F.small, fontWeight: W.semi,
                 border: `1px solid ${ready ? TK.brand : TK.line}`,
                 background: ready ? TK.brand : TK.sunken,
                 color: ready ? TK.onAccent : TK.faint }}>
        {saving ? 'Submitting…' : 'Submit self rating'}
      </button>
      {!ready && (
        <div style={{ fontSize: F.small, color: TK.muted, marginTop: 8 }}>
          Every KRA needs a rating before you can submit.
        </div>
      )}
      {msg && <div style={{ fontSize: F.small, color: TK.critical, marginTop: 8 }}>{msg}</div>}
    </div>
  )
}

// ── My Result ──────────────────────────────────────────────────────────────
//
// Spec §3.5: "Result publish hone se pehle rating, comments — kuch bhi visible
// nahi." So this shows nothing at all until the workflow says FINALISED and the
// feedback row is marked visible_to_employee. A half-published result — a score
// with no feedback, or a manager comment before the conversation — is worse
// than waiting.

function MyResult({ employeeId }: { employeeId: string }) {
  const { period, overall, loading } = usePeriod(employeeId)
  const [fb, setFb] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    (async () => {
      if (!period) return
      const { data } = await supabase.from('pms_feedback')
        .select('appreciation_remark,improvement_feedback,development_plan,visible_to_employee')
        .eq('employee_id', employeeId).eq('period_id', period.id).maybeSingle()
      setFb(data as Record<string, unknown> | null)
    })()
  }, [employeeId, period])

  if (loading) return <Muted>Loading…</Muted>
  if (!period)  return <NoPeriod />

  const published = overall?.workflow_status === 'FINALISED' && Boolean(fb?.visible_to_employee)
  if (!published) return (
    <Muted>
      Nothing to show for {period.period_code} yet. Your result and feedback appear here once your
      HOD has finalised and published them — not before.
    </Muted>
  )

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ border: `1px solid ${TK.brandEdge}`, background: TK.brandTint,
                    borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ fontSize: F.micro, fontWeight: W.semi, letterSpacing: '.05em',
                      textTransform: 'uppercase', color: TK.muted }}>Final rating</div>
        <div style={{ ...numeric, fontSize: 30, fontWeight: W.bold, color: TK.brandDeep, lineHeight: 1.2 }}>
          {overall?.final_rating ?? '—'}
          {overall?.final_rating_code && (
            <span style={{ fontSize: F.small, fontWeight: W.semi, color: TK.muted, marginLeft: 8 }}>
              {overall.final_rating_code}
            </span>
          )}
        </div>
        {overall?.self_score != null && (
          <div style={{ fontSize: F.small, color: TK.muted, marginTop: 6 }}>
            You rated yourself <strong style={{ ...numeric, color: TK.ink }}>{overall.self_score}</strong>
          </div>
        )}
      </div>

      {Boolean(fb?.appreciation_remark) && (
        <FeedbackCard tone="positive" title="Appreciation" body={String(fb?.appreciation_remark)} />
      )}
      {Boolean(fb?.improvement_feedback) && (
        <FeedbackCard tone="warning" title="Where to improve" body={String(fb?.improvement_feedback)} />
      )}
      {Boolean(fb?.development_plan) && (
        <FeedbackCard title="Development plan" body={String(fb?.development_plan)} />
      )}
    </div>
  )
}

function FeedbackCard({ title, body, tone }: { title: string; body: string; tone?: 'positive' | 'warning' }) {
  const edge = tone === 'positive' ? TK.positive : tone === 'warning' ? TK.warning : TK.line
  const fill = tone === 'positive' ? TK.positiveTint : tone === 'warning' ? TK.warningTint : TK.surface
  return (
    <div style={{ border: `1px solid ${edge}`, background: fill, borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ fontSize: F.micro, fontWeight: W.semi, letterSpacing: '.05em',
                    textTransform: 'uppercase', color: TK.muted, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: F.small, color: TK.ink, lineHeight: 1.65 }}>{body}</div>
    </div>
  )
}

function NoPeriod() {
  return (
    <Muted>
      No appraisal cycle is open. HR opens a period once the policy and the reporting chain are set —
      nothing for you to do until then.
    </Muted>
  )
}

// ── RM and HOD queues ──────────────────────────────────────────────────────
// Both read pms_overall_rating, which does not exist yet. They are structured
// so that wiring them up later is a query change, not a rewrite.

function TeamQueue({ employeeId, n }: { employeeId: string; n: number }) {
  const { period, loading } = usePeriod(employeeId)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])

  useEffect(() => {
    (async () => {
      if (!period) return
      // The frozen chain decides whose appraisals are mine, not a live lookup
      // of who reports to me — a reorg mid-cycle must not move work between
      // managers. Same reason pms_finalise reads the snapshot.
      const { data } = await supabase.from('pms_overall_rating')
        .select('employee_id,workflow_status,kra_count,total_weightage,self_score,rm_l1_score,employment_flag')
        .eq('period_id', period.id)
        .or(`rm_l1_id.eq.${employeeId},rm_l2_id.eq.${employeeId}`)
      if (!data?.length) { setRows([]); return }

      const ids = data.map(d => d.employee_id)
      const { data: emps } = await supabase.from('employees')
        .select('id,emp_code,full_name,designation').in('id', ids)
      const byId = new Map((emps || []).map(e => [e.id, e]))
      setRows(data.map(d => ({ ...d, emp: byId.get(d.employee_id) })))
    })()
  }, [employeeId, period])

  if (loading) return <Muted>Loading…</Muted>
  if (!period)  return <NoPeriod />
  if (!rows.length) return (
    <Muted>
      <strong style={{ color: TK.ink }}>{n} people report to you</strong>, but none are enrolled in{' '}
      {period.period_code}. Enrolment happens when HR opens the period.
    </Muted>
  )

  return (
    <div>
      <Muted>
        Your team for {period.period_code}. Approve their KRAs first; rating opens once they have
        submitted their self rating.
      </Muted>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {rows.map(r => {
          const e = r.emp as Record<string, unknown> | undefined
          const flag = String(r.employment_flag || 'ACTIVE')
          // Notice-period and exited people are highlighted because their
          // window closes with their last working day — spec §4.1.
          const edge = flag === 'EXITED' ? TK.critical : flag === 'NOTICE_PERIOD' ? TK.warning : TK.line
          return (
            <div key={String(r.employee_id)} style={{ border: `1px solid ${edge}`, background: TK.surface,
                          borderRadius: 14, padding: '12px 14px', display: 'flex', gap: 12,
                          alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: F.small, fontWeight: W.semi, color: TK.ink }}>
                  {String(e?.full_name || 'Unknown')}
                  {flag !== 'ACTIVE' && (
                    <span style={{ fontSize: F.micro, fontWeight: W.semi, marginLeft: 8,
                                   color: flag === 'EXITED' ? TK.critical : TK.warning }}>
                      {flag.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: F.micro, color: TK.faint }}>
                  {String(e?.emp_code || '')}{e?.designation ? ` · ${String(e.designation)}` : ''}
                </div>
              </div>
              <div style={{ ...numeric, fontSize: F.micro, color: TK.muted, minWidth: 150 }}>
                {r.kra_count ? `${String(r.kra_count)} KRAs · ${String(r.total_weightage)}%` : 'no KRAs yet'}
              </div>
              <span style={{ fontSize: F.micro, fontWeight: W.semi, padding: '4px 10px', borderRadius: 999,
                             background: TK.sunken, color: TK.muted, whiteSpace: 'nowrap' }}>
                {String(r.workflow_status || 'NOT_STARTED').replace(/_/g, ' ').toLowerCase()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DeptQueue({ employeeId }: { employeeId: string }) {
  const { period, loading } = usePeriod(employeeId)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])

  useEffect(() => {
    (async () => {
      if (!period) return
      const { data } = await supabase.from('pms_overall_rating')
        .select('employee_id,workflow_status,self_score,rm_l1_score,rm_l2_score,final_rating,employment_flag')
        .eq('period_id', period.id).eq('hod_id', employeeId)
      if (!data?.length) { setRows([]); return }
      const { data: emps } = await supabase.from('employees')
        .select('id,emp_code,full_name').in('id', data.map(d => d.employee_id))
      const byId = new Map((emps || []).map(e => [e.id, e]))
      setRows(data.map(d => ({ ...d, emp: byId.get(d.employee_id) })))
    })()
  }, [employeeId, period])

  if (loading) return <Muted>Loading…</Muted>
  if (!period)  return <NoPeriod />
  if (!rows.length) return (
    <Muted>
      Nothing waiting to be finalised in {period.period_code}. Appraisals reach you after RM L1 and
      RM L2 have rated them.
    </Muted>
  )

  return (
    <div>
      <Muted>
        You finalise these. RM L2 must have rated first, and a final-review one-to-one must be
        acknowledged by both sides — the database refuses to finalise otherwise.
      </Muted>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {rows.map(r => {
          const e = r.emp as Record<string, unknown> | undefined
          const ready = r.rm_l2_score != null
          return (
            <div key={String(r.employee_id)} style={{ border: `1px solid ${TK.line}`, background: TK.surface,
                          borderRadius: 14, padding: '12px 14px', display: 'flex', gap: 12,
                          alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: F.small, fontWeight: W.semi, color: TK.ink }}>
                  {String(e?.full_name || 'Unknown')}
                </div>
                <div style={{ fontSize: F.micro, color: TK.faint }}>{String(e?.emp_code || '')}</div>
              </div>
              <div style={{ ...numeric, fontSize: F.micro, color: TK.muted, minWidth: 190 }}>
                self {String(r.self_score ?? '—')} · L1 {String(r.rm_l1_score ?? '—')} · L2 {String(r.rm_l2_score ?? '—')}
              </div>
              <span style={{ fontSize: F.micro, fontWeight: W.semi, padding: '4px 10px', borderRadius: 999,
                             background: ready ? TK.brandTint : TK.sunken,
                             color: ready ? TK.brandDeep : TK.faint, whiteSpace: 'nowrap' }}>
                {ready ? 'ready to finalise' : 'waiting on RM L2'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
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
