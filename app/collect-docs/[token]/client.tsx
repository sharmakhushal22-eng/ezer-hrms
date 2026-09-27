'use client'
// app/collect-docs/[token]/client.tsx — candidate document upload, gated by an
// email OTP, with a live 24-hour countdown. The candidate proves they own the
// registered email (Get OTP → verify) before any documents are shown or accepted.
import { useCallback, useEffect, useRef, useState } from 'react'
import { COLLECT_DOCS, DOC_GROUPS } from '@/lib/recruitment/collect-docs'

const C = {
  bg: '#F5F3FF', navy: '#1E1B4B', purple: '#7C3AED', pdark: '#4F46E5', card: '#FFFFFF',
  line: '#E9E7F5', muted: '#6B6890', faint: '#9C99B8', ok: '#059669', okbg: '#ECFDF5',
  warn: '#B45309', warnbg: '#FEF3C7', dang: '#DC2626', dangbg: '#FEF2F2',
}
const font = '"DM Sans","Segoe UI",system-ui,sans-serif'

interface DocRow { id: string; doc_type: string; file_name?: string; file_size?: number }
interface State {
  loading: boolean; error?: string
  gate?: 'otp' | 'ok'; authed?: boolean; has_email?: boolean
  valid?: boolean; expired?: boolean; submitted?: boolean
  expires_at?: string; candidate_name?: string; job_title?: string; company_name?: string
  uploaded?: string[]; docs?: DocRow[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const kb = (n?: number) => n ? (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`) : ''
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim())

// Defined at module scope — NOT inside the component — so they keep a stable identity
// across re-renders. (A component defined inline remounts on every keystroke, which
// steals focus from inputs.)
const Page = ({ children }: { children: React.ReactNode }) => (
  <div style={{ minHeight: '100vh', background: C.bg, color: C.navy, fontFamily: font, padding: '0 0 60px' }}>{children}</div>
)
const centered = (icon: string, title: string, msg: string, tone: string, toneBg: string) => (
  <Page><div style={{ maxWidth: 560, margin: '0 auto', padding: '80px 20px', textAlign: 'center' }}>
    <div style={{ fontSize: 52 }}>{icon}</div>
    <div style={{ fontSize: 22, fontWeight: 800, marginTop: 10 }}>{title}</div>
    <div style={{ fontSize: 14, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>{msg}</div>
    <div style={{ marginTop: 16, display: 'inline-block', fontSize: 12, fontWeight: 700, color: tone, background: toneBg, borderRadius: 99, padding: '5px 14px' }}>{title}</div>
  </div></Page>
)

export default function CollectDocsClient({ token }: { token: string }) {
  const [s, setS] = useState<State>({ loading: true })
  const [access, setAccess] = useState<string>('')
  const [remaining, setRemaining] = useState<number>(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // OTP login flow
  const [otpStage, setOtpStage] = useState<'email' | 'code'>('email')
  const [otpEmail, setOtpEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [otpMsg, setOtpMsg] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string>('')

  const storeKey = `collect_access_${token}`
  const authHeaders = useCallback((a?: string) => {
    const tok = a ?? access
    return tok ? { 'x-collect-access': tok } : {}
  }, [access])

  const load = useCallback(async (a?: string) => {
    try {
      const r = await fetch(`/api/collect-docs?token=${encodeURIComponent(token)}`, { cache: 'no-store', headers: authHeaders(a) as any })
      const j = await r.json()
      if (!r.ok) { setS({ loading: false, error: j.error || 'This link is not available.' }); return }
      setS({ loading: false, ...j })
    } catch { setS({ loading: false, error: 'Could not reach the server.' }) }
  }, [token, authHeaders])

  // restore a stored access token (this browser session) then load
  useEffect(() => {
    let a = ''
    try { a = sessionStorage.getItem(storeKey) || '' } catch { /* ignore */ }
    if (a) setAccess(a)
    load(a)
  }, [load, storeKey])

  // countdown
  useEffect(() => {
    if (!s.expires_at) return
    const end = new Date(s.expires_at).getTime()
    const tick = () => setRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)))
    tick(); const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [s.expires_at])

  const docs = s.docs || []
  const filesOf = (type: string) => docs.filter(d => d.doc_type === type)
  const uploaded = new Set(docs.map(d => d.doc_type))
  const mandatory = COLLECT_DOCS.filter(d => d.mandatory)
  const allMandatoryDone = mandatory.every(d => uploaded.has(d.type))
  const doneCount = COLLECT_DOCS.filter(d => uploaded.has(d.type)).length
  const timedOut = remaining <= 0 && !!s.expires_at

  // ── OTP actions ──
  async function requestOtp() {
    if (!emailOk(otpEmail)) { setOtpMsg('Please enter a valid email address.'); return }
    setOtpBusy(true); setOtpMsg(null)
    try {
      const r = await fetch('/api/collect-docs/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: 'request', email: otpEmail.trim() }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setOtpMsg(j.error || 'Could not send the code.'); setOtpBusy(false); return }
      setSentTo(j.sentTo || otpEmail.trim())
      setOtpStage('code')
      setOtpMsg(j.debugOtp ? `Dev code: ${j.debugOtp}` : null)
    } catch { setOtpMsg('Could not reach the server — try again.') }
    setOtpBusy(false)
  }

  async function verifyOtp() {
    if (otpCode.trim().length < 4) { setOtpMsg('Enter the code from your email.'); return }
    setOtpBusy(true); setOtpMsg(null)
    try {
      const r = await fetch('/api/collect-docs/otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: 'verify', email: otpEmail.trim(), otp: otpCode.trim() }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setOtpMsg(j.error || 'Could not verify the code.'); setOtpBusy(false); return }
      const a = j.access as string
      try { sessionStorage.setItem(storeKey, a) } catch { /* ignore */ }
      setAccess(a)
      await load(a)
    } catch { setOtpMsg('Could not reach the server — try again.') }
    setOtpBusy(false)
  }

  // ── document actions ──
  async function upload(docType: string, file: File) {
    setBusy(docType); setNote(null)
    try {
      const fd = new FormData(); fd.append('token', token); fd.append('doc_type', docType); fd.append('file', file)
      const r = await fetch('/api/collect-docs/upload', { method: 'POST', body: fd, headers: authHeaders() as any })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setNote(j.error || 'Upload failed'); setBusy(null); return }
      await load()
    } catch { setNote('Upload failed — try again') }
    setBusy(null)
  }

  async function removeFile(id: string) {
    setRemoving(id); setNote(null)
    try {
      const r = await fetch('/api/collect-docs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ token, action: 'remove', doc_id: id }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setNote(j.error || 'Could not remove'); setRemoving(null); return }
      await load()
    } catch { setNote('Could not remove — try again') }
    setRemoving(null)
  }

  async function submit() {
    setSubmitting(true); setNote(null)
    try {
      const r = await fetch('/api/collect-docs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ token, action: 'submit' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setNote(j.error || 'Could not submit'); setSubmitting(false); return }
      setJustSubmitted(true)
    } catch { setNote('Could not submit — try again') }
    setSubmitting(false)
  }

  if (s.loading) return centered('⏳', 'Loading…', 'Fetching your document request.', C.muted, '#EFEDFB')
  if (s.error) return centered('⚠️', 'Link unavailable', s.error, C.dang, C.dangbg)
  if (s.submitted || justSubmitted) return centered('✅', 'Documents submitted', 'Thank you! Your documents have been received. Our team will proceed with your offer.', C.ok, C.okbg)
  if (s.expired || timedOut) return centered('⌛', 'Link expired', 'This upload link was valid for 24 hours and has expired. Please contact your recruiter to get a fresh link.', C.warn, C.warnbg)

  const hrs = Math.floor(remaining / 3600), mins = Math.floor((remaining % 3600) / 60), secs = remaining % 60
  const urgent = remaining < 3600

  // ── OTP login gate ──
  if (s.gate === 'otp' || !s.authed) {
    const inp: React.CSSProperties = { width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.line}`, background: '#FAFAFF', fontSize: 15, fontFamily: font, color: C.navy, outline: 'none', boxSizing: 'border-box' }
    return (
      <Page>
        <div style={{ background: `linear-gradient(135deg, ${C.purple}, ${C.pdark})`, color: '#fff', padding: '26px 20px 30px' }}>
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', opacity: .85 }}>{s.company_name || 'EZER HRMS'}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>Document Submission</div>
            <div style={{ fontSize: 14, opacity: .92, marginTop: 4 }}>Verify your identity to continue.</div>
          </div>
        </div>
        <div style={{ maxWidth: 480, margin: '-18px auto 0', padding: '0 16px' }}>
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: '22px 20px', boxShadow: '0 6px 20px rgba(30,27,75,0.08)' }}>
            <div style={{ fontSize: 30, textAlign: 'center' }}>🔒</div>
            {otpStage === 'email' ? (
              <>
                <div style={{ fontSize: 17, fontWeight: 800, textAlign: 'center', marginTop: 6 }}>Verify your email</div>
                <div style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 6, lineHeight: 1.5 }}>Enter the email address this link was sent to. We’ll send you a one-time code.</div>
                <div style={{ marginTop: 18 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>Registered email</label>
                  <input style={{ ...inp, marginTop: 6 }} type="email" inputMode="email" autoComplete="email" placeholder="you@email.com"
                    value={otpEmail} onChange={e => setOtpEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') requestOtp() }} />
                </div>
                {otpMsg && <div style={{ fontSize: 12.5, color: C.dang, background: C.dangbg, borderRadius: 8, padding: '8px 12px', marginTop: 12, fontWeight: 600 }}>{otpMsg}</div>}
                <button onClick={requestOtp} disabled={otpBusy}
                  style={{ width: '100%', marginTop: 16, padding: 13, borderRadius: 11, border: 'none', fontFamily: font, fontSize: 15, fontWeight: 800, cursor: 'pointer', background: `linear-gradient(135deg, ${C.purple}, ${C.pdark})`, color: '#fff', opacity: otpBusy ? .6 : 1 }}>
                  {otpBusy ? 'Sending…' : 'Get OTP'}
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 17, fontWeight: 800, textAlign: 'center', marginTop: 6 }}>Enter the code</div>
                <div style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 6, lineHeight: 1.5 }}>We sent a 6-digit code to <b style={{ color: C.navy }}>{sentTo}</b>. It’s valid for 10 minutes.</div>
                <div style={{ marginTop: 18 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>Verification code</label>
                  <input style={{ ...inp, marginTop: 6, letterSpacing: '.4em', textAlign: 'center', fontWeight: 800, fontSize: 22 }} inputMode="numeric" maxLength={6} placeholder="••••••"
                    value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter') verifyOtp() }} />
                </div>
                {otpMsg && <div style={{ fontSize: 12.5, color: otpMsg.startsWith('Dev code') ? C.purple : C.dang, background: otpMsg.startsWith('Dev code') ? '#EFEDFB' : C.dangbg, borderRadius: 8, padding: '8px 12px', marginTop: 12, fontWeight: 600 }}>{otpMsg}</div>}
                <button onClick={verifyOtp} disabled={otpBusy}
                  style={{ width: '100%', marginTop: 16, padding: 13, borderRadius: 11, border: 'none', fontFamily: font, fontSize: 15, fontWeight: 800, cursor: 'pointer', background: `linear-gradient(135deg, ${C.purple}, ${C.pdark})`, color: '#fff', opacity: otpBusy ? .6 : 1 }}>
                  {otpBusy ? 'Verifying…' : 'Verify & Continue'}
                </button>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                  <button onClick={() => { setOtpStage('email'); setOtpCode(''); setOtpMsg(null) }} style={{ border: 'none', background: 'transparent', color: C.muted, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: font }}>← Change email</button>
                  <button onClick={requestOtp} disabled={otpBusy} style={{ border: 'none', background: 'transparent', color: C.purple, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: font }}>Resend code</button>
                </div>
              </>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.faint, textAlign: 'center', marginTop: 14 }}>Only the person this link was sent to can access these documents.</div>
        </div>
      </Page>
    )
  }

  // ── authenticated: the document upload flow ──
  const uploadBtn = (type: string, label: string, primary: boolean) => (
    <>
      <input ref={el => { fileRefs.current[type] = el }} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(type, f); e.currentTarget.value = '' }} />
      <button onClick={() => fileRefs.current[type]?.click()} disabled={busy === type}
        style={{ padding: '7px 14px', borderRadius: 8, fontFamily: font, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
          border: primary ? 'none' : `1px solid ${C.line}`, background: primary ? C.purple : C.card, color: primary ? '#fff' : C.purple, opacity: busy === type ? .6 : 1 }}>
        {busy === type ? 'Uploading…' : label}
      </button>
    </>
  )

  return (
    <Page>
      {/* header */}
      <div style={{ background: `linear-gradient(135deg, ${C.purple}, ${C.pdark})`, color: '#fff', padding: '26px 20px 30px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', opacity: .85 }}>{s.company_name || 'EZER HRMS'}</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6, letterSpacing: '-.01em' }}>Congratulations{s.candidate_name ? `, ${s.candidate_name.split(' ')[0]}` : ''}! 🎉</div>
          <div style={{ fontSize: 14, opacity: .92, marginTop: 4 }}>
            You’ve been selected{s.job_title ? ` for ${s.job_title}` : ''}{s.company_name ? ` at ${s.company_name}` : ''}. Please upload the documents below to move forward.
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '-18px auto 0', padding: '0 16px' }}>
        {/* countdown */}
        <div style={{ background: urgent ? C.dangbg : C.card, border: `1px solid ${urgent ? C.dang + '55' : C.line}`, borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', boxShadow: '0 6px 20px rgba(30,27,75,0.08)' }}>
          <div style={{ fontSize: 26 }}>{urgent ? '⏰' : '⏳'}</div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: urgent ? C.dang : C.muted }}>Time left to submit</div>
            <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: urgent ? C.dang : C.navy, letterSpacing: '.02em' }}>
              {pad(hrs)}<span style={{ opacity: .5 }}>:</span>{pad(mins)}<span style={{ opacity: .5 }}>:</span>{pad(secs)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.muted, textAlign: 'right' }}>Link valid for 24 hours<br />from when it was sent</div>
        </div>

        {/* progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 2px 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Documents</div>
          <div style={{ flex: 1, height: 7, background: '#E9E7F5', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${(doneCount / COLLECT_DOCS.length) * 100}%`, height: '100%', background: C.purple, borderRadius: 99, transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{doneCount}/{COLLECT_DOCS.length}</div>
        </div>

        {/* doc groups */}
        {DOC_GROUPS.map(group => {
          const items = COLLECT_DOCS.filter(d => d.group === group)
          if (!items.length) return null
          return (
            <div key={group} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.purple, marginBottom: 8 }}>{group}</div>
              {items.map(d => {
                const files = filesOf(d.type)
                const done = files.length > 0

                // ── multi-file doc (Aadhaar front/back, appraisal letters) ──
                if (d.multiple) {
                  return (
                    <div key={d.type} style={{ padding: '11px 0', borderTop: `1px solid ${C.line}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 26, height: 26, borderRadius: 7, background: done ? C.ok : '#EFEDFB', color: done ? '#fff' : C.faint, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{done ? '✓' : '•'}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.label}{!d.mandatory && <span style={{ fontSize: 11, color: C.faint, fontWeight: 500 }}> · optional</span>}</div>
                          <div style={{ fontSize: 11, color: done ? C.ok : C.faint, fontWeight: 600 }}>{done ? `${files.length} file${files.length > 1 ? 's' : ''} uploaded` : 'You can upload more than one file'}</div>
                        </div>
                        {uploadBtn(d.type, done ? '+ Add file' : 'Upload', !done)}
                      </div>
                      {files.length > 0 && (
                        <div style={{ marginTop: 8, marginLeft: 38, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {files.map(f => (
                            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: '7px 10px' }}>
                              <span style={{ fontSize: 14 }}>📄</span>
                              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name || 'Document'}</span>
                              {f.file_size ? <span style={{ fontSize: 11, color: C.faint, flexShrink: 0 }}>{kb(f.file_size)}</span> : null}
                              <button onClick={() => removeFile(f.id)} disabled={removing === f.id}
                                style={{ border: 'none', background: 'transparent', color: C.dang, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: font, flexShrink: 0, opacity: removing === f.id ? .5 : 1 }}>
                                {removing === f.id ? '…' : '✕ Remove'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }

                // ── single-file doc ──
                return (
                  <div key={d.type} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: `1px solid ${C.line}` }}>
                    <div style={{ width: 26, height: 26, borderRadius: 7, background: done ? C.ok : '#EFEDFB', color: done ? '#fff' : C.faint, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{done ? '✓' : '•'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.label}{!d.mandatory && <span style={{ fontSize: 11, color: C.faint, fontWeight: 500 }}> · optional</span>}</div>
                      {done && <div style={{ fontSize: 11, color: C.ok, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{files[0].file_name || 'Uploaded'} ✓</div>}
                    </div>
                    {done && (
                      <button onClick={() => removeFile(files[0].id)} disabled={removing === files[0].id}
                        style={{ padding: '7px 12px', borderRadius: 8, fontFamily: font, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', border: `1px solid ${C.dang}44`, background: C.dangbg, color: C.dang, opacity: removing === files[0].id ? .5 : 1 }}>
                        {removing === files[0].id ? '…' : 'Remove'}
                      </button>
                    )}
                    {uploadBtn(d.type, done ? 'Replace' : 'Upload', !done)}
                  </div>
                )
              })}
            </div>
          )
        })}

        {note && <div style={{ fontSize: 13, color: C.dang, background: C.dangbg, border: `1px solid ${C.dang}33`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontWeight: 600 }}>{note}</div>}

        {/* submit */}
        <div style={{ position: 'sticky', bottom: 0, background: C.bg, padding: '12px 0 4px' }}>
          <button onClick={submit} disabled={!allMandatoryDone || submitting}
            style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', fontFamily: font, fontSize: 15, fontWeight: 800, cursor: allMandatoryDone && !submitting ? 'pointer' : 'not-allowed',
              background: allMandatoryDone ? `linear-gradient(135deg, ${C.purple}, ${C.pdark})` : '#CBC7E6', color: '#fff', boxShadow: allMandatoryDone ? '0 8px 22px rgba(124,58,237,0.35)' : 'none' }}>
            {submitting ? 'Submitting…' : allMandatoryDone ? 'Submit all documents' : `Upload all required documents to submit (${mandatory.filter(d => uploaded.has(d.type)).length}/${mandatory.length})`}
          </button>
          <div style={{ fontSize: 11, color: C.faint, textAlign: 'center', marginTop: 8 }}>PDF, JPG, PNG or WEBP · up to 8 MB each · your information is kept confidential</div>
        </div>
      </div>
    </Page>
  )
}
