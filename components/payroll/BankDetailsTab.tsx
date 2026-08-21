'use client'
// components/payroll/BankDetailsTab.tsx — Payroll → Employees → Bank Details.
// Salary account per employee, alongside the org and date context needed to identify
// whose account it is: Emp Code · Name · Department · Location · DOJ · DOL.
// Read-only — bank fields are maintained in the Employee Master; this is the payroll view.
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { loadBankDetails, type BankRow } from '@/lib/payroll/core'
import { C, font, fmtDate } from './attendanceShared'
// Design tokens, aliased as TK — this file declares its own C.
import { C as TK } from '@/lib/ui'

export default function BankDetailsTab({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<BankRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [loc, setLoc] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)

  useEffect(() => { setLoading(true); loadBankDetails(companyId).then(d => { setRows(d); setLoading(false) }) }, [companyId])

  const depts = Array.from(new Set(rows.map(r => r.department).filter(Boolean))) as string[]
  const locs = Array.from(new Set(rows.map(r => r.location).filter(Boolean))) as string[]
  // The search box accepts several values at once — "srs0001, srs0002" or a pasted
  // newline list — and a row matches if it matches ANY of them. A single term still
  // behaves as a plain substring search across code / name / bank / IFSC.
  const terms = q.split(/[\s,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
  const filtered = rows.filter(r => {
    if (dept && r.department !== dept) return false
    if (loc && r.location !== loc) return false
    if (onlyActive && r.dol) return false
    if (!terms.length) return true
    return terms.some(t =>
      (r.emp_code || '').toLowerCase().includes(t) || (r.full_name || '').toLowerCase().includes(t)
      || (r.ifsc_code || '').toLowerCase().includes(t) || (r.bank_name || '').toLowerCase().includes(t)
      || (r.account_number || '').toLowerCase().includes(t))
  })

  function exportXlsx() {
    const sheet = filtered.map(r => ({
      'Emp Code': r.emp_code || '', 'Name': r.full_name || '',
      'Department': r.department || '', 'Location': r.location || '',
      'DOJ': fmtDate(r.doj), 'DOL': fmtDate(r.dol),
      // Leading apostrophe so Excel keeps the account number as text — without it a
      // 12-digit number loses its leading zeros (001752711255 → 1752711255) and long
      // ones flip to scientific notation.
      'Bank Name': r.bank_name || '', 'Account Number': r.account_number ? `'${r.account_number}` : '',
      'IFSC Code': r.ifsc_code || '', 'Account Type': r.account_type || '',
    }))
    const header: string[] = []
    sheet.forEach(r => Object.keys(r).forEach(k => { if (!header.includes(k)) header.push(k) }))
    const ws = XLSX.utils.json_to_sheet(sheet, { header })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Bank Details')
    XLSX.writeFile(wb, 'Bank_Details.xlsx')
  }

  const inp: React.CSSProperties = { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12.5, background: '#fff', color: C.navy, fontFamily: font, outline: 'none' }
  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 9.5, color: `${TK.violetEdge}`, fontWeight: 700, textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '7px 10px', color: C.navy, whiteSpace: 'nowrap' }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg,${TK.violet},${TK.violetDeep})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Bank Details</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Salary account per employee — maintained in the Employee Master, shown here for payroll</div>
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12, boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search or paste codes — e.g. SRS0001, SRS0002" style={{ ...inp, flex: 1, minWidth: 260 }} />
          <select value={dept} onChange={e => setDept(e.target.value)} style={{ ...inp, minWidth: 160 }}>
            <option value="">All departments</option>
            {depts.sort().map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={loc} onChange={e => setLoc(e.target.value)} style={{ ...inp, minWidth: 160 }}>
            <option value="">All locations</option>
            {locs.sort().map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.navy, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} /> Hide exited
          </label>
          <button onClick={exportXlsx} disabled={!filtered.length}
            style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,#10B981,${C.green})`, color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: filtered.length ? 'pointer' : 'not-allowed', opacity: filtered.length ? 1 : 0.5 }}>
            ⬇ Export
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
          {loading ? 'Loading…' : `${filtered.length} of ${rows.length} employees`}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }}>
        {loading
          ? <div style={{ fontSize: 12, color: C.muted, padding: '18px 0', textAlign: 'center' }}>Loading bank details…</div>
          : filtered.length === 0
            ? <div style={{ fontSize: 12, color: C.muted, padding: '18px 0', textAlign: 'center' }}>No employees match these filters.</div>
            : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead><tr style={{ background: C.navy }}>
                    {['Emp Code', 'Name', 'Department', 'Location', 'DOJ', 'DOL', 'Bank Name', 'Account Number', 'IFSC', 'Type'].map(h => <th key={h} style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {filtered.map((r, i) => (
                      <tr key={r.emp_code + i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? '#fff' : C.gray }}>
                        <td style={{ ...td, fontWeight: 700 }}>{r.emp_code}</td>
                        <td style={td}>{r.full_name}</td>
                        <td style={td}>{r.department || '—'}</td>
                        <td style={td}>{r.location || '—'}</td>
                        <td style={td}>{fmtDate(r.doj) || '—'}</td>
                        <td style={{ ...td, color: r.dol ? C.red : C.muted }}>{fmtDate(r.dol) || '—'}</td>
                        <td style={td}>{r.bank_name || '—'}</td>
                        <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{r.account_number || (r.account_last4 ? `•••• ${r.account_last4}` : '—')}</td>
                        <td style={td}>{r.ifsc_code || '—'}</td>
                        <td style={td}>{r.account_type || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </div>
  )
}
