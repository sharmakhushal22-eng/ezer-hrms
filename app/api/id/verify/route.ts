import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/profile/idcard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/id/verify   { token, gate? }
 * Open endpoint — the gate device or a guard's phone calls it.
 * It CONSUMES the token, so the same code cannot be verified twice.
 * Returns only name, code, photo, designation and access zones.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token ?? '');
  if (!token) return NextResponse.json({ valid: false, reason: 'No code supplied.' }, { status: 400 });

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') || undefined;

  const result = await verifyToken(token, {
    gate: body.gate ?? req.headers.get('x-gate-id') ?? undefined,
    ip,
    ua: req.headers.get('user-agent') ?? undefined,
  });

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
