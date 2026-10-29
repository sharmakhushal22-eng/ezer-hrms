'use client'
// app/sign/verify/page.tsx — public "is this signed PDF genuine?" page. The QR on every
// Certificate of Completion opens it with ?id=<envelope>.
//
// Two checks: drop the PDF (its SHA-256 is computed on the server and compared with the
// fingerprint EZER Sign registered when the last person signed — one changed byte and it no
// longer matches), or type the envelope ID printed in the footer to see who signed and when.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { C, F, W, R, IconCheck, IconAlert, IconSearch, IconUpload } from '@/lib/ui'
import { SignMark, Panel, Pill, Btn, font, numeric, ENVELOPE_STATUS, IconShield } from '@/components/esign/ui'

type Summary = {
  envelope_no: string; title: string; status: string; company: string | null; sent_by: string | null
  created_at: string; completed_at: string | null; page_count: number; original_sha256: string; signed_sha256: string | null
  signers: { order_no: number; name: string; email: string; role_label: string | null; status: string; signed_at: string | null; auth_method: string; aadhaar_verified_at: string | null; aadhaar_mode: string | null }[]
}
const when = (s: string | null) => s ? new Date(s).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST' : '—'

function EnvelopeCard({ e }: { e: Summary }) {
  const st = ENVELOPE_STATUS[e.status] || ENVELOPE_STATUS.SENT
  return (
    <div style={{ marginTop: 18, border: `1px solid ${C.line}`, borderRadius: R.lg, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', background: C.sunken, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: W.bold, fontSize: 15 }}>{e.title}</div>
        <span style={{ marginLeft: 'auto' }}><Pill t={st.t} dot>{st.label}</Pill></span>
      </div>
      <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, fontSize: F.small }}>
        {[['Envelope', e.envelope_no], ['Company', e.company || '—'], ['Sent by', e.sent_by || '—'], ['Sent', when(e.created_at)], ['Completed', when(e.completed_at)], ['Pages', String(e.page_count)]].map(([k, v]) => (
          <div key={k}><div style={{ color: C.muted, fontSize: F.tiny, fontWeight: W.bold, textTransform: 'uppercase', letterSpacing: '.06em' }}>{k}</div><div style={{ color: C.ink, fontWeight: W.semi, marginTop: 3, ...numeric }}>{v}</div></div>
        ))}
      </div>
      <div style={{ padding: '4px 18px 16px' }}>
        {e.signers.map(s => (
          <div key={s.order_no} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
            <span style={{ width: 26, height: 26, borderRadius: 99, display: 'grid', placeItems: 'center', background: s.status === 'SIGNED' ? C.positive : C.sunken, color: s.status === 'SIGNED' ? C.onAccent : C.muted, fontSize: F.tiny, fontWeight: W.bold }}>{s.status === 'SIGNED' ? <IconCheck size={13} /> : s.order_no}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: W.semi }}>{s.name} <span style={{ color: C.muted, fontWeight: W.regular }}>· {s.email}</span></div>
              <div style={{ fontSize: F.tiny, color: C.muted }}>{s.role_label || 'Signer'} · {s.auth_method === 'EMAIL_AADHAAR_OTP' ? `E-mail + Aadhaar OTP${s.aadhaar_mode === 'DEMO' ? ' (demo)' : ''}` : 'E-mail OTP'}</div>
            </div>
            <div style={{ fontSize: F.small, color: s.signed_at ? C.inkSoft : C.faint, ...numeric }}>{s.signed_at ? when(s.signed_at) : 'not signed'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Verify() {
  const sp = useSearchParams()
  const [id, setId] = useState(sp.get('id') || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [byId, setById] = useState<Summary | null | 'none'>(null)
  const [file, setFile] = useState<{ result: string; sha256: string; envelope?: Summary; name: string } | null>(null)
  const [drag, setDrag] = useState(false)

  const lookup = async (v = id) => {
    setErr(''); setById(null); if (!v.trim()) return
    setBusy(true)
    try {
      const r = await fetch(`/api/esign/verify?id=${encodeURIComponent(v.trim())}`); const j = await r.json()
      if (!r.ok) throw new Error(j.error); setById(j.found ? j.envelope : 'none')
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { if (sp.get('id')) lookup(sp.get('id')!) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const check = async (f: File | undefined) => {
    if (!f) return
    setErr(''); setFile(null); setBusy(true)
    try {
      const fd = new FormData(); fd.append('file', f)
      const r = await fetch('/api/esign/verify', { method: 'POST', body: fd }); const j = await r.json()
      if (!r.ok) throw new Error(j.error); setFile({ ...j, name: f.name })
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const verdict = file && ({
    AUTHENTIC: { t: 'positive' as const, icon: <IconCheck size={26} />, title: 'Authentic — not altered since signing', text: 'This file is exactly the one EZER Sign sealed when the last party signed. Every byte matches the registered fingerprint.' },
    ORIGINAL: { t: 'warning' as const, icon: <IconAlert size={24} />, title: 'This is the unsigned original', text: 'The file matches a document that was sent for signature, but it is the copy before signing — not the signed PDF.' },
    UNKNOWN: { t: 'critical' as const, icon: <IconAlert size={24} />, title: 'Not recognised — treat as unverified', text: 'This file does not match any document signed on EZER Sign. It may have been edited, re-saved or printed to PDF after signing, or it was never signed here.' },
  }[file.result as 'AUTHENTIC'])
  const vc = verdict ? { positive: [C.positive, C.positiveTint, C.positiveEdge], warning: [C.warning, C.warningTint, C.warningEdge], critical: [C.critical, C.criticalTint, C.criticalEdge] }[verdict.t] : null

  return (
    <div style={{ minHeight: '100vh', background: C.canvas, fontFamily: font, color: C.ink }}>
      <header style={{ background: C.surface, borderBottom: `1px solid ${C.line}` }}><div style={{ maxWidth: 900, margin: '0 auto', padding: '12px 20px' }}><SignMark sub="Document verification" /></div></header>
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '30px 16px 80px' }} className="ez-rise">
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{ width: 54, height: 54, borderRadius: R.lg, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}><IconShield size={26} /></div>
          <h1 style={{ fontSize: 28, fontWeight: W.bold, letterSpacing: '-.02em', margin: 0 }}>Verify a signed document</h1>
          <p style={{ color: C.muted, fontSize: F.body, marginTop: 8 }}>Check that a PDF signed on EZER Sign is genuine and unchanged. Nothing you upload is stored.</p>
        </div>

        <Panel pad={24}>
          <div style={{ fontWeight: W.bold, fontSize: 16 }}>1 · Check the file</div>
          <label onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); check(e.dataTransfer.files[0]) }}
            style={{ marginTop: 14, display: 'grid', placeItems: 'center', minHeight: 150, borderRadius: R.lg, border: `1.5px dashed ${drag ? C.brand : C.lineStrong}`, background: drag ? C.brandTint : C.sunken, cursor: 'pointer', textAlign: 'center', padding: 16 }}>
            <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => check(e.target.files?.[0])} />
            <div><div style={{ color: C.brand, display: 'grid', placeItems: 'center', marginBottom: 8 }}><IconUpload size={22} /></div><div style={{ fontWeight: W.semi }}>{busy ? 'Checking…' : 'Drop the signed PDF here, or click to choose'}</div><div style={{ fontSize: F.small, color: C.muted, marginTop: 4 }}>The check compares the file’s SHA-256 fingerprint</div></div>
          </label>
          {verdict && vc && (
            <div className="ez-rise" style={{ marginTop: 16, display: 'flex', gap: 14, padding: 16, borderRadius: R.lg, background: vc[1], border: `1px solid ${vc[2]}` }}>
              <div style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 99, background: C.surface, color: vc[0], display: 'grid', placeItems: 'center' }}>{verdict.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: W.bold, color: vc[0], fontSize: 16 }}>{verdict.title}</div>
                <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: 4, lineHeight: 1.55 }}>{verdict.text}</div>
                <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 8, wordBreak: 'break-all', ...numeric }}>{file!.name} · SHA-256 {file!.sha256}</div>
              </div>
            </div>
          )}
          {file?.envelope && <EnvelopeCard e={file.envelope} />}
        </Panel>

        <Panel pad={24} style={{ marginTop: 18 }}>
          <div style={{ fontWeight: W.bold, fontSize: 16 }}>2 · Look up an envelope</div>
          <div style={{ fontSize: F.small, color: C.muted, marginTop: 4 }}>The ID is printed in the footer of every signed page, e.g. EZS-2026-7KQ2MX.</div>
          <form onSubmit={e => { e.preventDefault(); lookup() }} style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <input value={id} onChange={e => setId(e.target.value.toUpperCase())} placeholder="EZS-2026-XXXXXX" data-no-titlecase
              style={{ flex: '1 1 220px', padding: '11px 13px', borderRadius: R.md, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink, fontSize: F.body, fontFamily: font, letterSpacing: '.06em', outline: 'none', ...numeric }} />
            <Btn type="submit" disabled={busy || !id.trim()}><IconSearch size={15} /> Look up</Btn>
          </form>
          {byId === 'none' && <div style={{ marginTop: 14, fontSize: F.small, color: C.critical }}>No envelope with that ID.</div>}
          {byId && byId !== 'none' && <EnvelopeCard e={byId} />}
        </Panel>
        {err && <div role="alert" style={{ marginTop: 14, fontSize: F.small, color: C.critical, textAlign: 'center' }}>{err}</div>}
      </main>
    </div>
  )
}

export default function VerifyPage() {
  return <Suspense fallback={null}><Verify /></Suspense>
}
