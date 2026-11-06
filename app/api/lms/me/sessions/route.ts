// app/api/lms/me/sessions/route.ts — the live sessions this learner can see.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner } from '@/lib/lms/learner'
import { mySessions } from '@/lib/lms/live'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    return NextResponse.json(await mySessions(learner))
  } catch (e) { return errorResponse(e) }
}
