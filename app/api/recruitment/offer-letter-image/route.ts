// app/api/recruitment/offer-letter-image/route.ts
// Returns the offer letter as a PNG. Used for in-app preview and by the
// send-offer-email route (which attaches the same image to the email).
import { NextRequest, NextResponse } from 'next/server'
import { renderOfferLetterPng, type OfferImageData } from '@/lib/offer-letter-image'

export const runtime = 'nodejs'

function dataFromParams(sp: URLSearchParams): OfferImageData {
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined)
  return {
    candidate_name: sp.get('candidate_name') || undefined,
    designation: sp.get('designation') || undefined,
    company_name: sp.get('company_name') || undefined,
    annual_ctc: num('annual_ctc'),
    variable_pct: num('variable_pct'),
    monthly_basic: num('monthly_basic'),
    monthly_hra: num('monthly_hra'),
    monthly_inhand: num('monthly_inhand'),
    joining_bonus: num('joining_bonus'),
    retention_bonus: num('retention_bonus'),
    esop_value: num('esop_value'),
    proposed_doj: sp.get('proposed_doj') || undefined,
    from_name: sp.get('from_name') || undefined,
  }
}

export async function GET(req: NextRequest) {
  try {
    const png = await renderOfferLetterPng(dataFromParams(new URL(req.url).searchParams))
    return new Response(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    })
  } catch (err: any) {
    console.error('offer-letter-image failed:', err)
    return NextResponse.json({ error: err?.message || 'Failed to render image' }, { status: 500 })
  }
}
