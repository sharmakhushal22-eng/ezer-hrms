// lib/analytics/server/org-request.ts — one reading of an /api/analytics/org request.
//
// Shared by the figures route and the AI-read route so both apply the SAME gate, the
// same company pinning and the same filters — the AI can never be asked about a
// slice its caller could not open.
//
// Gate: any one of the reporting permissions — Reports (the dashboard module the CFO /
// MD roles are given), Company Dashboard or ESS Reports (the ESS-side views HR heads
// hold). The company is never taken from the request on trust: companyFilter() pins
// everyone who is not cross-company to the companies their roles cover.
//
// Two slices are narrower than the gate:
//   * Pay & cost needs Payroll, Finance or Reports — salary totals are not a Company
//     Dashboard matter.
//   * Named people (flight risk, late-comers, probation lists) need Reports or
//     Employees. Holders of the ESS views alone get the counts, not the names.

import type { NextRequest, NextResponse } from 'next/server'
import { requireAccess, holds, holdsAny } from '@/lib/rms/authz'
import type { Module } from '@/lib/rms/modules'
import type { Grant } from '@/lib/rms/resolve'
import { orgAnalytics, type OrgQuery } from './org'
import { isPeriodKey } from '../period'
import { memo } from './memo'
import type { OrgAnalytics } from '../types'

const GATE: Module[] = ['Reports', 'Company Dashboard', 'ESS Reports']
const uuid = (s: string | null) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null)

/** How long one caller's figures are reused between the page and its AI read. */
const MEMO_MS = 90_000

export async function orgFromRequest(req: NextRequest, opts: { fresh?: boolean } = {}):
  Promise<{ body: OrgAnalytics; grant: Grant; error: null } | { body: null; grant: null; error: NextResponse }> {
  const { grant, error } = await requireAccess(req, GATE, 'VIEW')
  if (error) return { body: null, grant: null, error }

  const sp = req.nextUrl.searchParams
  const period = sp.get('period')
  // The module whose company scope applies: the first reporting permission they hold.
  const scopeModule = GATE.find(m => holds(grant, m)) as Module
  const access = {
    cost: holdsAny(grant, ['Payroll', 'Finance', 'Reports']),
    people: holdsAny(grant, ['Reports', 'Employees']),
  }
  const q: OrgQuery = {
    company: uuid(sp.get('company')),
    department: (sp.get('department') || '').slice(0, 120) || null,
    location: (sp.get('location') || '').slice(0, 120) || null,
    type: (sp.get('type') || '').slice(0, 40) || null,
    period: isPeriodKey(period) ? period : 'last_12',
    cycle: (sp.get('cycle') || '').slice(0, 40) || null,
  }
  const key = JSON.stringify({ who: grant.employeeId || 'legacy', q, access })
  const body = await memo(key, MEMO_MS, () => orgAnalytics(grant, scopeModule, q, access), opts.fresh)
  return { body, grant, error: null }
}
