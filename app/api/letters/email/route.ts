// ================================================================
// EZER HRMS — Email a generated letter
// Path: app/api/letters/email/route.ts
// ================================================================
import { NextRequest, NextResponse } from 'next/server'
import { emailGeneratedLetter } from '@/lib/letters/emailLetter'

export async function POST(req: NextRequest) {
  const { generated_letter_id } = await req.json()
  if (!generated_letter_id) return NextResponse.json({ error: 'generated_letter_id required' }, { status: 400 })

  try {
    const result = await emailGeneratedLetter({ generatedLetterId: generated_letter_id })
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
