import { verifyToken } from '@/lib/profile/idcard';
import { svc } from '@/lib/profile/access';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /verify/<token> — what the guard's camera opens.
 * Rendering this page CONSUMES the token. Reload and it reports "already used",
 * which is exactly what should happen to a forwarded screenshot.
 */
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const res = await verifyToken(decodeURIComponent(token), {
    gate: h.get('x-gate-id') ?? undefined,
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim(),
    ua: h.get('user-agent') ?? undefined,
  });

  let photo: string | null = null;
  if (res.valid && res.photo_path) {
    const { data } = await svc().storage
      .from('employee-photos').createSignedUrl(res.photo_path, 120);
    photo = data?.signedUrl ?? null;
  }

  const good = res.valid;
  return (
    <main style={{
      minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 20,
      background: good ? '#ECFDF5' : '#FEF2F2',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif',
    }}>
      <div style={{
        width: '100%', maxWidth: 380, background: '#fff', borderRadius: 26, padding: 26,
        textAlign: 'center', boxShadow: '0 24px 60px -22px rgba(15,23,42,.3)',
        border: `1px solid ${good ? '#A7F3D0' : '#FECACA'}`,
      }}>
        <div style={{
          width: 62, height: 62, margin: '0 auto 14px', borderRadius: '50%',
          display: 'grid', placeItems: 'center', fontSize: 30, color: '#fff',
          background: good ? '#059669' : '#DC2626',
        }}>{good ? '✓' : '✕'}</div>

        <h1 style={{ margin: 0, fontSize: 19, letterSpacing: '-.02em' }}>
          {good ? 'Verified' : 'Not verified'}
        </h1>

        {good ? (
          <>
            <div style={{
              width: 96, height: 96, margin: '18px auto 12px', borderRadius: 28, overflow: 'hidden',
              background: 'linear-gradient(150deg,#3B82F6,#1D4ED8)', display: 'grid',
              placeItems: 'center', color: '#fff', fontSize: 32, fontWeight: 700,
            }}>
              {photo
                ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (res.name ?? '').split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{res.name}</div>
            <div style={{ color: '#64748B', fontSize: 13.5, marginTop: 2 }}>{res.designation}</div>
            <div style={{
              fontFamily: 'ui-monospace,monospace', marginTop: 10, fontSize: 13,
              background: '#EFF6FF', color: '#1E3A8A', padding: '7px 12px',
              borderRadius: 999, display: 'inline-block',
            }}>{res.employee_code} · {res.card_no}</div>

            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
              {(res.access_zones ?? []).map(z => (
                <span key={z} style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 999,
                  background: '#F1F5F9', color: '#334155',
                }}>{z}</span>
              ))}
            </div>

            <p style={{ color: '#64748B', fontSize: 12, marginTop: 16, lineHeight: 1.6 }}>
              Scanned {new Date(res.scanned_at ?? Date.now()).toLocaleTimeString('en-IN')}.
              This code is now used and cannot be scanned again.
            </p>
          </>
        ) : (
          <p style={{ color: '#7F1D1D', fontSize: 14, marginTop: 12, lineHeight: 1.6 }}>
            {res.reason}
          </p>
        )}

        <div style={{ marginTop: 18, fontSize: 11, color: '#94A3B8' }}>EZER HRMS · identity check</div>
      </div>
    </main>
  );
}
