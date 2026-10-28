'use client'
// app/sign/[token]/page.tsx — where a signer lands from the e-mail. Public: no EZER login.
//
// The flow mirrors Leegality / Adobe Sign, step by step:
//   1. What it is     title, from whom, the sender's note, who signs and in which order
//   2. Verify         a 6-digit code to the signer's own e-mail (and, when the sender asked
//                     for it, an Aadhaar OTP step — DEMO until a licensed eSign provider)
//   3. Review & sign  the actual PDF, every box that is theirs marked "Sign here"; one
//                     signature adopted (draw / type / upload) fills all of them, initials
//                     boxes get initials, date/name boxes fill themselves
//   4. Consent        the IT Act consent line, then Finish
//   5. Done           a copy to download; everyone is mailed the final PDF when the last
//                     person signs
// The document is only fetched after step 2, so a forwarded link reveals the title alone.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { C, F, W, R, E, Z, IconLock, IconCheck, IconMail, IconAlert, IconDownload, IconClose } from '@/lib/ui'
import PdfPages, { loadPdf, useFitWidth } from '@/components/esign/PdfPages'
import SignaturePad, { type SignatureKind } from '@/components/esign/SignaturePad'
import { SignMark, Pill, Btn, Panel, OtpBoxes, IconPen, IconShield, font, numeric, SIGNER_STATUS } from '@/components/esign/ui'

type Field = { id: string; page: number; x: number; y: number; w: number; h: number; kind: 'SIGNATURE' | 'INITIALS' | 'DATE' | 'NAME' }
type Info = {
  envelope: { envelope_no: string; title: string; message: string | null; category: string; page_count: number; sender: string; sender_email: string | null; company: string | null; expires_at: string | null; signing_order: string; status: string }
  signer: { name: string; email_masked: string; role_label: string | null; auth_method: string; email_verified: boolean; aadhaar_verified: boolean; aadhaar_last4: string | null; status: string; signed_at: string | null }
  signers: { order_no: number; name: string; role_label: string | null; status: string; signed_at: string | null; you: boolean }[]
  fields: Field[]; others: { page: number; x: number; y: number; w: number; h: number }[]
  blocked: null | { code: string; message: string }; aadhaar_demo: boolean
}
type Step = 'intro' | 'otp' | 'aadhaar' | 'sign' | 'done'

const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

