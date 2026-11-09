// app/api/recruitment/reports/route.ts — Recruitment → Reports.
//
//   GET ?counts=1[&from&to&company]          -> { reports: [{ ...def, rows }], scope }   the catalogue
//   GET ?report=<key|all>[&from&to&company]  -> .xlsx                                     one report, or all in one workbook
//
// The data is scoped exactly as the Recruitment page scopes it (app/dashboard/recruitment
// page.tsx loadAll): company-pinned unless cross-company; a Hiring Manager / Recruiter without
// oversight sees only the MRFs assigned to them, raised by them or awaiting their approval, and
// candidates only of the MRFs they run; confidential searches only for those who may see them.
// Everything else (interviews, negotiations, offers, documents, onboarding, audit) follows the
// candidates and MRFs left. Read-only. Guarded by the Recruitment module (VIEW).
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { rmsServiceClient as sb, grantForRequest } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { REPORTS, buildReport, reportCounts, sheetName, type Range } from '@/lib/recruitment/reports'
import { loadReportData } from '@/lib/recruitment/reports-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const DATE = /^\d{4}-\d{2}-\d{2}$/

function rangeOf(req: NextRequest): Range | NextResponse {
  const sp = req.nextUrl.searchParams
  const from = sp.get('from') || null, to = sp.get('to') || null
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return NextResponse.json({ error: 'Dates must be YYYY-MM-DD.' }, { status: 400 })
  if (from && to && from > to) return NextResponse.json({ error: 'The From date is after the To date.' }, { status: 400 })
  return { from, to }
}

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error
  const range = rangeOf(req); if (range instanceof NextResponse) return range
  const sp = req.nextUrl.searchParams
  let loaded: Awaited<ReturnType<typeof loadReportData>>
  try { loaded = await loadReportData(sb, await grantForRequest(req), sp.get('company')) }
  catch (e: any) { return NextResponse.json({ error: `Could not load recruitment data: ${e?.message || e}` }, { status: 500 }) }
  const { ds, scope } = loaded

  if (sp.get('counts')) {
    const counts = reportCounts(ds, range)
    return NextResponse.json({ scope, reports: REPORTS.map(r => ({ ...r, rows: counts[r.key] ?? 0 })) })
  }

  const key = sp.get('report') || ''
  const defs = key === 'all' ? REPORTS : REPORTS.filter(r => r.key === key)
  if (!defs.length) return NextResponse.json({ error: 'Unknown report.' }, { status: 400 })

  const wb = XLSX.utils.book_new()
  const taken = new Set<string>()
  const window = range.from || range.to ? `${range.from || 'start'} to ${range.to || 'today'}` : 'All dates'
  const about = [
    ['EZER HRMS · Recruitment reports'], [],
    ['Report', key === 'all' ? 'All recruitment reports' : defs[0].title],
    ['Scope', scope], ['Dates', window], ['Generated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })], [],
    ['Sheet', 'What it holds', 'Rows'],
  ]
  const sheets: { name: string; rows: any[]; title: string }[] = []
  for (const d of defs) for (const s of buildReport(d.key, ds, range)) sheets.push({ name: sheetName(defs.length > 1 ? `${d.title}${s.name !== d.title ? ` - ${s.name}` : ''}` : s.name, taken), rows: s.rows, title: d.desc })
  for (const s of sheets) about.push([s.name, s.title, String(s.rows.length)])
  const aboutWs = XLSX.utils.aoa_to_sheet(about)
  aboutWs['!cols'] = [{ wch: 34 }, { wch: 90 }, { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, aboutWs, sheetName('About', taken))
  for (const s of sheets) {
    const ws = s.rows.length ? XLSX.utils.json_to_sheet(s.rows) : XLSX.utils.aoa_to_sheet([['No records for this scope and date range.']])
    if (s.rows.length) {
      const cols = Object.keys(s.rows[0])
      ws['!cols'] = cols.map(c => ({ wch: Math.min(48, Math.max(c.length + 2, ...s.rows.slice(0, 300).map(r => String(r[c] ?? '').length + 1))) }))
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.rows.length, c: cols.length - 1 } }) }
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name)
  }
  const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const stamp = new Date().toISOString().slice(0, 10)
  const file = `Recruitment_${key === 'all' ? 'All_Reports' : defs[0].title.replace(/[^A-Za-z0-9]+/g, '_')}_${stamp}.xlsx`
  return new Response(new Uint8Array(buf), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store',
  } })
}
