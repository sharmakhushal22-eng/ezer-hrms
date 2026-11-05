// app/api/lms/admin/preview/route.ts — one lesson's files for the builder's "Preview as
// learner", draft or live. Reading only: nothing about any learner changes.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin } from '@/lib/lms/access'
import { previewLesson } from '@/lib/lms/preview'
import { LmsError, errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'viewContent')
  if (error) return error
  try {
    const id = req.nextUrl.searchParams.get('lesson') || ''
    if (!id) throw new LmsError('Choose a lesson.')
    return NextResponse.json(await previewLesson(actor, id))
  } catch (e) { return errorResponse(e) }
}
