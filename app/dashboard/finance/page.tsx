'use client'
// app/dashboard/finance/page.tsx — the finance department.
//
// Deliberately not a travel screen. Finance owns approvals and payouts across
// the product, so this reads one queue (finance_work_items) that any module can
// write to. Travel is the first module in it; payroll, vendor invoices and
// advances are already registered and appear here the moment they start
// enqueuing, with no change to this file.
//
// The module tabs are rendered from finance_modules rather than hardcoded, so
// "connect the next module" is a row in a table, not an edit here.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
// This file declares its own S, Stat, Empty and Note, so the system's spacing
// scale is imported as SP and the colliding components are not imported at all.
import {
  C, F, W, R, E, S as SP, tone, eyebrow, numeric, inputStyle,
} from '@/lib/ui'

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// Bound to the design system. Every style below reads from here, so this page
// follows lib/ui/tokens.ts rather than restating a palette.
const V = {
  navy: C.ink, purple: C.brand, purpleDark: C.brandDeep, border: C.line,
  muted: C.muted, card: C.surface, green: C.positive, greenBg: C.positiveTint,
  red: C.critical, redBg: C.criticalTint, amber: C.warning, amberBg: C.warningTint,
  purpleBg: C.brandTint, field: C.sunken, page: C.canvas,
}
const inr = (n: unknown) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const num = (v: unknown) => Number(v) || 0
const dmy = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const S = {
  card: { background: V.card, borderRadius: R.lg, border: `1px solid ${V.border}`,
          padding: '16px 18px', marginBottom: SP.md, boxShadow: E.raised } as React.CSSProperties,
  inp:  { ...inputStyle(), width: 'auto' } as React.CSSProperties,
  lbl:  { ...eyebrow, display: 'block', marginBottom: 5 } as React.CSSProperties,
  btnP: { height: 36, padding: '0 16px', borderRadius: R.md, border: `1px solid ${C.brandDeep}`,
          cursor: 'pointer', fontSize: F.small, fontWeight: W.semi, fontFamily: 'inherit',
          background: `linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color: C.onAccent,
          boxShadow: E.brand } as React.CSSProperties,
  // Approving money is the consequential action on this screen, so it is the
  // only green button — and green here means "settled", not "branded".
  btnG: { height: 36, padding: '0 16px', borderRadius: R.md, border: 'none', cursor: 'pointer',
          fontSize: F.small, fontWeight: W.semi, fontFamily: 'inherit',
          background: C.positive, color: C.onAccent } as React.CSSProperties,
  btnO: { height: 32, padding: '0 13px', borderRadius: R.md, border: `1px solid ${C.lineStrong}`,
          cursor: 'pointer', fontSize: F.tiny, fontWeight: W.medium, fontFamily: 'inherit',
          background: C.surface, color: C.ink, boxShadow: E.flat } as React.CSSProperties,
  btnR: { height: 32, padding: '0 13px', borderRadius: R.md, border: `1px solid ${tone('critical').edge}`,
          cursor: 'pointer', fontSize: F.tiny, fontWeight: W.medium, fontFamily: 'inherit',
          background: C.surface, color: C.critical, boxShadow: E.flat } as React.CSSProperties,
}

interface Company { id: string; company_name: string }
interface Mod {
  module_code: string; module_name: string; description: string | null
  is_enabled: boolean; detail_route: string | null; sort_order: number
}
interface Item {
  id: string; module_code: string; ref_id: string; ref_table: string
  title: string; subtitle: string | null; amount: number | null
  status: string; flag_count: number; raised_at: string
  employee: { emp_code: string; full_name: string } | null
  meta: Record<string, unknown> | null
}
interface Member {
  id: string; employee_id: string; role: string
  can_approve: boolean; can_disburse: boolean
  approval_limit: number | null; is_active: boolean
  employee: { emp_code: string; full_name: string; designation: string | null } | null
}

// ---------------------------------------------------------------------------
// Sub-components outside the parent — inside, they remount on every render.
// ---------------------------------------------------------------------------
function Empty({ text }: { text: string }) {
  return <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted, fontSize: F.small }}>{text}</div>
}

function Note({ tone: t, children }: { tone: 'ok' | 'warn' | 'err'; children: React.ReactNode }) {
  const k = tone(t === 'ok' ? 'positive' : t === 'warn' ? 'warning' : 'critical')
  return <div style={{ background: k.bg, color: C.inkSoft, border: `1px solid ${k.edge}`,
                       borderRadius: R.md, padding: `${SP.md}px ${SP.lg}px`, fontSize: F.small,
                       marginBottom: SP.md, lineHeight: 1.55 }}>{children}</div>
}

function Stat({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div style={{ ...S.card, marginBottom: 0, padding: '13px 15px', boxShadow: E.flat }}>
      <div style={{ ...eyebrow, lineHeight: 1.3, minHeight: 27 }}>{label}</div>
      <div style={{ fontSize: F.display, fontWeight: W.bold, color: colour || C.ink,
                    marginTop: 4, letterSpacing: '-.02em', lineHeight: 1.05, ...numeric }}>{value}</div>
    </div>
  )
}

/** One thing awaiting finance, whichever module raised it. */
function QueueRow({ item, moduleName, detailRoute, onAction, busy }: {
  item: Item; moduleName: string; detailRoute: string | null
  onAction: (id: string, action: string, note: string) => Promise<void>
  busy: boolean
}) {
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)

  return (
    <div style={{ border: `1px solid ${V.border}`, borderRadius: 10, marginBottom: 9, background: V.card }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 99, background: V.purpleBg,
                       color: V.purpleDark, fontWeight: 600 }}>{moduleName}</span>

        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: V.navy }}>{item.title}</div>
          <div style={{ fontSize: 12, color: V.muted, marginTop: 2 }}>
            {item.subtitle}
            {item.flag_count > 0 && (
              <span style={{ color: V.amber, fontWeight: 600 }}> · ⚑ {item.flag_count} to review</span>
            )}
            <span> · raised {dmy(item.raised_at)}</span>
          </div>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700, color: V.navy }}>{inr(item.amount)}</div>
        <button onClick={() => setOpen(o => !o)} style={S.btnO}>{open ? 'Close' : 'Action'}</button>
      </div>

      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${V.border}` }}>
          <div style={{ marginTop: 10, marginBottom: 10 }}>
            <label style={S.lbl}>Note {'(required to reject)'}</label>
            <input value={note} onChange={e => setNote(e.target.value)}
                   placeholder="Optional when approving"
                   style={{ ...S.inp, width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => onAction(item.id, 'APPROVE', note)} disabled={busy} style={S.btnG}>
              {busy ? 'Working…' : 'Verify & approve'}
            </button>
            <button onClick={() => onAction(item.id, 'MARK_PAID', note)} disabled={busy} style={S.btnP}>
              Mark paid
            </button>
            <button onClick={() => onAction(item.id, 'REJECT', note)} disabled={busy || !note.trim()}
                    style={{ ...S.btnR, opacity: note.trim() ? 1 : 0.5 }}>
              Reject
            </button>
            {detailRoute && (
              <a href={detailRoute} style={{ ...S.btnO, textDecoration: 'none', display: 'inline-block' }}>
                Open in {moduleName}
              </a>
            )}
          </div>
          <div style={{ fontSize: 11, color: V.muted, marginTop: 9 }}>
            Approve and Mark paid are separate rights. Approving confirms the amount; marking paid
            releases the money and closes the item.
          </div>
        </div>
      )}
    </div>
  )
}

