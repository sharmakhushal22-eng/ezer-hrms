'use client'
// app/dashboard/loans/page.tsx — Admin Loan Management.
// Company-scoped: pending approvals, agreement review, disbursement, active loans, loan types.
// Inline styles only. All sub-components OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

// ── Admin C palette ──────────────────────────────────────────────
const C = {
  page: TK.sunken, card:TK.surface, border:TK.line, purple:TK.brand, navy:TK.ink, muted:TK.muted,
  red:TK.critical, redBg:TK.criticalTint, green:TK.positive, greenBg:TK.positiveTint, amber:TK.warning, amberBg:TK.warningTint, blue: TK.brand, blueBg: TK.brandTint,
}
const S = {
  page: { background:C.page, minHeight:'100vh', color:C.navy, fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:13, padding:'20px 16px' } as React.CSSProperties,
  content: { maxWidth:1100, margin:'0 auto' } as React.CSSProperties,
  card: { background:C.card, borderRadius:12, border:`1px solid ${C.border}`, padding:'16px 18px', marginBottom:16 } as React.CSSProperties,
  h1: { fontSize:22, fontWeight:700, color:C.navy, margin:0 } as React.CSSProperties,
  sub: { fontSize:12.5, color:C.muted, marginTop:3 } as React.CSSProperties,
  section: { fontSize:14, fontWeight:600, color:C.navy, marginBottom:12 } as React.CSSProperties,
  label: { fontSize:11, fontWeight:600, color:C.purple, textTransform:'uppercase' as const, letterSpacing:'.05em', display:'block', marginBottom:4 },
  input: { width:'100%', padding:'8px 10px', background:TK.surface, border:`1px solid ${C.border}`, borderRadius:8, color:C.navy, fontSize:13, outline:'none', boxSizing:'border-box' as const, fontFamily:'inherit' },
  btnP: { padding:'7px 14px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:C.purple, color:TK.onAccent } as React.CSSProperties,
  btnG: { padding:'7px 14px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:C.green, color:TK.onAccent } as React.CSSProperties,
  btnR: { padding:'7px 14px', borderRadius:8, border:`1px solid ${C.red}`, cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', background:TK.surface, color:C.red } as React.CSSProperties,
  row: { display:'flex', justifyContent:'space-between', gap:12, padding:'10px 0', borderBottom:`1px solid ${C.border}`, alignItems:'center', flexWrap:'wrap' as const },
}
const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const today = () => new Date().toISOString().slice(0, 10)

function Badge({ status }: { status: string }) {
  const s = (status || '').toUpperCase()
  const map: Record<string, [string, string]> = {
    IN_APPROVAL:[C.amberBg, C.amber], SUBMITTED:[C.amberBg, C.amber], REQUESTED:[C.amberBg, C.amber], GENERATED:[C.amberBg, C.amber], UNDER_REVIEW:[C.blueBg, C.blue],
    APPROVED:[C.greenBg, C.green], RECOVERING:[C.greenBg, C.green], DISBURSED:[C.greenBg, C.green], SIGNED:[C.greenBg, C.green],
    REJECTED:[C.redBg, C.red], CANCELLED:[C.redBg, C.red], EXIT_RECOVERY:[C.redBg, C.red],
    CLOSED:[TK.sunken, C.muted], FORECLOSED:[TK.sunken, C.muted],
  }
  const [bg, c] = map[s] || [TK.brandTint, C.purple]
  return <span style={{ fontSize:10, padding:'2px 9px', borderRadius:99, background:bg, color:c, fontWeight:600, whiteSpace:'nowrap' }}>{s.replace(/_/g, ' ')}</span>
}

// ── 1) Pending approvals ─────────────────────────────────────────
function PendingApprovals({ companyId, empMap, typeMap, notify }: { companyId: string; empMap: Record<string, string>; typeMap: Record<string, string>; notify: (m: string, t?: 'error') => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [levels, setLevels] = useState<Record<string, any>>({}) // request_id -> current pending level row
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data } = await supabase.from('loan_requests').select('*').eq('company_id', companyId).eq('status', 'IN_APPROVAL').order('created_at', { ascending: false })
    const reqs = data || []
    setRows(reqs)
    const lvlMap: Record<string, any> = {}
    for (const r of reqs) {
      const { data: lv } = await supabase.from('loan_approvals').select('*').eq('request_id', r.id).eq('level_order', r.current_approval_level).maybeSingle()
      if (lv) lvlMap[r.id] = lv
    }
    setLevels(lvlMap)
  }, [companyId])
  useEffect(() => { load() }, [load])

  const act = async (r: any, action: 'APPROVED' | 'REJECTED') => {
    const lv = levels[r.id]
    if (!lv) { notify('No pending approval level found', 'error'); return }
    setBusy(r.id)
    const res = await fetch('/api/loans/admin', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ request_id: r.id, approver_id: 'admin', approver_role: lv.approver_role, action, remarks: '' }) })
    const d = await res.json().catch(() => ({}))
    setBusy(null)
    if (res.ok) load(); else notify(d.error || 'Failed', 'error')
  }

  return (
    <div style={S.card}>
      <div style={S.section}>Pending approvals</div>
      {rows.length === 0 ? <div style={{ fontSize:12, color:C.muted }}>Nothing awaiting approval.</div> : rows.map(r => {
        const lv = levels[r.id]
        return (
          <div key={r.id} style={S.row}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{empMap[r.employee_id] || r.employee_id} · {typeMap[r.loan_type_id] || 'Loan'}</div>
              <div style={{ fontSize:11.5, color:C.muted, marginTop:2 }}>{inr(r.requested_amount)} · {r.requested_tenure_months} mo · EMI {inr(r.indicative_emi)} · level {r.current_approval_level}{lv ? ` (${lv.approver_role})` : ''}</div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <button disabled={busy === r.id} onClick={() => act(r, 'APPROVED')} style={S.btnG}>Approve</button>
              <button disabled={busy === r.id} onClick={() => act(r, 'REJECTED')} style={S.btnR}>Reject</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 2) Agreements to review ──────────────────────────────────────
function AgreementsReview({ companyEmpIds, empMap, notify }: { companyEmpIds: Set<string>; empMap: Record<string, string>; notify: (m: string, t?: 'error') => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data } = await supabase.from('loan_agreements').select('*').eq('status', 'UNDER_REVIEW').order('signed_at', { ascending: false })
    setRows((data || []).filter(a => companyEmpIds.has(a.employee_id)))
  }, [companyEmpIds])
  useEffect(() => { load() }, [load])

  const act = async (a: any, action: 'APPROVED' | 'REJECTED') => {
    setBusy(a.id)
    const res = await fetch('/api/ess/loans/agreement', { method:'PATCH', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ agreement_id: a.id, reviewer_id: 'admin', action, review_remarks: '' }) })
    const d = await res.json().catch(() => ({}))
    setBusy(null)
    if (res.ok) load(); else notify(d.error || 'Failed', 'error')
  }

  return (
    <div style={S.card}>
      <div style={S.section}>Agreements to review</div>
      {rows.length === 0 ? <div style={{ fontSize:12, color:C.muted }}>No agreements pending review.</div> : rows.map(a => (
        <div key={a.id} style={S.row}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:600 }}>{a.agreement_number} · {empMap[a.employee_id] || a.employee_id}</div>
            <div style={{ fontSize:11.5, color:C.muted, marginTop:2 }}>Signed via {a.signature_type || '—'}{a.signed_at ? ` · ${new Date(a.signed_at).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' })}` : ''}</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button disabled={busy === a.id} onClick={() => act(a, 'APPROVED')} style={S.btnG}>Approve</button>
            <button disabled={busy === a.id} onClick={() => act(a, 'REJECTED')} style={S.btnR}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 3) Ready to disburse ─────────────────────────────────────────
function DisburseRow({ agr, empMap, onDone, notify }: { agr: any; empMap: Record<string, string>; onDone: () => void; notify: (m: string, t?: 'error') => void }) {
  const [utr, setUtr] = useState('')
  const [sanction, setSanction] = useState(today())
  const [disb, setDisb] = useState(today())
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!utr.trim()) { notify('Enter a UTR number', 'error'); return }
    setBusy(true)
    const res = await fetch('/api/loans/admin', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ agreement_id: agr.id, disbursed_by: 'admin', utr_number: utr.trim(), sanction_date: sanction, disbursement_date: disb }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) onDone(); else notify(d.error || 'Failed to disburse', 'error')
  }
  return (
    <div style={{ padding:'12px 0', borderBottom:`1px solid ${C.border}` }}>
      <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>{agr.agreement_number} · {empMap[agr.employee_id] || agr.employee_id}</div>
      <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1fr auto', gap:10, alignItems:'end' }}>
        <div><label style={S.label}>UTR number</label><input style={S.input} value={utr} onChange={e => setUtr(e.target.value)} placeholder="Bank UTR" /></div>
        <div><label style={S.label}>Sanction date</label><input type="date" style={S.input} value={sanction} onChange={e => setSanction(e.target.value)} /></div>
        <div><label style={S.label}>Disbursement date</label><input type="date" style={S.input} value={disb} onChange={e => setDisb(e.target.value)} /></div>
        <button disabled={busy} onClick={submit} style={{ ...S.btnP, whiteSpace:'nowrap' }}>{busy ? 'Disbursing…' : 'Disburse'}</button>
      </div>
    </div>
  )
}
function ReadyToDisburse({ companyEmpIds, empMap, notify }: { companyEmpIds: Set<string>; empMap: Record<string, string>; notify: (m: string, t?: 'error') => void }) {
  const [rows, setRows] = useState<any[]>([])
  const load = useCallback(async () => {
    const { data } = await supabase.from('loan_agreements').select('*').eq('status', 'APPROVED').is('loan_id', null).order('created_at', { ascending: false })
    setRows((data || []).filter(a => companyEmpIds.has(a.employee_id)))
  }, [companyEmpIds])
  useEffect(() => { load() }, [load])
  return (
    <div style={S.card}>
      <div style={S.section}>Ready to disburse</div>
      {rows.length === 0 ? <div style={{ fontSize:12, color:C.muted }}>Nothing ready for disbursement.</div> : rows.map(a => (
        <DisburseRow key={a.id} agr={a} empMap={empMap} onDone={load} notify={notify} />
      ))}
    </div>
  )
}

