// app/api/ess/profile/photo/route.ts
//
//   POST multipart { file }  -> your profile photo, cropped by PhotoUploader
//
// A photo is yours to set — no approval, the Keka / greytHR norm. HR sees the
// new face on the ID card queue like any other change to the record.
//
// WHO: resolved with essRoute through writer(), like every other profile
// write. It used to use essViewerId(), which answers the VIEWED employee in
// view-as — so the shared dashboard login could set anybody's picture.
//
// WHERE IT SHOWS: two columns carry a face, and they had drifted apart.
//   photo_path     the private employee-photos bucket. Profile, ID card,
//                  the printable card and the ID-card admin screens read it.
//   profile_photo  a data URL. The ESS portal's header avatar and hero read it.
// Uploading here used to set only the first, so a new photo appeared on the
// profile and nowhere else in the portal. Both are now written together.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { writer, bad } from '@/lib/profile/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX = 2 * 1024 * 1024        // after the client crops to a square
/** Above this the data URL is not mirrored into profile_photo — a row-sized
 *  base64 blob slows every query that selects it. PhotoUploader's 768px JPEG
 *  at q0.92 is ~120 KB, so in practice it always is. */
const INLINE_MAX = 600 * 1024

export async function POST(req: NextRequest) {
  const w = await writer(req)
  if (w.error) return w.error
  const me = w.me

  let file: File | null = null
  try { file = (await req.formData()).get('file') as File | null } catch { return bad('The upload could not be read.') }
  if (!file || !file.size) return bad('No file was sent.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return bad('Use JPG, PNG or WebP.')
  if (file.size > MAX) return bad('Image is over 2 MB.')

  const { data: prev } = await sb.from('employees').select('photo_path').eq('id', me).maybeSingle()
  const oldPath = (prev as { photo_path?: string | null } | null)?.photo_path ?? null

  const path = `${me}/avatar-${Date.now()}.jpg`
  const buf = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await sb.storage.from('employee-photos')
    .upload(path, buf, { contentType: file.type, upsert: true })
  if (upErr) return bad(upErr.message, 500)

  const patch: Record<string, unknown> = { photo_path: path, photo_updated_at: new Date().toISOString() }
  if (buf.length <= INLINE_MAX) patch.profile_photo = `data:${file.type};base64,${buf.toString('base64')}`
  const { error: dbErr } = await sb.from('employees').update(patch).eq('id', me)
  if (dbErr) {
    await sb.storage.from('employee-photos').remove([path])
    return bad(dbErr.message, 500)
  }
  // The old object is unreachable once the row points elsewhere.
  if (oldPath && oldPath !== path) await sb.storage.from('employee-photos').remove([oldPath])

  const { data: signed } = await sb.storage.from('employee-photos').createSignedUrl(path, 60 * 60 * 8)
  return NextResponse.json({ ok: true, path, url: signed?.signedUrl ?? null })
}
