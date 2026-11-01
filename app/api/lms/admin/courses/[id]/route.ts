// app/api/lms/admin/courses/[id]/route.ts — one course: read, edit, and move through its life.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin } from '@/lib/lms/access'
import { courseAction, courseDetail, saveRules, updateCourse } from '@/lib/lms/authoring'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { actor, error } = await lmsAdmin(req, 'viewContent')
  if (error) return error
  try { return NextResponse.json(await courseDetail(actor, (await params).id, req.nextUrl.searchParams.get('version'))) }
  catch (e) { return errorResponse(e) }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { actor, error } = await lmsAdmin(req, 'editContent')
  if (error) return error
  try {
    const b = await req.json()
    if (b.version_id) await saveRules(actor, b.version_id, b.rules || {})
    await updateCourse(actor, (await params).id, b)
    return NextResponse.json({ ok: true })
  } catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { actor, error } = await lmsAdmin(req, 'editContent')
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json(await courseAction(actor, (await params).id, String(b.action || ''), b))
  } catch (e: any) {
    if (e?.problems) return NextResponse.json({ error: e.message, problems: e.problems }, { status: 422 })
    return errorResponse(e)
  }
}
