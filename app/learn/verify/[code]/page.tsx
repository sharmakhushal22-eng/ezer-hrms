'use client'
// app/learn/verify/[code]/page.tsx — is this certificate genuine? The QR on every certificate
// opens this page. Public, and it says only what the route says: no employee code, department
// or e-mail.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { C, F, W, S, R, E, Badge, Button, Card, Skeleton, UIKeyframes, numeric, IconAlert, IconCheck, IconClose, type Tone } from '@/lib/ui'
import { CalmMessage, LearnMark, LearnStyles, dayWords } from '@/components/learning/shared'

interface Verdict { status: 'VALID' | 'EXPIRED' | 'REVOKED'; cert_no: string; recipient: string; title: string; company: string | null; issued_at: string; expires_at: string | null }

const LOOK: Record<Verdict['status'], { label: string; line: string; t: Tone; icon: React.ReactNode; bg: string; fg: string }> = {
  VALID: { label: 'Valid', line: 'This certificate is genuine and current.', t: 'positive', icon: <IconCheck size={22} />, bg: C.positiveTint, fg: C.positive },
  EXPIRED: { label: 'Expired', line: 'This certificate was genuine, and its validity has ended.', t: 'warning', icon: <IconAlert size={22} />, bg: C.warningTint, fg: C.warning },
  REVOKED: { label: 'Revoked', line: 'This certificate has been withdrawn and should not be relied on.', t: 'critical', icon: <IconClose size={22} />, bg: C.criticalTint, fg: C.critical },
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '112px minmax(0,1fr)', gap: S.md, padding: `${S.sm + 2}px 0`, borderTop: `1px solid ${C.line}`, fontSize: F.small }}>
      <span style={{ color: C.muted }}>{k}</span>
      <span style={{ color: C.ink, fontWeight: W.medium, minWidth: 0, ...numeric }}>{v}</span>
    </div>
  )
}

function Result({ v }: { v: Verdict }) {
  const look = LOOK[v.status] || LOOK.REVOKED
  return (
    <Card pad={S.xl} className="ez-rise" style={{ boxShadow: E.raised }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md, marginBottom: S.lg }}>
        <span style={{ width: 44, height: 44, borderRadius: R.pill, display: 'grid', placeItems: 'center', background: look.bg, color: look.fg, flexShrink: 0 }}>{look.icon}</span>
        <div style={{ minWidth: 0 }}>
          <Badge t={look.t}>{look.label}</Badge>
          <div style={{ fontSize: F.small, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>{look.line}</div>
        </div>
      </div>
      <div style={{ marginBottom: S.lg }}>
        <div style={{ fontSize: F.tiny, color: C.muted }}>Awarded to</div>
        <div style={{ fontSize: 24, fontWeight: W.bold, letterSpacing: '-.02em', lineHeight: 1.2, marginTop: 2 }}>{v.recipient}</div>
      </div>
      <Row k="For completing" v={v.title} />
      {v.company && <Row k="Issued by" v={v.company} />}
      <Row k="Issued on" v={dayWords(v.issued_at)} />
      <Row k={v.status === 'EXPIRED' ? 'Expired on' : 'Valid until'} v={v.expires_at ? dayWords(v.expires_at) : 'No expiry'} />
      <Row k="Certificate no." v={v.cert_no} />
    </Card>
  )
}

export default function VerifyCertificate() {
  const { code } = useParams<{ code: string }>()
  const [state, setState] = useState<'loading' | 'missing' | 'trouble' | 'found'>('loading')
  const [v, setV] = useState<Verdict | null>(null)
  const load = useCallback(() => {
    setState('loading')
    fetch(`/api/lms/verify/${encodeURIComponent(code)}`, { cache: 'no-store' }).then(async r => {
      if (r.status === 404) { setState('missing'); return }
      if (!r.ok) { setState('trouble'); return }
      setV(await r.json()); setState('found')
    }).catch(() => setState('trouble'))
  }, [code])
  useEffect(() => { document.title = 'Verify a certificate | EZER Learn'; load() }, [load])

  return (
    <div className="ezl" style={{ minHeight: '100dvh', background: C.canvas, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px 64px', boxSizing: 'border-box' }}>
      <UIKeyframes />
      <LearnStyles />
      <div style={{ width: '100%', maxWidth: 480, display: 'grid', gap: S.lg }}>
        <LearnMark sub="Certificate check" />
        {state === 'loading' && <Card pad={S.xl} style={{ display: 'grid', gap: S.md }}><Skeleton w="40%" /><Skeleton h={26} w="70%" /><Skeleton /><Skeleton /></Card>}
        {state === 'found' && v && <Result v={v} />}
        {state === 'missing' && <CalmMessage title="We could not find this certificate">The link may be incomplete. Check it against the one on the certificate, or scan the QR code again.</CalmMessage>}
        {state === 'trouble' && <CalmMessage title="We could not check this just now" action={<Button onClick={load}>Try again</Button>}>Please try once more in a moment.</CalmMessage>}
      </div>
    </div>
  )
}
