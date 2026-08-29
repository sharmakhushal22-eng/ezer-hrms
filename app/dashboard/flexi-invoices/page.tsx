'use client'
// app/dashboard/flexi-invoices/page.tsx — Flexi reimbursement vouchers/invoices.
// For a company + month, groups approved flexi claims per employee and generates a
// printable voucher PDF. Invoice no: EZER-FLX-{COMPANY_CODE}-{YYYYMM}-{EMP_CODE}.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { COMP_NAMES } from '@/lib/flexi/claims'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep, border: TK.line, muted: TK.muted,
  card: TK.surface, green: TK.positive, greenBg: TK.positiveTint, amber: TK.warning, purpleBg: TK.brandTint,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const inp: React.CSSProperties = { padding: '8px 11px', border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, background: TK.sunken, color: C.navy, outline: 'none', fontFamily: font, boxSizing: 'border-box' }
const pri: React.CSSProperties = { padding: '8px 16px', background: C.purple, color: TK.onAccent, border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: font }
const sec: React.CSSProperties = { padding: '7px 13px', background: TK.surface, color: C.purpleDark, border: `1px solid ${C.border}`, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontFamily: font }

interface EmpVoucher {
  employee_id: string; emp_code: string; full_name: string; department: string; designation: string
  components: { code: string; amount: number }[]; total: number; approvedOn: string | null; anyProcessed: boolean
}

