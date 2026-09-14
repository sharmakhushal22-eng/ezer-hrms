// app/verify/[token]/page.tsx — what the guard's camera opens.
//
// A phone camera pointed at the QR lands here. It must answer one question,
// from arm's length, in a second: let this person through, or not.
//
// So it is a full-bleed green or red screen with the name large. No EZER
// chrome, no navigation, nothing to tap by accident. It is rendered on the
// SERVER and consumes the token during the render, which means the code is
// spent by the time the page reaches the phone — a screenshot of this screen
// verifies nothing.

import { verifyToken } from '@/lib/profile/idcard'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function Verify({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const h = await headers()
  const r = await verifyToken(decodeURIComponent(token), {
    gate: h.get('x-gate-id') ?? undefined,
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim(),
    ua: h.get('user-agent') ?? undefined,
  })

  const ok = r.valid
  const bg = ok ? '#065F46' : '#7F1D1D'
  const chip = ok ? '#10B981' : '#F87171'

  return (
    <main style={{
      minHeight: '100dvh', background: bg, color: '#fff', display: 'grid',
      placeItems: 'center', padding: 24, textAlign: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ maxWidth: 460, width: '100%' }}>
        <div style={{
          width: 84, height: 84, borderRadius: '50%', margin: '0 auto 22px',
          background: 'rgba(255,255,255,.14)', display: 'grid', placeItems: 'center',
          fontSize: 42, lineHeight: 1,
        }}>{ok ? '✓' : '✕'}</div>

        <div style={{
          display: 'inline-block', background: chip, color: '#052e26',
          fontSize: 12, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase',
          padding: '5px 14px', borderRadius: 20, marginBottom: 18,
        }}>{ok ? 'Verified' : 'Not verified'}</div>

        {ok ? (
          <>
            <h1 style={{ fontSize: 34, fontWeight: 800, margin: '0 0 6px', letterSpacing: '-.02em' }}>
              {r.name}
            </h1>
            <p style={{ fontSize: 16, opacity: .9, margin: '0 0 20px' }}>{r.designation}</p>
            <div style={{
              background: 'rgba(255,255,255,.12)', borderRadius: 14, padding: '14px 16px',
              display: 'grid', gap: 10, textAlign: 'left', fontSize: 14,
            }}>
              <Row k="Employee code" v={r.employee_code} mono />
              <Row k="Card number" v={r.card_no} mono />
              {r.access_zones?.length ? <Row k="Access zones" v={r.access_zones.join(', ')} /> : null}
              {r.valid_till ? <Row k="Valid till" v={r.valid_till} /> : null}
            </div>
            <p style={{ fontSize: 12, opacity: .7, marginTop: 18 }}>
              This code has now been used and will not verify again.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 10px' }}>Do not let this through</h1>
            <p style={{ fontSize: 16, opacity: .92, margin: 0 }}>{r.reason}</p>
            <p style={{ fontSize: 12, opacity: .7, marginTop: 20 }}>
              Every scan is logged, including this one.
            </p>
          </>
        )}
      </div>
    </main>
  )
}

function Row({ k, v, mono }: { k: string; v?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ opacity: .75 }}>{k}</span>
      <b style={{ fontFamily: mono ? 'ui-monospace, Menlo, monospace' : undefined }}>{v ?? '—'}</b>
    </div>
  )
}
