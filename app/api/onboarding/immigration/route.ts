// app/api/onboarding/immigration/route.ts — the immigration tracker (Onboarding → Compliance):
// every foreign national / overseas employee of the caller's companies with their passport,
// visa, work permit, FRRO and SSA dates and the days left. lib/onboarding/immigration.ts.
//   GET ?company_id=…   (optional; the caller's company scope applies)
// Guarded by the Onboarding module.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { requireModule } from '@/lib/api-auth'
import { grantForRequest } from '@/lib/rms/server'
import { companyFilter } from '@/lib/rms/resolve'
import { trackedEmployees } from '@/lib/onboarding/immigration'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Onboarding')
  if (gate.error) return gate.error
  const grant = await grantForRequest(req)
  const company = companyFilter(grant, req.nextUrl.searchParams.get('company_id') || null)
  const people = await trackedEmployees(sb as any, company || null)
  return NextResponse.json({ people, generated_at: new Date().toISOString() })
}
