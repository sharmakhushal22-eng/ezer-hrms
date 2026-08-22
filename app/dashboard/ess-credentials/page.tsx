'use client'
// app/dashboard/ess-credentials/page.tsx — HR bulk-generates ESS login credentials.
// Temp password = emp_code · employee is forced to change it on first login.
// Generates accounts, previews the list, and exports an Excel to distribute.
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import * as XLSX from 'xlsx'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep, border: TK.line, muted: TK.muted,
  card: TK.surface, green: TK.positive, greenBg: TK.positiveTint, red: TK.critical, amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.brandTint,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inp: React.CSSProperties = { padding: '8px 11px', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: TK.sunken, color: C.navy, outline: 'none', fontFamily: font, boxSizing: 'border-box' }
const pri: React.CSSProperties = { padding: '9px 18px', background: C.purple, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: font }
const sec: React.CSSProperties = { padding: '8px 14px', background: '#fff', color: C.navy, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: font }

export default function EssCredentialsPage() {
  const [companies, setCompanies] = useState<{ id: string; company_name: string }[]>([])
  const [companyId, setCompanyId] = useState('')
  const [empCodes, setEmpCodes] = useState('')
  const [reset, setReset] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<any[]>([])
  const [summary, setSummary] = useState<{ generated: number; skipped: number } | null>(null)
  const [error, setError] = useState('')
  const [counts, setCounts] = useState<{ total: number; withPw: number }>({ total: 0, withPw: 0 })
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  // Prefill "Specific codes" when arriving from Access Control (?codes=SRS0001,SSM0002).
  useEffect(() => {
    const codes = new URLSearchParams(window.location.search).get('codes')
    if (codes) setEmpCodes(codes.split(/[\s,]+/).filter(Boolean).join(', '))
  }, [])

  useEffect(() => {
    supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
      .then(({ data }) => { setCompanies(data || []); if (data?.length) setCompanyId(data[0].id) })
  }, [])
  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      const { count: total } = await supabase.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('employment_status', 'Active').neq('is_test', true)
      const { data: emps } = await supabase.from('employees').select('id').eq('company_id', companyId).eq('employment_status', 'Active').neq('is_test', true)
      const ids = (emps || []).map((e: any) => e.id)
      let withPw = 0
      if (ids.length) { const { count } = await supabase.from('ess_accounts').select('id', { count: 'exact', head: true }).in('employee_id', ids).not('password_hash', 'is', null); withPw = count || 0 }
      setCounts({ total: total || 0, withPw })
    })()
  }, [companyId, summary])

  async function generate(mode: 'all' | 'selected') {
    setError(''); setBusy(true); setRows([]); setSummary(null)
    let body: any = { reset, performedBy: 'HR', company_id: companyId }
    if (mode === 'all') body.all = true
    else {
      const codes = empCodes.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
      if (!codes.length) { setError('Enter at least one employee code.'); setBusy(false); return }
      const { data } = await supabase.from('employees').select('id').in('emp_code', codes)
      const ids = (data || []).map((e: any) => e.id)
      if (!ids.length) { setError('No matching employees found for those codes.'); setBusy(false); return }
      body.employee_ids = ids
    }
    const res = await fetch('/api/ess-auth/admin/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(e => ({ error: e.message }))
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setRows(res.issued || []); setSummary({ generated: res.generated || 0, skipped: res.skipped || 0 })
  }

  function exportExcel() {
    const issued = rows.filter(r => r.status === 'ISSUED')
    if (!issued.length) return
    const data = issued.map(r => ({ 'Employee Code': r.emp_code, 'Name': r.full_name, 'Login ID (email or code)': r.login_id, 'Temporary Password': r.temp_password, 'Note': 'Change on first login' }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'ESS Credentials')
    XLSX.writeFile(wb, `EZER_ESS_Credentials_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const issuedCount = rows.filter(r => r.status === 'ISSUED').length

  return (
    <div style={{ padding: 24, background: C.bg, minHeight: '100vh', color: C.navy, fontFamily: font, fontSize: 13 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>ESS Login Credentials</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 2, marginBottom: 16 }}>Generate employee self-service logins in bulk · temp password = employee code · forced change on first login</div>

      <div style={{ background: C.amberBg, border: '1px solid #FDE68A', borderRadius: 10, padding: '11px 14px', marginBottom: 16, fontSize: 12.5, color: C.amber, display: 'flex', gap: 8 }}>
        <span></span><span><b>Confidential.</b> Each employee&apos;s temporary password is their own <b>employee code</b> (e.g. SRS0001). They must set a new password on first login. Share the exported list securely, then delete it.</span>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 14, boxShadow: '0 1px 4px rgba(37,99,235,0.06)' }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: C.purpleDark, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>Company</label>
            <select style={{ ...inp, minWidth: 240 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>{companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            <div><b style={{ color: C.navy }}>{counts.total}</b> active employees</div>
            <div><b style={{ color: C.green }}>{counts.withPw}</b> already have a password · <b style={{ color: C.amber }}>{Math.max(0, counts.total - counts.withPw)}</b> pending</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.navy, marginLeft: 'auto', cursor: 'pointer' }}>
            <input type="checkbox" checked={reset} onChange={e => setReset(e.target.checked)} /> Re-issue for employees who already have a password
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <button style={{ ...pri, opacity: busy ? .6 : 1 }} disabled={busy || !companyId} onClick={() => generate('all')}>{busy ? 'Generating…' : `⚡ Generate for all active employees`}</button>
          <span style={{ color: C.muted, fontSize: 12 }}>or</span>
          <div style={{ flex: 1, minWidth: 260 }}>
            <input style={{ ...inp, width: '100%', fontFamily: 'monospace' }} placeholder="Specific codes: SRS0001, SSM0002, …" value={empCodes} onChange={e => setEmpCodes(e.target.value)} />
          </div>
          <button
            style={ empCodes.trim()
              ? { ...pri, background: C.green, opacity: busy ? .6 : 1 }
              : { ...sec, opacity: busy ? .6 : 1 } }
            disabled={busy}
            onClick={() => generate('selected')}
          >Generate for these</button>
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 12.5, color: C.red, background: TK.criticalTint, border: '1px solid #FCA5A5', borderRadius: 8, padding: '9px 12px' }}>⚠ {error}</div>}
      </div>

      {summary && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Credentials generated</div>
            <span style={{ fontSize: 11, color: C.green }}>✓ {summary.generated} issued</span>
            {summary.skipped > 0 && <span style={{ fontSize: 11, color: C.muted }}>· {summary.skipped} skipped (already set)</span>}
            {issuedCount > 0 && <button style={{ ...pri, marginLeft: 'auto', padding: '7px 14px' }} onClick={exportExcel}>⬇ Download Excel</button>}
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '55vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: C.bg }}>{['Emp Code', 'Name', 'Login ID', 'Temp Password', 'Status'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: C.purpleDark, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: C.bg }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontWeight: 600, color: C.purple }}>{r.emp_code}</td>
                    <td style={{ padding: '7px 12px' }}>{r.full_name}</td>
                    <td style={{ padding: '7px 12px', color: C.muted }}>{r.login_id}</td>
                    <td style={{ padding: '7px 12px', fontFamily: 'monospace' }}>{r.temp_password || '—'}</td>
                    <td style={{ padding: '7px 12px' }}>
                      {r.status === 'ISSUED' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: C.greenBg, color: C.green, fontWeight: 600 }}>Issued</span>
                          <button
                            onClick={async () => {
                              const link = `${window.location.origin}/ess-login`
                              try { await navigator.clipboard.writeText(link) } catch { /* clipboard best-effort */ }
                              setCopiedIdx(i); setTimeout(() => setCopiedIdx(c => (c === i ? null : c)), 1800)
                            }}
                            style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, border: `1px solid ${C.border}`, background: copiedIdx === i ? C.greenBg : '#fff', color: copiedIdx === i ? C.green : C.purpleDark, fontWeight: 600, cursor: 'pointer', fontFamily: font }}
                          >{copiedIdx === i ? 'Copied' : 'Copy link'}</button>
                        </span>
                      ) : <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: TK.criticalTint, color: C.red, fontWeight: 600 }}>{r.error || 'Error'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
