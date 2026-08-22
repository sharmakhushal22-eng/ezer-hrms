'use client'
// components/ess/InvestmentProofs.tsx — ESS → Investment Proofs.
//
// The declaration is a promise; this is the bill behind it. Normally the window opens at
// year-end, but a resigning employee will not be here in March — so their deadline is
// their Date of Leaving and the window is already open (sql99: investment_proof_deadline).
//
// The line that costs money: anything declared but not proven — rejected, or simply never
// submitted before the deadline — stops being exempt. The screen says so plainly, because
// an employee who does not know that only finds out in their final settlement.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: 'rgba(37,99,235,0.12)', muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint, amberBd: TK.warningTint, red: TK.critical, redBg: TK.criticalTint,
  soft: TK.sunken, purpleBg: TK.brandTint,
}
const FY = '2026-27'
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0)
const fmtDate = (d: any) => {
  if (!d) return '—'
  const x = new Date(d)
  return `${String(x.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][x.getMonth()]} ${x.getFullYear()}`
}

interface Proof {
  id: string; section: string; declared_item: string
  declared_amount: number; submitted_amount: number
  proof_reference: string | null; status: string; rejection_reason: string | null; deadline: string | null
}

const TONE: Record<string, { bg: string; fg: string; label: string }> = {
  PENDING:   { bg: TK.sunken, fg: TK.muted, label: 'Proof pending' },
  SUBMITTED: { bg: TK.warningTint, fg: TK.warning, label: 'Under review' },
  APPROVED:  { bg: TK.positiveTint, fg: TK.positive, label: 'Approved' },
  REJECTED:  { bg: TK.criticalTint, fg: TK.critical, label: 'Rejected' },
}

