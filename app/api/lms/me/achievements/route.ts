// app/api/lms/me/achievements/route.ts — certificates, results and history.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner } from '@/lib/lms/learner'
import { achievements } from '@/lib/lms/me'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    return NextResponse.json(await achievements(learner))
  } catch (e) { return errorResponse(e) }
}