// ── 4) Active loans ──────────────────────────────────────────────
// EMI is deducted by Payroll → Data Sync → Loan, one entry per payroll month
// (loan_emi_ledger enforces that), so this screen shows what has actually been
// recovered rather than what was scheduled. Foreclosure stops future EMIs.
function ActiveLoans({ companyEmpIds, empMap }: { companyEmpIds: Set<string>; empMap: Record<string, string> }) {
  const [rows, setRows] = useState<any[]>([])
  const [paid, setPaid] = useState<Record<string, { n: number; total: number }>>({})
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')

  const load = useCallback(() => {
    supabase.from('loans').select('*').then(({ data }) => {
      const mine = (data || []).filter(l => companyEmpIds.has(l.employee_id))
      setRows(mine)
      if (!mine.length) { setPaid({}); return }
      supabase.from('loan_emi_ledger').select('loan_id, emi_amount').in('loan_id', mine.map(l => l.id))
        .then(({ data: led }) => {
          const acc: Record<string, { n: number; total: number }> = {}
          ;(led || []).forEach((g: any) => {
            const a = acc[g.loan_id] || { n: 0, total: 0 }
            acc[g.loan_id] = { n: a.n + 1, total: a.total + (Number(g.emi_amount) || 0) }
          })
          setPaid(acc)
        })
    })
  }, [companyEmpIds])
  useEffect(() => { load() }, [load])

  async function foreclose(l: any) {
    const left = Number(l.outstanding_principal) || 0
    if (!confirm(`Foreclose ${l.loan_number}?\n\nThe remaining ${inr(left)} is treated as recovered in one go and no EMI is deducted from next month. This cannot be undone.`)) return
    setBusy(l.id); setErr(''); setMsg('')
    const { data, error } = await supabase.rpc('foreclose_loan', { p_loan_id: l.id })
    setBusy('')
    if (error) { setErr(error.message); return }
    if (!data) { setErr('This loan is not running — only a running loan can be foreclosed.'); return }
    setMsg(`${l.loan_number} foreclosed. No EMI will be deducted from next month.`)
    load()
  }
  const th: React.CSSProperties = { fontSize:10, textAlign:'right', padding:'6px 8px', color:C.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em', whiteSpace:'nowrap' }
  const td: React.CSSProperties = { fontSize:12, textAlign:'right', padding:'8px 8px', color:C.navy, whiteSpace:'nowrap' }
  return (
    <div style={S.card}>
      <div style={S.section}>Active loans</div>
      {rows.length === 0 ? <div style={{ fontSize:12, color:C.muted }}>No loans for this company.</div> : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ borderCollapse:'collapse', width:'100%', minWidth:640 }}>
            <thead><tr style={{ background:TK.sunken }}>
              <th style={{ ...th, textAlign:'left' }}>Loan #</th><th style={{ ...th, textAlign:'left' }}>Employee</th><th style={th}>Principal</th><th style={th}>EMI</th><th style={th}>Recovered</th><th style={th}>Outstanding</th><th style={{ ...th, textAlign:'left' }}>Status</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {rows.map(l => (
                <tr key={l.id} style={{ borderTop:`1px solid ${C.border}` }}>
                  <td style={{ ...td, textAlign:'left', fontWeight:600 }}>{l.loan_number}</td>
                  <td style={{ ...td, textAlign:'left' }}>{empMap[l.employee_id] || l.employee_id}</td>
                  <td style={td}>{inr(l.principal)}</td>
                  <td style={td}>{inr(l.emi_amount)}</td>
                  <td style={td}>
                    {inr(paid[l.id]?.total || 0)}
                    <span style={{ fontSize:10, color:C.muted }}>{paid[l.id]?.n ? ` · ${paid[l.id].n} EMI` : ''}</span>
                  </td>
                  <td style={{ ...td, fontWeight:600 }}>{inr(l.outstanding_principal)}</td>
                  <td style={{ ...td, textAlign:'left' }}><Badge status={l.status} /></td>
                  <td style={td}>
                    {['DISBURSED','ACTIVE'].includes(String(l.status || '').toUpperCase()) && (
                      <button onClick={() => foreclose(l)} disabled={busy === l.id}
                        style={{ padding:'4px 11px', borderRadius:99, border:`0.5px solid ${C.amber}`, background:TK.warningTint, color:C.amber, fontWeight:700, fontSize:10.5, cursor: busy === l.id ? 'not-allowed' : 'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                        {busy === l.id ? '…' : 'Foreclose'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize:11, color:C.muted, marginTop:10, lineHeight:1.55 }}>
        EMI is deducted through <b>Payroll → Data Sync → Loan</b> — once per payroll month, however many times you run the sync. The last EMI is only as large as the balance that is left.
      </div>
      {msg && <div style={{ fontSize:12, fontWeight:600, color:C.green, background:TK.positiveTint, borderRadius:8, padding:'9px 12px', marginTop:10 }}>✓ {msg}</div>}
      {err && <div style={{ fontSize:12, color:C.red, background:TK.criticalTint, borderRadius:8, padding:'9px 12px', marginTop:10 }}>{err}</div>}
    </div>
  )
}

// ── 5) Loan types (read-only) ────────────────────────────────────
function LoanTypes({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => {
    supabase.from('loan_types').select('*').eq('company_id', companyId).then(({ data }) => setRows(data || []))
  }, [companyId])
  return (
    <div style={S.card}>
      <div style={S.section}>Loan types</div>
      {rows.length === 0 ? <div style={{ fontSize:12, color:C.muted }}>No loan types configured.</div> : rows.map(t => (
        <div key={t.id} style={S.row}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:600 }}>{t.code ? `${t.code} · ` : ''}{t.name}</div>
            <div style={{ fontSize:11.5, color:C.muted, marginTop:2 }}>Base {t.eligibility_base || '—'} · max {t.max_loan_percent ?? '—'}% · tenure {t.min_tenure_months ?? '—'}–{t.max_tenure_months ?? '—'} mo · {t.interest_rate ?? '—'}% {t.interest_type ? `(${t.interest_type})` : ''}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Parent ───────────────────────────────────────────────────────
export default function LoansPage() {
  const [companies, setCompanies] = useState<{ id: string; company_name: string }[]>([])
  const [companyId, setCompanyId] = useState('')
  const [emps, setEmps] = useState<any[]>([])
  const [types, setTypes] = useState<any[]>([])
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null)
  const notify = (msg: string, t?: 'error') => { setToast({ msg, err: t === 'error' }); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name').then(({ data }) => {
      const list = data || []
      setCompanies(list)
      if (list.length) setCompanyId(list[0].id)
    })
  }, [])
  useEffect(() => {
    if (!companyId) return
    supabase.from('employees').select('id, emp_code, full_name').eq('company_id', companyId).then(({ data }) => setEmps(data || []))
    supabase.from('loan_types').select('id, name').eq('company_id', companyId).then(({ data }) => setTypes(data || []))
  }, [companyId])

  const empMap: Record<string, string> = {}
  const empIds = new Set<string>()
  emps.forEach(e => { empMap[e.id] = `${e.full_name}${e.emp_code ? ` (${e.emp_code})` : ''}`; empIds.add(e.id) })
  const typeMap: Record<string, string> = {}
  types.forEach(t => { typeMap[t.id] = t.name })

  return (
    <div style={S.page}>
      <div style={S.content}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:16, marginBottom:16, flexWrap:'wrap', background:TK.surface, borderRadius:12, border:`1px solid ${C.border}`, padding:'14px 16px', position:'sticky', top:0, zIndex:30, boxShadow:'0 2px 8px rgba(15,23,42,0.06)' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <h1 style={S.h1}>Loan Management</h1>
            <div style={S.sub}>Approve requests, review agreements, disburse funds, and track active loans.</div>
          </div>
          <div>
            <label style={S.label}>Company</label>
            <select style={{ ...S.input, minWidth:220 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
              {companies.length === 0 && <option value="">No companies</option>}
              {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
        </div>

        {!companyId ? <div style={S.card}><div style={{ color:C.muted }}>Select a company to continue.</div></div> : (
          <>
            <PendingApprovals companyId={companyId} empMap={empMap} typeMap={typeMap} notify={notify} />
            <AgreementsReview companyEmpIds={empIds} empMap={empMap} notify={notify} />
            <ReadyToDisburse companyEmpIds={empIds} empMap={empMap} notify={notify} />
            <ActiveLoans companyEmpIds={empIds} empMap={empMap} />
            <LoanTypes companyId={companyId} />
          </>
        )}
      </div>

      {toast && (
        <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', background: toast.err ? C.red : C.navy, color:TK.onAccent, padding:'10px 18px', borderRadius:10, fontSize:13, fontWeight:500, boxShadow:'0 4px 16px rgba(0,0,0,.18)', zIndex:1000 }}>{toast.msg}</div>
      )}
    </div>
  )
}
