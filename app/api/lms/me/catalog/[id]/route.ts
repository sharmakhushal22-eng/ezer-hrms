// app/api/lms/me/catalog/[id]/route.ts — a course's page, before enrolling. With
// ?preview=<lesson id>, one of its free-preview lessons, ready to watch or read.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner } from '@/lib/lms/learner'
import { courseInfo, previewLesson } from '@/lib/lms/me'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    const id = (await params).id
    const preview = req.nextUrl.searchParams.get('preview')
    if (preview) return NextResponse.json(await previewLesson(learner, id, preview))
    return NextResponse.json(await courseInfo(learner, id))
  } catch (e) { return errorResponse(e) }
}
