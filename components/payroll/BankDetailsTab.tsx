'use client'
// components/payroll/BankDetailsTab.tsx — Payroll → Employees → Bank Details.
// Salary account per employee, alongside the org and date context needed to identify
// whose account it is: Emp Code · Name · Department · Location · DOJ · DOL.
// Read-only — bank fields are maintained in the Employee Master; this is the payroll view.
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { loadBankDetails, type BankRow } from '@/lib/payroll/core'
import { font, fmtDate, ScreenIntro } from './attendanceShared'
// Design tokens, aliased as TK — this file declares its own C.
import { C as TK, F, W, S as SP, R, numeric, IconDownload, IconSearch } from '@/lib/ui'
import {
  SectionCard, FilterBar, FilterField, fieldStyle, PButton, DataTable, EmptyState, StatusPill, CountChip, IconBank, dt,
} from '@/components/payroll/kit'

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

  const filtering = !!(terms.length || dept || loc || onlyActive)
  const exitedCount = rows.filter(r => r.dol).length

  return (
    <div style={{ fontFamily: font, fontSize: F.small, color: TK.ink, maxWidth: 1180 }}>
      <ScreenIntro icon={<IconBank size={20} />} title="Bank Details"
        subtitle="Salary account per employee, maintained in the Employee Master, shown here for payroll"
        meta={<>
          <StatusPill t="neutral" size="sm" dot>Read-only view</StatusPill>
          {!loading && <StatusPill t="brand" size="sm">{rows.length} employees</StatusPill>}
          {!loading && exitedCount > 0 && <StatusPill t="critical" size="sm" dot>{exitedCount} exited</StatusPill>}
        </>}
        actions={
          <PButton variant="primary" icon={<IconDownload size={15} />} onClick={exportXlsx} disabled={!filtered.length}>
            Export ({filtered.length})
          </PButton>
        } />

      <FilterBar label="Find accounts" active={filtering}
        summary={loading ? 'Loading…' : `${filtered.length} of ${rows.length} employees`}>
        <FilterField label="Search" grow minWidth={260}>
          <span style={{ position: 'relative', display: 'block' }}>
            <span aria-hidden style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TK.muted, display: 'inline-flex', pointerEvents: 'none' }}><IconSearch size={14} /></span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search or paste codes, e.g. SRS0001, SRS0002" style={{ ...fieldStyle, paddingLeft: 32, fontFamily: font }} />
          </span>
        </FilterField>
        <FilterField label="Department" minWidth={170}>
          <select value={dept} onChange={e => setDept(e.target.value)} style={{ ...fieldStyle, fontFamily: font, cursor: 'pointer' }}>
            <option value="">All departments</option>
            {depts.sort().map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </FilterField>
        <FilterField label="Location" minWidth={170}>
          <select value={loc} onChange={e => setLoc(e.target.value)} style={{ ...fieldStyle, fontFamily: font, cursor: 'pointer' }}>
            <option value="">All locations</option>
            {locs.sort().map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </FilterField>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', boxSizing: 'border-box',
          border: `1px solid ${onlyActive ? TK.brandEdge : TK.lineStrong}`, borderRadius: R.md,
          background: onlyActive ? TK.brandTint : TK.surface, fontSize: F.small, fontWeight: W.medium,
          color: onlyActive ? TK.brandDeep : TK.ink, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} style={{ accentColor: TK.brand, width: 15, height: 15 }} /> Hide exited
        </label>
      </FilterBar>

      <SectionCard icon={<IconBank size={15} />} title="Salary accounts" flush
        hint="Export keeps account numbers as text, so leading zeros survive in Excel."
        actions={<CountChip t="brand">{filtered.length}</CountChip>}>
        {loading
          ? <EmptyState compact t="neutral" icon={<IconBank size={20} />} title="Loading bank details…" />
          : filtered.length === 0
            ? <EmptyState compact t="neutral" icon={<IconSearch size={20} />} title="No employees match these filters." />
            : (
              <DataTable minWidth={980}>
                <thead><tr>
                  {['Emp Code', 'Name', 'Department', 'Location', 'DOJ', 'DOL', 'Bank Name', 'Account Number', 'IFSC', 'Type'].map(h => <th key={h} style={dt.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={r.emp_code + i} className={dt.rowClass}>
                      <td style={dt.tdMono}>{r.emp_code}</td>
                      <td style={{ ...dt.tdStrong, whiteSpace: 'nowrap' }}>{r.full_name}</td>
                      <td style={{ ...dt.td, whiteSpace: 'nowrap' }}>{r.department || '-'}</td>
                      <td style={{ ...dt.td, whiteSpace: 'nowrap' }}>{r.location || '-'}</td>
                      <td style={{ ...dt.td, whiteSpace: 'nowrap', ...numeric }}>{fmtDate(r.doj) || '-'}</td>
                      <td style={{ ...dt.td, whiteSpace: 'nowrap', ...numeric }}>
                        {r.dol ? <StatusPill t="critical" size="sm" dot>{fmtDate(r.dol)}</StatusPill> : <span style={{ color: TK.faint }}>-</span>}
                      </td>
                      <td style={{ ...dt.td, whiteSpace: 'nowrap' }}>{r.bank_name || '-'}</td>
                      <td style={{ ...dt.tdMono, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: W.medium, letterSpacing: '.02em' }}>{r.account_number || (r.account_last4 ? `•••• ${r.account_last4}` : '-')}</td>
                      <td style={{ ...dt.td, whiteSpace: 'nowrap', ...numeric }}>{r.ifsc_code || '-'}</td>
                      <td style={{ ...dt.td, whiteSpace: 'nowrap' }}>{r.account_type ? <StatusPill t="neutral" size="sm">{r.account_type}</StatusPill> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
      </SectionCard>
    </div>
  )
}
