'use client'
// components/payroll/NpsReport.tsx — Payroll → Statutory & Tax → NPS.
//
// Who is enrolled in the corporate NPS, and who is not. The Y/N is the point of the
// screen, so everybody is listed by default and the filter narrows to the opted-in —
// a report that only ever shows enrolled people cannot answer "did we miss anyone".
//
// Opted-in means a declaration that is ACTIVE or PENDING_PRAN. STOPPED and SUPERSEDED
// are shown as N with the status spelled out, because "never enrolled" and "enrolled
// and then stopped" are different answers to the same question.
//
// All sub-components are defined OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'

const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489', card: '#FFFFFF',
  border: '#E9E7F5', muted: '#6B7280', green: '#059669', greenBg: '#ECFDF5',
  amber: '#B45309', amberBg: '#FFFBEB', amberBd: '#FDE68A',
  red: '#DC2626', redBg: '#FEF2F2', purpleBg: '#EEEDFE', gray: '#F8F7FF',
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const fmtDate = (d?: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const S = {
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.07)' } as React.CSSProperties,
  sel: { padding: '8px 10px', border: `1px solid #DDD6FE`, borderRadius: 7, fontSize: 12.5, fontFamily: font, background: '#FAFAF8', color: C.navy, outline: 'none', minWidth: 150 } as React.CSSProperties,
  btnP: { padding: '9px 16px', borderRadius: 8, border: 'none', background: C.purple, color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: font } as React.CSSProperties,
  btnO: { padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.purpleD, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: font } as React.CSSProperties,
  th: { padding: '9px 10px', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: '.04em', textAlign: 'left' as const, whiteSpace: 'nowrap' as const, background: C.gray, borderBottom: `1px solid ${C.border}` },
  td: { padding: '8px 10px', fontSize: 12, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' as const, color: C.navy },
}

export interface NpsRow {
  company: string
  emp_code: string
  full_name: string
  department: string
  location: string
  doj: string | null
  dol: string | null
  regime: string          // the employee's own regime for the FY
  opted: boolean
  status: string          // ACTIVE / PENDING_PRAN / STOPPED / SUPERSEDED / —
  pran: string
  tier: string
  percent: number | null
  monthly: number | null
  nps_regime: string      // the regime the contribution % was worked out on
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: C.gray, border: `1px solid ${C.border}`, borderRadius: 9, padding: '9px 14px', minWidth: 92 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: color || C.navy, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function YesNo({ yes }: { yes: boolean }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 10px', borderRadius: 99, background: yes ? C.greenBg : '#F1F5F9', color: yes ? C.green : '#64748B' }}>
      {yes ? 'Y' : 'N'}
    </span>
  )
}

const STATUS_STYLE: Record<string, [string, string]> = {
  ACTIVE: [C.greenBg, C.green], PENDING_PRAN: ['#EFF6FF', '#1D4ED8'],
  STOPPED: [C.redBg, C.red], SUPERSEDED: ['#F1F5F9', '#64748B'],
}
function StatusPill({ s }: { s: string }) {
  if (!s || s === '—') return <span style={{ color: C.muted }}>—</span>
  const [bg, fg] = STATUS_STYLE[s] || ['#F3F0FF', C.purpleD]
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 99, background: bg, color: fg }}>{s.replace('_', ' ')}</span>
}

