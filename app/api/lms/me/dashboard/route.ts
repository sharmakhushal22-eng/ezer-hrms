// app/api/lms/me/dashboard/route.ts — My Learning.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner } from '@/lib/lms/learner'
import { dashboard } from '@/lib/lms/me'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    return NextResponse.json(await dashboard(learner))
  } catch (e) { return errorResponse(e) }
}