// Outside the parent so typing in an amount box never remounts the row.
function ProofRow({ p, draftAmt, draftRef, onAmt, onRef, onSave, busy }: {
  p: Proof; draftAmt: string; draftRef: string
  onAmt: (v: string) => void; onRef: (v: string) => void; onSave: () => void; busy: boolean
}) {
  const t = TONE[p.status] || TONE.PENDING
  const locked = p.status === 'APPROVED'
  const shortfall = Math.max(0, num(p.declared_amount) - num(draftAmt || p.submitted_amount))
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '13px 15px', marginBottom: 10, background: TK.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: C.purpleD, background: C.purpleBg, borderRadius: 6, padding: '3px 8px' }}>{p.section}</span>
        <div style={{ flex: 1, minWidth: 160, fontSize: 13, fontWeight: 600 }}>{p.declared_item}</div>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: t.fg, background: t.bg, borderRadius: 99, padding: '3px 10px' }}>{t.label}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, alignItems: 'end' }}>
        <div>
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 3 }}>Declared</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{inr(p.declared_amount)}</div>
        </div>
        <div>
          <label style={{ fontSize: 10.5, color: C.muted, display: 'block', marginBottom: 3 }}>Proof amount</label>
          <input style={{ width: '100%', padding: '8px 10px', background: locked ? TK.sunken : C.soft, border: `1px solid ${TK.brandEdge}`, borderRadius: 7, fontSize: 13, color: C.navy, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
            value={draftAmt} readOnly={locked} inputMode="numeric"
            onChange={e => onAmt(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={{ fontSize: 10.5, color: C.muted, display: 'block', marginBottom: 3 }}>Bill / policy reference</label>
          <input style={{ width: '100%', padding: '8px 10px', background: locked ? TK.sunken : C.soft, border: `1px solid ${TK.brandEdge}`, borderRadius: 7, fontSize: 13, color: C.navy, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
            value={draftRef} readOnly={locked} placeholder="Policy no. / receipt no. / drive link"
            onChange={e => onRef(e.target.value)} />
        </div>
      </div>

      {!locked && shortfall > 0 && (
        <div style={{ fontSize: 11, color: C.amber, marginTop: 8 }}>
          Proof for {inr(shortfall)} is still pending — that much will not stay exempt.
        </div>
      )}
      {p.status === 'REJECTED' && p.rejection_reason && (
        <div style={{ fontSize: 11.5, color: C.red, background: C.redBg, borderRadius: 7, padding: '8px 10px', marginTop: 8 }}>
          Rejected: {p.rejection_reason}
        </div>
      )}
      {!locked && (
        <div style={{ marginTop: 10 }}>
          <button onClick={onSave} disabled={busy}
            style={{ padding: '7px 15px', borderRadius: 7, border: 'none', background: C.purple, color: TK.onAccent, fontWeight: 700, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'inherit' }}>
            {p.status === 'PENDING' ? 'Submit proof' : 'Update proof'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function InvestmentProofs({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<Proof[]>([])
  const [draft, setDraft] = useState<Record<string, { amt: string; ref: string }>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [leaving, setLeaving] = useState<string | null>(null)
  const [hasDecl, setHasDecl] = useState(false)
  const [regime, setRegime] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: emp } = await supabase.from('employees')
        .select('date_of_leaving, last_working_date, relieving_date').eq('id', employeeId).maybeSingle()
      setLeaving((emp as any)?.date_of_leaving || (emp as any)?.last_working_date || (emp as any)?.relieving_date || null)

      const { data: d } = await supabase.from('tds_declarations')
        .select('regime').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
      setHasDecl(!!d); setRegime((d as any)?.regime || '')

      const { data, error } = await supabase.from('investment_proofs')
        .select('*').eq('employee_id', employeeId).eq('fy', FY).order('section')
      if (error) throw new Error(error.message)
      const list = (data || []) as any as Proof[]
      setRows(list)
      const dr: Record<string, { amt: string; ref: string }> = {}
      list.forEach(p => { dr[p.id] = { amt: num(p.submitted_amount) ? String(num(p.submitted_amount)) : '', ref: p.proof_reference || '' } })
      setDraft(dr)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setLoading(false) }
  }, [employeeId])
  useEffect(() => { load() }, [load])

  async function openWindow() {
    setErr(''); setMsg(''); setBusy('open')
    const { data, error } = await supabase.rpc('open_investment_proof_window', { p_employee_id: employeeId, p_fy: FY })
    setBusy('')
    if (error) { setErr(error.message); return }
    if (!Number(data)) { setErr('No declared line found — fill in and submit the Investment Declaration first.'); return }
    setMsg(`Proof window opened for ${data} line${Number(data) === 1 ? '' : 's'}.`)
    load()
  }

  async function saveProof(p: Proof) {
    setErr(''); setMsg(''); setBusy(p.id)
    const d = draft[p.id] || { amt: '', ref: '' }
    const { error } = await supabase.from('investment_proofs').update({
      submitted_amount: num(d.amt), proof_reference: d.ref.trim() || null,
      status: 'SUBMITTED', rejection_reason: null, updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    setBusy('')
    if (error) { setErr(error.message); return }
    setMsg(`${p.section} proof submitted — HR will review it.`)
    load()
  }

  const deadline = rows[0]?.deadline || null
  const overdue = deadline ? new Date(deadline) < new Date() : false
  const declared = rows.reduce((a, p) => a + num(p.declared_amount), 0)
  const proven = rows.filter(p => p.status === 'APPROVED').reduce((a, p) => a + num(p.submitted_amount), 0)

  if (loading) return <div style={{ padding: 24, color: C.muted, fontSize: 13 }}>Loading…</div>

  return (
    <div style={{ fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13, color: C.navy, maxWidth: 780 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Investment Proofs</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>FY {FY} — bills for what you declared</div>
      </div>

      {leaving && (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amberBd}`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.amber }}>Your proof window is open now</div>
          <div style={{ fontSize: 11.5, color: C.amber, marginTop: 3, lineHeight: 1.55 }}>
            Your last working day is <b>{fmtDate(leaving)}</b>, so the deadline is not the end of the year — it is <b>that day</b>.
            Anything not proved by then will not stay exempt and will be taxed in the final settlement.
          </div>
        </div>
      )}

      {!hasDecl ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
          No <b>Investment Declaration</b> found for this FY. Proofs are submitted against it — fill in and submit the declaration first.
        </div>
      ) : regime === 'NEW' ? (
        <div style={{ background: C.greenBg, border: `1px solid ${TK.positiveTint}`, borderRadius: 12, padding: 20, fontSize: 12.5, color: C.green, lineHeight: 1.6 }}>
          You are on the <b>New regime</b> — the 80C/80D/HRA exemptions do not apply, so no proof is needed.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            {[['Declared', inr(declared), C.navy], ['Proven', inr(proven), C.green], ['Not yet proven', inr(Math.max(0, declared - proven)), declared - proven > 0 ? C.amber : C.muted]].map(([l, v, col]) => (
              <div key={l} style={{ background: TK.sunken, border: `1px solid ${C.border}`, borderRadius: 9, padding: '9px 14px', minWidth: 120 }}>
                <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: col as string }}>{v}</div>
              </div>
            ))}
            {deadline && (
              <div style={{ background: overdue ? C.redBg : TK.sunken, border: `1px solid ${overdue ? '#FECACA' : C.border}`, borderRadius: 9, padding: '9px 14px' }}>
                <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Deadline</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: overdue ? C.red : C.navy }}>{fmtDate(deadline)}</div>
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
                The proof window is not open yet. Use the button below to open a window for each line of your declaration.
              </div>
              <button onClick={openWindow} disabled={busy === 'open'}
                style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: C.purple, color: TK.onAccent, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                {busy === 'open' ? 'Opening…' : 'Proof window kholein'}
              </button>
            </div>
          ) : (
            rows.map(p => (
              <ProofRow key={p.id} p={p}
                draftAmt={draft[p.id]?.amt ?? ''} draftRef={draft[p.id]?.ref ?? ''}
                onAmt={v => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], amt: v } }))}
                onRef={v => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], ref: v } }))}
                onSave={() => saveProof(p)} busy={busy === p.id} />
            ))
          )}
        </>
      )}

      {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${TK.positiveTint}`, borderRadius: 9, padding: '10px 14px', marginTop: 12 }}>✓ {msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.red, background: C.redBg, borderRadius: 9, padding: '10px 14px', marginTop: 12 }}>{err}</div>}
    </div>
  )
}