export default function NpsReport({ fy }: { fy: string }) {
  const [rows, setRows] = useState<NpsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fDept, setFDept] = useState('')
  const [fLoc, setFLoc] = useState('')
  const [fOpt, setFOpt] = useState<'all' | 'y' | 'n'>('all')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [empRes, npsRes, tdsRes] = await Promise.all([
        // locations!location_id — employees reaches locations through more than one key,
        // so the FK has to be named or the join is ambiguous.
        supabase.from('employees')
          .select('id, emp_code, full_name, group_doj, date_of_leaving, employment_status, companies(company_name), departments(dept_name), locations!location_id(location_name)')
          .order('emp_code'),
        supabase.from('nps_declarations')
          .select('employee_id, fy, status, tax_regime, pran_number, tier_type, contribution_percent, monthly_nps_amount, created_at')
          .eq('fy', fy),
        supabase.from('tds_declarations').select('employee_id, regime').eq('fy', fy),
      ])
      if (empRes.error) throw new Error(empRes.error.message)
      if (npsRes.error) throw new Error(npsRes.error.message)

      const regimeBy = new Map<string, string>()
      for (const t of (tdsRes.data as any[]) || []) regimeBy.set(t.employee_id, t.regime || '')

      // One employee can hold several declarations across a year — a stopped one, a
      // superseded one, a live one. The live record wins; otherwise the most recent,
      // so a stopped enrolment is still reported instead of vanishing.
      const npsBy = new Map<string, any>()
      for (const n of (npsRes.data as any[]) || []) {
        const cur = npsBy.get(n.employee_id)
        const live = (s: string) => s === 'ACTIVE' || s === 'PENDING_PRAN'
        if (!cur) { npsBy.set(n.employee_id, n); continue }
        if (live(n.status) && !live(cur.status)) { npsBy.set(n.employee_id, n); continue }
        if (live(n.status) === live(cur.status) && (n.created_at || '') > (cur.created_at || '')) npsBy.set(n.employee_id, n)
      }

      const out: NpsRow[] = ((empRes.data as any[]) || []).map(e => {
        const n = npsBy.get(e.id)
        const st = n?.status || '—'
        return {
          company: e.companies?.company_name || '—',
          emp_code: e.emp_code || '',
          full_name: e.full_name || '',
          department: e.departments?.dept_name || '—',
          location: e.locations?.location_name || '—',
          doj: e.group_doj || null,
          dol: e.date_of_leaving || null,
          regime: regimeBy.get(e.id) || n?.tax_regime || '—',
          opted: st === 'ACTIVE' || st === 'PENDING_PRAN',
          status: st,
          pran: n?.pran_number || '',
          tier: n?.tier_type || '',
          percent: n?.contribution_percent ?? null,
          monthly: n?.monthly_nps_amount ?? null,
          nps_regime: n?.tax_regime || '',
        }
      })
      setRows(out)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [fy])
  useEffect(() => { load() }, [load])

  const companies = useMemo(() => Array.from(new Set(rows.map(r => r.company).filter(x => x && x !== '—'))).sort(), [rows])
  const depts = useMemo(() => Array.from(new Set(rows.map(r => r.department).filter(x => x && x !== '—'))).sort(), [rows])
  const locs = useMemo(() => Array.from(new Set(rows.map(r => r.location).filter(x => x && x !== '—'))).sort(), [rows])

  const shown = useMemo(() => {
    // A pasted list of codes works as well as a single name.
    const terms = q.split(/[\s,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
    return rows.filter(r => {
      if (fCompany && r.company !== fCompany) return false
      if (fDept && r.department !== fDept) return false
      if (fLoc && r.location !== fLoc) return false
      if (fOpt === 'y' && !r.opted) return false
      if (fOpt === 'n' && r.opted) return false
      if (!terms.length) return true
      return terms.some(t => r.emp_code.toLowerCase().includes(t) || r.full_name.toLowerCase().includes(t))
    })
  }, [rows, fCompany, fDept, fLoc, fOpt, q])

  const optedCount = shown.filter(r => r.opted).length
  const stopped = shown.filter(r => r.status === 'STOPPED').length
  const pending = shown.filter(r => r.status === 'PENDING_PRAN').length
  const monthlyTotal = shown.filter(r => r.opted).reduce((s, r) => s + (r.monthly || 0), 0)
  // The contribution rate follows the regime — 10% of Basic on old, 14% on new. If the
  // employee switched regime after enrolling, the percent on file is for the old one.
  const regimeMismatch = shown.filter(r => r.opted && r.nps_regime && r.regime !== '—' && r.nps_regime !== r.regime)

  function download() {
    const sheet = shown.map(r => ({
      'Company Name': r.company,
      'Employee Code': r.emp_code,
      'Employee Name': r.full_name,
      'Department': r.department,
      'Location': r.location,
      'Date of Joining': r.doj || '',
      'Date of Leaving': r.dol || '',
      'Regime': r.regime,
      'NPS Opted (Y/N)': r.opted ? 'Y' : 'N',
      'NPS Status': r.status === '—' ? '' : r.status,
      'PRAN': r.pran,
      'Tier': r.tier,
      'Contribution %': r.percent ?? '',
      'Monthly NPS': r.monthly ?? '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'NPS')
    XLSX.writeFile(wb, `NPS_Report_FY${fy}.xlsx`)
  }

  return (
    <div style={{ fontFamily: font, color: C.navy }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>Corporate NPS — Enrolment Report</div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
          FY {fy} · who is enrolled in the corporate NPS and who is not. Employer contribution
          is 80CCD(2) — over and above the ₹1.5L 80C limit.
        </div>
      </div>

      {err && <div style={{ ...S.card, background: C.redBg, border: '1px solid #FECACA', color: C.red, fontSize: 12.5 }}>{err}</div>}

      <div style={S.card}>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 12 }}>
          <Stat label="Employees" value={shown.length} />
          <Stat label="NPS opted" value={optedCount} color={optedCount ? C.green : C.muted} />
          <Stat label="Not opted" value={shown.length - optedCount} color={C.muted} />
          {pending > 0 && <Stat label="PRAN pending" value={pending} color="#1D4ED8" />}
          {stopped > 0 && <Stat label="Stopped" value={stopped} color={C.red} />}
          <Stat label="Monthly NPS" value={inr(monthlyTotal)} color={C.purpleD} />
          <div style={{ flex: 1 }} />
          <button onClick={download} disabled={!shown.length} style={{ ...S.btnP, alignSelf: 'center', opacity: shown.length ? 1 : 0.5 }}>
            📄 Download Excel
          </button>
          <button onClick={load} style={{ ...S.btnO, alignSelf: 'center' }}>↻ Refresh</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={S.sel} value={fCompany} onChange={e => setFCompany(e.target.value)}>
            <option value="">All companies</option>{companies.map(c => <option key={c}>{c}</option>)}
          </select>
          <select style={S.sel} value={fDept} onChange={e => setFDept(e.target.value)}>
            <option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}
          </select>
          <select style={S.sel} value={fLoc} onChange={e => setFLoc(e.target.value)}>
            <option value="">All locations</option>{locs.map(l => <option key={l}>{l}</option>)}
          </select>
          <select style={S.sel} value={fOpt} onChange={e => setFOpt(e.target.value as any)}>
            <option value="all">NPS: all</option>
            <option value="y">NPS opted only (Y)</option>
            <option value="n">Not opted only (N)</option>
          </select>
          <input style={{ ...S.sel, flex: 1, minWidth: 200 }} placeholder="🔍 Employee code or name" value={q} onChange={e => setQ(e.target.value)} />
          {(fCompany || fDept || fLoc || fOpt !== 'all' || q) && (
            <button onClick={() => { setFCompany(''); setFDept(''); setFLoc(''); setFOpt('all'); setQ('') }} style={S.btnO}>Clear</button>
          )}
        </div>

        {regimeMismatch.length > 0 && (
          <div style={{ marginTop: 11, fontSize: 11.5, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBd}`, borderRadius: 9, padding: '10px 12px', lineHeight: 1.55 }}>
            <b>{regimeMismatch.length} employee{regimeMismatch.length === 1 ? '' : 's'} changed tax regime after enrolling.</b> The
            NPS rate follows the regime — 10% of Basic on old, 14% on new — so the percent on
            file was worked out for the other one and the contribution is stale:{' '}
            {regimeMismatch.slice(0, 6).map(r => `${r.emp_code} (${r.nps_regime}→${r.regime})`).join(', ')}
            {regimeMismatch.length > 6 ? `, …and ${regimeMismatch.length - 6} more` : ''}.
          </div>
        )}
      </div>

      <div style={{ ...S.card, padding: 0, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 12.5 }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 12.5 }}>
            {rows.length === 0 ? 'No employees found.' : 'Nothing matched this filter.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Company', 'Emp Code', 'Employee Name', 'Department', 'Location', 'DOJ', 'DOL', 'Regime', 'NPS', 'Status', 'PRAN', 'Tier', '%', 'Monthly'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.emp_code} style={{ background: r.opted ? '#FCFDFF' : '#fff' }}>
                  <td style={S.td}>{r.company}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{r.emp_code}</td>
                  <td style={S.td}>{r.full_name}</td>
                  <td style={S.td}>{r.department}</td>
                  <td style={S.td}>{r.location}</td>
                  <td style={S.td}>{fmtDate(r.doj)}</td>
                  <td style={{ ...S.td, color: r.dol ? C.red : C.muted }}>{fmtDate(r.dol)}</td>
                  <td style={S.td}>{r.regime}</td>
                  <td style={S.td}><YesNo yes={r.opted} /></td>
                  <td style={S.td}><StatusPill s={r.status} /></td>
                  <td style={{ ...S.td, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.pran || '—'}</td>
                  <td style={S.td}>{r.tier || '—'}</td>
                  <td style={S.td}>{r.percent == null ? '—' : `${r.percent}%`}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{r.monthly == null ? '—' : inr(r.monthly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontSize: 10.5, color: C.purpleD, background: C.purpleBg, borderRadius: 9, padding: '11px 13px', lineHeight: 1.6 }}>
        <b>Y</b> means a live enrolment — ACTIVE, or PENDING_PRAN where the employee has enrolled
        but not yet submitted their PRAN. <b>N</b> covers both never enrolled and enrolled-then-stopped;
        the Status column separates the two, so a stopped enrolment is never mistaken for someone
        who was simply never asked.
        <br />Enrolment happens in the employee&apos;s ESS portal. This screen reports it — it does not change it.
      </div>
    </div>
  )
}
