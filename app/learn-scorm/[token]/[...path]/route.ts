// app/learn-scorm/[token]/[...path]/route.ts — one file of a SCORM package, for the player's
// sandboxed frame. The token is the permission (lib/lms/scorm.ts); it sits in the path so that
// every relative link inside the package carries it.
import { serveFile } from '@/lib/lms/scorm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ token: string; path: string[] }> }

async function handle(req: Request, { params }: Ctx) {
  const { token, path } = await params
  try { return await serveFile(token, path, req) }
  catch (e) {
    console.error('[lms] scorm file', e)
    return new Response('This file could not be loaded. Try again.', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' } })
  }
}

export const GET = handle
export const HEAD = handle
