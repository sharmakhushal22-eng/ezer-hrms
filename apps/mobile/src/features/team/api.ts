// src/features/team/api.ts — the Team section's reads, exactly as the website
// makes them (components/ess/team/MyTeam.tsx, TeamRoster.tsx, lib/rms/client.ts
// useManagerChain). Nothing here writes.
import { api } from '@/core/api'

export interface ManagerSlot {
  relationship_type: 'L1' | 'L2' | 'L3' | 'L4' | 'HOD'
  manager: { id: string; emp_code: string | null; full_name: string | null; designation: string | null; department: string | null } | null
}
export interface Peer { id: string; full_name: string; designation: string | null; department: string | null; isSelf: boolean; direct_reports: number }
export interface Report { id: string; emp_code: string | null; full_name: string | null; designation: string | null; department: string | null }
export interface RosterRow {
  id: string; code: string | null; name: string; designation: string | null; department: string | null
  direct: boolean; status: string; tone: 'ok' | 'warn' | 'info'
}

/** useManagerChain(): GET /api/rms/hierarchy?employee_id=… MyTeam ignores the
 *  hook's error, so a failure reads the same as "nobody above you". */
export async function loadChain(employeeId: string): Promise<ManagerSlot[]> {
  try {
    const j = await api<{ managers?: ManagerSlot[] }>('/api/rms/hierarchy', { employeeId })
    return j?.managers || []
  } catch { return [] }
}

/** GET /api/rms/orgchart?view=peers — `.catch(() => ({}))` on the website, so a
 *  403 under module enforcement shows "no team-mates". peersFor() already
 *  camel-cases the RPC columns (isSelf, directReports). */
export async function loadPeers(employeeId: string): Promise<Peer[]> {
  try {
    const j = await api<{ peers?: any[] }>('/api/rms/orgchart', { query: { view: 'peers' }, employeeId })
    return (j?.peers || []).map((p: any) => ({
      id: p.id, full_name: p.full_name, designation: p.designation,
      department: p.department, isSelf: !!p.isSelf, direct_reports: p.directReports || 0,
    }))
  } catch { return [] }
}

/** GET /api/rms/hierarchy?employee_id=…&view=reports — also `.catch(() => ({}))`. */
export async function loadReports(employeeId: string): Promise<Report[]> {
  try {
    const j = await api<{ reports?: Report[] }>('/api/rms/hierarchy', { query: { view: 'reports' }, employeeId })
    return j?.reports || []
  } catch { return [] }
}

/** TeamRoster: api(`/api/ess/team?scope=${scope}`, employeeId). Errors surface as
 *  the server's message (shown in the warning note). */
export async function loadRoster(employeeId: string, scope: 'TEAM' | 'DEPT'): Promise<RosterRow[]> {
  const d = await api<{ rows?: RosterRow[] }>('/api/ess/team', { query: { scope }, employeeId })
  return d?.rows || []
}
