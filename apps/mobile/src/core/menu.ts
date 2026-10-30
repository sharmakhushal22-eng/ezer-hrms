// src/core/menu.ts — /api/ess/menu, the nav as data.
//
// The website's useEssMenu() (components/ess/RoleTabs.tsx) reads the same
// endpoint. It is a convenience for the UI, never the authorization — every route
// re-checks on the server — so a section hidden here is also refused there.
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useEmployeeId } from './session'

export interface EssMenu {
  tabs: { id: string; label: string }[]
  is_rm: boolean
  direct_reports: number
  is_hod: boolean
  hod_departments: string[]
  roles: { code: string; name: string; scope: string }[]
  functional_scope: string
  approval_types: string[]
  modules: Record<string, number>
  can: { approvals: boolean; company: boolean; reports: boolean }
  screens?: { allow: Record<string, boolean>; configured: Record<string, boolean> }
  super_admin: boolean
  view_as: boolean
}

export const EMPTY_MENU: EssMenu = {
  tabs: [], is_rm: false, direct_reports: 0, is_hod: false, hod_departments: [], roles: [], functional_scope: 'SELF',
  approval_types: [], modules: {}, can: { approvals: false, company: false, reports: false }, super_admin: false, view_as: false,
}

export function useMenu() {
  const employeeId = useEmployeeId()
  const q = useQuery({
    queryKey: ['menu', employeeId],
    queryFn: () => api<EssMenu>('/api/ess/menu', { employeeId }),
    enabled: !!employeeId,
    staleTime: 5 * 60_000,
  })
  return { menu: q.data || EMPTY_MENU, loaded: !!q.data, error: q.error, refetch: q.refetch }
}

/** EmployeePortal.tsx canRaiseMrf — matches POST /api/ess/mrf action:'create' exactly. */
export const canRaiseMrf = (m: EssMenu) => m.is_rm || m.is_hod || m.can.approvals
