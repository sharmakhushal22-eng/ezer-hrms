// app/api/onboarding/forms/route.ts — a statutory form, filled from the onboarding record.
//
//   GET ?form=form11|form2|esic1|formf &token=<magic link>          the candidate, from the portal
//   GET ?form=…               &onboarding_id=<id>             HR, from the review sheet (Onboarding module)
//   &mode=download                                           attachment instead of inline
//
// EPF Form 11, EPF Form 2 (Part A + EPS Part B) and ESIC Form 1 are the official blanks in
// public/statutory-forms/ with the details drawn on (lib/onboarding/statutory-forms.ts). The
// Aadhaar number comes from the Aadhaar front's AI extraction when the form has none; the
// passport photo goes on the ESIC temporary identity card.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireModule } from '@/lib/api-auth'
import { FORMS, isFormKey, loadStatutory, renderStatutoryForm } from '@/lib/onboarding/statutory-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!)

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const form = q.get('form') || ''
  if (!isFormKey(form)) return NextResponse.json({ error: 'form must be form11, form2, esic1 or formf' }, { status: 400 })
  const token = q.get('token') || '', onboardingId = q.get('onboarding_id') || ''
  if (!token && !onboardingId) return NextResponse.json({ error: 'token or onboarding_id required' }, { status: 400 })
  if (!token) {
    const gate = await requireModule(req, 'Onboarding')
    if (gate.error) return gate.error
  }
  const l = await loadStatutory(supa, token ? { token } : { id: onboardingId }, { photo: form === 'esic1' })
  if (!l) return NextResponse.json({ error: 'Onboarding record not found' }, { status: 404 })

  try {
    const bytes = await renderStatutoryForm(form, l.data, { photo: l.photo })
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${q.get('mode') === 'download' ? 'attachment' : 'inline'}; filename="${FORMS[form].filename(l.data)}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e: any) {
    console.error('statutory form render failed', form, e)
    return NextResponse.json({ error: e?.message || 'Could not render the form' }, { status: 500 })
  }
}
