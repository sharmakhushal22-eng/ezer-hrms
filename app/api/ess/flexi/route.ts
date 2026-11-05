// app/api/ess/flexi/route.ts — an employee's flexi entitlements, in one call.
//
// WHY THIS ROUTE EXISTS
//
// Flexi entitlement resolution is written three times in this product: once in
// lib/flexi/claims.ts, again inside components/ess/EmployeePortal.tsx, and a
// third time in the Android app's repository. All three do the same seven
// steps in the same order, against seven tables read directly on the anon key:
//
//   1. annual fixed = (gross + employer PF + employer ESIC + gratuity) × 12
//   2. the company's slab whose band contains it — else the last slab
//   3. that slab's per-component limits for the employee's regime
//   4. any filed declaration refines them
//   5. a submitted Flexi & TDS form REPLACES them outright, because the
//      employee's own declaration in their chosen regime is authoritative
//   6. admin overrides replace whatever is left
//   7. claims are subtracted to leave what is actually available
//
// Seven steps × three implementations is six chances to drift. Leave already
// proved what that costs. This is the one implementation; the clients render
// what it returns, and POST enforces exactly what GET showed, because both
// call the same resolver below.
//
// flexi_claims is RLS-locked to payroll staff (sql97), which is why the other
// clients fetch claims through /api/flexi/claims with an employee_id in the
// query — one of the routes that still trusts a caller-supplied id. Here the
// service role reads the table directly and the employee comes from the
// session, so no id is passed anywhere.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, forbidden, audit } from '@/lib/ess/session'
import { resolveFlexi, FY, COMP_NAMES, num } from '@/lib/flexi/resolve-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const f = await resolveFlexi(r.ctx.caller.employeeId)

  return NextResponse.json({
    fy: FY,
    regime: f.regime,
    annual_fixed: f.annualFixed,
    slab: f.slab ? { id: f.slab.id, label: f.slab.slab_label } : null,
    window: f.window
      ? {
          id: f.window.id, status: f.window.status, open: f.windowOpen,
          opens_at: f.window.opens_at, closes_at: f.window.closes_at,
        }
      : null,
    heads: f.heads,
    claims: f.claims.slice()
      .sort((a, b) => String(b.bill_date ?? '').localeCompare(String(a.bill_date ?? ''))),
    // Why a head list is empty, which is the common case until HR publishes a
    // policy and the employee files their declaration.
    diagnostics: f.diagnostics,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// POST — submit a claim, against the entitlement this route just worked out
//
// /api/flexi/claims already accepts a SUBMIT, but it takes employee_id from the
// body and checks only the window and that the amount is positive. Nothing
// stops a claim larger than the entitlement the screen displayed. Here the
// employee comes from the session and the limit is enforced against the same
// resolver that produced the number they saw.
// ═══════════════════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  // See app/api/ess/mrf/route.ts for why these are two messages, not one.
  if (ctx.caller.viewAs) {
    return forbidden(ctx.caller.actorEmployeeId === null
      ? 'Your ESS session is not active, so this claim has nobody to file it. '
        + 'Sign in again with your own ESS account.'
      : 'A claim is filed in your own name, so it cannot be submitted while you are '
        + 'viewing somebody else\'s portal. Open your own portal to file one.')
  }

  const me = ctx.caller.employeeId
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })
  const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

  const code = text(body.component_code, 20).toUpperCase()
  const amount = num(body.claim_amount)
  if (!code) return bad('Say which flexi head this claim is against.')
  if (!(amount > 0)) return bad('The claim amount has to be more than zero.')

  const f = await resolveFlexi(me)

  // The window is the 1st–20th of every month, on its own (lib/flexi/window); the claim goes
  // on this month's. Inside it, what refuses a bill is the balance, checked next.
  const windowId = f.window?.id || ''
  if (!windowId) return bad('Your company could not be found, so the claim has nowhere to go. Contact HR.')
  if (!f.windowOpen) return bad(`Bills can be submitted from the 1st to the 20th of the month. The window opens again on ${new Date(`${f.diagnostics.reopensOn}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}.`)

  const head = f.heads.find(h => h.code === code)
  if (!head) {
    return bad(f.diagnostics.noDeclaration
      ? `${COMP_NAMES[code] ?? code} is not one of your flexi heads. File your Flexi & TDS declaration first.`
      : `${COMP_NAMES[code] ?? code} is not one of your flexi heads this year.`)
  }
  if (amount > head.available) {
    return bad(`You have ₹${Math.round(head.available).toLocaleString('en-IN')} of ${head.name} left; this claim is ₹${Math.round(amount).toLocaleString('en-IN')}.`, 409)
  }

  // The same rule /api/flexi/claims applies, so a claim looks the same to
  // payroll whichever door it came through.
  const aiFlag = amount > 15000 ? 'flag' : 'clear'
  const agency = text(body.agency_name) || text(body.vendor_desc) || null

  const { data, error } = await sb.from('flexi_claims').insert({
    window_id: windowId,
    employee_id: me,                       // the session's, never the body's
    company_id: f.companyId,
    component_code: code,
    claim_amount: amount,
    bill_date: text(body.bill_date, 10) || null,
    bill_no: text(body.bill_no, 60) || null,
    agency_name: agency,
    vendor_desc: agency,
    remark: text(body.remark, 500) || null,
    supporting_remark: text(body.supporting_remark, 500) || null,
    status: 'PENDING',
    ai_flag: aiFlag,
    ai_notes: aiFlag === 'flag' ? 'Amount above ₹15,000: manual review recommended' : null,
  }).select('id, status').maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await audit(ctx.caller, 'FLEXI_CLAIM_SUBMITTED', me, { component_code: code, amount })

  const claim = (data ?? null) as { id?: string; status?: string } | null
  return NextResponse.json({
    ok: true,
    claim_id: claim?.id,
    status: claim?.status ?? 'PENDING',
    // What is left after this one, so the screen need not refetch to update.
    available_after: Math.max(0, head.available - amount),
  })
}
