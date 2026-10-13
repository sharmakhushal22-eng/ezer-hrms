// ================================================================
// EZER HRMS — Email a generated letter
// Path: app/api/letters/email/route.ts
// ================================================================
import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { emailGeneratedLetter } from '@/lib/letters/emailLetter'

export const runtime = 'nodejs' // nodemailer needs Node, not Edge

export async function POST(req: NextRequest) {
  // Sends a letter to an employee — an HR Letters action, not an open endpoint.
  const gate = await requireModule(req, 'HR Letters', 'EDIT')
  if (gate.error) return gate.error

  const { generated_letter_id } = await req.json()
  if (!generated_letter_id) return NextResponse.json({ error: 'generated_letter_id required' }, { status: 400 })

  try {
    const result = await emailGeneratedLetter({ generatedLetterId: generated_letter_id })
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
