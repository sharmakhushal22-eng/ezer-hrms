// app/api/recruitment/pincode/route.ts
//
//   GET ?pin=560011  ->  { ok, pin, city, state, country, area }
//
// PIN-code lookup for the Add Candidate address block: city / state / country
// auto-fill once a 6-digit PIN is typed. Uses India Post's public directory
// (api.postalpincode.in), proxied server-side so the browser has no CORS or
// rate-limit exposure, with a small in-memory cache per instance. The state name is
// normalised to the spelling the State dropdown uses (lib/recruitment/min-wages).

import { NextRequest, NextResponse } from 'next/server'
// Guarded: an unauthenticated caller must not reach this. See docs/security/open-endpoints.md.
import { requireModule } from '@/lib/api-auth'
import { normalizeStateName } from '@/lib/recruitment/min-wages'

export const runtime = 'nodejs'

type Hit = { ok: true; pin: string; city: string; state: string; country: string; area: string }
const cache = new Map<string, Hit | { ok: false }>()

export async function GET(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')
  if (gate.error) return gate.error

  const pin = (req.nextUrl.searchParams.get('pin') || '').replace(/\D/g, '')
  if (!/^\d{6}$/.test(pin)) return NextResponse.json({ ok: false, error: 'A 6-digit PIN code is required' }, { status: 400 })
  const hit = cache.get(pin)
  if (hit) return NextResponse.json(hit)
  try {
    const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } } as any)
    const j = await r.json().catch(() => null) as any
    const po = Array.isArray(j) && j[0]?.Status === 'Success' && Array.isArray(j[0].PostOffice) ? j[0].PostOffice[0] : null
    if (!po) { cache.set(pin, { ok: false }); return NextResponse.json({ ok: false, pin, error: 'PIN code not found' }) }
    const out: Hit = {
      ok: true, pin,
      city: String(po.District || po.Block || po.Division || '').trim(),
      state: normalizeStateName(po.State) || String(po.State || '').trim(),
      country: String(po.Country || 'India').trim(),
      area: String(po.Name || '').trim(),
    }
    cache.set(pin, out)
    return NextResponse.json(out)
  } catch {
    return NextResponse.json({ ok: false, pin, error: 'Lookup unavailable — fill the address manually' }, { status: 502 })
  }
}