async function call(token: string, body: object, session?: string | null) {
  const r = await fetch(`/api/esign/sign/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'x-esign-session': session } : {}) }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j })
  return j
}

function Shell({ children, env }: { children: React.ReactNode; env?: Info['envelope'] }) {
  return (
    <div style={{ minHeight: '100vh', background: C.canvas, fontFamily: font, color: C.ink }}>
      <header style={{ position: 'sticky', top: 0, zIndex: Z.sticky, background: C.surface, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <SignMark sub="Secure e-signature" />
          {env && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontSize: F.small, color: C.muted, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconLock size={14} /> Encrypted link</span>
            <span style={{ width: 1, height: 14, background: C.line }} />
            <span style={{ ...numeric, fontWeight: W.semi, color: C.inkSoft }}>{env.envelope_no}</span>
          </div>}
        </div>
      </header>
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '26px 16px 80px' }}>{children}</main>
    </div>
  )
}

function SignerTimeline({ signers }: { signers: Info['signers'] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 0 }}>
      {signers.map((s, i) => {
        const st = SIGNER_STATUS[s.status] || SIGNER_STATUS.WAITING
        const done = s.status === 'SIGNED'
        return (
          <li key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 12, alignItems: 'start', position: 'relative', paddingBottom: i < signers.length - 1 ? 16 : 0 }}>
            {i < signers.length - 1 && <span style={{ position: 'absolute', left: 13, top: 28, bottom: 0, width: 2, background: done ? C.positiveEdge : C.line }} />}
            <span style={{ width: 28, height: 28, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: F.tiny, fontWeight: W.bold, background: done ? C.positive : s.you ? C.brand : C.sunken, color: done || s.you ? C.onAccent : C.muted, border: `1px solid ${done ? C.positive : s.you ? C.brand : C.line}`, ...numeric }}>{done ? <IconCheck size={14} /> : s.order_no}</span>
            <div style={{ minWidth: 0, paddingTop: 3 }}>
              <div style={{ fontWeight: W.semi, fontSize: F.body, color: C.ink }}>{s.name}{s.you && <span style={{ color: C.brand }}> · you</span>}</div>
              <div style={{ fontSize: F.tiny, color: C.muted }}>{s.role_label || 'Signer'}{done && s.signed_at ? ` · signed ${fmtDate(s.signed_at)}` : ''}</div>
            </div>
            <span style={{ paddingTop: 3 }}><Pill t={st.t}>{st.label}</Pill></span>
          </li>
        )
      })}
    </ol>
  )
}

function Centered({ children, max = 560 }: { children: React.ReactNode; max?: number }) {
  return <div style={{ maxWidth: max, margin: '0 auto' }} className="ez-rise">{children}</div>
}

function StatusScreen({ icon, tone, title, text, children }: { icon: React.ReactNode; tone: 'positive' | 'warning' | 'critical' | 'neutral'; title: string; text: string; children?: React.ReactNode }) {
  const fg = tone === 'positive' ? C.positive : tone === 'warning' ? C.warning : tone === 'critical' ? C.critical : C.muted
  const bg = tone === 'positive' ? C.positiveTint : tone === 'warning' ? C.warningTint : tone === 'critical' ? C.criticalTint : C.sunken
  return (
    <Centered>
      <Panel pad={34} style={{ textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 99, background: bg, color: fg, display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>{icon}</div>
        <div style={{ fontSize: 22, fontWeight: W.bold, letterSpacing: '-.01em' }}>{title}</div>
        <div style={{ fontSize: F.body, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>{text}</div>
        {children && <div style={{ marginTop: 22 }}>{children}</div>}
      </Panel>
    </Centered>
  )
}

/** One box on the page: what it shows depends on its kind and whether a signature is adopted. */
function FieldBox({ f, size, sig, initials, name, onPick, active }: {
  f: Field; size: { w: number; h: number }; sig: string | null; initials: string | null; name: string; onPick: () => void; active: boolean
}) {
  const filled = f.kind === 'SIGNATURE' ? !!sig : f.kind === 'INITIALS' ? !!initials : true
  const img = f.kind === 'SIGNATURE' ? sig : f.kind === 'INITIALS' ? initials : null
  const label = f.kind === 'INITIALS' ? 'Initials' : f.kind === 'DATE' ? 'Date' : f.kind === 'NAME' ? 'Name' : 'Sign here'
  return (
    <button type="button" onClick={onPick} data-field={f.id} aria-label={`${label} on page ${f.page}`}
      style={{ position: 'absolute', left: f.x * size.w, top: f.y * size.h, width: f.w * size.w, height: f.h * size.h, padding: 0, cursor: 'pointer', borderRadius: 4,
        border: `1.5px ${filled ? 'solid' : 'dashed'} ${filled ? C.positive : C.warning}`, background: filled ? 'transparent' : C.warningTint,
        boxShadow: active ? `0 0 0 4px ${C.brandTint}, 0 0 0 5.5px ${C.brand}` : 'none', transition: 'box-shadow .2s', fontFamily: font, overflow: 'hidden' }}>
      {img ? <img src={img} alt="" style={{ position: 'absolute', inset: '6% 6% 30%', width: '88%', height: '64%', objectFit: 'contain', objectPosition: 'left center' }} />
        : f.kind === 'DATE' ? <span style={{ fontSize: Math.max(9, f.h * size.h * 0.42), color: C.ink, paddingLeft: 4 }}>{fmtDate(new Date().toISOString())}</span>
        : f.kind === 'NAME' ? <span style={{ fontSize: Math.max(9, f.h * size.h * 0.42), color: C.ink, paddingLeft: 4 }}>{name}</span>
        : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: Math.max(10, Math.min(13, f.h * size.h * 0.22)), fontWeight: W.bold, color: C.warning }}><IconPen size={13} /> {label}</span>}
      {img && f.kind === 'SIGNATURE' && <span style={{ position: 'absolute', left: 6, right: 4, bottom: 3, fontSize: Math.max(6, f.h * size.h * 0.075), color: C.muted, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden' }}>Digitally signed by {name} · verification details added on finish</span>}
    </button>
  )
}

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: Z.modal, background: 'rgba(8,15,35,.55)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="ez-rise" style={{ width: '100%', maxWidth: 620, maxHeight: '92vh', overflow: 'auto', background: C.surface, borderRadius: R.xl, boxShadow: E.overlay, border: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 22px', borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontWeight: W.bold, fontSize: 17 }}>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer', display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: R.sm }}><IconClose size={18} /></button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
        {footer && <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', background: C.sunken }}>{footer}</div>}
      </div>
    </div>
  )
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<Info | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [step, setStep] = useState<Step>('intro')
  const [session, setSession] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState('')
  const [cool, setCool] = useState(0)
  const [aadhaar, setAadhaar] = useState('')
  const [aOtpSent, setAOtpSent] = useState<string | null>(null)
  const [doc, setDoc] = useState<any>(null)
  const [sig, setSig] = useState<{ png: string; kind: SignatureKind } | null>(null)
  const [ini, setIni] = useState<string | null>(null)
  const [padFor, setPadFor] = useState<null | 'SIGNATURE' | 'INITIALS'>(null)
  const [draft, setDraft] = useState<{ png: string | null; kind: SignatureKind }>({ png: null, kind: 'DRAWN' })
  const [consent, setConsent] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [completed, setCompleted] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const { ref: viewRef, width } = useFitWidth(860, 8)
  const skey = `ezsign:${token}`

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/esign/sign/${token}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setLoadErr(j.error || 'This link could not be opened.'); return null }
    setInfo(j); return j as Info
  }, [token])

  useEffect(() => {
    refresh().then(j => {
      if (!j) return
      let s: string | null = null
      try { s = sessionStorage.getItem(skey) } catch { /* private mode */ }
      if (s && j.signer.email_verified && !j.blocked) {
        setSession(s)
        setStep(j.signer.auth_method === 'EMAIL_AADHAAR_OTP' && !j.signer.aadhaar_verified ? 'aadhaar' : 'sign')
      }
    })
  }, [refresh, skey])

  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool(c => c - 1), 1000); return () => clearTimeout(t) }, [cool])

  // Fetch the PDF once the signer is verified.
  useEffect(() => {
    if (step !== 'sign' || !session || doc) return
    ;(async () => {
      const r = await fetch(`/api/esign/sign/${token}/document`, { headers: { 'x-esign-session': session }, cache: 'no-store' })
      if (r.status === 401) { setSession(null); setStep('intro'); setErr('Your verification expired. Verify again to continue.'); return }
      if (!r.ok) { setErr('The document could not be loaded. Refresh the page.'); return }
      setDoc(await loadPdf(await r.arrayBuffer()))
    })()
  }, [step, session, doc, token])

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e: any) { setErr(e.message); if (e.body?.blocked) refresh() } finally { setBusy(false) } }

  const sendOtp = () => run(async () => {
    const j = await call(token, { action: 'send_otp' })
    setSentTo(j.to); setDevOtp(j.dev_otp || null); setOtp(''); setCool(30); setStep('otp')
  })
  const verifyOtp = (code = otp) => run(async () => {
    const j = await call(token, { action: 'verify_otp', otp: code })
    setSession(j.session); try { sessionStorage.setItem(skey, j.session) } catch { /* ignore */ }
    setStep(j.need_aadhaar ? 'aadhaar' : 'sign'); refresh()
  })
  const sendAadhaar = () => run(async () => {
    const j = await call(token, { action: 'aadhaar_send', aadhaar }, session)
    setAOtpSent(j.demo_otp || ''); setOtp('')
  })
  const verifyAadhaar = (code = otp) => run(async () => {
    await call(token, { action: 'aadhaar_verify', otp: code }, session)
    setOtp(''); setStep('sign'); refresh()
  })
  const submit = () => run(async () => {
    if (!sig) throw new Error('Adopt your signature first.')
    // Initials boxes take the initials, or the signature when none were drawn.
    const j = await call(token, { action: 'submit', signature: sig.png, initials: ini, kind: sig.kind, consent }, session)
    setCompleted(!!j.completed); setStep('done'); refresh()
  })
  const decline = () => run(async () => {
    await call(token, { action: 'decline', reason }, session)
    setDeclining(false); refresh()
  })
  const downloadCopy = () => run(async () => {
    const r = await fetch(`/api/esign/sign/${token}/document?view=0`, { headers: { 'x-esign-session': session || '' } })
    if (!r.ok) throw new Error('Download is available from the completion e-mail.')
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a'); a.href = url; a.download = `${info?.envelope.title.replace(/[^A-Za-z0-9]+/g, '_') || 'document'}_${completed ? 'signed' : 'copy'}.pdf`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  })

  const fields = useMemo(() => [...(info?.fields || [])].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x), [info])
  const needInitials = fields.some(f => f.kind === 'INITIALS')
  const toFill = fields.filter(f => f.kind === 'SIGNATURE' || f.kind === 'INITIALS')
  const filledCount = toFill.filter(f => f.kind === 'SIGNATURE' ? !!sig : !!(ini || sig)).length
  const ready = !!sig && (!needInitials || !!ini || !!sig) && consent

  const goNext = () => {
    const next = toFill.find(f => f.kind === 'SIGNATURE' ? !sig : !(ini || sig)) || toFill[0]
    if (!next) return
    setActive(next.id)
    document.querySelector(`[data-field="${next.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const pick = (f: Field) => { setActive(f.id); if (f.kind === 'SIGNATURE' || f.kind === 'INITIALS') { setDraft({ png: null, kind: 'DRAWN' }); setPadFor(f.kind) } }
  const adopt = () => {
    if (!draft.png) return
    if (padFor === 'INITIALS') setIni(draft.png); else setSig({ png: draft.png, kind: draft.kind })
    setPadFor(null)
  }
  const pageOverlay = useCallback((page: number, size: { w: number; h: number }) => (
    <>
      {(info?.others || []).filter(o => o.page === page).map((o, i) => (
        <div key={`o${i}`} title="Another signer's box" style={{ position: 'absolute', left: o.x * size.w, top: o.y * size.h, width: o.w * size.w, height: o.h * size.h, border: `1px dashed ${C.lineStrong}`, borderRadius: 4, background: 'transparent', pointerEvents: 'none' }} />
      ))}
      {fields.filter(f => f.page === page).map(f => (
        <FieldBox key={f.id} f={f} size={size} sig={sig?.png || null} initials={ini || sig?.png || null} name={info?.signer.name || ''} active={active === f.id} onPick={() => pick(f)} />
      ))}
    </>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [fields, sig, ini, active, info])

  if (loadErr) return <Shell><StatusScreen icon={<IconAlert size={28} />} tone="critical" title="This link cannot be opened" text={loadErr} /></Shell>
  if (!info) return <Shell><div style={{ textAlign: 'center', color: C.muted, padding: 80 }}>Opening your document…</div></Shell>
  const env = info.envelope

  if (info.blocked && step !== 'done') {
    const b = info.blocked
    const tone = b.code === 'SIGNED' || b.code === 'COMPLETED' ? 'positive' : b.code === 'NOT_YOUR_TURN' ? 'warning' : b.code === 'DECLINED' || b.code === 'VOIDED' ? 'critical' : 'neutral'
    const title = { SIGNED: 'You have signed this document', COMPLETED: 'This document is complete', NOT_YOUR_TURN: 'Not your turn yet', DECLINED: 'This document was declined', VOIDED: 'This document was cancelled', EXPIRED: 'This link has expired' }[b.code] || 'Not available'
    return (
      <Shell env={env}>
        <StatusScreen icon={tone === 'positive' ? <IconCheck size={30} /> : <IconAlert size={28} />} tone={tone as any} title={title} text={b.message}>
          <div style={{ textAlign: 'left', marginTop: 6 }}><SignerTimeline signers={info.signers} /></div>
          {(b.code === 'SIGNED' || b.code === 'COMPLETED') && <div style={{ fontSize: F.small, color: C.muted, marginTop: 18 }}>The signed copy is e-mailed to every party when the last person signs.</div>}
        </StatusScreen>
      </Shell>
    )
  }

  // ── Steps 1–2: intro + verification ─────────────────────────────────────
  if (step === 'intro' || step === 'otp' || step === 'aadhaar') {
    return (
      <Shell env={env}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, alignItems: 'start', maxWidth: 1000, margin: '0 auto' }} className="ez-rise">
          <Panel pad={26}>
            <div style={{ fontSize: F.tiny, fontWeight: W.bold, color: C.brand, letterSpacing: '.08em', textTransform: 'uppercase' }}>Document for your signature</div>
            <div style={{ fontSize: 24, fontWeight: W.bold, letterSpacing: '-.015em', marginTop: 8, lineHeight: 1.25 }}>{env.title}</div>
            <div style={{ fontSize: F.body, color: C.muted, marginTop: 8 }}>From <b style={{ color: C.inkSoft }}>{env.sender}</b>{env.company ? ` · ${env.company}` : ''} · {env.page_count} page{env.page_count === 1 ? '' : 's'}</div>
            {env.message && <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: R.md, background: C.brandTint, borderLeft: `3px solid ${C.brand}`, fontSize: F.body, color: C.inkSoft, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{env.message}</div>}
            <div style={{ marginTop: 22, fontSize: F.tiny, fontWeight: W.bold, color: C.muted, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>Signers · {env.signing_order === 'PARALLEL' ? 'any order' : 'in this order'}</div>
            <SignerTimeline signers={info.signers} />
            {env.expires_at && <div style={{ marginTop: 18, fontSize: F.small, color: C.muted }}>Please sign by <b style={{ color: C.inkSoft }}>{fmtDate(env.expires_at)}</b>.</div>}
          </Panel>

          <Panel pad={26}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: R.md, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center' }}><IconShield size={20} /></div>
              <div>
                <div style={{ fontWeight: W.bold, fontSize: 17 }}>{step === 'aadhaar' ? 'Aadhaar verification' : 'Verify it’s you'}</div>
                <div style={{ fontSize: F.small, color: C.muted }}>{step === 'aadhaar' ? 'Step 2 of 2 · requested by the sender' : `Step 1 of ${info.signer.auth_method === 'EMAIL_AADHAAR_OTP' ? 2 : 1} · e-mail one-time password`}</div>
              </div>
            </div>

            {step === 'intro' && <>
              <p style={{ fontSize: F.body, color: C.inkSoft, lineHeight: 1.6, margin: '18px 0' }}>Hi <b>{info.signer.name}</b>. To open the document we’ll send a 6-digit code to <b>{info.signer.email_masked}</b>. Only you can see that inbox, which is how the signature is tied to you.</p>
              <Btn onClick={sendOtp} disabled={busy} style={{ width: '100%', padding: '13px 18px' }}><IconMail size={16} /> {busy ? 'Sending…' : 'Send me the code'}</Btn>
            </>}

            {step === 'otp' && <>
              <p style={{ fontSize: F.body, color: C.inkSoft, lineHeight: 1.6, margin: '18px 0 16px' }}>Enter the code sent to <b>{sentTo}</b>. It is valid for 10 minutes.</p>
              <OtpBoxes value={otp} onChange={setOtp} onDone={v => verifyOtp(v)} disabled={busy} />
              {devOtp && <div style={{ marginTop: 12, textAlign: 'center', fontSize: F.small, color: C.warning, background: C.warningTint, border: `1px solid ${C.warningEdge}`, borderRadius: R.md, padding: '7px 10px' }}>Local development (no mail server): your code is <b style={numeric}>{devOtp}</b></div>}
              <Btn onClick={() => verifyOtp()} disabled={busy || otp.length !== 6} style={{ width: '100%', marginTop: 16, padding: '13px 18px' }}>{busy ? 'Checking…' : 'Verify & continue'}</Btn>
              <div style={{ textAlign: 'center', marginTop: 12, fontSize: F.small, color: C.muted }}>
                Didn’t get it? {cool > 0 ? <span style={numeric}>Resend in {cool}s</span> : <button type="button" onClick={sendOtp} disabled={busy} style={{ border: 'none', background: 'none', color: C.brand, fontWeight: W.semi, cursor: 'pointer', fontFamily: font, fontSize: F.small }}>Send again</button>} · check spam too
              </div>
            </>}

            {step === 'aadhaar' && <>
              {info.aadhaar_demo && <div style={{ marginTop: 16, fontSize: F.small, color: C.warning, background: C.warningTint, border: `1px solid ${C.warningEdge}`, borderRadius: R.md, padding: '8px 11px', lineHeight: 1.5 }}><b>Demo mode.</b> No UIDAI request is made yet; the code is shown on screen. Live Aadhaar eSign switches on when a licensed provider is connected.</div>}
              {aOtpSent === null ? <>
                <label style={{ display: 'block', fontSize: F.tiny, fontWeight: W.bold, color: C.muted, letterSpacing: '.06em', textTransform: 'uppercase', margin: '18px 0 6px' }}>Aadhaar number</label>
                <input value={aadhaar.replace(/(\d{4})(?=\d)/g, '$1 ')} onChange={e => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" placeholder="XXXX XXXX XXXX" data-no-titlecase
                  style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: R.md, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink, fontSize: 18, letterSpacing: '.12em', fontFamily: font, outline: 'none', ...numeric }} />
                <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 6 }}>Only the last 4 digits are stored. The full number is never saved.</div>
                <Btn onClick={sendAadhaar} disabled={busy || aadhaar.length !== 12} style={{ width: '100%', marginTop: 16, padding: '13px 18px' }}>{busy ? 'Requesting…' : 'Send Aadhaar OTP'}</Btn>
              </> : <>
                <p style={{ fontSize: F.body, color: C.inkSoft, margin: '18px 0 16px' }}>Enter the OTP for Aadhaar <b style={numeric}>XXXX XXXX {aadhaar.slice(-4)}</b>.</p>
                <OtpBoxes value={otp} onChange={setOtp} onDone={v => verifyAadhaar(v)} disabled={busy} />
                {aOtpSent && <div style={{ marginTop: 12, textAlign: 'center', fontSize: F.small, color: C.warning }}>Demo OTP: <b style={numeric}>{aOtpSent}</b></div>}
                <Btn onClick={() => verifyAadhaar()} disabled={busy || otp.length !== 6} style={{ width: '100%', marginTop: 16, padding: '13px 18px' }}>{busy ? 'Checking…' : 'Verify Aadhaar'}</Btn>
              </>}
            </>}

            {err && <div role="alert" style={{ marginTop: 14, fontSize: F.small, color: C.critical, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, borderRadius: R.md, padding: '9px 12px' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.line}`, fontSize: F.tiny, color: C.muted, lineHeight: 1.55 }}>
              <IconLock size={14} /><span>Every step is recorded with time, IP address and device in the audit trail attached to the signed document. EZER Sign never asks for your password.</span>
            </div>
          </Panel>
        </div>
      </Shell>
    )
  }

  // ── Step 5: done ────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <Shell env={env}>
        <StatusScreen icon={<IconCheck size={32} />} tone="positive" title={completed ? 'Signed — the document is complete' : 'Signed. Thank you!'}
          text={completed ? 'Everyone has signed. The final PDF, with its Certificate of Completion, has been e-mailed to all parties.' : 'Your signature has been applied. The next signer has been notified; you’ll get the final copy by e-mail when everyone has signed.'}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Btn kind="secondary" onClick={downloadCopy} disabled={busy}><IconDownload size={16} /> Download {completed ? 'signed PDF' : 'a copy'}</Btn>
          </div>
          <div style={{ textAlign: 'left', marginTop: 22 }}><SignerTimeline signers={info.signers} /></div>
        </StatusScreen>
      </Shell>
    )
  }

  // ── Steps 3–4: review & sign ────────────────────────────────────────────
  return (
    <Shell env={env}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 20, alignItems: 'start' }} className="ez-sign-grid">
        <style>{`@media (max-width: 900px) { .ez-sign-grid { grid-template-columns: 1fr !important; } .ez-sign-side { position: static !important; order: -1; } }`}</style>
        <div ref={viewRef} style={{ minWidth: 0 }}>
          <div style={{ background: C.sunken, borderRadius: R.lg, border: `1px solid ${C.line}`, padding: '18px 4px' }}>
            {doc ? <PdfPages doc={doc} width={width} overlay={pageOverlay} /> : <div style={{ padding: 80, textAlign: 'center', color: C.muted }}>Loading the document…</div>}
          </div>
        </div>

        <aside className="ez-sign-side" style={{ position: 'sticky', top: 84, display: 'grid', gap: 14 }}>
          <Panel pad={20}>
            <div style={{ fontSize: F.tiny, fontWeight: W.bold, color: C.muted, letterSpacing: '.08em', textTransform: 'uppercase' }}>Signing as</div>
            <div style={{ fontWeight: W.bold, fontSize: 16, marginTop: 4 }}>{info.signer.name}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <Pill t="positive"><IconCheck size={12} /> E-mail verified</Pill>
              {info.signer.aadhaar_verified && <Pill t="positive"><IconCheck size={12} /> Aadhaar ••{info.signer.aadhaar_last4}</Pill>}
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: F.small, color: C.muted, marginBottom: 6 }}><span>Fields</span><span style={numeric}><b style={{ color: C.ink }}>{filledCount}</b> of {toFill.length} done</span></div>
              <div style={{ height: 6, borderRadius: 99, background: C.sunken, overflow: 'hidden' }}><div style={{ width: `${toFill.length ? (filledCount / toFill.length) * 100 : 0}%`, height: '100%', background: C.positive, transition: 'width .3s' }} /></div>
            </div>
            <Btn kind="secondary" onClick={goNext} style={{ width: '100%', marginTop: 14 }}><IconPen size={15} /> {filledCount < toFill.length ? 'Go to next field' : 'Review fields'}</Btn>

            {sig && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: R.md, border: `1px solid ${C.line}`, background: C.canvas }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: F.tiny, color: C.muted, fontWeight: W.bold, textTransform: 'uppercase', letterSpacing: '.06em' }}>Your signature</span>
                  <button type="button" onClick={() => { setDraft({ png: null, kind: 'DRAWN' }); setPadFor('SIGNATURE') }} style={{ border: 'none', background: 'none', color: C.brand, fontWeight: W.semi, fontSize: F.small, cursor: 'pointer', fontFamily: font }}>Change</button></div>
                <img src={sig.png} alt="Your signature" style={{ display: 'block', maxHeight: 56, maxWidth: '100%', marginTop: 6 }} />
              </div>
            )}

            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 16, fontSize: F.small, color: C.inkSoft, lineHeight: 1.55, cursor: 'pointer' }}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--ez-brand)' }} />
              <span>I have read this document and agree to sign it electronically. I understand my electronic signature is legally binding, the same as my handwritten signature (Information Technology Act, 2000).</span>
            </label>
            <Btn onClick={submit} disabled={busy || !ready} style={{ width: '100%', marginTop: 16, padding: '13px 18px' }}>{busy ? 'Applying signature…' : <><IconPen size={16} /> Finish & sign</>}</Btn>
            {!sig && <div style={{ fontSize: F.tiny, color: C.muted, textAlign: 'center', marginTop: 8 }}>Click a yellow <b>Sign here</b> box to add your signature.</div>}
            {err && <div role="alert" style={{ marginTop: 12, fontSize: F.small, color: C.critical, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, borderRadius: R.md, padding: '9px 12px' }}>{err}</div>}
          </Panel>

          <Panel pad={16} style={{ boxShadow: 'none' }}>
            <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.55 }}>Something wrong in this document? Don’t sign it — decline and tell {env.sender} why.</div>
            <Btn kind="danger" onClick={() => setDeclining(true)} style={{ width: '100%', marginTop: 10 }}>Decline to sign</Btn>
          </Panel>
        </aside>
      </div>

      {padFor && (
        <Modal title={padFor === 'INITIALS' ? 'Add your initials' : 'Adopt your signature'} onClose={() => setPadFor(null)}
          footer={<><Btn kind="secondary" onClick={() => setPadFor(null)}>Cancel</Btn><Btn onClick={adopt} disabled={!draft.png}><IconCheck size={16} /> Adopt & place</Btn></>}>
          <SignaturePad name={info.signer.name} initials={padFor === 'INITIALS'} onChange={(png, kind) => setDraft({ png, kind })} />
          <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 14, lineHeight: 1.55 }}>Your {padFor === 'INITIALS' ? 'initials' : 'signature'} will be placed in every box marked for you. Under it the document records “Digitally signed by {info.signer.name}”, the date and time (IST), how you were verified, and a reference that ties it to this envelope.</div>
        </Modal>
      )}

      {declining && (
        <Modal title="Decline to sign" onClose={() => setDeclining(false)}
          footer={<><Btn kind="secondary" onClick={() => setDeclining(false)}>Back</Btn><Btn kind="danger" onClick={decline} disabled={busy || reason.trim().length < 3}>Decline</Btn></>}>
          <div style={{ fontSize: F.body, color: C.inkSoft, lineHeight: 1.6 }}>The document will be closed and {env.sender} will be told your reason. They can correct it and send a new one.</div>
          <textarea value={reason} onChange={e => setReason(e.target.value.slice(0, 500))} placeholder="e.g. My joining date is wrong — it should be 1 December." rows={4} data-no-titlecase
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 14, padding: '11px 13px', borderRadius: R.md, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink, fontSize: F.body, fontFamily: font, resize: 'vertical', outline: 'none' }} />
          {err && <div style={{ marginTop: 10, fontSize: F.small, color: C.critical }}>{err}</div>}
        </Modal>
      )}
    </Shell>
  )
}
