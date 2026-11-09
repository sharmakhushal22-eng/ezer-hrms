'use client'
// app/learn/[token]/page.tsx — where a candidate lands from their personal link. Public: they
// have no EZER login. This is often the first thing a new joiner sees of the company, so it
// reads as a welcome, not as a sign-in form or an error.
//
//   1. Welcome     "Hi Cara", and the e-mail the code will go to
//   2. Code        a six-digit code proves the mailbox
//   3. Learning    My Learning and the course player, nothing else
//
// The session lives in sessionStorage, keyed to this link, and goes to the API through
// setCandidateSession (lib/lms/client.ts). A 401 means it ended: back to step 2. Neither the
// link token nor the session is ever logged.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { C, F, W, S, R, E, Z, Button, Card, Skeleton, UIKeyframes, IconCheck, IconMail, IconMobile } from '@/lib/ui'
import { LmsApiError, lmsApi, setCandidateSession } from '@/lib/lms/client'
import { CalmMessage, LearnMark, LearnStyles, Problem, errorWords, firstName, IconPlay, type Dashboard } from '@/components/learning/shared'
import MyLearning from '@/components/learning/MyLearning'
import Player from '@/components/learning/Player'
import { OtpBoxes } from '@/components/esign/ui'

interface LinkInfo { first_name: string; company: string | null; email: string }
type Step = 'loading' | 'invalid' | 'trouble' | 'welcome' | 'code' | 'learning'

const RESEND_S = 30

// Keyed by the start of the link, so the page never stores the whole link token.
const storeKey = (token: string) => `ezer-learn:${token.slice(0, 12)}`
const readSession = (token: string) => { try { return sessionStorage.getItem(storeKey(token)) } catch { return null } }
const writeSession = (token: string, s: string | null) => {
  try { if (s) sessionStorage.setItem(storeKey(token), s); else sessionStorage.removeItem(storeKey(token)) } catch { /* private mode: this tab still works */ }
}

async function pre<T>(body: object): Promise<T> {
  const r = await fetch('/api/lms/pre', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new LmsApiError(j.error || 'Something went wrong. Please try again.', r.status, j)
  return j as T
}

function Shell({ name, children, wide }: { name?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="ezl" style={{ minHeight: '100dvh', background: C.canvas, ['--ezl-top' as string]: '72px', display: 'flex', flexDirection: 'column' }}>
      <UIKeyframes />
      <LearnStyles />
      <header style={{ position: 'sticky', top: 0, zIndex: Z.sticky, background: C.surface, borderBottom: `1px solid ${C.line}` }}>
        <div style={{ maxWidth: 1140, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S.md }}>
          <LearnMark />
          {name && <span style={{ fontSize: F.small, color: C.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>}
        </div>
      </header>
      <main style={{ flex: 1, width: '100%', maxWidth: wide ? 1140 : 480, margin: '0 auto', padding: wide ? '20px 16px 72px' : '32px 16px 72px', boxSizing: 'border-box', minWidth: 0 }}>{children}</main>
    </div>
  )
}

function Reassure({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm + 2, fontSize: F.small, color: C.inkSoft }}>
      <span style={{ width: 28, height: 28, borderRadius: R.md, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</span>
      {children}
    </div>
  )
}

function Welcome({ info, back, busy, err, onSend }: { info: LinkInfo; back: boolean; busy: boolean; err: string; onSend: () => void }) {
  return (
    <Card pad={S.xl} className="ez-rise" style={{ display: 'grid', gap: S.lg, boxShadow: E.raised }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: W.bold, letterSpacing: '-.02em', lineHeight: 1.2 }}>{back ? `Welcome back, ${info.first_name}` : `Hi ${info.first_name}`}</h1>
        <p style={{ margin: '8px 0 0', fontSize: F.body, color: C.inkSoft, lineHeight: 1.6 }}>
          {back ? 'You were away for a while, so we closed your session to keep your learning private. Everything you did is saved.'
            : `${info.company ? `Welcome to ${info.company}. ` : 'Welcome. '}We have put together a few short lessons for you to go through before your first day.`}
        </p>
      </div>
      {!back && (
        <div style={{ display: 'grid', gap: S.sm }}>
          <Reassure icon={<IconPlay size={14} />}>Short lessons you can take at your own pace</Reassure>
          <Reassure icon={<IconCheck size={14} />}>Your progress saves as you go</Reassure>
          <Reassure icon={<IconMobile size={14} />}>Works on your phone or your laptop</Reassure>
        </div>
      )}
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: S.lg, display: 'grid', gap: S.sm }}>
        <div style={{ fontSize: F.small, color: C.muted }}>{back ? 'We will send a new code to ' : 'To keep this private, we will send a one-time code to '}<strong style={{ color: C.ink, fontWeight: W.semi }}>{info.email}</strong>.</div>
        {err && <div role="alert" style={{ fontSize: F.small, color: C.critical }}>{err}</div>}
        <Button variant="primary" size="lg" full disabled={busy} onClick={onSend}>{busy ? 'Sending your code' : 'Send my code'}</Button>
      </div>
    </Card>
  )
}

