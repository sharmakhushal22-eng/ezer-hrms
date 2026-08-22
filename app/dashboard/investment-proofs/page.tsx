'use client'
// app/dashboard/investment-proofs/page.tsx — HR/Payroll approval queue for investment proofs.
//
// The employee declares, then proves. Whatever is NOT proven by the deadline stops being
// exempt — so this queue is where tax is actually decided. Two things are surfaced hard:
//   • the deadline, and whether it has passed (for a resigning employee it is their DOL)
//   • the gap between declared and proven, per employee
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint, amberBd: '#FDE68A', red: TK.critical, redBg: TK.criticalTint,
  purpleBg: TK.brandTint, soft: TK.sunken,
}
const FY = '2026-27'
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0)
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDate = (d: any) => { if (!d) return '—'; const x = new Date(d); return `${String(x.getDate()).padStart(2,'0')} ${MON[x.getMonth()]} ${x.getFullYear()}` }

const S = {
  page: { background: C.bg, minHeight: '100vh', padding: 24, color: C.navy, fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13 } as React.CSSProperties,
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: '0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  inp: { padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: C.soft, color: C.navy, outline: 'none', fontFamily: 'inherit' } as React.CSSProperties,
  pri: { padding: '7px 14px', background: C.green, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' } as React.CSSProperties,
  rej: { padding: '7px 14px', background: '#fff', color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' } as React.CSSProperties,
}

interface Row {
  id: string; employee_id: string; fy: string; section: string; declared_item: string
  declared_amount: number; submitted_amount: number; proof_reference: string | null
  status: string; rejection_reason: string | null; deadline: string | null
}

const TONE: Record<string, [string, string]> = {
  PENDING: ['#F3F4F6', TK.muted], SUBMITTED: [C.amberBg, C.amber],
  APPROVED: [C.greenBg, C.green], REJECTED: [C.redBg, C.red],
}

// Outside the parent so the per-row inputs keep focus while typing.
function ProofCard({ r, name, code, leaving, draft, onDraft, onApprove, onReject, busy }: {
  r: Row; name: string; code: string; leaving: string | null
  draft: string; onDraft: (v: string) => void
  onApprove: () => void; onReject: () => void; busy: boolean
}) {
  const [bg, fg] = TONE[r.status] || TONE.PENDING
  const overdue = r.deadline ? new Date(r.deadline) < new Date() : false
  const gap = Math.max(0, num(r.declared_amount) - num(draft || r.submitted_amount))
  const done = r.status === 'APPROVED' || r.status === 'REJECTED'
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '13px 15px', marginBottom: 10, background: '#fff' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: C.purpleD, background: C.purpleBg, borderRadius: 6, padding: '3px 8px' }}>{r.section}</span>
        <div style={{ flex: 1, minWidth: 190 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{code} — {name}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{r.declared_item}</div>
        </div>
        {leaving && <span style={{ fontSize: 10, fontWeight: 700, color: C.amber, background: C.amberBg, border: `0.5px solid ${C.amberBd}`, borderRadius: 99, padding: '2px 9px' }}>Leaving {fmtDate(leaving)}</span>}
        <span style={{ fontSize: 10.5, fontWeight: 700, color: overdue && !done ? C.red : C.muted, background: overdue && !done ? C.redBg : TK.sunken, borderRadius: 99, padding: '3px 10px' }}>
          {overdue && !done ? 'Deadline passed · ' : 'Deadline '}{fmtDate(r.deadline)}
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: fg, background: bg, borderRadius: 99, padding: '3px 10px' }}>{r.status}</span>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Declared</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{inr(r.declared_amount)}</div>
        </div>
        <div>
          <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Employee submitted</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{inr(r.submitted_amount)}</div>
        </div>
        {r.proof_reference && (
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Reference</div>
            <div style={{ fontSize: 12 }}>{r.proof_reference}</div>
          </div>
        )}
        {!done && (
          <div>
            <label style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, display: 'block', marginBottom: 3 }}>Approve amount</label>
            <input style={{ ...S.inp, width: 130, textAlign: 'right' }} value={draft} inputMode="numeric"
              onChange={e => onDraft(e.target.value.replace(/[^0-9]/g, ''))} />
          </div>
        )}
      </div>

      {!done && gap > 0 && (
        <div style={{ fontSize: 11, color: C.amber, marginTop: 8 }}>
          {inr(gap)} stays unproven — that much will not be exempt and will be taxed.
        </div>
      )}
      {r.status === 'REJECTED' && r.rejection_reason && (
        <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, borderRadius: 7, padding: '8px 10px', marginTop: 8 }}>Rejected: {r.rejection_reason}</div>
      )}
      {!done && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button style={{ ...S.pri, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={onApprove}>Approve</button>
          <button style={{ ...S.rej, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={onReject}>Reject</button>
        </div>
      )}
    </div>
  )
}

export default function InvestmentProofsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [emps, setEmps] = useState<Record<string, { name: string; code: string; leaving: string | null }>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('SUBMITTED')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data, error } = await supabase.from('investment_proofs').select('*').eq('fy', FY).order('deadline')
      if (error) throw new Error(error.message)
      const list = (data || []) as any as Row[]
      setRows(list)
      const d: Record<string, string> = {}
      list.forEach(r => { d[r.id] = String(num(r.submitted_amount) || '') })
      setDraft(d)
      const ids = Array.from(new Set(list.map(r => r.employee_id)))
      if (ids.length) {
        const { data: e } = await supabase.from('employees')
          .select('id, full_name, emp_code, date_of_leaving, last_working_date, relieving_date').in('id', ids)
        const m: Record<string, { name: string; code: string; leaving: string | null }> = {}
        ;(e || []).forEach((x: any) => {
          m[x.id] = { name: x.full_name || '—', code: x.emp_code || '—', leaving: x.date_of_leaving || x.last_working_date || x.relieving_date || null }
        })
        setEmps(m)
      }
    } catch (e: any) { setErr(e.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function decide(r: Row, approve: boolean) {
    setErr(''); setMsg('')
    let reason: string | null = null
    if (!approve) {
      reason = window.prompt('Reason for rejection? (the employee will see this)') || ''
      if (!reason.trim()) { setErr('A rejection reason is required.'); return }
    }
    setBusy(r.id)
    // The approved figure is what the tax computation may treat as exempt — anything
    // below what was declared stays taxable, so it is stored, not just the verdict.
    const { error } = await supabase.from('investment_proofs').update({
      status: approve ? 'APPROVED' : 'REJECTED',
      submitted_amount: approve ? num(draft[r.id]) : 0,
      rejection_reason: reason, reviewed_by: 'Payroll', reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', r.id)
    setBusy('')
    if (error) { setErr(error.message); return }
    setMsg(approve ? `${r.section} approved — ${inr(num(draft[r.id]))} will be treated as exempt.` : `${r.section} rejected — the full amount is taxable.`)
    load()
  }

  const filtered = rows.filter(r => {
    if (status && r.status !== status) return false
    const e = emps[r.employee_id]
    if (!q.trim()) return true
    const t = q.trim().toLowerCase()
    return (e?.code || '').toLowerCase().includes(t) || (e?.name || '').toLowerCase().includes(t) || r.section.toLowerCase().includes(t)
  })
  const stat = (label: string, v: any, color: string) => (
    <div key={label} style={{ background: TK.sunken, border: `1px solid ${C.border}`, borderRadius: 9, padding: '9px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{v}</div>
    </div>
  )
  const overdueCount = rows.filter(r => r.deadline && new Date(r.deadline) < new Date() && !['APPROVED', 'REJECTED'].includes(r.status)).length

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Investment Proofs</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
          FY {FY} — how much of what was declared has actually been proved. Anything unproved will not stay exempt.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 14 }}>
        {stat('Total lines', rows.length, C.navy)}
        {stat('Awaiting review', rows.filter(r => r.status === 'SUBMITTED').length, C.amber)}
        {stat('Approved', rows.filter(r => r.status === 'APPROVED').length, C.green)}
        {stat('Not yet submitted', rows.filter(r => r.status === 'PENDING').length, C.muted)}
        {overdueCount > 0 && stat('Deadline passed', overdueCount, C.red)}
      </div>

      <div style={{ ...S.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...S.inp, minWidth: 160 }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input style={{ ...S.inp, flex: 1, minWidth: 200 }} placeholder="Emp code, naam ya section" value={q} onChange={e => setQ(e.target.value)} />
        <button style={{ padding: '7px 13px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.purpleD, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }} onClick={load}>⟳ Refresh</button>
      </div>

      {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, background: C.greenBg, border: '1px solid #BBF7D0', borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>✓ {msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 9, padding: '10px 14px', marginBottom: 12 }}>{err}</div>}

      {loading ? <div style={{ fontSize: 12.5, color: C.muted }}>Loading…</div>
        : filtered.length === 0 ? (
          <div style={S.card}>
            <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
              {rows.length === 0
                ? <>There are no proof lines yet. They appear once an employee submits a declaration and their proof window opens — or open everyone&apos;s at once from <b>Payroll → Data Sync → Investment proofs</b>.</>
                : 'Nothing matched this filter.'}
            </div>
          </div>
        ) : filtered.map(r => (
          <ProofCard key={r.id} r={r}
            name={emps[r.employee_id]?.name || '—'} code={emps[r.employee_id]?.code || '—'}
            leaving={emps[r.employee_id]?.leaving || null}
            draft={draft[r.id] ?? ''} onDraft={v => setDraft(d => ({ ...d, [r.id]: v }))}
            onApprove={() => decide(r, true)} onReject={() => decide(r, false)}
            busy={busy === r.id} />
        ))}
    </div>
  )
}
