import { NextRequest, NextResponse } from 'next/server';
import { essViewerId, resolveEmployeeId, loadProfile, buildTabs, svc } from '@/lib/profile/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/ess/profile/SRS0512 — masking is done by get_employee_profile(). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const viewerId = await essViewerId(req);
  if (!viewerId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const targetId = code === 'me' ? viewerId : await resolveEmployeeId(code);
  if (!targetId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    const payload = await loadProfile(targetId, viewerId);
    // Sign the photo here so the client never needs the storage bucket directly.
    let photoUrl: string | null = null;
    const pp = (payload as any)?.employee?.photo_path;
    if (pp) {
      const { data: s } = await svc().storage.from('employee-photos').createSignedUrl(pp, 60 * 60 * 8);
      photoUrl = s?.signedUrl ?? null;
    }
    return NextResponse.json(
      { ...payload, tabs: buildTabs(payload), photoUrl, isSelf: targetId === viewerId },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    const m = String(e.message);
    if (m === 'separated') {
      return NextResponse.json(
        { error: m, message: 'Access ended on your last working day.' },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
