// app/api/lms/me/catalog/route.ts — the catalogue this person may see.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner } from '@/lib/lms/learner'
import { catalogue } from '@/lib/lms/me'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    return NextResponse.json(await catalogue(learner))
  } catch (e) { return errorResponse(e) }
}
