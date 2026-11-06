// app/api/lms/admin/assets/route.ts — the file library. POST starts a direct-to-storage
// upload, PATCH confirms it arrived.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies, writeCompany } from '@/lib/lms/access'
import { beginUpload, finishUpload, listAssets } from '@/lib/lms/authoring'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'viewContent')
  if (error) return error
  try {
    const sp = req.nextUrl.searchParams
    return NextResponse.json({ assets: await listAssets(await readCompanies(actor, sp.get('company')), sp.get('kind')) })
  } catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, ['editContent', 'assign'])
  if (error) return error
  try {
    const b = await req.json()
    // A webinar's recording is uploaded by whoever runs the session, who may assign learning
    // without editing courses. That is a video and nothing else.
    const recording = b.purpose === 'recording' && b.kind === 'VIDEO'
    if (!actor.caps.editContent && !recording) return NextResponse.json({ error: 'Uploading course files needs Learning Content.' }, { status: 403 })
    return NextResponse.json(await beginUpload(actor, writeCompany(actor, b.company_id, actor.caps.editContent ? 'editContent' : 'assign'), b))
  } catch (e) { return errorResponse(e) }
}

export async function PATCH(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, ['editContent', 'assign'])
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json({ asset: await finishUpload(actor, String(b.asset_id || ''), b) })
  } catch (e) { return errorResponse(e) }
}
