// app/api/onboarding/save-progress/route.ts
// Auto-saves form step data and advances step
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  try {
    const { token, step, data } = await req.json()
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

    const { data: cand, error } = await supa
      .from('onboarding_candidates')
      .select('id, form_data, current_step, status')
      .eq('magic_link_token', token)
      .single()

    if (error || !cand) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
    if (!['IN_PROGRESS', 'INVITED'].includes(cand.status)) {
      return NextResponse.json({ error: 'Form already submitted' }, { status: 409 })
    }

    // Merge step data into form_data
    const existing = (cand.form_data as any) || {}
    const merged   = { ...existing, [`step_${step}`]: data, last_saved_at: new Date().toISOString() }
    const nextStep = Math.max(cand.current_step, step + 1)

    await supa.from('onboarding_candidates').update({
      form_data:    merged,
      current_step: nextStep,
    }).eq('id', cand.id)

    // Save statutory forms if step 7
    if (step === 7 && data) {
      const formsToSave = [
        { form_type: 'EPF_FORM11', form_data: { ...data.pf_details, nominee: data.pf_nominee } },
        { form_type: 'EPF_FORM2',  form_data: data.pf_nominee || {} },
        { form_type: 'BANK_MANDATE', form_data: data.bank_details || {} },
        ...(data.esic_applicable ? [{ form_type: 'ESIC_FORM1', form_data: data.esic_details || {} }] : []),
        ...(data.mid_year_joining ? [{ form_type: 'FORM_12B', form_data: data.prev_salary_details || {} }] : []),
      ]
      for (const f of formsToSave) {
        await supa.from('onboarding_statutory_forms').upsert({
          onboarding_id: cand.id,
          form_type:     f.form_type,
          form_data:     f.form_data,
          submitted_at:  new Date().toISOString(),
        }, { onConflict: 'onboarding_id,form_type' })
      }
    }

    return NextResponse.json({ success: true, current_step: nextStep })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
