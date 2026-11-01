// app/api/lms/me/catalog/[id]/route.ts — a course's page, before enrolling.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner } from '@/lib/lms/learner'
import { courseInfo } from '@/lib/lms/me'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    return NextResponse.json(await courseInfo(learner, (await params).id))
  } catch (e) { return errorResponse(e) }
}
