// app/api/onboarding/submit/route.ts
// Final submission — validates, moves to HR review (lib/onboarding/submit.ts).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { submitOnboarding } from '@/lib/onboarding/submit'

export const runtime = 'nodejs' // nodemailer needs the Node.js runtime

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

export async function POST(req: NextRequest) {
  try {
    const { token, final_form_data } = await req.json()
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })
    const r = await submitOnboarding(supa, token, final_form_data, req)
    return NextResponse.json(r.body, { status: r.status })
  } catch (err: any) {
    console.error('submit error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
