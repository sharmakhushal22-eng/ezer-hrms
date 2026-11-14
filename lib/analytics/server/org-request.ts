// lib/analytics/server/org-request.ts — one reading of an /api/analytics/org request.
//
// Shared by the figures route and the AI-read route so both apply the SAME gate, the
// same company pinning and the same filters — the AI can never be asked about a
// slice its caller could not open.
//
// Who gets in, and on what, is decided in ./access.ts:
//   * Super Admin — everything.
//   * An analytics_access row (Manage access, migration 232) — exactly the companies,
//     locations, departments, employment types and tabs on the row, with names, pay
//     and downloads as the row says.
//   * A reporting role (Reports / Company Dashboard / ESS Reports) — every company the
//     role covers (companyFilter pins the rest). Pay & cost needs Payroll, Finance or
//     Reports; named people lists need Reports or Employees.
//
// The company, department, location and type picks from the request are only ever
// narrowings of that: a pick outside the limit is ignored, never honoured.

import { NextResponse, type NextRequest } from 'next/server'
import { requireGrant } from '@/lib/rms/authz'
import type { Grant } from '@/lib/rms/resolve'
import { orgAnalytics, type OrgQuery } from './org'
import { isPeriodKey } from '../period'
import { memo } from './memo'
import { orgAccessFor, canManageAnalytics, scopeModuleOf } from './access'
import { redactTabs, type OrgAccess } from '../access'
import type { OrgAnalytics } from '../types'

const uuid = (s: string | null) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null)

/** How long one caller's figures are reused between the page and its AI read. */
const MEMO_MS = 90_000

type Ok = { body: OrgAnalytics; full: OrgAnalytics; access: OrgAccess; grant: Grant; error: null }
type Refused = { body: null; full: null; access: null; grant: null; error: NextResponse }

export async function orgFromRequest(req: NextRequest, opts: { fresh?: boolean } = {}): Promise<Ok | Refused> {
  const refused = (error: NextResponse): Refused => ({ body: null, full: null, access: null, grant: null, error })
  const gate = await requireGrant(req)
  if (gate.error) return refused(gate.error)
  const grant = gate.grant
  const access = await orgAccessFor(grant)
  if (!access) return refused(NextResponse.json({ error: 'People Analytics is not part of your access. Ask HR to give you access.' }, { status: 403 }))

  const sp = req.nextUrl.searchParams
  const period = sp.get('period')
  const q: OrgQuery = {
    company: uuid(sp.get('company')),
    department: (sp.get('department') || '').slice(0, 120) || null,
    location: (sp.get('location') || '').slice(0, 120) || null,
    type: (sp.get('type') || '').slice(0, 40) || null,
    period: isPeriodKey(period) ? period : 'last_12',
    cycle: (sp.get('cycle') || '').slice(0, 40) || null,
  }
  const key = JSON.stringify({ who: grant.employeeId || 'legacy', q, access })
  // The full payload stays on the server: the AI read builds its fact sheet from it and
  // then drops the tabs this reader cannot open (restrictPack). The browser gets the
  // redacted copy.
  const full = await memo(key, MEMO_MS, () => orgAnalytics(grant, scopeModuleOf(grant), q, access), opts.fresh)
  const body = redactTabs(full, access.tabs)
  body.access = { ...body.access, manage: canManageAnalytics(grant), viewer: grant.name }
  return { body, full, access, grant, error: null }
}