function CodeStep({ info, busy, err, note, sentAt, onVerify, onResend }: { info: LinkInfo; busy: boolean; err: string; note: string; sentAt: number; onVerify: (otp: string) => void; onResend: () => void }) {
  const [otp, setOtp] = useState('')
  const [wait, setWait] = useState(RESEND_S)
  useEffect(() => {
    const tick = () => setWait(Math.max(0, RESEND_S - Math.floor((Date.now() - sentAt) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [sentAt])
  useEffect(() => { if (err) setOtp('') }, [err])
  return (
    <Card pad={S.xl} className="ez-rise" style={{ display: 'grid', gap: S.lg, textAlign: 'center', boxShadow: E.raised }}>
      <div style={{ width: 44, height: 44, margin: '0 auto', borderRadius: R.lg, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center' }}><IconMail size={20} /></div>
      <div>
        <h1 style={{ margin: 0, fontSize: F.title, fontWeight: W.bold, letterSpacing: '-.01em' }}>Check your e-mail</h1>
        <p style={{ margin: '6px 0 0', fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>We sent a six-digit code to {info.email}. It is valid for 10 minutes.</p>
      </div>
      {note && <div role="status" style={{ fontSize: F.small, color: C.inkSoft, background: C.warningTint, border: `1px solid ${C.warningEdge}`, borderRadius: R.md, padding: `${S.sm + 2}px ${S.md}px`, textAlign: 'left' }}>{note}</div>}
      <OtpBoxes value={otp} onChange={setOtp} onDone={onVerify} disabled={busy} />
      {err && <div role="alert" style={{ fontSize: F.small, color: C.critical }}>{err}</div>}
      <div style={{ fontSize: F.small, color: C.muted }}>
        {wait > 0 ? <span>You can ask for another code in {wait} seconds.</span>
          : <button className="ezl-linkbtn" onClick={onResend} disabled={busy}>Send me a new code</button>}
      </div>
    </Card>
  )
}

function Learning({ onEnded }: { onEnded: () => void }) {
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [off, setOff] = useState(false)
  const [err, setErr] = useState('')
  const [course, setCourse] = useState<string | null>(() => new URLSearchParams(window.location.search).get('course'))

  const load = useCallback(() => {
    lmsApi<Dashboard>('/api/lms/me/dashboard').then(d => { setErr(''); setOff(!d.enabled); if (d.enabled) setDash(d) }).catch(e => {
      if (e instanceof LmsApiError && e.status === 401) onEnded()
      else if (e instanceof LmsApiError && e.status === 403) setOff(true)
      else setErr(errorWords(e))
    })
  }, [onEnded])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onPop = () => { setCourse(new URLSearchParams(window.location.search).get('course')); load() }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [load])

  const open = useCallback((id: string) => {
    setCourse(id)
    window.history.pushState(null, '', `${window.location.pathname}?course=${encodeURIComponent(id)}`)
    window.scrollTo({ top: 0 })
  }, [])
  const close = useCallback(() => {
    setCourse(null)
    window.history.pushState(null, '', window.location.pathname)
    window.scrollTo({ top: 0 })
    load()
  }, [load])

  if (off) return <CalmMessage title="Nothing to do here for now">HR has not turned this on yet. If you were expecting lessons, please ask them.</CalmMessage>
  if (err && !dash) return <Problem message={err} onRetry={load} />
  if (!dash) return <div style={{ display: 'grid', gap: S.md }}><Skeleton w={200} h={22} /><Skeleton h={92} r={R.lg} /><Skeleton h={92} r={R.lg} /></div>
  if (course) return <Player key={course} enrollmentId={course} onClose={close} onOpenCourse={open} onSessionEnded={onEnded} />
  return <MyLearning data={dash} onOpen={open} />
}

export default function CandidateLearn() {
  const { token } = useParams<{ token: string }>()
  const [step, setStep] = useState<Step>('loading')
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [sentAt, setSentAt] = useState(0)
  const [returning, setReturning] = useState(false)
  const verifying = useRef(false)

  const readLink = useCallback(async (next: Step) => {
    try {
      setInfo(await pre<LinkInfo>({ action: 'open', token }))
      setStep(next)
    } catch (e) {
      setStep(e instanceof LmsApiError && e.status === 404 ? 'invalid' : 'trouble')
    }
  }, [token])

  useEffect(() => {
    const saved = readSession(token)
    if (saved) { setCandidateSession(saved); setStep('learning'); return }
    void readLink('welcome')
    return () => setCandidateSession(null)
  }, [token, readLink])

  const send = async (fromWelcome: boolean) => {
    setBusy(true); setErr(''); setNote('')
    try {
      const r = await pre<{ sent: boolean }>({ action: 'send', token })
      if (!r.sent) setNote('We could not send the e-mail just now. Try again in a minute, or ask HR to check your address.')
      setSentAt(Date.now())
      setStep('code')
    } catch (e) {
      const m = errorWords(e)
      if (e instanceof LmsApiError && e.status === 404) setStep('invalid')
      else if (fromWelcome) setErr(m)
      else setNote(m)
    } finally { setBusy(false) }
  }

  const verify = async (otp: string) => {
    if (verifying.current) return
    verifying.current = true
    setBusy(true); setErr('')
    try {
      const r = await pre<{ session: string; name: string }>({ action: 'verify', token, otp })
      setCandidateSession(r.session)
      writeSession(token, r.session)
      setName(r.name)
      setStep('learning')
    } catch (e) {
      if (e instanceof LmsApiError && e.status === 404) setStep('invalid')
      else setErr(errorWords(e))
    } finally { setBusy(false); verifying.current = false }
  }

  const sessionEnded = useCallback(() => {
    setCandidateSession(null)
    writeSession(token, null)
    setErr(''); setNote('')
    setReturning(true)
    void readLink('welcome')
  }, [token, readLink])

  if (step === 'learning') return <Shell wide name={firstName(name)}><Learning onEnded={sessionEnded} /></Shell>
  return (
    <Shell>
      {step === 'loading' && <div style={{ display: 'grid', gap: S.md }}><Skeleton w="50%" h={26} /><Skeleton /><Skeleton w="80%" /><Skeleton h={44} r={R.md} /></div>}
      {step === 'invalid' && <CalmMessage title="This link has come to its end">Links like this are personal and last a limited time. Ask HR for a new one and you can pick up right where you left off.</CalmMessage>}
      {step === 'trouble' && <CalmMessage title="We could not open this just now" action={<Button onClick={() => { setStep('loading'); void readLink('welcome') }}>Try again</Button>}>Check your connection and try once more.</CalmMessage>}
      {step === 'welcome' && info && <Welcome info={info} back={returning} busy={busy} err={err} onSend={() => void send(true)} />}
      {step === 'code' && info && <CodeStep info={info} busy={busy} err={err} note={note} sentAt={sentAt} onVerify={otp => void verify(otp)} onResend={() => void send(false)} />}
    </Shell>
  )
}
