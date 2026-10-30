// src/features/orgchart/api.ts — the org chart's reads, as the website's
// app/dashboard/org-chart/page.tsx makes them. Nothing here writes.
//
//   who am I        GET /api/rms/me                      (useGrant)
//   companies       supabase companies, status Active     (direct anon read, as the web)
//   own company     supabase employees.company_id         (direct anon read, as the web)
//   the tree        GET /api/rms/orgchart?company_id=X|ALL
//   diagnostics     GET /api/rms/orgchart?view=orphans|span&company_id=X
import { api } from '@/core/api'
import { supabase } from '@/core/supabase'
import { emptyGrant, scopedCompanies, type Grant } from '@web/rms/resolve'

export interface OrgTreeNode {
  id: string
  companyId: string
  empCode: string | null
  fullName: string | null
  designation: string | null
  department: string | null
  grade: string | null
  managerId: string | null
  depth: number
  directReports: number
  isHod: boolean
}
export interface Company { id: string; company_name: string }
export interface Orphan { emp_code: string; full_name: string; designation: string | null; department: string | null }
export interface SpanRow { emp_code: string; full_name: string; direct_reports: number; department: string | null }

/** lib/rms/client.ts loadGrant(): a network failure must not read as "holds
 *  nothing" — the website keeps the viewer in, unenforced. */
export async function loadGrant(employeeId: string): Promise<Grant> {
  try {
    const j = await api<{ grant?: Grant }>('/api/rms/me')
    return (j?.grant as Grant) || emptyGrant()
  } catch {
    return { ...emptyGrant(), employeeId, enforced: false, resolved: false }
  }
}

/** The page's mount effect: the company list (scoped to the viewer) and the
 *  default selection — own company if it is in the list, else the first. */
export async function loadCompanies(grant: Grant): Promise<{ list: Company[]; initial: string }> {
  const { data } = await supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
  const list = scopedCompanies(grant, (data || []) as Company[])
  let own: string | null = null
  if (grant.employeeId) {
    const { data: me } = await supabase.from('employees').select('company_id').eq('id', grant.employeeId).maybeSingle()
    own = (me as { company_id?: string | null } | null)?.company_id ?? null
  }
  return { list, initial: list.some(c => c.id === own) ? own! : list[0]?.id ?? '' }
}

/** '' = All companies → the API's explicit ALL token. Falls back to an empty
 *  tree on failure, as the website does. */
export async function loadTree(companyId: string): Promise<OrgTreeNode[]> {
  try {
    const res = await api<{ tree?: OrgTreeNode[] }>('/api/rms/orgchart', { query: { company_id: companyId || 'ALL' } })
    return res?.tree || []
  } catch { return [] }
}

export async function loadDiagnostics(companyId: string): Promise<{ orphans: Orphan[]; span: SpanRow[] }> {
  // The website passes company_id=<id> even when it is '' (All): both RPCs read
  // an empty value as "no company filter".
  const path = (view: string) => `/api/rms/orgchart?view=${view}&company_id=${encodeURIComponent(companyId)}`
  const [o, s] = await Promise.all([
    api<{ orphans?: Orphan[] }>(path('orphans')).catch(() => ({ orphans: [] as Orphan[] })),
    api<{ span?: SpanRow[] }>(path('span')).catch(() => ({ span: [] as SpanRow[] })),
  ])
  return { orphans: o?.orphans || [], span: s?.span || [] }
}
