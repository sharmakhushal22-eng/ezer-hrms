// app/api/lms/admin/enrollments/[id]/route.ts — HR's actions on one person's enrolment.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin } from '@/lib/lms/access'
import { enrollmentAction } from '@/lib/lms/assign'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { actor, error } = await lmsAdmin(req, 'assign')
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json(await enrollmentAction(actor, (await params).id, String(b.action || ''), b))
  } catch (e) { return errorResponse(e) }
}