function esc(s: any) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)) }
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Build the printable HTML for one or more vouchers.
function voucherHtml(companyName: string, companyCode: string, ym: string, vouchers: EmpVoucher[]): string {
  const [yr, mo] = ym.split('-')
  const period = new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const page = (v: EmpVoucher) => {
    const invNo = `EZER-FLX-${companyCode || 'EZ'}-${yr}${mo}-${v.emp_code}`
    const rows = v.components.map(c => `<tr><td>${esc(COMP_NAMES[c.code] || c.code)}</td><td class="r">${inr(c.amount)}</td></tr>`).join('')
    return `<section class="voucher">
      <div class="hd">
        <div><div class="brand">EZER HRMS</div><div class="co">${esc(companyName)}</div></div>
        <div class="title"><div>FLEXI REIMBURSEMENT</div><div class="sub">VOUCHER</div></div>
      </div>
      <div class="meta">
        <div><span>Invoice No.</span><b>${esc(invNo)}</b></div>
        <div><span>Period</span><b>${esc(period)}</b></div>
        <div><span>Status</span><b>${v.anyProcessed ? 'Paid via payroll' : 'Approved'}</b></div>
      </div>
      <div class="emp">
        <div><span>Employee</span><b>${esc(v.full_name)}</b></div>
        <div><span>Code</span><b>${esc(v.emp_code)}</b></div>
        <div><span>Department</span><b>${esc(v.department || '—')}</b></div>
        <div><span>Designation</span><b>${esc(v.designation || '—')}</b></div>
      </div>
      <table class="items"><thead><tr><th>Component</th><th class="r">Approved Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Total Reimbursement</td><td class="r">${inr(v.total)}</td></tr></tfoot>
      </table>
      <div class="ft">
        <div><span>Approved on</span><b>${fmtDate(v.approvedOn)}</b><br/><span>Approved by</span><b>Payroll / HR</b></div>
        <div class="sign"><div class="line"></div>Authorised Signatory</div>
      </div>
      <div class="note">This is a system-generated reimbursement voucher against submitted bills. Amounts shown are approved flexi (FBP) claims for the period and are settled through payroll. No signature is required if generated electronically.</div>
    </section>`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Flexi Vouchers ${period}</title>
  <style>
    *{box-sizing:border-box} body{font-family:${font};color:#1E1B4B;margin:0;background:#F5F3FF}
    .voucher{background:#fff;max-width:760px;margin:22px auto;padding:34px 38px;border:1px solid #E9E7F5;border-radius:14px}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2563EB;padding-bottom:14px}
    .brand{font-size:22px;font-weight:800;color:#2563EB;letter-spacing:.02em}
    .co{font-size:13px;color:#6B7280;margin-top:2px}
    .title{text-align:right;font-size:15px;font-weight:800;color:#1E1B4B;letter-spacing:.06em}
    .title .sub{font-size:12px;color:#2563EB;font-weight:700}
    .meta,.emp{display:flex;flex-wrap:wrap;gap:18px 34px;margin-top:18px;font-size:13px}
    .meta div,.emp div{display:flex;flex-direction:column}
    .meta span,.emp span{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF;margin-bottom:2px}
    .emp{background:#F5F3FF;border:1px solid #EDE9FE;border-radius:10px;padding:14px 16px}
    table.items{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px}
    table.items th{text-align:left;background:#1E1B4B;color:#fff;padding:9px 12px;font-size:11px;letter-spacing:.03em}
    table.items td{padding:9px 12px;border-bottom:1px solid #F1F0FA}
    table.items .r{text-align:right}
    table.items tfoot td{font-weight:800;color:#2563EB;background:#F5F3FF;border-top:2px solid #E9E7F5}
    .ft{display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px;font-size:12px}
    .ft span{font-size:10px;text-transform:uppercase;color:#9CA3AF;letter-spacing:.04em;margin-right:6px}
    .sign{text-align:center;color:#6B7280;font-size:11px}
    .sign .line{width:170px;border-top:1px solid #94A3B8;margin-bottom:5px}
    .note{margin-top:22px;font-size:11px;color:#9CA3AF;line-height:1.5;border-top:1px dashed #E9E7F5;padding-top:12px}
    @media print{body{background:#fff}.voucher{border:none;margin:0;border-radius:0;max-width:100%}.voucher+.voucher{page-break-before:always}}
  </style></head><body>${vouchers.map(page).join('')}
  <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`
}

export default function FlexiInvoicesPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [companyId, setCompanyId] = useState('')
  const [ym, setYm] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`)
  const [rows, setRows] = useState<EmpVoucher[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('companies').select('id, company_name, company_code').eq('status', 'Active').order('company_name')
      .then(({ data }) => { setCompanies(data || []); if (data?.length) setCompanyId(data[0].id) })
  }, [])

  const company = companies.find(c => c.id === companyId)

  const load = useCallback(async () => {
    if (!companyId) { setRows([]); return }
    setLoading(true)
    const [yr, mo] = ym.split('-').map(Number)
    const from = `${yr}-${String(mo).padStart(2, '0')}-01`
    const to = mo >= 12 ? `${yr + 1}-01-01` : `${yr}-${String(mo + 1).padStart(2, '0')}-01`
    const { data } = await supabase.from('flexi_claims')
      .select('employee_id, component_code, claim_amount, status, reviewed_at, employees(emp_code, full_name, designation, departments!employees_department_id_fkey(dept_name))')
      .eq('company_id', companyId).in('status', ['APPROVED', 'PAYROLL_PROCESSED'])
      .gte('submitted_at', from).lt('submitted_at', to)
    const byEmp = new Map<string, EmpVoucher>()
    ;(data || []).forEach((c: any) => {
      const e = byEmp.get(c.employee_id) || {
        employee_id: c.employee_id, emp_code: c.employees?.emp_code || '', full_name: c.employees?.full_name || '',
        department: c.employees?.departments?.dept_name || '', designation: c.employees?.designation || '',
        components: [], total: 0, approvedOn: null, anyProcessed: false,
      }
      e.components.push({ code: c.component_code, amount: Number(c.claim_amount) || 0 })
      e.total += Number(c.claim_amount) || 0
      if (c.status === 'PAYROLL_PROCESSED') e.anyProcessed = true
      if (c.reviewed_at && (!e.approvedOn || c.reviewed_at > e.approvedOn)) e.approvedOn = c.reviewed_at
      byEmp.set(c.employee_id, e)
    })
    setRows(Array.from(byEmp.values()).sort((a, b) => a.emp_code.localeCompare(b.emp_code)))
    setLoading(false)
  }, [companyId, ym])
  useEffect(() => { load() }, [load])

  function print(vouchers: EmpVoucher[]) {
    if (!vouchers.length) return
    const html = voucherHtml(company?.company_name || '', company?.company_code || '', ym, vouchers)
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  const grandTotal = rows.reduce((t, r) => t + r.total, 0)

  return (
    <div style={{ padding: 24, background: C.bg, minHeight: '100vh', color: C.navy, fontFamily: font, fontSize: 13 }}>
      <div className="ez-page-head" style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Flexi Invoices &amp; Vouchers</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Generate reimbursement vouchers for approved flexi claims · one voucher per employee per month</div>
        </div>
        <div><label style={{ fontSize: 10, color: C.purpleDark, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Company</label>
          <select style={{ ...inp, minWidth: 200 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>{companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></div>
        <div><label style={{ fontSize: 10, color: C.purpleDark, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Period</label>
          <input type="month" style={inp} value={ym} onChange={e => setYm(e.target.value)} /></div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['Employees', String(rows.length), C.purple], ['Total reimbursement', inr(grandTotal), C.green]].map(([l, v, c]) => (
          <div key={l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 18px', minWidth: 160 }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c as string, marginTop: 2 }}>{v}</div>
          </div>
        ))}
        {rows.length > 0 && <button style={{ ...pri, alignSelf: 'flex-end', padding: '11px 18px' }} onClick={() => print(rows)}>Generate all vouchers ({rows.length})</button>}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600 }}>Approved claims — {new Date(Number(ym.split('-')[0]), Number(ym.split('-')[1]) - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
        {loading && <div style={{ padding: 30, textAlign: 'center', color: C.muted }}>Loading…</div>}
        {!loading && !rows.length && <div style={{ padding: 30, textAlign: 'center', color: C.muted }}>No approved flexi claims for this company &amp; month.</div>}
        {!loading && rows.map(r => (
          <div key={r.employee_id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 2fr 100px 130px', alignItems: 'center', padding: '10px 16px', borderTop: `1px solid ${C.border}` }}>
            <div><div style={{ fontWeight: 600 }}>{r.full_name}</div><div style={{ fontSize: 11, color: C.muted }}>{r.emp_code}{r.department ? ` · ${r.department}` : ''}</div></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{r.components.map((c, i) => <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: C.purpleBg, color: C.purpleDark, fontWeight: 500 }}>{c.code} {inr(c.amount)}</span>)}</div>
            <div style={{ fontWeight: 700 }}>{inr(r.total)}</div>
            <div style={{ textAlign: 'right' }}><button style={sec} onClick={() => print([r])}>Voucher</button></div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>Invoice number format: <code>EZER-FLX-{'{'}COMPANY{'}'}-{'{'}YYYYMM{'}'}-{'{'}EMP_CODE{'}'}</code> · Vouchers open in a new tab — use your browser&apos;s Print → Save as PDF.</div>
    </div>
  )
}