function TeamRow({ m, onChange, busy }: {
  m: Member; onChange: (id: string, patch: Record<string, unknown>) => void; busy: boolean
}) {
  const [limit, setLimit] = useState(m.approval_limit == null ? '' : String(m.approval_limit))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0',
                  borderBottom: `1px solid ${V.border}`, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 170 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: m.is_active ? V.navy : V.muted }}>
          {m.employee?.full_name ?? '—'}
          <span style={{ color: V.muted, fontWeight: 500 }}> · {m.employee?.emp_code ?? ''}</span>
        </div>
        <div style={{ fontSize: 11, color: V.muted }}>{m.employee?.designation ?? '—'}</div>
      </div>

      <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 99, background: V.purpleBg,
                     color: V.purpleDark, fontWeight: 600 }}>{m.role}</span>

      <label style={{ fontSize: 12, color: V.navy, display: 'flex', alignItems: 'center', gap: 5 }}>
        <input type="checkbox" checked={m.can_approve} disabled={busy}
               onChange={e => onChange(m.id, { can_approve: e.target.checked })}
               style={{ accentColor: V.purple }} />
        approve
      </label>
      <label style={{ fontSize: 12, color: V.navy, display: 'flex', alignItems: 'center', gap: 5 }}>
        <input type="checkbox" checked={m.can_disburse} disabled={busy}
               onChange={e => onChange(m.id, { can_disburse: e.target.checked })}
               style={{ accentColor: V.purple }} />
        pay
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 11, color: V.muted }}>limit ₹</span>
        <input value={limit} onChange={e => setLimit(e.target.value)}
               onBlur={() => onChange(m.id, { approval_limit: limit === '' ? null : Number(limit) })}
               placeholder="none"
               style={{ ...S.inp, width: 86, padding: '5px 8px', fontSize: 12 }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
export default function FinanceDepartment() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [tab, setTab] = useState<'QUEUE' | 'TEAM' | 'MODULES'>('QUEUE')
  const [moduleFilter, setModuleFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('PENDING')

  const [items, setItems] = useState<Item[]>([])
  const [modules, setModules] = useState<Mod[]>([])
  const [team, setTeam] = useState<Member[]>([])
  const [totals, setTotals] = useState({ count: 0, value: 0, flagged: 0 })
  const [actingId, setActingId] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  // Set when the schema is not in place yet — a setup step, not a failure.
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
      .then(({ data }) => {
        setCompanies((data ?? []) as Company[])
        if (data?.length) setCompanyId(data[0].id)
      })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const h = await authHeaders()
      // '' = All companies → the APIs' explicit ALL token.
      const qs = new URLSearchParams({ company_id: companyId || 'ALL', status: statusFilter })
      if (moduleFilter !== 'ALL') qs.set('module', moduleFilter)

      const [qr, tr] = await Promise.all([
        fetch(`/api/finance/queue?${qs}`, { headers: h }),
        fetch(`/api/finance/team?company_id=${companyId || 'ALL'}`, { headers: h }),
      ])

      if (!qr.ok) {
        const j = await qr.json().catch(() => ({}))
        setItems([]); setModules([])
        // The API now names the cause instead of a generic sentence. An unrun
        // migration comes back as MIGRATION_PENDING, which is a state to
        // explain, not an error to apologise for.
        if (j.code === 'MIGRATION_PENDING') {
          setPending(j.error || 'The finance tables have not been created yet.')
          setNote(null)
        } else if (qr.status === 401) {
          setNote({ tone: 'warn', text: 'Your dashboard session has expired — sign in again.' })
        } else {
          setNote({ tone: 'err', text: j.error || `Could not load the finance queue (HTTP ${qr.status}).` })
        }
        return
      }
      setPending(null)
      const q = await qr.json()
      setItems((q.items ?? []) as Item[])
      setModules((q.modules ?? []) as Mod[])
      setTotals(q.totals ?? { count: 0, value: 0, flagged: 0 })

      if (tr.ok) {
        const t = await tr.json()
        const list = (t.team ?? []) as Member[]
        setTeam(list)
        setActingId(prev => (list.some(m => m.employee?.emp_code && m.id === prev) ? prev : list[0]?.id ?? ''))
      }
      setNote(null)
    } finally {
      setLoading(false)
    }
  }, [companyId, moduleFilter, statusFilter])

  useEffect(() => { load() }, [load])

  const acting = team.find(m => m.id === actingId)

  const action = async (itemId: string, act: string, actionNote: string) => {
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/finance/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          item_id: itemId, action: act, note: actionNote || null,
          // the employee id, not the finance_team row id — the API checks
          // authority against finance_team.employee_id
          acting_employee_id: acting?.employee_id ?? null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setNote({ tone: 'err', text: j.error || 'That action did not go through.' }); return }
      setNote({ tone: 'ok', text: `Done — ${j.status?.toLowerCase()}.` })
      await load()
    } finally { setBusy(false) }
  }

  const updateMember = async (id: string, patch: Record<string, unknown>) => {
    setBusy(true)
    try {
      const r = await fetch('/api/finance/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ id, ...patch }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setNote({ tone: 'err', text: j.error || 'Could not update that member.' })
        return
      }
      await load()
    } finally { setBusy(false) }
  }

  const enabled = modules.filter(m => m.is_enabled)
  const planned = modules.filter(m => !m.is_enabled)

  return (
    <div style={{ background: V.page, minHeight: '100vh',
                  padding: `${SP.xl}px ${SP.xl}px ${SP.huge}px`, maxWidth: 1440, margin: '0 auto',
                  fontFamily: F.family, color: C.ink, fontSize: F.body }}>
      <div className="ez-page-head">
        <h1 style={{ margin: 0, fontSize: F.page, fontWeight: W.bold, color: C.ink,
                     letterSpacing: '-.02em' }}>Finance</h1>
        <div style={{ marginTop: 5, fontSize: F.small, color: C.muted }}>
          Approvals and payouts across the company · {enabled.length} module
          {enabled.length === 1 ? '' : 's'} routing work here
        </div>
      </div>

      <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={S.lbl}>Company</label>
          <select value={companyId} onChange={e => setCompanyId(e.target.value)}
                  style={{ ...S.inp, minWidth: 210 }}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
        <div>
          <label style={S.lbl}>Acting as</label>
          <select value={actingId} onChange={e => setActingId(e.target.value)}
                  style={{ ...S.inp, minWidth: 230 }}>
            {team.length === 0 && <option value="">Nobody on the finance team</option>}
            {team.filter(m => m.is_active).map(m => (
              <option key={m.id} value={m.id}>
                {m.employee?.full_name} · {m.role}
                {m.approval_limit != null ? ` (≤ ${inr(m.approval_limit)})` : ' (no limit)'}
              </option>
            ))}
          </select>
        </div>
        <button onClick={load} disabled={loading} style={S.btnO}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
        {([['QUEUE', 'Approvals'], ['TEAM', 'Finance team'], ['MODULES', 'Connected modules']] as const)
          .map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
                  style={{ padding: '8px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600,
                           fontFamily: 'inherit', cursor: 'pointer',
                           border: tab === k ? 'none' : `1px solid ${V.border}`,
                           background: tab === k ? V.purple : V.card,
                           color: tab === k ? C.surface : V.purpleDark }}>
            {label}{k === 'QUEUE' && totals.count > 0 ? ` · ${totals.count}` : ''}
          </button>
        ))}
      </div>

      {note && <Note tone={note.tone}>{note.text}</Note>}

      {pending && (
        <div style={{ ...S.card, padding: '22px 24px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: V.navy, marginBottom: 8 }}>
            Finance is not installed yet
          </div>
          <div style={{ fontSize: 13, color: V.muted, lineHeight: 1.7, maxWidth: 620 }}>
            {pending}
            <br /><br />
            The department, its authority rules and the shared work queue all live in
            that migration. Until it is applied there is nothing to read — this is a
            setup step, not a fault. The screens below are already built and will fill
            in as soon as it runs.
          </div>
          <div style={{ marginTop: 14, padding: '10px 13px', background: V.field,
                        border: `1px solid ${V.border}`, borderRadius: 10,
                        fontFamily: 'ui-monospace, monospace', fontSize: 12, color: V.navy }}>
            supabase/migrations/053_finance_department.sql
          </div>
        </div>
      )}

      {!pending && tab === 'QUEUE' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                        gap: 10, marginBottom: 12 }}>
            <Stat label="Awaiting finance" value={String(totals.count)} colour={V.purpleDark} />
            <Stat label="Total value" value={inr(totals.value)} />
            <Stat label="With flags" value={String(totals.flagged)} colour={totals.flagged ? V.amber : V.navy} />
          </div>

          <div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={S.lbl}>Module</label>
              <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} style={S.inp}>
                <option value="ALL">All modules</option>
                {enabled.map(m => <option key={m.module_code} value={m.module_code}>{m.module_name}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={S.inp}>
                <option value="PENDING">Awaiting action</option>
                <option value="APPROVED">Approved</option>
                <option value="SETTLED">Paid</option>
                <option value="REJECTED">Rejected</option>
                <option value="ALL">Everything</option>
              </select>
            </div>
            {acting && (
              <div style={{ fontSize: 12, color: V.muted, paddingBottom: 9 }}>
                {acting.can_approve ? '✓ can approve' : '✗ cannot approve'} ·{' '}
                {acting.can_disburse ? '✓ can release payment' : '✗ cannot release payment'}
              </div>
            )}
          </div>

          <div style={S.card}>
            {loading ? <Empty text="Loading…" />
              : items.length === 0
                ? <Empty text={statusFilter === 'PENDING'
                    ? 'Nothing awaiting finance. All clear.'
                    : 'No items with that status.'} />
                : items.map(i => {
                    const m = modules.find(x => x.module_code === i.module_code)
                    return <QueueRow key={i.id} item={i}
                                     moduleName={m?.module_name ?? i.module_code}
                                     detailRoute={m?.detail_route ?? null}
                                     onAction={action} busy={busy} />
                  })}
          </div>
        </>
      )}

      {!pending && tab === 'TEAM' && !companyId ? (
        <div style={S.card}><div style={{ fontSize: 12, color: V.muted }}>
          The finance team is kept per company — pick one above to add or edit members. (The queue works across all companies.)
        </div></div>
      ) : null}
      {!pending && tab === 'TEAM' && !!companyId && (
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Finance team</div>
          <div style={{ fontSize: 12, color: V.muted, marginBottom: 14, lineHeight: 1.6 }}>
            Sitting in the Finance &amp; Accounts department does not grant approval rights — a row
            here does. Approving a claim and releasing the money are separate permissions, and a
            limit caps what each person can sign off alone.
          </div>
          {loading ? <Empty text="Loading…" />
            : team.length === 0 ? <Empty text="Nobody on the finance team yet." />
            : team.map(m => <TeamRow key={m.id} m={m} onChange={updateMember} busy={busy} />)}
        </div>
      )}

      {!pending && tab === 'MODULES' && (
        <>
          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Routing work here</div>
            <div style={{ fontSize: 12, color: V.muted, marginBottom: 14, lineHeight: 1.6 }}>
              Finance reads one queue, so a module connects by enqueuing rather than by growing
              this screen. Adding the next one is a row in <code>finance_modules</code> plus a call
              to <code>finance_enqueue()</code> when something needs finance.
            </div>
            {enabled.map(m => (
              <div key={m.module_code} style={{ display: 'flex', alignItems: 'center', gap: 11,
                                                padding: '10px 0', borderBottom: `1px solid ${V.border}` }}>
                <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 99,
                               background: V.greenBg, color: V.green, fontWeight: 600 }}>LIVE</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{m.module_name}</div>
                  <div style={{ fontSize: 11, color: V.muted }}>{m.description}</div>
                </div>
                <span style={{ fontSize: 12, color: V.navy, fontWeight: 600 }}>
                  {items.filter(i => i.module_code === m.module_code).length} open
                </span>
              </div>
            ))}
          </div>

          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Registered, not yet sending</div>
            <div style={{ fontSize: 12, color: V.muted, marginBottom: 12 }}>
              These describe the intended shape. Each becomes live when its module starts enqueuing.
            </div>
            {planned.map(m => (
              <div key={m.module_code} style={{ display: 'flex', alignItems: 'center', gap: 11,
                                                padding: '9px 0', borderBottom: `1px solid ${V.border}` }}>
                <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 99,
                               background: V.field, color: V.muted, fontWeight: 600 }}>PLANNED</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: V.muted }}>{m.module_name}</div>
                  <div style={{ fontSize: 11, color: V.muted }}>{m.description}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
