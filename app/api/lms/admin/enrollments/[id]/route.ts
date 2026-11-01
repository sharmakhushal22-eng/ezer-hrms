// app/api/lms/admin/enrollments/[id]/route.ts — HR's actions on one person's enrolment, and
// the quizzes on it, which is how HR finds the one to grant more attempts on.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin } from '@/lib/lms/access'
import { enrollmentAction, enrollmentQuizzes } from '@/lib/lms/assign'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { actor, error } = await lmsAdmin(req, 'viewAssignments')
  if (error) return error
  try { return NextResponse.json({ quizzes: await enrollmentQuizzes(actor, (await params).id) }) }
  catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { actor, error } = await lmsAdmin(req, 'assign')
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json(await enrollmentAction(actor, (await params).id, String(b.action || ''), b))
  } catch (e) { return errorResponse(e) }
}
