// app/api/lms/admin/sessions/[id]/route.ts — one live session: its register, edits, and the
// host's actions (invite, attendance, recording, held, cancelled).
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin } from '@/lib/lms/access'
import {
  cancelSession, completeSession, inviteToSession, markAttendance, removeAttendee, sessionDetail, setRecording, updateSession,
} from '@/lib/lms/live'
import { errorResponse, LmsError } from '@/lib/lms/server'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { actor, error } = await lmsAdmin(req, 'viewAssignments')
  if (error) return error
  try { return NextResponse.json(await sessionDetail(actor, (await params).id)) }
  catch (e) { return errorResponse(e) }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { actor, error } = await lmsAdmin(req, 'assign')
  if (error) return error
  try { return NextResponse.json(await updateSession(actor, (await params).id, await req.json())) }
  catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { actor, error } = await lmsAdmin(req, 'assign')
  if (error) return error
  try {
    const id = (await params).id
    const b = await req.json()
    switch (b.action) {
      case 'invite': return NextResponse.json(await inviteToSession(actor, id, b))
      case 'remove': return NextResponse.json(await removeAttendee(actor, id, String(b.learner_id || '')))
      case 'attendance': return NextResponse.json(await markAttendance(actor, id, b))
      case 'recording': return NextResponse.json(await setRecording(actor, id, b.asset_id || null))
      case 'complete': return NextResponse.json(await completeSession(actor, id))
      case 'cancel': return NextResponse.json(await cancelSession(actor, id, String(b.reason || '').trim()))
      default: throw new LmsError('Unknown action.')
    }
  } catch (e) { return errorResponse(e) }
}
