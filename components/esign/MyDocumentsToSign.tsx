'use client'
// components/esign/MyDocumentsToSign.tsx — ESS → Profile → Documents to sign.
//
// Everything sent to this employee through EZER Sign, whatever the e-mail it went to: what
// is waiting for them now, what is queued behind someone else, and what they have signed.
// "Review & sign" asks the server for a fresh link and opens the signing page — which still
// asks for the e-mail OTP: being logged in to ESS is not treated as a signature.
import { useEffect, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { C, F, W, R, E, IconCheck, IconClock, IconAlert } from '@/lib/ui'
import { Btn, Pill, font, numeric, ENVELOPE_STATUS, IconPen } from './ui'
import { categoryLabel } from '@/lib/esign/core'

type Item = { signer_id: string; status: string; signed_at: string | null; invited_at: string | null; role_label: string | null; envelope: { envelope_no: string; title: string; category: string; status: string; created_by_name: string | null; created_at: string; expires_at: string | null; completed_at: string | null } }
const day = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

function Row({ it, onOpen, busy }: { it: Item; onOpen: () => void; busy: boolean }) {
  const e = it.envelope
  const live = e.status === 'SENT' || e.status === 'IN_PROGRESS'
  const mine = live && (it.status === 'PENDING' || it.status === 'VIEWED')
  const queued = live && it.status === 'WAITING'
  const signed = it.status === 'SIGNED'
  const st = signed ? (e.status === 'COMPLETED' ? { label: 'Completed', t: 'positive' as const } : { label: 'You signed · others pending', t: 'info' as const }) : mine ? { label: 'Action needed', t: 'warning' as const } : queued ? { label: 'Queued', t: 'neutral' as const } : ENVELOPE_STATUS[e.status]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 14, alignItems: 'center', padding: '14px 16px', borderTop: `1px solid ${C.line}` }}>
      <span style={{ width: 40, height: 40, borderRadius: R.md, display: 'grid', placeItems: 'center', background: mine ? C.warningTint : signed ? C.positiveTint : C.sunken, color: mine ? C.warning : signed ? C.positive : C.muted }}>{signed ? <IconCheck size={18} /> : mine ? <IconPen size={18} /> : queued ? <IconClock size={18} /> : <IconAlert size={18} />}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: W.semi, color: C.ink }}>{e.title}</div>
        <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, ...numeric }}>{categoryLabel(e.category)} · from {e.created_by_name || 'HR'} · {day(e.created_at)} · {e.envelope_no}{mine && e.expires_at ? ` · sign by ${day(e.expires_at)}` : ''}{signed ? ` · signed ${day(it.signed_at)}` : ''}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {st && <Pill t={st.t}>{st.label}</Pill>}
        {mine && <Btn onClick={onOpen} disabled={busy} style={{ padding: '8px 14px' }}><IconPen size={14} /> Review & sign</Btn>}
      </div>
    </div>
  )
}

export default function MyDocumentsToSign() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/esign/mine', { headers: await authHeaders(), cache: 'no-store' })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error); setItems(j.items || [])
      } catch (e: any) { setErr(e.message); setItems([]) }
    })()
  }, [])
  const open = async (id: string) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/esign/mine', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ signer_id: id }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      window.open(j.url, '_blank', 'noopener')
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const list = items || []
  const todo = list.filter(i => (i.envelope.status === 'SENT' || i.envelope.status === 'IN_PROGRESS') && (i.status === 'PENDING' || i.status === 'VIEWED'))
  const rest = list.filter(i => !todo.includes(i))
  return (
    <div style={{ fontFamily: font, color: C.ink, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 38, height: 38, borderRadius: R.md, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center' }}><IconPen size={18} /></span>
        <div><div style={{ fontWeight: W.bold, fontSize: 17 }}>Documents to sign</div><div style={{ fontSize: F.small, color: C.muted }}>Letters, policies and agreements HR has sent you for e-signature.</div></div>
      </div>
      {err && <div role="alert" style={{ fontSize: F.small, color: C.critical, background: C.criticalTint, borderRadius: R.md, padding: '9px 12px' }}>{err}</div>}
      {[{ title: `Waiting for you${todo.length ? ` · ${todo.length}` : ''}`, rows: todo, empty: 'Nothing to sign right now.' }, { title: 'Everything else', rows: rest, empty: 'No signed or queued documents yet.' }].map(g => (
        <section key={g.title} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', fontWeight: W.bold, fontSize: F.body }}>{g.title}</div>
          {items === null ? <div style={{ padding: 18, color: C.muted, fontSize: F.small, borderTop: `1px solid ${C.line}` }}>Loading…</div>
            : g.rows.length ? g.rows.map(it => <Row key={it.signer_id} it={it} busy={busy} onOpen={() => open(it.signer_id)} />)
            : <div style={{ padding: 18, color: C.faint, fontSize: F.small, borderTop: `1px solid ${C.line}` }}>{g.empty}</div>}
        </section>
      ))}
    </div>
  )
}
