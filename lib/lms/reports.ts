// lib/lms/reports.ts — what HR reads, and what it exports. Server only.
import * as XLSX from 'xlsx'
import { allRows, must, sb } from './server'
import { inScope, type LmsActor } from './access'

export interface ReportFilter {
  companies: string[]
  location?: string | null
  department?: string | null
  course?: string | null
  status?: string | null
  mandatory?: boolean | null
  from?: string | null
  to?: string | null
  search?: string | null
}

const args = (f: ReportFilter, a: LmsActor) => ({
  p_companies: f.companies, p_location: a.locationId || f.location || null, p_department: f.department || null, p_course: f.course || null,
  p_employees: null, p_status: f.status || null, p_mandatory: f.mandatory ?? null, p_from: f.from || null, p_to: f.to || null, p_search: f.search || null,
})

export async function overview(a: LmsActor, companies: string[]) {
  return must(await sb.rpc('lms_overview', { p_companies: companies, p_location: a.locationId, p_employees: null }))
}

export async function reportPage(a: LmsActor, f: ReportFilter, page: number, size = 100) {
  const from = Math.max(0, page) * size
  const { data, error, count } = await sb.rpc('lms_report_rows', args(f, a), { count: 'exact' }).range(from, from + size - 1)
  if (error) throw new Error(error.message)
  return { rows: data || [], total: count ?? (data || []).length, page, size }
}

const day = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : ''

/** Spreadsheet injection: a cell starting with these runs as a formula when opened in Excel,
 *  and course titles and names are typed by people. */
const safe = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

export async function exportXlsx(a: LmsActor, f: ReportFilter, kind: string): Promise<Uint8Array> {
  const wb = XLSX.utils.book_new()
  if (kind === 'quizzes') {
    const rows = must(await sb.rpc('lms_quiz_stats', { p_companies: f.companies, p_course: f.course || null })) as any[]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((rows || []).map(r => ({
      Course: safe(r.course_title), Quiz: safe(r.title), 'Pass mark %': r.pass_pct, Attempts: r.attempts, Learners: r.learners, 'Average %': r.avg_pct, 'Pass rate %': r.pass_rate,
    }))), 'Assessments')
  } else {
    const filter = kind === 'failed' ? { ...f, status: 'FAILED' } : kind === 'overdue' ? { ...f, status: 'OVERDUE' } : kind === 'compliance' ? { ...f, mandatory: true } : f
    const rows = await allRows<any>((from, to) => sb.rpc('lms_report_rows', args(filter, a)).range(from, to) as any)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r => ({
      Company: r.company_code, 'Emp code': safe(r.emp_code), Name: safe(r.full_name), Department: safe(r.dept_name), Location: safe(r.location_name), Designation: safe(r.designation), Manager: safe(r.manager_name),
      'Course code': safe(r.course_code), Course: safe(r.course_title), Category: safe(r.category), Compliance: r.is_compliance ? 'Yes' : 'No', Version: r.version_no, Status: r.display_status, Mandatory: r.mandatory ? 'Yes' : 'No',
      Source: r.source, Cycle: r.cycle_no, Assigned: day(r.enrolled_at), Due: day(r.due_at), Started: day(r.started_at), Completed: day(r.completed_at), 'Valid until': day(r.expires_at), 'Progress %': Number(r.progress_pct), 'Score %': r.score_pct == null ? '' : Number(r.score_pct), 'Assigned by': safe(r.assigned_by),
    }))), 'Learning')
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

export async function auditTrail(companies: string[], page: number) {
  const size = 100, from = Math.max(0, page) * size
  return must(await sb.from('lms_audit_log').select('*').in('company_id', companies).order('created_at', { ascending: false }).range(from, from + size - 1))
}

export async function certificatesFor(companies: string[]) {
  return must(await sb.from('lms_certificates').select('id, company_id, cert_no, recipient_name, title, score_pct, issued_at, expires_at, revoked_at, revoke_reason').in('company_id', companies).order('issued_at', { ascending: false }).limit(500))
}

export async function revokeCertificate(a: LmsActor, id: string, reason: string) {
  const { data: c } = await sb.from('lms_certificates').select('company_id').eq('id', id).maybeSingle()
  inScope(a, c?.company_id, 'That certificate')
  must(await sb.from('lms_certificates').update({ revoked_at: new Date().toISOString(), revoked_by_name: a.label, revoke_reason: reason }).eq('id', id).select('id'))
  const { audit } = await import('./server')
  await audit({ companyId: c!.company_id, actorId: a.employeeId, actorLabel: a.label, action: 'CERTIFICATE_REVOKED', entity: 'certificate', entityId: id, detail: { reason } })
}
