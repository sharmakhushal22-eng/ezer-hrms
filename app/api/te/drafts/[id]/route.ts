// DELETE /api/te/drafts/[id] — discard unfinished work, or clear the draft once
// the real trip or expense has been saved.
//
// Ownership is the filter inside te_draft_delete, not a check here, so another
// person's id deletes nothing and is reported as nothing deleted. Quiet about
// an id that has already gone: finishing a form and clearing its draft twice
// is not a failure worth showing anybody.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needUuid } from '@/lib/te/errors'
import { draftDelete } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => draftDelete(await t.ctx(), needUuid(id, 'Draft')))
}
