import { NextRequest, NextResponse } from 'next/server';
import { essViewerId, resolveEmployeeId } from '@/lib/profile/access';
import { issueToken } from '@/lib/profile/idcard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ess/id-card/token
 * Issues a fresh 30 second QR token for the LOGGED IN employee only.
 * A manager or HR can never pull someone else's live code — that would
 * defeat the point of the card.
 */
export async function GET(req: NextRequest) {
  const viewerId = await essViewerId(req);
  if (!viewerId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const asked = req.nextUrl.searchParams.get('code');
  if (asked && asked !== 'me') {
    const target = await resolveEmployeeId(asked);
    if (target !== viewerId) {
      return NextResponse.json(
        { error: 'forbidden', message: 'A live ID code can only be generated for yourself.' },
        { status: 403 }
      );
    }
  }

  try {
    const t = await issueToken(viewerId);
    return NextResponse.json(t, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' },
    });
  } catch (e: any) {
    const m = String(e.message);
    const status = m === 'rate_limited' ? 429 : m.startsWith('card_') || m === 'no_card' ? 403 : 500;
    const message =
      m === 'rate_limited' ? 'Too many codes requested. Wait a minute.'
      : m === 'card_revoked' ? 'Your ID card has been revoked. Contact HR.'
      : m === 'card_suspended' ? 'Your ID card is suspended.'
      : m === 'no_card' ? 'No ID card has been issued to you yet.'
      : 'Could not generate a code.';
    return NextResponse.json({ error: m, message }, { status });
  }
}
