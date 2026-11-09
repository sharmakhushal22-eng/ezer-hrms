// lib/recruitment/reports-data.ts — SERVER ONLY. The dataset Recruitment → Reports builds from,
// scoped exactly as the Recruitment page scopes its own data (app/dashboard/recruitment/page.tsx
// loadAll): company-pinned unless cross-company; without oversight, only the MRFs assigned to,
// raised by or awaiting the viewer, and candidates only of the MRFs they run; confidential
// searches only for those who may see them. Interviews, negotiations, offers, documents,
// onboarding and the audit trail follow the candidates and MRFs left.
import { companyFilter, type Grant } from '@/lib/rms/resolve'
import { hideConfidential } from '@/lib/recruitment/confidential'
import type { Dataset } from './reports'

const OVERSIGHT_CODES = ['ADMIN_SUPER', 'SUPER_ADMIN', 'ALL_ACCESS', 'HR_HEAD', 'HR_MANAGER', 'CHRO']

/** Every row of a query, past PostgREST's 1,000-row page. */
async function all(q: () => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}
/** Rows whose `col` is one of `ids`, asked for 150 ids at a time so the URL stays short. */
async function allIn(ids: string[], q: (chunk: string[]) => any): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 150) out.push(...await all(() => q(ids.slice(i, i + 150))))
  return out
}

/** The dataset every report is built from, scoped to what `grant` may see. */
export async function loadReportData(sb: any, grant: Grant, company: string | null): Promise<{ ds: Dataset; scope: string }> {
  const co = companyFilter(grant, company)
  const scoped = (t: string, sel = '*', order = 'created_at') => () => { let q = sb.from(t).select(sel).order(order, { ascending: false }); if (co) q = q.eq('company_id', co); return q }
  let [mrfs, candidates] = await Promise.all([all(scoped('manpower_requisitions')), all(scoped('candidates'))])

  const oversight = grant.legacy || grant.isSuperAdmin || grant.crossCompany || (grant.roles || []).some((r: any) => OVERSIGHT_CODES.includes(r.role_code))
  const me = grant.employeeId
  if (!oversight && me) {
    const assigned = (m: any) => Array.isArray(m.assigned_recruiter_ids) && m.assigned_recruiter_ids.includes(me)
    const approver = (m: any) => Array.isArray(m.approval_chain) && m.approval_chain.some((s: any) => s.approver_id === me)
    const mine = new Set(mrfs.filter(m => assigned(m) || m.requested_by === me || approver(m)).map(m => m.id))
    const run = new Set(mrfs.filter(assigned).map(m => m.id))
    mrfs = mrfs.filter(m => mine.has(m.id))
    candidates = candidates.filter(c => c.mrf_id && run.has(c.mrf_id))
  }
  ;({ mrfs, candidates } = hideConfidential(mrfs, candidates, grant as any))

  const cIds = candidates.map(c => c.id), mIds = mrfs.map(m => m.id)
  const byCand = (t: string, sel = '*', order = 'created_at') =>
    allIn(cIds, ch => sb.from(t).select(sel).in('candidate_id', ch).order(order, { ascending: false }))
  const [invites, negotiations, offerRequests, offerLetters, acceptances, docLinks, docs, onboarding, auditC, auditM, companies, departments, locations] = await Promise.all([
    byCand('interview_invites'), byCand('ctc_negotiations'), byCand('offer_approval_requests'), byCand('offer_letters'),
    byCand('offer_acceptances', '*', 'accepted_at'), byCand('document_collection_links'), byCand('candidate_documents_uploaded', '*', 'uploaded_at'),
    byCand('onboarding_candidates', 'id, candidate_id, status, employee_code, date_of_joining, designation, submitted_at, created_at, updated_at'),
    byCand('recruitment_audit_logs'),
    allIn(mIds, ch => sb.from('recruitment_audit_logs').select('*').in('mrf_id', ch).is('candidate_id', null).order('created_at', { ascending: false })),
    all(() => sb.from('companies').select('id, company_name').order('company_name')),
    all(() => sb.from('departments').select('id, dept_name').order('dept_name')),
    all(() => sb.from('locations').select('id, location_name').order('location_name')),
  ])
  // Names for the people the rows mention: raisers, recruiters, rejecters, schedulers.
  const pids = new Set<string>()
  for (const m of mrfs) { if (m.requested_by) pids.add(m.requested_by); for (const r of m.assigned_recruiter_ids || []) pids.add(r) }
  for (const c of candidates) if (c.rejected_by && /^[0-9a-f-]{36}$/.test(c.rejected_by)) pids.add(c.rejected_by)
  for (const i of invites) if (i.scheduled_by && /^[0-9a-f-]{36}$/.test(i.scheduled_by)) pids.add(i.scheduled_by)
  const ppl = await allIn([...pids], ch => sb.from('employees').select('id, full_name, emp_code').in('id', ch).order('id'))

  const map = (rows: any[], k: string) => Object.fromEntries(rows.map(r => [r.id, r[k]]))
  const ds: Dataset = {
    mrfs, candidates, invites, negotiations, offerRequests, offerLetters, acceptances, docLinks, docs, onboarding,
    audit: [...auditC, ...auditM].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    companies: map(companies, 'company_name'), departments: map(departments, 'dept_name'), locations: map(locations, 'location_name'),
    people: Object.fromEntries(ppl.map(p => [p.id, { name: p.full_name, code: p.emp_code }])),
  }
  const scope = `${co ? ds.companies[co] || 'Your company' : 'All companies'}${!oversight && me ? ' · requisitions assigned to you' : ''}`
  return { ds, scope }
}
