import { NextRequest, NextResponse } from 'next/server';
import { essViewerId, svc } from '@/lib/profile/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 2 * 1024 * 1024; // 2 MB, after the client crops to 512x512

/** POST /api/ess/profile/photo  (multipart: file) -> employee-photos bucket. */
export async function POST(req: NextRequest) {
  const viewerId = await essViewerId(req);
  if (!viewerId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return NextResponse.json({ error: 'bad_type', message: 'Use JPG, PNG or WebP.' }, { status: 400 });
  }
  if (file.size > MAX) {
    return NextResponse.json({ error: 'too_large', message: 'Image is over 2 MB.' }, { status: 400 });
  }

  const db = svc();
  const path = `${viewerId}/avatar-${Date.now()}.jpg`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await db.storage
    .from('employee-photos')
    .upload(path, buf, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await db.from('employees')
    .update({ photo_path: path, photo_updated_at: new Date().toISOString() })
    .eq('id', viewerId);

  const { data: signed } = await db.storage
    .from('employee-photos').createSignedUrl(path, 60 * 60 * 8);

  return NextResponse.json({ ok: true, path, url: signed?.signedUrl ?? null });
}
