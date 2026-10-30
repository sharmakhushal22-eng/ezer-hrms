// app/api/onboarding/approvers/route.ts — who acts for each onboarding approval, per company.
//
//   GET ?company_ids=a,b   → { holders: { [company_id]: { HR_MANAGER: [...], IT: [...], ADMIN: [...], PAYROLL: [...] } } }
//                            each entry { name, code } — the employees holding the team's ESS role
//                            (lib/onboarding/approvals.ts TEAM_ROLES), active, in that company
//
// Read-only. Feeds the approvals popover on the onboarding table (who has it now, who approved).
// Guarded by the Onboarding module (VIEW); a company-pinned caller only ever gets their own company.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb, grantForRequest } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { companyFilter } from '@/lib/rms/resolve'
import { TEAMS, TEAM_ROLES, type Team } from '@/lib/onboarding/approvals'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Holder = { name: string; code: string | null }

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Onboarding')
  if (gate.error) return gate.error
  const grant = await grantForRequest(req)
  const pinned = companyFilter(grant, null, 'Onboarding')
  const asked = String(req.nextUrl.searchParams.get('company_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
  const companies = [...new Set(pinned ? asked.filter(c => c === pinned) : asked)].slice(0, 50)
  if (!companies.length) return NextResponse.json({ holders: {} })

  // One pass for every team: the roles, then who holds them (active), then group by company.
  const codes = [...new Set(TEAMS.flatMap(t => TEAM_ROLES[t]))]
  const { data: roles, error: rErr } = await sb.from('ess_roles').select('id, role_code').in('role_code', codes)
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
  const codeOf = new Map<string, string>((roles || []).map((r: any) => [r.id, r.role_code]))
  if (!codeOf.size) return NextResponse.json({ holders: {} })
  const { data: urs, error: uErr } = await sb.from('ess_user_roles')
    .select('role_id, ess_accounts!inner(employees!inner(id, full_name, emp_code, company_id, employment_status))')
    .in('role_id', [...codeOf.keys()]).eq('is_active', true)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  const wanted = new Set(companies)
  const out: Record<string, Partial<Record<Team, Holder[]>>> = {}
  const seen = new Set<string>()
  for (const u of (urs || []) as any[]) {
    const e = u.ess_accounts?.employees
    if (!e || !wanted.has(e.company_id)) continue
    // Somebody who has left keeps their role row until it is cleaned up; they do not act for a team.
    if (e.employment_status && /exit|resign|separat|terminat|inactive|left/i.test(String(e.employment_status))) continue
    const code = codeOf.get(u.role_id)
    for (const t of TEAMS) {
      if (!code || !TEAM_ROLES[t].includes(code)) continue
      const k = `${e.company_id}|${t}|${e.id}`
      if (seen.has(k)) continue
      seen.add(k)
      const byTeam = (out[e.company_id] ||= {})
      ;(byTeam[t] ||= []).push({ name: e.full_name, code: e.emp_code || null })
    }
  }
  for (const byTeam of Object.values(out)) for (const list of Object.values(byTeam)) list?.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ holders: out })
}
