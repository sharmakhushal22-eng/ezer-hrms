// app/onboarding/[token]/client.tsx
// 12-step joining wizard the candidate opens from the onboarding link, with AI doc verification.
//
// Layout: a "journey" rail on the left (company, the joiner, progress, the 12 steps grouped
// into four phases) and the current step on the right. On a phone the rail becomes a compact
// progress bar at the top. Hover, focus and the responsive collapse live in onboarding.css.
'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import {
  C as TK, IconCheck, IconUpload, IconAlert, IconLock, IconUser, IconCalendar, IconBuilding,
  IconLetters, IconPolicies, IconCard, IconEmployees, IconCompliance, IconAi, IconClock, IconMail,
  IconDownload, IconPayroll, IconLeave, IconHome,
} from '@/lib/ui'
import './onboarding.css'
import { missingFor, missingFields, describeMissing } from '@/lib/onboarding/required'

// ── Types ────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
interface DocStatus { doc_code: string; ai_status: string; ai_extracted_data: any; ai_confidence: number; ai_flags: string[]; file_name: string; hr_notes?: string | null; hr_verified?: boolean | null }
/** HR rejected this file (the review on the onboarding card); a new upload clears it. */
const isRejected = (d?: DocStatus | null) => !!d && d.hr_verified === false
const rejectReason = (d?: DocStatus | null) => (d?.hr_notes || '').replace(/^Rejected:\s*/i, '')

// ── EZER Theme ───────────────────────────────────────────────────
// Inputs are white with a neutral edge and a blue focus ring (onboarding.css). An empty
// required field used to be painted pink from the first second, so a fresh form looked
// like it was already full of errors; it now carries only a faint red edge.
const P = TK.brand
const S = {
  page: { minHeight: '100vh', color: TK.ink } as const,
  card: { background: TK.surface, borderRadius: 18, border: `1px solid ${TK.line}`, padding: 'clamp(18px, 4vw, 24px) clamp(16px, 4vw, 26px)', marginBottom: 16, boxShadow: '0 1px 2px rgba(16,24,40,.04), 0 12px 32px -24px rgba(16,24,40,.28)' } as const,
  lbl: { fontSize: 12.5, fontWeight: 600, color: TK.inkSoft, display: 'block', marginBottom: 6 },
  inp: (err = false) => ({ width: '100%', height: 44, padding: '0 13px', background: TK.surface, border: `1px solid ${err ? TK.criticalEdge : TK.lineStrong}`, borderRadius: 11, color: TK.ink, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' }),
  sel: { width: '100%', height: 44, padding: '0 12px', background: TK.surface, border: `1px solid ${TK.lineStrong}`, borderRadius: 11, color: TK.ink, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', cursor: 'pointer' },
  btnP: { height: 48, padding: '0 26px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 14.5, fontWeight: 650, fontFamily: 'inherit', background: `linear-gradient(180deg, ${TK.brand}, ${TK.brandDeep})`, color: TK.onAccent, boxShadow: `0 10px 22px -12px ${TK.brand}` } as const,
  btnO: { height: 48, padding: '0 20px', borderRadius: 12, border: `1px solid ${TK.lineStrong}`, cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', background: TK.surface, color: TK.inkSoft } as const,
  g2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as const,
  g3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 } as const,
}

// A repeating group inside a step (an employer, a qualification, a family member).
const BLOCK: React.CSSProperties = { border: `1px solid ${TK.line}`, borderRadius: 14, padding: '14px 16px 4px', marginBottom: 12, background: TK.sunken }
const BLOCK_TITLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, fontWeight: 700, color: TK.ink }
const BLOCK_NO: React.CSSProperties = { width: 24, height: 24, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 800, background: TK.surface, color: TK.brand, border: `1px solid ${TK.brandEdge}`, flexShrink: 0 }
const REMOVE_BTN: React.CSSProperties = { height: 30, padding: '0 11px', borderRadius: 9, border: `1px solid ${TK.criticalEdge}`, background: TK.surface, color: TK.critical, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }
const ADD_BTN: React.CSSProperties = { height: 42, padding: '0 16px', borderRadius: 12, border: `1px dashed ${TK.brandEdge}`, background: TK.brandTint, color: TK.brand, fontSize: 13.5, fontWeight: 650, fontFamily: 'inherit', cursor: 'pointer', width: '100%' }

const STEPS = ['Welcome', 'Documents', 'AI Review', 'Personal', 'KYC & EPF', 'Nominees', 'ESIC & Family', 'Education', 'Forms Review', 'Policies', 'ACK Doc', 'Aadhaar']

/** What each step is called on screen, and the line under its title. Index = step - 1. */
const STEP_META: { title: string; desc: string; phase: number }[] = [
  { phase: 0, title: 'Welcome aboard', desc: 'A quick identity check, then about 15 minutes of joining formalities. Your progress is saved after every step, so you can stop and come back.' },
  { phase: 1, title: 'Upload your documents', desc: 'Each file is read and checked automatically as you upload it. JPG, PNG or PDF, up to 5 MB each.' },
  { phase: 1, title: 'Check what we read', desc: 'These details were picked up from your documents. You can correct anything in the next steps.' },
  { phase: 2, title: 'Personal details', desc: 'As they appear on your Aadhaar. These go on your PF and gratuity forms.' },
  { phase: 2, title: 'Contact, PAN, PF & bank', desc: 'Where to reach you, and where your salary goes. Bank details are encrypted and only Payroll can see them.' },
  { phase: 2, title: 'Your nominees', desc: 'Who receives your PF, pension and gratuity benefits. The PF shares should add up to 100%.' },
  { phase: 2, title: 'ESIC & family', desc: 'Your salary falls under ESIC, so we need your family details for medical cover and the e-Pehchan card.' },
  { phase: 2, title: 'Emergency contacts, work & education', desc: 'Who to call in an emergency, where you have worked before, and your qualifications.' },
  { phase: 3, title: 'Review your forms', desc: 'Your EPF and gratuity forms, filled in from your answers. Check each one before you sign.' },
  { phase: 3, title: 'Company policies', desc: 'Read and acknowledge each policy. Mandatory ones must be done before you can continue.' },
  { phase: 3, title: 'Your acknowledgement', desc: 'A summary of what you are confirming. A copy is emailed to you after you sign.' },
  { phase: 3, title: 'Sign with Aadhaar', desc: 'One OTP e-signs every form and acknowledgement at once.' },
]
const PHASES = ['Get started', 'Documents', 'Your details', 'Review & sign']

const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal']
const COUNTRIES = ['India', 'United States', 'United Kingdom', 'United Arab Emirates', 'Canada', 'Australia', 'Germany', 'France', 'Singapore', 'Japan', 'China', 'Nepal', 'Bangladesh', 'Sri Lanka', 'Pakistan', 'Bhutan', 'Myanmar', 'Maldives', 'Afghanistan', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Malaysia', 'Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'South Korea', 'Hong Kong', 'Taiwan', 'New Zealand', 'Ireland', 'Netherlands', 'Belgium', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Italy', 'Spain', 'Portugal', 'Austria', 'Poland', 'Russia', 'Turkey', 'Israel', 'Egypt', 'South Africa', 'Nigeria', 'Kenya', 'Mauritius', 'Brazil', 'Mexico', 'Argentina', 'Chile', 'Luxembourg', 'Greece', 'Czech Republic', 'Hungary', 'Other']

// ── Misc helpers ──────────────────────────────────────────────────
const ageFromDob = (dob: string) => dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : 0

// ── Field helpers ─────────────────────────────────────────────────
// A trailing " *" in a label is drawn as a small red asterisk rather than typed text.
const Fld = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => {
  const req = /\s\*$/.test(label)
  const text = req ? label.replace(/\s\*$/, '') : label
  return (
    <div style={{ marginBottom: 14, minWidth: 0 }}>
      <label style={S.lbl}>{text}{req && <span style={{ color: TK.critical, marginLeft: 3 }}>*</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: TK.faint, marginTop: 5 }}>{hint}</div>}
    </div>
  )
}

/** A heading inside a card: icon tile, title, hairline to the right. */
const Sec = ({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) => (
  <div className="ezo-sec">{icon && <span className="ezo-sec-ic">{icon}</span>}<span>{children}</span></div>
)

/** A soft notice line inside a card. */
const Note = ({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn' | 'bad'; children: React.ReactNode }) => {
  const t = { info: [TK.brandTint, TK.brandEdge, TK.brandDeep], ok: [TK.positiveTint, TK.positiveEdge, TK.positive], warn: [TK.warningTint, TK.warningEdge, TK.warning], bad: [TK.criticalTint, TK.criticalEdge, TK.critical] }[tone]
  const Ic = tone === 'ok' ? IconCheck : tone === 'info' ? IconLock : IconAlert
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: t[0], border: `1px solid ${t[1]}`, color: t[2], borderRadius: 12, padding: '10px 14px', fontSize: 13, lineHeight: 1.55, margin: '0 0 14px' }}>
      <span style={{ display: 'flex', marginTop: 2, flexShrink: 0 }}><Ic size={15} strokeWidth={2} /></span><span>{children}</span>
    </div>
  )
}

// ── API helper ────────────────────────────────────────────────────
async function api(path: string, body: any, method = 'POST') {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

// ── Toast ─────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: string; type: 'ok' | 'err' }) {
  return (
    <div className="ezo-toast ezo-noprint" role="status" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, borderRadius: 14, padding: '12px 18px', fontSize: 13.5, fontWeight: 600, background: TK.ink, color: TK.surface, boxShadow: '0 18px 40px -16px rgba(0,0,0,.5)', maxWidth: 'calc(100vw - 32px)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, background: type === 'ok' ? TK.positive : TK.critical, color: TK.onAccent }}>
        {type === 'ok' ? <IconCheck size={13} strokeWidth={2.6} /> : <IconAlert size={13} strokeWidth={2.4} />}
      </span>
      {msg}
    </div>
  )
}

// ── Journey: progress ring, step list, rail and phone bar ─────────
const initialsOf = (n: string) => (n || '').replace(/^CLAUDE TEST\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
const pctOf = (step: Step) => Math.round(((step - 1) / STEPS.length) * 100)

function Ring({ pct }: { pct: number }) {
  const r = 23, c = 2 * Math.PI * r
  return (
    <div className="ezo-ring" aria-hidden>
      <svg viewBox="0 0 54 54"><circle className="t" cx="27" cy="27" r={r} /><circle className="f" cx="27" cy="27" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} /></svg>
      <i>{pct}%</i>
    </div>
  )
}

function JourneyRail({ current, candidate, company, esic, saving }: { current: Step; candidate: any; company: any; esic: boolean; saving: boolean }) {
  const pct = pctOf(current)
  const doj = candidate.date_of_joining ? new Date(candidate.date_of_joining).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null
  return (
    <aside className="ezo-rail ezo-noprint" aria-label="Your joining journey">
      <div className="ezo-co">
        <div className="ezo-mono">{(company?.company_code || initialsOf(company?.company_name || 'EZ')).slice(0, 3)}</div>
        <div style={{ minWidth: 0 }}><b>{company?.company_name || 'Your new company'}</b><span>Joining formalities</span></div>
      </div>

      <div className="ezo-me">
        <div className="ezo-me-top">
          <div className="ezo-av">{initialsOf(candidate.full_name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="ezo-me-name">{candidate.full_name}</div>
            <div className="ezo-me-role">{[candidate.designation, candidate.department].filter(Boolean).join(' · ') || 'New joiner'}</div>
          </div>
        </div>
        <div className="ezo-facts">
          {doj && <span className="ezo-chip is-brand"><IconCalendar size={12} strokeWidth={2} />Joins {doj}</span>}
          {esic && <span className="ezo-chip">ESIC applicable</span>}
        </div>
      </div>

      <div className="ezo-progress">
        <Ring pct={pct} />
        <div><b>{pct === 0 ? 'Let’s get started' : pct >= 90 ? 'Almost there' : `${STEPS.length - current + 1} steps to go`}</b><span>Step {current} of {STEPS.length}</span></div>
      </div>

      <nav className="ezo-steps" aria-label="Steps">
        {PHASES.map((ph, pi) => (
          <div key={ph}>
            <div className="ezo-phase-label">{ph}</div>
            {STEPS.map((s, i) => STEP_META[i].phase !== pi ? null : (() => {
              const n = (i + 1) as Step
              const skip = n === 7 && !esic
              const cls = skip ? 'is-skip' : n < current ? 'is-done' : n === current ? 'is-now' : ''
              return (
                <div key={s} className={`ezo-step ${cls}`} aria-current={n === current ? 'step' : undefined}>
                  <span className="ezo-dot">{n < current && !skip ? <IconCheck size={12} strokeWidth={3} /> : n}</span>{s}
                </div>
              )
            })())}
          </div>
        ))}
      </nav>

      <div className="ezo-rail-foot">
        <div><IconClock size={14} />{saving ? 'Saving your progress…' : 'Progress saves after every step'}</div>
        <div><IconLock size={14} />Your data is encrypted and private</div>
      </div>
    </aside>
  )
}

function PhoneBar({ current, company }: { current: Step; company: any }) {
  const pct = pctOf(current)
  return (
    <div className="ezo-top ezo-noprint">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="ezo-mono" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 12 }}>{(company?.company_code || 'EZ').slice(0, 3)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{STEPS[current - 1]}</div>
          <div style={{ fontSize: 11.5, color: TK.muted }}>{PHASES[STEP_META[current - 1].phase]} · Step {current} of {STEPS.length}</div>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: TK.brand }}>{pct}%</span>
      </div>
      <div style={{ display: 'flex', gap: 3, marginTop: 10 }}>
        {STEPS.map((s, i) => (
          <span key={s} style={{ flex: 1, height: 4, borderRadius: 99, background: i + 1 < current ? TK.positive : i + 1 === current ? TK.brand : TK.line }} />
        ))}
      </div>
    </div>
  )
}

function StepHeader({ step, extra }: { step: Step; extra?: React.ReactNode }) {
  const m = STEP_META[step - 1]
  return (
    <header className="ezo-head" key={step}>
      <div className="ezo-eyebrow">{PHASES[m.phase]} <span>· Step {step} of {STEPS.length}</span></div>
      <h1>{m.title}</h1>
      <p>{m.desc}</p>
      {extra}
    </header>
  )
}

// ── Document upload tile ──────────────────────────────────────────
function DocUpload({
  docCode, docName, required, token,
  status, onSuccess, onRemoved, compact,
}: {
  docCode: string; docName: string; required: boolean; token: string
  status: DocStatus | null
  onSuccess: (code: string, data: any) => void
  onRemoved: (code: string) => void
  /** inside an employer / qualification block: a single slim row */
  compact?: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const fileUrl = (mode: 'view' | 'download') => `/api/onboarding/document?token=${encodeURIComponent(token)}&doc_code=${encodeURIComponent(docCode)}&mode=${mode}`
  const remove = async () => {
    if (!status || removing) return
    if (!confirm(`Remove ${docName} from your form?`)) return
    setRemoving(true)
    try {
      const r = await fetch('/api/onboarding/document', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, doc_code: docCode }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not remove')
      onRemoved(docCode)
    } catch (e: any) { alert(e.message) }
    setRemoving(false)
  }
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setErr('')
    // Validate
    const maxMB = 5
    if (file.size > maxMB * 1024 * 1024) { setErr(`That file is over ${maxMB} MB. Try a smaller scan or photo.`); return }
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
    if (!allowed.includes(file.type)) { setErr('Only JPG, PNG or PDF files can be uploaded.'); return }

    setUploading(true)
    setProgress('Uploading…')

    const fd = new FormData()
    fd.append('token', token)
    fd.append('doc_code', docCode)
    fd.append('file', file)

    try {
      setProgress('Checking your document…')
      const res = await fetch('/api/onboarding/verify-document', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setProgress('')
      onSuccess(docCode, data)
    } catch (e: any) {
      setErr('Upload failed: ' + e.message)
      setProgress('')
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => upload(e.target.files?.[0])

  const aiStatus = status?.ai_status
  // The file is saved whenever a record exists. MISMATCH is the only real warning;
  // FAILED just means AI auto-check was skipped (no AI key) — the upload still succeeded.
  const rejected = isRejected(status)
  const isMismatch = aiStatus === 'MISMATCH' && !rejected
  const isOk = !!status && !isMismatch && !rejected

  const tone = rejected ? { bg: TK.criticalTint, edge: TK.criticalEdge, fg: TK.critical }
    : isMismatch ? { bg: TK.warningTint, edge: TK.warningEdge, fg: TK.warning }
    : isOk ? { bg: TK.positiveTint, edge: TK.positiveEdge, fg: TK.positive }
    : { bg: TK.brandTint, edge: TK.brandEdge, fg: TK.brand }
  const statusLine = uploading ? progress
    : err ? err
    : !status ? (required ? 'Required' : 'Optional')
    : rejected ? `HR rejected this file${rejectReason(status) ? `: ${rejectReason(status)}` : ''}. Upload a new copy.`
    : status.hr_verified === true ? 'Accepted by HR'
    : aiStatus === 'VERIFIED' ? `Verified · ${Math.round((status.ai_confidence || 0) * 100)}% match`
    : isMismatch ? 'Flagged for HR to review'
    : 'Uploaded · HR will verify'
  const carried = !!status?.hr_notes && /carried over/i.test(status.hr_notes)
  const extracted = status?.ai_extracted_data && Object.keys(status.ai_extracted_data).length > 0
    ? Object.entries(status.ai_extracted_data).slice(0, 3).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ') : ''
  const link: React.CSSProperties = { fontSize: 11.5, fontWeight: 650, color: TK.brandDeep, textDecoration: 'none', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }

  return (
    <div className={`ezo-doc${drag ? ' is-drag' : ''}`}
      onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]) }}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: compact ? '10px 12px' : '14px 14px', borderRadius: 14, minWidth: 0,
               border: `1px ${status ? 'solid' : 'dashed'} ${status ? tone.edge : TK.lineStrong}`, background: status ? tone.bg : TK.surface, marginTop: compact ? 6 : 0 }}>
      <span style={{ width: compact ? 34 : 42, height: compact ? 34 : 42, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center',
                     background: status ? TK.surface : tone.bg, color: tone.fg, border: `1px solid ${tone.edge}` }}>
        {uploading ? <IconClock size={18} /> : (isMismatch || rejected) ? <IconAlert size={18} strokeWidth={2} /> : isOk ? <IconCheck size={18} strokeWidth={2.4} /> : <IconLetters size={18} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650, lineHeight: 1.3 }}>{docName}{required && !status && <span style={{ color: TK.critical, marginLeft: 3 }}>*</span>}</div>
        <div style={{ fontSize: 12, marginTop: 2, color: err ? TK.critical : status ? tone.fg : TK.faint, fontWeight: status ? 600 : 500 }}>{statusLine}</div>
        {carried && !rejected && <div style={{ fontSize: 11.5, color: TK.brandDeep, marginTop: 3 }}>Already with us, from the documents you sent before the offer. Replace it if you have a better copy.</div>}
        {extracted && !compact && <div style={{ fontSize: 11.5, color: TK.muted, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{extracted}</div>}
        {status && (
          <div style={{ display: 'flex', gap: 12, marginTop: 5 }}>
            <a href={fileUrl('view')} target="_blank" rel="noreferrer" style={link}>View</a>
            <a href={fileUrl('download')} style={link}>Download</a>
            <button type="button" onClick={remove} disabled={removing} style={{ ...link, color: TK.critical, opacity: removing ? .6 : 1 }}>{removing ? 'Removing…' : 'Remove'}</button>
          </div>
        )}
      </div>
      <button className="ezo-btn" onClick={() => inputRef.current?.click()} disabled={uploading}
        style={{ height: 34, padding: '0 13px', borderRadius: 10, flexShrink: 0, cursor: uploading ? 'not-allowed' : 'pointer', fontSize: 12.5, fontWeight: 650, fontFamily: 'inherit',
                 display: 'inline-flex', alignItems: 'center', gap: 6, opacity: uploading ? .6 : 1,
                 border: `1px solid ${status ? TK.lineStrong : TK.brand}`, background: status ? TK.surface : TK.brand, color: status ? TK.inkSoft : TK.onAccent }}>
        {!status && <IconUpload size={14} strokeWidth={2} />}{status ? 'Replace' : 'Upload'}
      </button>
      <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  )
}

// ── Document list + reusable upload grid (used in Step 2 AND the pre-Policies gate) ──
const DOC_LIST = (esic: boolean, isFresher: boolean, isForeign = false) => [
  { code: 'AADHAAR_FRONT', name: 'Aadhaar Card (Front)', required: true },
  { code: 'AADHAAR_BACK', name: 'Aadhaar Card (Back)', required: true },
  { code: 'PAN', name: 'PAN Card', required: true },
  { code: 'PHOTO', name: 'Passport Size Photo', required: true },
  ...(esic ? [{ code: 'FAMILY_PHOTO', name: 'Family Photo (for ESIC e-Pehchan card)', required: true }] : []),
  { code: 'DEGREE', name: 'Highest Degree Certificate', required: true },
  { code: 'EXP_LETTER', name: 'Experience / Relieving Letter', required: !isFresher },
  { code: 'BANK_PROOF', name: 'Cancelled Cheque / Bank Passbook', required: true },
  { code: 'UAN_CARD', name: 'UAN Card (if you have PF already)', required: false },
  // Optional: these arrive filled in when they were collected before the offer.
  { code: 'MARKSHEET_10', name: '10th Mark Sheet', required: false },
  { code: 'MARKSHEET_12', name: '12th Mark Sheet', required: false },
  { code: 'MASTERS', name: 'Post-graduation / Masters Certificate', required: false },
  { code: 'OTHER_CERT', name: 'Other Certificate', required: false },
  { code: 'APPOINTMENT_LETTER', name: 'Previous Appointment Letter', required: false },
  { code: 'APPRAISAL_LETTER', name: 'Previous Appraisal Letter', required: false },
  { code: 'SALARY_SLIP_1', name: 'Salary Slip (latest month)', required: false },
  { code: 'SALARY_SLIP_2', name: 'Salary Slip (2nd last month)', required: false },
  { code: 'SALARY_SLIP_3', name: 'Salary Slip (3rd last month)', required: false },
  { code: 'FORM_16', name: 'Form 16 (previous employer)', required: false },
  ...(isForeign ? [
    { code: 'PASSPORT', name: 'Passport (front page)', required: true },
    { code: 'VISA', name: 'Visa copy', required: true },
    { code: 'WORK_PERMIT', name: 'Work Permit', required: false },
  ] : []),
]
const REQUIRED_DOC_CODES = (esic: boolean) => ['AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'PHOTO', 'DEGREE', 'BANK_PROOF', ...(esic ? ['FAMILY_PHOTO'] : [])]
function DocsGrid({ docs, token, esicApplicable, isFresher, isForeign = false, onUploaded, onRemoved }: {
  docs: Record<string, DocStatus>; token: string; esicApplicable: boolean; isFresher: boolean; isForeign?: boolean; onUploaded: (code: string, data: any) => void; onRemoved: (code: string) => void
}) {
  const list = DOC_LIST(esicApplicable, isFresher, isForeign)
  const req = list.filter(d => d.required)
  const done = req.filter(d => docs[d.code] && !isRejected(docs[d.code])).length
  const carried = Object.values(docs).filter(d => d.hr_notes && /carried over/i.test(d.hr_notes)).length
  const rejected = list.filter(d => isRejected(docs[d.code]))
  const optional = list.filter(d => !d.required && !docs[d.code])
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 8, borderRadius: 99, background: TK.sunken, overflow: 'hidden' }}>
          <div style={{ width: `${req.length ? (done / req.length) * 100 : 0}%`, height: '100%', borderRadius: 99, background: done === req.length ? TK.positive : TK.brand, transition: 'width .4s ease' }} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: done === req.length ? TK.positive : TK.inkSoft, whiteSpace: 'nowrap' }}>{done} of {req.length} required uploaded</span>
      </div>
      {rejected.length > 0 && (
        <Note tone="warn">
          <b>HR has rejected {rejected.length} document{rejected.length === 1 ? '' : 's'}.</b> Upload a new copy of each before you submit again:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{rejected.map(d => <li key={d.code}>{d.name}{rejectReason(docs[d.code]) ? `: ${rejectReason(docs[d.code])}` : ''}</li>)}</ul>
        </Note>
      )}
      {carried > 0 && (
        <Note>{carried} document{carried === 1 ? '' : 's'} you sent before the offer {carried === 1 ? 'is' : 'are'} already here. Check each one: view, download, replace or remove it.</Note>
      )}
      <div className="ezo-docs">
        {list.filter(d => d.required || docs[d.code]).map(doc => (
          <DocUpload key={doc.code} docCode={doc.code} docName={doc.name} required={doc.required} token={token} status={docs[doc.code] || null} onSuccess={onUploaded} onRemoved={onRemoved} />
        ))}
      </div>
      {optional.length > 0 && (
        <details className="ezo-more-docs" style={{ marginTop: 14 }}>
          <summary style={{ fontSize: 13, color: TK.brandDeep, cursor: 'pointer', fontWeight: 650 }}>More documents (optional) · {optional.length}</summary>
          <div className="ezo-docs" style={{ marginTop: 10 }}>
            {optional.map(doc => (
              <DocUpload key={doc.code} docCode={doc.code} docName={doc.name} required={false} token={token} status={null} onSuccess={onUploaded} onRemoved={onRemoved} />
            ))}
          </div>
        </details>
      )}
      <div style={{ fontSize: 12, color: TK.faint, marginTop: 12 }}>Tip: you can drag a file straight onto a tile.</div>
    </>
  )
}

// ── Phase 2: AI document-extraction review table ──────────────────
function AIReviewTable({ docs }: { docs: Record<string, DocStatus> }) {
  const aadhaar = docs['AADHAAR_FRONT']?.ai_extracted_data || {}
  const pan = docs['PAN']?.ai_extracted_data || {}
  const bank = docs['BANK']?.ai_extracted_data || docs['BANK_PROOF']?.ai_extracted_data || {}
  const srcConf = (d?: DocStatus | null) => Math.round(((d?.ai_confidence) || 0) * 100)
  const rows: { field: string; value: any; conf: number; src?: DocStatus }[] = [
    { field: 'Full name', value: aadhaar.name || pan.name || '', conf: srcConf(docs['AADHAAR_FRONT'] || docs['PAN']), src: docs['AADHAAR_FRONT'] || docs['PAN'] },
    { field: 'Date of birth', value: aadhaar.dob || '', conf: srcConf(docs['AADHAAR_FRONT']), src: docs['AADHAAR_FRONT'] },
    { field: 'PAN number', value: pan.pan_number || '', conf: srcConf(docs['PAN']), src: docs['PAN'] },
    { field: 'Bank account', value: bank.account_number || bank.account || '', conf: srcConf(docs['BANK'] || docs['BANK_PROOF']), src: docs['BANK'] || docs['BANK_PROOF'] },
    { field: 'IFSC', value: bank.ifsc || '', conf: srcConf(docs['BANK'] || docs['BANK_PROOF']), src: docs['BANK'] || docs['BANK_PROOF'] },
  ]
  if (!rows.some(r => r.value)) return null
  return (
    <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${TK.line}` }}>
        <span className="ezo-sec-ic"><IconAi size={15} /></span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Read from your documents</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
        <thead>
          <tr style={{ background: TK.sunken }}>
            {['Field', 'Value we read', 'Match', 'Status'].map(h => <th key={h} style={{ padding: '9px 18px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: TK.faint, textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const mismatch = r.src?.ai_status === 'MISMATCH'
            const ok = !!r.value && r.conf >= 80 && !mismatch
            return (
              <tr key={r.field} style={{ borderTop: `1px solid ${TK.line}`, background: mismatch ? TK.criticalTint : 'transparent' }}>
                <td style={{ padding: '11px 18px', color: TK.muted }}>{r.field}</td>
                <td style={{ padding: '11px 18px', fontWeight: 600 }}>{r.value || <span style={{ color: TK.faint, fontWeight: 500 }}>Not found</span>}</td>
                <td style={{ padding: '11px 18px' }}>{r.value ? <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: ok ? TK.positiveTint : TK.warningTint, color: ok ? TK.positive : TK.warning }}>{r.conf}%</span> : '—'}</td>
                <td style={{ padding: '11px 18px', fontWeight: 600 }}>{!r.value ? <span style={{ color: TK.faint }}>You’ll type it in</span> : mismatch ? <span style={{ color: TK.critical }}>Doesn’t match</span> : ok ? <span style={{ color: TK.positive }}>Verified</span> : <span style={{ color: TK.warning }}>Please double-check</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}

// ── Phase 8: read-only statutory form previews (Form 11/2/F/ESIC) ──
function FormRow({ l, v }: { l: string; v: any }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: `1px solid ${TK.line}` }}>
      <span style={{ fontSize: 13, color: TK.muted }}>{l}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: v ? TK.ink : TK.faint, textAlign: 'right' }}>{v || 'Not given'}</span>
    </div>
  )
}
function StatutoryFormCard({ code, title, rows }: { code: string; title: string; rows: [string, any][] }) {
  const [ok, setOk] = useState(false)
  return (
    <div style={{ ...S.card, border: `1px solid ${ok ? TK.positiveEdge : TK.line}`, position: 'relative', overflow: 'hidden' }}>
      {/* a paper-form feel: a coloured top edge and the form number as a stamp */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, background: ok ? TK.positive : `linear-gradient(90deg, ${TK.brand}, ${TK.info})` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: TK.brand, background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, padding: '3px 9px', borderRadius: 8 }}>{code}</span>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
        {ok && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, color: TK.positive }}><IconCheck size={14} strokeWidth={2.6} />Checked</span>}
      </div>
      <div>{rows.map(([l, v]) => <FormRow key={l} l={l} v={v} />)}</div>
      {!ok && <button className="ezo-btn" onClick={() => setOk(true)} style={{ ...S.btnO, marginTop: 16, height: 40, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, color: TK.positive, borderColor: TK.positiveEdge }}><IconCheck size={14} strokeWidth={2.4} />This looks correct</button>}
    </div>
  )
}
// The official form (EPF 11 / EPF 2 / ESIC 1) filled in by /api/onboarding/forms and shown as the
// PDF itself; the candidate reads it and confirms. Phones that cannot show a PDF inline get the
// Open button.
function PdfFormCard({ code, title, token, form, note }: { code: string; title: string; token: string; form: 'form11' | 'form2' | 'esic1' | 'formf'; note: string }) {
  const [ok, setOk] = useState(false)
  const url = `/api/onboarding/forms?form=${form}&token=${encodeURIComponent(token)}`
  return (
    <div style={{ ...S.card, border: `1px solid ${ok ? TK.positiveEdge : TK.brandTint}`, background: ok ? TK.positiveTint : TK.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: TK.brand, background: TK.brandTint, padding: '2px 8px', borderRadius: 99 }}>{code}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <a href={url} target="_blank" rel="noreferrer" style={{ ...S.btnO, fontSize: 11, padding: '5px 10px', textDecoration: 'none' }}>Open ↗</a>
          <a href={`${url}&mode=download`} style={{ ...S.btnO, fontSize: 11, padding: '5px 10px', textDecoration: 'none' }}>Download</a>
        </span>
        {ok && <span style={{ fontSize: 11, fontWeight: 600, color: TK.positive }}>Looks correct</span>}
      </div>
      <div style={{ fontSize: 11.5, color: TK.muted, marginBottom: 8 }}>{note} If anything is wrong, go back to the step and correct it — the form updates by itself.</div>
      <iframe title={title} src={`${url}#toolbar=0&navpanes=0&view=FitH`} style={{ width: '100%', height: 'min(70vh, 640px)', border: `1px solid ${TK.line}`, borderRadius: 8, background: TK.sunken }} />
      {!ok && <button onClick={() => setOk(true)} style={{ ...S.btnO, marginTop: 10, fontSize: 12, padding: '6px 14px' }}>Looks correct</button>}
    </div>
  )
}
function StatutoryFormsPreview({ token, personal, contact, statutory, insurance, esic, candidate, esicApplicable, isForeign = false, epsFamily = [], epsFallback = {} }: {
  token: string; personal: any; contact: any; statutory: any; insurance: any; esic: any; candidate: any; esicApplicable: boolean; isForeign?: boolean
  epsFamily?: any[]; epsFallback?: any
}) {
  const doj = candidate.date_of_joining ? new Date(candidate.date_of_joining).toLocaleDateString('en-IN') : '—'
  // Form III: date of superannuation = DOB + 60 years
  const superannuation = personal.dob ? (() => { const d = new Date(personal.dob); d.setFullYear(d.getFullYear() + 60); return d.toLocaleDateString('en-IN') })() : '—'
  // Form III needs the address split into Village / PO / Thana / Sub-Division
  const permAddr = [contact?.perm_village, contact?.perm_po, contact?.perm_thana, contact?.perm_sub_division, contact?.perm_line1, contact?.perm_city, contact?.perm_district, contact?.perm_state, contact?.perm_pin].filter(Boolean).join(', ')
  const fam = [
    insurance.spouse_name && `${insurance.spouse_name} (Spouse)`,
    insurance.father_name && `${insurance.father_name} (Father)`,
    insurance.mother_name && `${insurance.mother_name} (Mother)`,
    insurance.kid1_name && `${insurance.kid1_name} (Child)`,
    insurance.kid2_name && `${insurance.kid2_name} (Child)`,
  ].filter(Boolean).join(', ')

  // EPS Form 2 Part B — family members + fallback nominee
  const epsFamStr = (epsFamily || [])
    .filter((m: any) => m && (m.name || m.relation))
    .map((m: any) => `${m.name || '—'}${m.relation ? ` (${m.relation})` : ''}`)
    .join(', ')
  const epsFallbackStr = epsFallback && (epsFallback.name || epsFallback.relation)
    ? `${epsFallback.name || '—'}${epsFallback.relation ? ` (${epsFallback.relation})` : ''}`
    : ''

  // ── Tabbed view ──────────────────────────────────────────────────
  const tabs: { id: string; label: string }[] = [
    { id: 'form11', label: 'Form 11' },
    { id: 'form2', label: 'Form 2' },
    { id: 'form3', label: 'Form III' },
    ...(esicApplicable ? [{ id: 'esic1', label: 'ESIC Form 1' }] : []),
  ]
  const [tab, setTab] = useState('form11')
  // Keep active tab valid if ESIC tab disappears
  const activeTab = tabs.some(t => t.id === tab) ? tab : 'form11'

  return (
    <div style={{ marginBottom: 4 }}>
      <div className="ezo-seg" role="tablist" style={{ marginBottom: 14 }}>
        {tabs.map(t => {
          const on = t.id === activeTab
          return (
            <button key={t.id} role="tab" aria-selected={on} data-on={on ? '1' : '0'} onClick={() => setTab(t.id)}>{t.label}</button>
          )
        })}
      </div>

      {activeTab === 'form11' && (
        <PdfFormCard code="EPF FORM 11" title="New Form 11 — Declaration" token={token} form="form11"
          note="Filled from your details: name, father's / husband's name, date of birth, marital status, email, mobile, UAN and previous PF account (if any), bank account, Aadhaar and PAN." />
      )}
      {activeTab === 'form2' && (
        <PdfFormCard code="EPF FORM 2" title="Form 2 (Revised) — Nomination & Declaration" token={token} form="form2"
          note="Part A lists your PF nominees with their shares; Part B (EPS) lists your family members for the pension and the fallback nominee." />
      )}
      {activeTab === 'form3' && (
        <PdfFormCard code="FORM F" title="Gratuity Form F — Nomination" token={token} form="formf"
          note="Your gratuity nominee(s) with relationship, age and share, and the statement: name, sex, religion, marital status, department, post, date of appointment and the permanent address split as the form asks." />
      )}
      {activeTab === 'esic1' && esicApplicable && (
        <PdfFormCard code="ESIC FORM 1" title="Form 1 — Declaration Form" token={token} form="esic1"
          note="Your particulars, present and permanent addresses, the nominee for the cash benefit, your family members and the temporary identity card with your photo." />
      )}
    </div>
  )
}

// ── Phase 9: Policy acknowledgement (config-driven per company) ─────
function PolicyCard({ policy, acked, onAck }: { policy: any; acked: boolean; onAck: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [scrolledEnd, setScrolledEnd] = useState(false)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) setScrolledEnd(true)
  }
  // A short policy doesn't produce a scrollbar — there's nothing to scroll to,
  // so treat it as already read and unlock the acknowledgement checkbox.
  useEffect(() => {
    if (!open) return
    const el = bodyRef.current
    if (el && el.scrollHeight <= el.clientHeight + 4) setScrolledEnd(true)
  }, [open])
  return (
    <div style={{ ...S.card, padding: 0, overflow: 'hidden', marginBottom: 12, border: `1px solid ${acked ? TK.positiveEdge : open ? TK.brandEdge : TK.line}` }}>
      <div data-policy-open={acked ? undefined : ''} className="ezo-pol-head" onClick={() => !acked && setOpen(o => !o)} role="button" tabIndex={0}
        onKeyDown={e => { if (!acked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(o => !o) } }}
        style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: acked ? 'default' : 'pointer', padding: '14px 18px', background: acked ? TK.positiveTint : undefined }}>
        <span style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', flexShrink: 0, background: acked ? TK.surface : TK.brandTint, color: acked ? TK.positive : TK.brand, border: `1px solid ${acked ? TK.positiveEdge : TK.brandEdge}` }}>
          {acked ? <IconCheck size={17} strokeWidth={2.6} /> : <IconPolicies size={17} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{policy.policy_title}</div>
          <div style={{ fontSize: 12, color: TK.faint, marginTop: 1 }}>{policy.policy_code} · Version {policy.version}{policy.is_mandatory ? ' · Mandatory' : ''}</div>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: acked ? TK.positive : TK.brand, whiteSpace: 'nowrap' }}>{acked ? 'Acknowledged' : open ? 'Close' : 'Read'}</span>
      </div>
      {open && !acked && (
        <div style={{ padding: '0 18px 18px' }}>
          <div data-policy-body ref={bodyRef} onScroll={onScroll} style={{ maxHeight: 260, overflowY: 'auto', background: TK.sunken, border: `1px solid ${TK.line}`, borderRadius: 12, padding: '14px 16px', fontSize: 13.5, color: TK.inkSoft, whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>
            {policy.policy_body || 'No content.'}
          </div>
          {!scrolledEnd && <div style={{ fontSize: 12, color: TK.warning, marginTop: 8 }}>Scroll to the end of the policy to acknowledge it.</div>}
          <label className="ezo-check" style={{ marginTop: 12, cursor: scrolledEnd ? 'pointer' : 'not-allowed', opacity: scrolledEnd ? 1 : 0.5 }}>
            <input data-policy-check type="checkbox" disabled={!scrolledEnd} checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>I have read and understood the {policy.policy_title} in full.</span>
          </label>
          <button className="ezo-btn" disabled={!checked || busy} onClick={async () => { setBusy(true); await onAck(); setBusy(false) }}
            style={{ ...S.btnP, marginTop: 12, height: 42, opacity: checked && !busy ? 1 : 0.5, cursor: checked && !busy ? 'pointer' : 'not-allowed' }}>
            {busy ? 'Saving…' : 'Acknowledge'}
          </button>
        </div>
      )}
    </div>
  )
}

function PolicyAckPhase({ token, onBack, onNext }: {
  token: string; onBack: () => void; onNext: () => void
}) {
  const [policies, setPolicies] = useState<any[]>([])
  const [acked, setAcked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch(`/api/onboarding/policies?token=${token}`).then(r => r.json())
      .then(d => { setPolicies(d.policies || []); setAcked(new Set(d.ackedIds || [])); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])
  const ack = async (p: any) => {
    await fetch('/api/onboarding/acknowledge-policy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, policy_id: p.id, policy_code: p.policy_code, policy_title: p.policy_title, policy_version: p.version }),
    })
    setAcked(prev => new Set([...prev, p.id]))
  }
  const mandatory = policies.filter(p => p.is_mandatory)
  const allMandatoryAcked = mandatory.every(p => acked.has(p.id))
  const ackedCount = policies.filter(p => acked.has(p.id)).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, height: 8, borderRadius: 99, background: TK.sunken, overflow: 'hidden' }}>
          <div style={{ width: `${policies.length ? (ackedCount / policies.length) * 100 : 100}%`, height: '100%', borderRadius: 99, background: ackedCount === policies.length ? TK.positive : TK.brand, transition: 'width .4s ease' }} />
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: TK.inkSoft, whiteSpace: 'nowrap' }}>
          {loading ? 'Loading…' : policies.length === 0 ? 'No policies to read' : `${ackedCount} of ${policies.length} acknowledged`}
        </span>
      </div>
      {!loading && policies.length === 0 && <Note>No policy is set up for this company yet, so you can go straight on.</Note>}
      {policies.map(p => <PolicyCard key={p.id} policy={p} acked={acked.has(p.id)} onAck={() => ack(p)} />)}
      <div className="ezo-actions">
        <button className="ezo-btn is-ghost" onClick={onBack} style={S.btnO}>Back</button>
        <button className="ezo-btn" onClick={onNext} disabled={!allMandatoryAcked}
          style={{ ...S.btnP, flex: 1, opacity: allMandatoryAcked ? 1 : .45, cursor: !allMandatoryAcked ? 'not-allowed' : 'pointer' }}>
          Review Acknowledgement →
        </button>
      </div>
    </div>
  )
}

// ── Phase 10: Acknowledgement document preview (auto-filled details) ─
function AckPreviewPhase({ token, onBack, onNext }: {
  token: string; onBack: () => void; onNext: () => void
}) {
  const [d, setD] = useState<any>(null)
  useEffect(() => {
    fetch(`/api/onboarding/ack-preview?token=${token}`).then(r => r.json()).then(setD).catch(() => setD({ error: true }))
  }, [token])
  if (!d) return <div style={{ ...S.card, color: TK.muted }}>Loading your acknowledgement…</div>

  const Row = ({ l, v }: { l: string; v: any }) => (
    <div style={{ padding: '10px 14px', background: TK.sunken, borderRadius: 12, border: `1px solid ${TK.line}`, minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: TK.faint, textTransform: 'uppercase', letterSpacing: '.05em' }}>{l}</div>
      <div style={{ fontSize: 14, fontWeight: 650, color: v ? TK.ink : TK.faint, marginTop: 3, overflowWrap: 'anywhere' }}>{v || 'Not set yet'}</div>
    </div>
  )
  return (
    <div>
      <div style={{ ...S.card, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, background: `linear-gradient(90deg, ${TK.brand}, ${TK.info})` }} />
        <Sec icon={<IconLetters size={15} />}>Joining acknowledgement</Sec>
        <div className="ezo-g2" style={{ gap: 10, marginBottom: 18 }}>
          <Row l="Employee Name" v={d.employee_name} />
          <Row l="Father's Name" v={d.father_name} />
          <Row l="Designation" v={d.designation} />
          <Row l="Department" v={d.department} />
          <Row l="Date of Joining" v={d.doj} />
          <Row l="Company" v={d.company_name} />
          <Row l="Work Location" v={d.work_location} />
          <Row l="Aadhaar" v={`XXXX XXXX ${d.aadhaar_last4 || '****'}`} />
          <Row l="Employee ID" v={d.employee_code} />
        </div>
        <Sec icon={<IconPolicies size={15} />}>Policies acknowledged ({(d.policies_acked || []).length})</Sec>
        {(d.policies_acked || []).length === 0
          ? <div style={{ fontSize: 13, color: TK.faint }}>None yet.</div>
          : <div style={{ display: 'grid', gap: 6 }}>{(d.policies_acked || []).map((p: any) => (
            <div key={p.policy_code} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, padding: '8px 12px', borderRadius: 10, background: TK.positiveTint, color: TK.ink }}>
              <span style={{ color: TK.positive, display: 'flex' }}><IconCheck size={15} strokeWidth={2.6} /></span>
              <span style={{ fontWeight: 600 }}>{p.policy_title}</span><span style={{ marginLeft: 'auto', fontSize: 12, color: TK.muted }}>{p.policy_code}</span>
            </div>
          ))}</div>}
        <div style={{ background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius: 12, padding: '14px 16px', marginTop: 18, fontSize: 13.5, color: TK.brandDeep, lineHeight: 1.7 }}>
          I hereby acknowledge that I have received, read, and understood all the above policies, and confirm the details shown are correct.
        </div>
      </div>
      <div className="ezo-actions">
        <button className="ezo-btn is-ghost" onClick={onBack} style={S.btnO}>Back</button>
        <button className="ezo-btn" onClick={onNext}
          style={{ ...S.btnP, flex: 1 }}>
          Proceed to Aadhaar e-Verify →
        </button>
      </div>
    </div>
  )
}

// ── Phase 11: Aadhaar e-Verify + digital signature (demo OTP) ───────
// Records the eSign (mock — UIDAI vendor needed for real OTP) then submits.
function ESignPhase({ token, onBack, onSubmit, submitting }: {
  token: string; onBack: () => void; onSubmit: () => void; submitting: boolean
}) {
  const [aadhaar, setAadhaar] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const clean = aadhaar.replace(/\D/g, '')
  const bundle = ['EPF Form 11 (PF Declaration)', 'EPF Form 2 (Nominee Declaration)', 'Gratuity Form F', 'All Policy Acknowledgements', 'Complete Joining Form (consolidated)']
  const lbl: React.CSSProperties = S.lbl
  const inp: React.CSSProperties = { ...S.inp(), height: 54, fontSize: 20, fontWeight: 600, letterSpacing: 4, textAlign: 'center' }

  const sendOtp = () => {
    if (clean.length !== 12) { setErr('Enter a valid 12-digit Aadhaar number'); return }
    setErr(''); setOtpSent(true)
  }
  const verifyAndSign = async () => {
    if (otp.replace(/\D/g, '').length !== 6) { setErr('Enter the 6-digit OTP'); return }
    setBusy(true); setErr('')
    try {
      await fetch('/api/onboarding/esign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, aadhaar_last4: clean.slice(-4) }) })
      await onSubmit()
    } catch { setErr('Verification failed — please try again.'); setBusy(false) }
  }

  return (
    <div>
      <div style={S.card}>
        <Sec icon={<IconLetters size={15} />}>What you are signing</Sec>
        <div className="ezo-g2" style={{ gap: 8 }}>
          {bundle.map(b => (
            <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, fontWeight: 600, color: TK.ink, padding: '11px 13px', borderRadius: 12, background: TK.sunken, border: `1px solid ${TK.line}` }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: TK.surface, color: TK.brand, border: `1px solid ${TK.brandEdge}`, flexShrink: 0 }}><IconLetters size={14} /></span>{b}
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...S.card, maxWidth: 520 }}>
        <Sec icon={<IconLock size={15} />}>{otpSent ? 'Enter the OTP' : 'Your Aadhaar number'}</Sec>
        {!otpSent ? (
          <>
            <label style={lbl}>Aadhaar Number</label>
            <input className="ezo-code" style={inp} value={aadhaar} maxLength={14} inputMode="numeric"
              onChange={e => setAadhaar(e.target.value)} placeholder="XXXX XXXX XXXX" />
            <div style={{ fontSize: 12, color: TK.faint, marginTop: 8 }}>An OTP goes to the mobile number linked to your Aadhaar. We only keep the last four digits.</div>
            <button className="ezo-btn" onClick={sendOtp} style={{ ...S.btnP, marginTop: 14, width: '100%' }}>Send OTP</button>
          </>
        ) : (
          <>
            <Note tone="ok">OTP sent to your Aadhaar-linked mobile ending {clean.slice(-4)}. <span style={{ color: TK.muted }}>(Demo: any 6 digits work.)</span></Note>
            <label style={lbl}>Enter OTP</label>
            <input className="ezo-code" style={inp} value={otp} maxLength={6} inputMode="numeric"
              onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="••••••" autoFocus />
            <div className="ezo-actions">
              <button className="ezo-btn is-ghost" onClick={() => { setOtpSent(false); setOtp('') }} style={S.btnO}>Change Aadhaar</button>
              <button className="ezo-btn" onClick={verifyAndSign} disabled={busy || submitting}
                style={{ ...S.btnP, flex: 1, background: `linear-gradient(180deg, ${TK.positive}, ${TK.positive})`, boxShadow: 'none', cursor: (busy || submitting) ? 'not-allowed' : 'pointer', opacity: (busy || submitting) ? .7 : 1 }}>
                {(busy || submitting) ? 'Verifying & signing…' : 'Verify & e-Sign — Submit'}
              </button>
            </div>
          </>
        )}
        {err && <div style={{ marginTop: 12 }}><Note tone="bad">{err}</Note></div>}
      </div>

      <button className="ezo-btn is-ghost" onClick={onBack} style={S.btnO}>Back</button>
    </div>
  )
}

// ── Phase 3b: Cross-document mismatch resolution ──────────────────
// Gathers the same logical field from multiple source docs, flags mismatches,
// and lets the employee pick the correct value (written back to form state).
function CrossDocCheck({ docs, onResolve, onMismatchChange }: {
  docs: Record<string, DocStatus>
  onResolve: (field: 'name' | 'dob' | 'pan', value: string) => void
  onMismatchChange: (unresolvedCount: number) => void
}) {
  const norm = (v: any) => (v == null ? '' : String(v).trim())
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

  const aadhaar = docs['AADHAAR_FRONT']?.ai_extracted_data || {}
  const pan = docs['PAN']?.ai_extracted_data || {}

  type FieldDef = { key: 'name' | 'dob' | 'pan'; label: string; sources: { src: string; value: string }[] }
  const fields: FieldDef[] = [
    { key: 'name', label: 'Name', sources: [
      { src: 'Aadhaar', value: norm(aadhaar.name) },
      { src: 'PAN', value: norm(pan.name) },
    ] },
    { key: 'dob', label: 'Date of birth', sources: [
      { src: 'Aadhaar', value: norm(aadhaar.dob) },
    ] },
    { key: 'pan', label: 'PAN', sources: [
      { src: 'PAN', value: norm(pan.pan_number) },
    ] },
  ].map(f => ({ ...f, sources: f.sources.filter(s => s.value) }))

  // Only fields that have at least one extracted value matter for display
  const present = fields.filter(f => f.sources.length > 0)

  // Classify each field
  const classify = (f: FieldDef): 'match' | 'mismatch' | 'single' => {
    if (f.sources.length < 2) return 'single'
    const first = f.sources[0].value
    return f.sources.every(s => eq(s.value, first)) ? 'match' : 'mismatch'
  }

  const mismatchFields = present.filter(f => classify(f) === 'mismatch')

  // Track which mismatches have been resolved (a choice made)
  const [resolved, setResolved] = useState<Record<string, string>>({})

  const unresolvedCount = mismatchFields.filter(f => !resolved[f.key]).length
  useEffect(() => { onMismatchChange(unresolvedCount) }, [unresolvedCount, onMismatchChange])

  if (present.length === 0) return null

  return (
    <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${TK.line}` }}>
        <span className="ezo-sec-ic"><IconCompliance size={15} /></span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Does everything match?</span>
        <span style={{ fontSize: 12.5, color: TK.muted }}>We compared the same details across your documents.</span>
      </div>
      <div style={{ padding: '4px 18px 14px' }}>
        {present.map(f => {
          const status = classify(f)
          const badge = status === 'match'
            ? { bg: TK.positiveTint, color: TK.positive, txt: 'Match' }
            : status === 'mismatch'
              ? { bg: TK.warningTint, color: TK.warning, txt: 'Mismatch' }
              : { bg: TK.brandTint, color: TK.brand, txt: 'Single source' }
          return (
            <div key={f.key} style={{ padding: '12px 0', borderBottom: `1px solid ${TK.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: TK.ink }}>{f.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: badge.bg, color: badge.color }}>{badge.txt}</span>
              </div>
              <div style={{ fontSize: 11, color: TK.muted, lineHeight: 1.7 }}>
                {f.sources.map(s => <span key={s.src} style={{ marginRight: 12 }}><b style={{ color: TK.muted }}>{s.src}:</b> {s.value}</span>)}
              </div>
              {status === 'mismatch' && (
                <div style={{ marginTop: 8 }}>
                  <label style={S.lbl}>Pick the correct {f.label.toLowerCase()}</label>
                  <select
                    style={{ ...S.sel, border: `1px solid ${resolved[f.key] ? TK.positiveEdge : TK.warningEdge}`, background: resolved[f.key] ? TK.positiveTint : TK.warningTint }}
                    value={resolved[f.key] || ''}
                    onChange={e => {
                      const chosen = e.target.value
                      if (!chosen) return
                      setResolved(r => ({ ...r, [f.key]: chosen }))
                      onResolve(f.key, chosen)
                    }}
                  >
                    <option value="">— Select correct value —</option>
                    {f.sources.map(s => <option key={s.src} value={s.value}>{s.value} (from {s.src})</option>)}
                  </select>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── EPS Family Member row (Form 2 Part B) ─────────────────────────
type Nominee = { name: string; relation: string; dob: string; share: string; address: string }
const EMPTY_NOMINEE: Nominee = { name: '', relation: '', dob: '', share: '', address: '' }
const shareTotal = (rows: Nominee[]) => rows.reduce((a, r) => a + (parseFloat(r.share) || 0), 0)
/** The first PF / gratuity nominee also fills the flat fields older code reads. */
function withLegacyNominees<T extends { pf_nominees: Nominee[]; grat_nominees: Nominee[] }>(st: T): T {
  const pf = st.pf_nominees[0] || EMPTY_NOMINEE, gr = st.grat_nominees[0] || EMPTY_NOMINEE
  return { ...st, nominee_name: pf.name, nominee_relation: pf.relation, nominee_dob: pf.dob, nominee_share: pf.share, nominee_address: pf.address, grat_nominee_name: gr.name, grat_nominee_relation: gr.relation, grat_nominee_dob: gr.dob, grat_nominee_share: gr.share }
}

function NomineeRow({ row, index, kind, canRemove, onChange, onRemove }: {
  row: Nominee; index: number; kind: 'pf' | 'grat'; canRemove: boolean
  onChange: (patch: Partial<Nominee>) => void; onRemove: () => void
}) {
  const req = kind === 'pf'
  return (
    <div style={BLOCK}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={BLOCK_TITLE}><span style={BLOCK_NO}>{index + 1}</span>{row.name || `Nominee ${index + 1}`}</div>
        {canRemove && (
          <button onClick={onRemove} style={REMOVE_BTN}>Remove</button>
        )}
      </div>
      <div className="ezo-g3">
        <Fld label={req ? 'Nominee Name *' : 'Nominee Name'}><input style={S.inp(req && !row.name)} value={row.name || ''} onChange={e => onChange({ name: e.target.value })} /></Fld>
        <Fld label={req ? 'Relation *' : 'Relation'}>
          <select style={S.sel} value={row.relation || ''} onChange={e => onChange({ relation: e.target.value })}>
            <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Son</option><option>Daughter</option><option>Other</option>
          </select>
        </Fld>
        <Fld label={req ? 'Date of Birth *' : 'Date of Birth'}><input type="date" style={S.inp(req && !row.dob)} value={row.dob || ''} onChange={e => onChange({ dob: e.target.value })} /></Fld>
        <Fld label="Share %"><input type="number" min={0} max={100} style={S.inp()} value={row.share || ''} onChange={e => onChange({ share: e.target.value })} /></Fld>
        <div style={{ gridColumn: 'span 2' }}><Fld label={req ? 'Nominee Address *' : 'Nominee Address'}><input style={S.inp(req && !row.address)} value={row.address || ''} onChange={e => onChange({ address: e.target.value })} /></Fld></div>
      </div>
    </div>
  )
}

const ADDR_PARTS = ['line1', 'village', 'po', 'thana', 'sub_division', 'district', 'city', 'state', 'pin']
/** Current address = permanent address, field for field. */
function copyPermToCurr<T extends Record<string, any>>(c: T): T {
  const n: any = { ...c }
  for (const k of ADDR_PARTS) n[`curr_${k}`] = c[`perm_${k}`] ?? ''
  return n
}

function EpsFamilyRow({ row, index, canRemove, onChange, onRemove }: {
  row: any; index: number; canRemove: boolean
  onChange: (patch: any) => void; onRemove: () => void
}) {
  return (
    <div style={BLOCK}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={BLOCK_TITLE}><span style={BLOCK_NO}>{index + 1}</span>{row.name || 'Family member'}</div>
        {canRemove && (
          <button onClick={onRemove} style={REMOVE_BTN}>Remove</button>
        )}
      </div>
      <div className="ezo-g2">
        <Fld label="Name"><input style={S.inp()} value={row.name || ''} onChange={e => onChange({ name: e.target.value })} /></Fld>
        <Fld label="Relation">
          <select style={S.sel} value={row.relation || ''} onChange={e => onChange({ relation: e.target.value })}>
            <option value="">Select</option><option>Spouse</option><option>Son</option><option>Daughter</option><option>Father</option><option>Mother</option><option>Other</option>
          </select>
        </Fld>
        <Fld label="Date of Birth"><input type="date" style={S.inp()} value={row.dob || ''} onChange={e => onChange({ dob: e.target.value })} /></Fld>
        <Fld label="Address"><input style={S.inp()} value={row.address || ''} onChange={e => onChange({ address: e.target.value })} /></Fld>
      </div>
    </div>
  )
}

// ── Dual acknowledgement copy (HR / Employee) ─────────────────────
function AckCopy({ copyFor, ackNo, generatedAt, employeeName, designation, department, doj, forms, docsCount }: {
  copyFor: string; ackNo: string; generatedAt: string; employeeName: string
  designation: string; department: string; doj: string; forms: string[]; docsCount: number
}) {
  const Row = ({ l, v }: { l: string; v: any }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: `1px dashed ${TK.line}` }}>
      <span style={{ fontSize: 12.5, color: TK.muted }}>{l}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: v || v === 0 ? TK.ink : TK.faint, textAlign: 'right' }}>{v || v === 0 ? v : 'Not set yet'}</span>
    </div>
  )
  return (
    <div style={{ ...S.card, flex: 1, minWidth: 260, textAlign: 'left', position: 'relative', overflow: 'hidden', marginBottom: 0 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, background: `linear-gradient(90deg, ${TK.brand}, ${TK.info})` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', color: TK.brand, background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, padding: '3px 9px', borderRadius: 8 }}>{copyFor}</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Acknowledgement</span>
      </div>
      <Row l="ACK No." v={ackNo} />
      <Row l="Generated" v={generatedAt} />
      <Row l="Employee Name" v={(employeeName || '').toUpperCase()} />
      <Row l="Designation" v={designation} />
      <Row l="Department" v={department} />
      <Row l="Date of Joining" v={doj} />
      <div style={{ fontSize: 12, fontWeight: 700, color: TK.inkSoft, margin: '14px 0 6px' }}>Forms e-signed</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{forms.map(f => <span key={f} className="ezo-chip is-ok"><IconCheck size={12} strokeWidth={2.6} />{f}</span>)}</div>
      <div style={{ marginTop: 8 }}><Row l="Documents uploaded" v={docsCount} /></div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function OnboardingClient({ token, candidate, company, uploadedDocs }: {
  token: string
  candidate: any
  company: any
  uploadedDocs: Record<string, DocStatus>
}) {
  // Numbering changed in the 12-phase redesign, so we don't reuse the raw stored
  // current_step. Resume at OTP gate if not verified, else at Documents (step 3).
  const [step, setStep] = useState<Step>((candidate.otp_verified ? 2 : 1) as Step)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [docs, setDocs] = useState<Record<string, DocStatus>>(uploadedDocs)
  const [submitted, setSubmitted] = useState(false)
  const [employeeCode, setEmployeeCode] = useState<string | null>(null)

  const c = candidate
  const co = company

  // Restore saved form data
  const saved = c.form_data || {}

  // Personal step state
  const [personal, setPersonal] = useState({
    full_name: (saved.step_3?.full_name) || c.full_name || '',
    dob: (saved.step_3?.dob) || '',
    gender: (saved.step_3?.gender) || '',
    father_name: (saved.step_3?.father_name) || '',
    mother_name: (saved.step_3?.mother_name) || '',
    blood_group: (saved.step_3?.blood_group) || '',
    marital_status: (saved.step_3?.marital_status) || '',
    nationality: (saved.step_3?.nationality) || 'Indian',
    religion: (saved.step_3?.religion) || '',
    country: (saved.step_3?.country) || 'India',
    birth_place: (saved.step_3?.birth_place) || '',
  })

  // Contact step
  const [contact, setContact] = useState({
    mobile: (saved.step_4?.mobile) || c.mobile || '',
    alt_mobile: (saved.step_4?.alt_mobile) || '',
    personal_email: (saved.step_4?.personal_email) || c.email || '',
    perm_line1: (saved.step_4?.perm_line1) || '',
    perm_village: (saved.step_4?.perm_village) || '',
    perm_po: (saved.step_4?.perm_po) || '',
    perm_thana: (saved.step_4?.perm_thana) || '',
    perm_sub_division: (saved.step_4?.perm_sub_division) || '',
    perm_city: (saved.step_4?.perm_city) || '',
    perm_district: (saved.step_4?.perm_district) || '',
    perm_state: (saved.step_4?.perm_state) || '',
    perm_pin: (saved.step_4?.perm_pin) || '',
    same_address: (saved.step_4?.same_address) !== undefined ? saved.step_4.same_address : false,
    curr_line1: (saved.step_4?.curr_line1) || '',
    curr_village: (saved.step_4?.curr_village) || '',
    curr_po: (saved.step_4?.curr_po) || '',
    curr_thana: (saved.step_4?.curr_thana) || '',
    curr_sub_division: (saved.step_4?.curr_sub_division) || '',
    curr_district: (saved.step_4?.curr_district) || '',
    curr_city: (saved.step_4?.curr_city) || '',
    curr_state: (saved.step_4?.curr_state) || '',
    curr_pin: (saved.step_4?.curr_pin) || '',
  })
  // "Current address same as permanent": the current fields stay on screen and are filled from
  // the permanent ones (and follow them while the box is ticked). Editing a current field by
  // hand unticks the box.
  const setPerm = (key: string, value: string) => setContact(c => { const n: any = { ...c, [key]: value }; return n.same_address ? copyPermToCurr(n) : n })
  const setCurr = (key: string, value: string) => setContact(c => ({ ...c, [key]: value, same_address: false }))

  // Emergency + prev employment
  const [emergency, setEmergency] = useState({
    emrg1_name: (saved.step_5?.emrg1_name) || '',
    emrg1_relation: (saved.step_5?.emrg1_relation) || '',
    emrg1_mobile: (saved.step_5?.emrg1_mobile) || '',
    emrg2_name: (saved.step_5?.emrg2_name) || '',
    emrg2_relation: (saved.step_5?.emrg2_relation) || '',
    emrg2_mobile: (saved.step_5?.emrg2_mobile) || '',
    is_fresher: (saved.step_5?.is_fresher) !== undefined ? saved.step_5.is_fresher : false,
    prev_company: (saved.step_5?.prev_company) || c.current_company || '',
    prev_designation: (saved.step_5?.prev_designation) || '',
    prev_from: (saved.step_5?.prev_from) || '',
    prev_to: (saved.step_5?.prev_to) || '',
    prev_ctc: (saved.step_5?.prev_ctc) || '',
    reason_leaving: (saved.step_5?.reason_leaving) || '',
  })

  // Statutory & bank step
  const [statutory, setStatutory] = useState({
    pan_number: (saved.step_7?.pan_number) || '',
    has_uan: (saved.step_7?.has_uan) !== undefined ? saved.step_7.has_uan : false,
    uan_number: (saved.step_7?.uan_number) || '',
    prev_pf_id: (saved.step_7?.prev_pf_id) || '',
    pf_transfer: (saved.step_7?.pf_transfer) !== undefined ? saved.step_7.pf_transfer : false,
    // PF nominees (EPF Form 2) and gratuity nominees (Form F): one or more each. The flat
    // nominee_* / grat_nominee_* fields that older forms saved are kept filled from the first
    // entry (withLegacyNominees), so the employee record and the form previews keep working.
    pf_nominees: (saved.step_7?.pf_nominees?.length ? saved.step_7.pf_nominees : [{
      name: (saved.step_7?.nominee_name) || '', relation: (saved.step_7?.nominee_relation) || '', dob: (saved.step_7?.nominee_dob) || '',
      share: (saved.step_7?.nominee_share) || '100', address: (saved.step_7?.nominee_address) || '',
    }]) as Nominee[],
    grat_nominees: (saved.step_7?.grat_nominees?.length ? saved.step_7.grat_nominees : [{
      name: (saved.step_7?.grat_nominee_name) || '', relation: (saved.step_7?.grat_nominee_relation) || '', dob: (saved.step_7?.grat_nominee_dob) || '', share: (saved.step_7?.grat_nominee_share) || '100', address: '',
    }]) as Nominee[],
    nominee_name: (saved.step_7?.nominee_name) || '',
    nominee_relation: (saved.step_7?.nominee_relation) || '',
    nominee_dob: (saved.step_7?.nominee_dob) || '',
    nominee_share: (saved.step_7?.nominee_share) || '100',
    nominee_address: (saved.step_7?.nominee_address) || '',
    grat_nominee_name: (saved.step_7?.grat_nominee_name) || '',
    grat_nominee_relation: (saved.step_7?.grat_nominee_relation) || '',
    // Bank
    bank_account: (saved.step_7?.bank_account) || '',
    bank_confirm: '',
    bank_ifsc: (saved.step_7?.bank_ifsc) || '',
    bank_name: (saved.step_7?.bank_name) || '',
    bank_branch: (saved.step_7?.bank_branch) || '',
    account_type: (saved.step_7?.account_type) || 'Savings',
    acc_holder: (saved.step_7?.acc_holder) || c.full_name || '',
    // Other government IDs (shown on the employee record)
    passport_no: (saved.step_7?.passport_no) || '',
    voter_id: (saved.step_7?.voter_id) || '',
    driving_licence: (saved.step_7?.driving_licence) || '',
    // Foreign employee fields
    fe_passport_number: (saved.step_7?.fe_passport_number) || '',
    fe_passport_country: (saved.step_7?.fe_passport_country) || '',
    fe_passport_expiry: (saved.step_7?.fe_passport_expiry) || '',
    fe_visa_type: (saved.step_7?.fe_visa_type) || '',
    fe_visa_number: (saved.step_7?.fe_visa_number) || '',
    fe_visa_expiry: (saved.step_7?.fe_visa_expiry) || '',
    fe_work_permit_number: (saved.step_7?.fe_work_permit_number) || '',
    fe_frro_number: (saved.step_7?.fe_frro_number) || '',
    fe_tax_residency: (saved.step_7?.fe_tax_residency) || '',
    fe_tax_country: (saved.step_7?.fe_tax_country) || '',
    fe_foreign_tin: (saved.step_7?.fe_foreign_tin) || '',
    fe_ssa_coc: (saved.step_7?.fe_ssa_coc) || '',
    fe_overseas_line: (saved.step_7?.fe_overseas_line) || '',
    fe_overseas_city: (saved.step_7?.fe_overseas_city) || '',
    fe_overseas_country: (saved.step_7?.fe_overseas_country) || '',
  })

  // ── ESIC applicability — from offered CTC (gross ≈ CTC/12), HR can override ──
  const grossMonthly = c.offered_ctc ? Number(c.offered_ctc) / 12 : 0
  const esicApplicable = c.esic_applicable === true || (grossMonthly > 0 && grossMonthly <= 21000)
  // Foreign employee — citizenship country other than India triggers extra KYC + docs.
  const isForeign = (personal.country || 'India').trim().toLowerCase() !== 'india'
  // Documents can be skipped on Step 2; if skipped they become mandatory (non-skippable) before Policies.
  const [docsDeferred, setDocsDeferred] = useState(false)
  const docsComplete = REQUIRED_DOC_CODES(esicApplicable).every(d => docs[d])
  const onDocRemoved = (code: string) => { setDocs(d => { const n = { ...d }; delete n[code]; return n }); showToast(`${code.replace(/_/g, ' ')} removed`) }
  const onDocUploaded = (code: string, data: any) => {
    setDocs(d => ({ ...d, [code]: { doc_code: code, ai_status: data.ai_status, ai_extracted_data: data.ai_extracted, ai_confidence: data.ai_confidence, ai_flags: data.ai_flags, file_name: data.file_name || 'uploaded' } }))
    if (code === 'PAN' && data.ai_extracted?.pan_number) {
      setStatutory(s => ({ ...s, pan_number: data.ai_extracted.pan_number, acc_holder: data.ai_extracted.name || s.acc_holder }))
    }
    showToast(`${DOC_LIST(true, false, true).find(d => d.code === code)?.name || code} uploaded`)
  }

  // Previous employers (multiple) — seeded from legacy single fields if present
  const [prevEmployers, setPrevEmployers] = useState<any[]>(
    (saved.step_5?.prev_employers?.length) ? saved.step_5.prev_employers : [{
      company: (saved.step_5?.prev_company) || c.current_company || '',
      designation: (saved.step_5?.prev_designation) || '',
      from: (saved.step_5?.prev_from) || '', to: (saved.step_5?.prev_to) || '',
      ctc: (saved.step_5?.prev_ctc) || '', reason: (saved.step_5?.reason_leaving) || '',
    }]
  )

  // Education ladder (10th → 12th → Graduation/Diploma → MBA/PG, + more)
  const [education, setEducation] = useState<any[]>(
    (saved.step_5?.education?.length) ? saved.step_5.education : [
      { qualification: '10th', institute: '', year: '' },
      { qualification: '12th', institute: '', year: '' },
      { qualification: 'Graduation / Diploma', institute: '', year: '' },
      { qualification: 'MBA / PG', institute: '', year: '' },
    ]
  )

  // Insurance family (Group Mediclaim + ESIC Form 1 family particulars)
  const ins0 = saved.step_7?.insurance || {}
  const [insurance, setInsurance] = useState({
    spouse_name: ins0.spouse_name || '', spouse_dob: ins0.spouse_dob || '', spouse_residing: ins0.spouse_residing || 'Yes',
    father_name: ins0.father_name || '', father_dob: ins0.father_dob || '', father_residing: ins0.father_residing || 'Yes',
    mother_name: ins0.mother_name || '', mother_dob: ins0.mother_dob || '', mother_residing: ins0.mother_residing || 'Yes',
    kid1_name: ins0.kid1_name || '', kid1_dob: ins0.kid1_dob || '',
    kid2_name: ins0.kid2_name || '', kid2_dob: ins0.kid2_dob || '',
  })

  // ESIC-specific details (only collected when ESIC applies)
  const esic0 = saved.step_7?.esic_details || {}
  const [esic, setEsic] = useState({ prev_ip: esic0.prev_ip || '', dispensary: esic0.dispensary || '' })

  // EPS Family Members (Form 2 Part B) + fallback nominee
  const [epsFamily, setEpsFamily] = useState<any[]>(
    (saved.step_7?.eps_family?.length) ? saved.step_7.eps_family : [{ name: '', address: '', dob: '', relation: '' }]
  )
  const epsFb0 = saved.step_7?.eps_fallback || {}
  const [epsFallback, setEpsFallback] = useState({ name: epsFb0.name || '', relation: epsFb0.relation || '', address: epsFb0.address || '', dob: epsFb0.dob || '' })

  // Cross-document mismatch tracking (step 3) — Continue blocked until resolved
  const [crossDocUnresolved, setCrossDocUnresolved] = useState(0)
  const onCrossDocResolve = useCallback((field: 'name' | 'dob' | 'pan', value: string) => {
    if (field === 'name') setPersonal(p => ({ ...p, full_name: value }))
    else if (field === 'dob') setPersonal(p => ({ ...p, dob: value }))
    else if (field === 'pan') setStatutory(s => ({ ...s, pan_number: value }))
  }, [])

  const upEmp = (i: number, patch: any) => setPrevEmployers(arr => arr.map((e, idx) => idx === i ? { ...e, ...patch } : e))
  const upEdu = (i: number, patch: any) => setEducation(arr => arr.map((e, idx) => idx === i ? { ...e, ...patch } : e))

  const [declaration, setDeclaration] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // ── Save progress ───────────────────────────────────────────────
  const saveStep = async (stepNum: Step, data: any) => {
    setSaving(true)
    await api('/api/onboarding/save-progress', { token, step: stepNum, data })
    setSaving(false)
  }

  // ── OTP send ────────────────────────────────────────────────────
  const sendOtp = async () => {
    if (c.otp_verified) { nextStep(); return }
    setOtpLoading(true)
    const res = await api('/api/onboarding/otp', { token })
    setOtpLoading(false)
    if (res.success) { setOtpSent(true); showToast(res.dev_otp ? `DEV OTP: ${res.dev_otp}` : (res.message || 'OTP sent to your email')) }
    else showToast(res.error || 'Failed to send OTP', 'err')
  }

  const verifyOtp = async () => {
    if (!otp.trim()) { showToast('Please enter OTP', 'err'); return }
    setOtpLoading(true)
    const res = await api('/api/onboarding/otp', { token, otp }, 'PUT')
    setOtpLoading(false)
    if (res.success) { showToast('Mobile verified!'); nextStep() }
    else showToast(res.error || 'Incorrect OTP', 'err')
  }

  // ── IFSC lookup ─────────────────────────────────────────────────
  const lookupIfsc = async (ifsc: string) => {
    if (ifsc.length < 11) return
    try {
      const r = await fetch(`https://ifsc.razorpay.com/${ifsc.toUpperCase()}`)
      if (r.ok) {
        const d = await r.json()
        setStatutory(s => ({ ...s, bank_name: d.BANK || '', bank_branch: d.BRANCH || '' }))
      }
    } catch { /* silently fail */ }
  }

  // ── PAN auto-fill from AI-extracted Aadhaar ────────────────────
  const panDoc = docs['PAN']
  const aadhaarDoc = docs['AADHAAR_FRONT']
  const aiPan = panDoc?.ai_extracted_data?.pan_number || ''
  const aiName = aadhaarDoc?.ai_extracted_data?.name || panDoc?.ai_extracted_data?.name || ''

  // ── Navigate steps ───────────────────────────────────────────────
  // ESIC & Family (step 7) only applies when esicApplicable — skip it otherwise,
  // both forward (6 → 8) and backward (8 → 6).
  const nextStep = () => setStep(s => {
    let n = Math.min(12, s + 1)
    if (n === 7 && !esicApplicable) n = 8
    return n as Step
  })
  const prevStep = () => setStep(s => {
    let n = Math.max(1, s - 1)
    if (n === 7 && !esicApplicable) n = 6
    return n as Step
  })

  // ── Final Submit ─────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!declaration) { showToast('Please accept the declaration', 'err'); return }
    // Everything required, across every step, one last time before it reaches HR.
    const missingAll = missingFields({
      step_3: personal, step_4: contact, step_5: { ...emergency, prev_employers: prevEmployers, education },
      step_7: { ...withLegacyNominees(statutory), gross_monthly: grossMonthly, esic_applicable: esicApplicable },
    })
    if (missingAll.length) {
      showToast(`Some required details are missing: ${describeMissing(missingAll)}. Go back and fill them.`, 'err')
      // PAN and bank live on the contact screen (4); only the nominees are on screen 7.
      const first = missingAll[0]
      setStep((first.step === 7 && first.key !== 'pf_nominees' ? 4 : first.step) as any)
      return
    }
    setSubmitting(true)

    const final = {
      step_3: personal,
      step_4: contact,
      step_5: { ...emergency, prev_employers: prevEmployers, education },
      step_7: {
        ...withLegacyNominees(statutory),
        gross_monthly: grossMonthly,
        esic_applicable: esicApplicable,
        esic_details: esic,
        insurance,
        eps_family: epsFamily,
        eps_fallback: epsFallback,
      },
    }

    const res = await api('/api/onboarding/submit', { token, final_form_data: final })
    setSubmitting(false)

    if (res.success) setSubmitted(true)
    else showToast(res.error || 'Submit failed', 'err')
  }

  // ── SUBMITTED screen ─────────────────────────────────────────────
  if (submitted) {
    const ackNo = `EZR-ACK-${(token || '').slice(0, 8).toUpperCase()}`
    const generatedAt = new Date().toLocaleString('en-IN')
    const doj = c.date_of_joining ? new Date(c.date_of_joining).toLocaleDateString('en-IN') : '—'
    const ackForms = ['Form 11', 'Form 2', 'Form III', ...(esicApplicable ? ['ESIC Form 1'] : [])]
    const first = (personal.full_name || c.full_name || '').replace(/^CLAUDE TEST\s+/i, '').split(' ')[0]
    const next = [
      { t: 'HR reviews your form', d: 'Usually within one working day.', ic: <IconCompliance size={16} /> },
      { t: 'Your Employee ID is created', d: 'You get it by email together with your portal login.', ic: <IconUser size={16} /> },
      { t: 'You sign in to the employee portal', d: 'Payslips, leave and attendance in one place.', ic: <IconHome size={16} /> },
      { t: `Day one${c.date_of_joining ? `: ${new Date(c.date_of_joining).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}` : ''}`, d: 'Bring your original documents for a quick check.', ic: <IconCalendar size={16} /> },
    ]
    return (
      <div className="ezo" style={S.page}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '48px 16px 64px' }}>
          <div style={{ ...S.card, padding: '40px 32px 32px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            <div aria-hidden style={{ position: 'absolute', inset: 0, background: `radial-gradient(520px 220px at 50% -20%, ${TK.positiveTint} 0%, transparent 70%)`, pointerEvents: 'none' }} />
            <div className="ezo-pop" style={{ position: 'relative', width: 76, height: 76, borderRadius: '50%', margin: '0 auto 18px', display: 'grid', placeItems: 'center', background: TK.positive, color: TK.onAccent, boxShadow: `0 0 0 10px ${TK.positiveTint}, 0 18px 36px -16px ${TK.positive}` }}>
              <IconCheck size={36} strokeWidth={2.6} />
            </div>
            <div style={{ position: 'relative', fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', color: TK.ink }}>You’re all set{first ? `, ${first}` : ''}!</div>
            <div style={{ position: 'relative', fontSize: 15, color: TK.muted, lineHeight: 1.7, marginTop: 8, maxWidth: 520, marginInline: 'auto' }}>
              Your joining form for <b style={{ color: TK.ink }}>{co?.company_name || 'your new company'}</b> has been signed and submitted. A copy of your acknowledgement is on its way to your email.
            </div>
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
              {['Details filled', 'Documents uploaded', 'Forms e-signed', 'Policies acknowledged'].map(x => <span key={x} className="ezo-chip is-ok"><IconCheck size={12} strokeWidth={2.6} />{x}</span>)}
            </div>
          </div>

          {/* The download is the one action left on this screen, so it is a card of its own,
              right under the confirmation: the acknowledgement as a PDF on the company's
              letterhead (app/api/onboarding/ack-pdf). It used to be a small outline button
              at the bottom that only printed the web page. */}
          <div className="ezo-dl ezo-noprint">
            <span className="ezo-dl-ic"><IconLetters size={26} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ezo-dl-t">Your joining acknowledgement</div>
              <div className="ezo-dl-d">A signed PDF on {co?.company_name || 'the company'}’s letterhead · reference {ackNo}. Keep it for your records.</div>
            </div>
            <div className="ezo-dl-acts">
              <a className="ezo-btn ezo-dl-main" href={`/api/onboarding/ack-pdf?token=${encodeURIComponent(token)}`} download>
                <IconDownload size={18} strokeWidth={2.2} />Download PDF
              </a>
              <a className="ezo-btn ezo-dl-view" href={`/api/onboarding/ack-pdf?token=${encodeURIComponent(token)}&inline=1`} target="_blank" rel="noreferrer">Open</a>
            </div>
          </div>

          <div style={S.card}>
            <Sec icon={<IconClock size={15} />}>What happens next</Sec>
            <div style={{ display: 'grid', gap: 0 }}>
              {next.map((n, i) => (
                <div key={n.t} style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: i < next.length - 1 ? 18 : 0 }}>
                  {i < next.length - 1 && <span style={{ position: 'absolute', left: 17, top: 36, bottom: 0, width: 2, background: TK.line }} />}
                  <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center', background: i === 0 ? TK.brand : TK.brandTint, color: i === 0 ? TK.onAccent : TK.brand }}>{n.ic}</span>
                  <div><div style={{ fontSize: 14, fontWeight: 700 }}>{n.t}</div><div style={{ fontSize: 13, color: TK.muted, marginTop: 1 }}>{n.d}</div></div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '8px 0 12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TK.ink }}>Acknowledgement copies</div>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
            <AckCopy copyFor="HR MANAGER COPY" ackNo={ackNo} generatedAt={generatedAt} employeeName={personal.full_name || c.full_name} designation={c.designation} department={c.department} doj={doj} forms={ackForms} docsCount={Object.keys(docs).length} />
            <AckCopy copyFor="EMPLOYEE COPY" ackNo={ackNo} generatedAt={generatedAt} employeeName={personal.full_name || c.full_name} designation={c.designation} department={c.department} doj={doj} forms={ackForms} docsCount={Object.keys(docs).length} />
          </div>
          <div style={{ textAlign: 'center', fontSize: 13, color: TK.faint }}>Questions? Write to {co?.hr_email || 'your HR team'}.</div>
        </div>
      </div>
    )
  }

  // ── RENDER ────────────────────────────────────────────────────────
  return (
    <div className="ezo" style={S.page}>
      <div className="ezo-shell">
      <PhoneBar current={step} company={co} />
      <JourneyRail current={step} candidate={c} company={co} esic={esicApplicable} saving={saving} />
      <main className="ezo-main">
      <div className="ezo-col" style={{ paddingTop: 0 }}>
        {/* HR returned the form: what to fix, from the review on the onboarding card */}
        {c.hr_review?.outcome === 'RETURNED' && (
          <div style={{ marginBottom: 18 }}>
            <Note tone="warn">
              <div style={{ fontWeight: 700, color: TK.critical, marginBottom: 4 }}>HR has asked for corrections before your form can be approved</div>
              {(c.hr_review.documents || []).length > 0 && <div><b>Documents to upload again:</b><ul style={{ margin: '2px 0 4px', paddingLeft: 18 }}>{c.hr_review.documents.map((d: any) => <li key={d.doc_code}>{d.label}{d.reason ? `: ${d.reason}` : ''}</li>)}</ul></div>}
              {(c.hr_review.details || []).length > 0 && <div><b>Details to correct:</b><ul style={{ margin: '2px 0 4px', paddingLeft: 18 }}>{c.hr_review.details.map((d: any, i: number) => <li key={i}>{d.field}{d.section ? ` (${d.section})` : ''}{d.reason ? `: ${d.reason}` : ''}</li>)}</ul></div>}
              {c.hr_review.note && <div><b>Note from HR:</b> {c.hr_review.note}</div>}
            </Note>
          </div>
        )}
        <StepHeader step={step} />
        <div className="ezo-body" key={step}>
        {/* Global country list — shared by the Personal + KYC foreign-block selectors */}
        <datalist id="ezer-countries">{COUNTRIES.map(c => <option key={c} value={c} />)}</datalist>


        {/* ═══ STEP 1: WELCOME + IDENTITY VERIFY ════════════════════ */}
        {step === 1 && (
          <div>
            {/* The offer, at a glance: who, what, where, when */}
            <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '22px 24px', background: `radial-gradient(520px 200px at 100% 0%, ${TK.brandEdge} 0%, transparent 70%), linear-gradient(135deg, ${TK.brandTint}, ${TK.surface})`, borderBottom: `1px solid ${TK.line}` }}>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.01em' }}>Hi {(c.full_name || '').replace(/^CLAUDE TEST\s+/i, '').split(' ')[0]}, welcome to {co?.company_name || 'the team'}</div>
                <div style={{ fontSize: 14, color: TK.muted, marginTop: 4 }}>We’re glad you’re joining us. Here is what we have on file.</div>
              </div>
              <div className="ezo-g3" style={{ padding: '18px 24px 6px', gap: 14 }}>
                {[
                  { k: 'Role', v: c.designation, ic: <IconEmployees size={16} /> },
                  { k: 'Joining date', v: c.date_of_joining ? new Date(c.date_of_joining).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null, ic: <IconCalendar size={16} /> },
                  { k: 'Department', v: c.department, ic: <IconBuilding size={16} /> },
                ].map(x => (
                  <div key={x.k} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, minWidth: 0 }}>
                    <span style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', background: TK.brandTint, color: TK.brand, flexShrink: 0 }}>{x.ic}</span>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 12, color: TK.faint, fontWeight: 600 }}>{x.k}</div><div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.v || 'To be confirmed'}</div></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ezo-g2" style={{ gap: 16, alignItems: 'start' }}>
              <div style={S.card}>
                <Sec icon={<IconLetters size={15} />}>Keep these handy</Sec>
                {[
                  ['Aadhaar card', 'front and back'], ['PAN card', ''], ['A passport-size photo', ''],
                  ['Highest degree certificate', ''], ['Cancelled cheque or passbook', 'for salary'],
                  ...(esicApplicable ? [['A family photo', 'for your ESIC card']] : []),
                ].map(([t, d]) => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', fontSize: 13.5 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, display: 'grid', placeItems: 'center', background: TK.positiveTint, color: TK.positive, flexShrink: 0 }}><IconCheck size={12} strokeWidth={2.6} /></span>
                    <span style={{ fontWeight: 600 }}>{t}</span>{d && <span style={{ color: TK.faint, fontSize: 12.5 }}>{d}</span>}
                  </div>
                ))}
              </div>

              <div style={S.card}>
                <Sec icon={<IconLock size={15} />}>Verify it’s you</Sec>
                <div style={{ fontSize: 13.5, color: TK.muted, marginBottom: 16, lineHeight: 1.65 }}>
                  We’ll email a 6-digit code to <strong style={{ color: TK.ink }}>{c.email?.replace(/^(.{2}).*(@.*)$/, '$1***$2') || 'your email'}</strong>.
                </div>
                {c.otp_verified ? (
                  <>
                    <Note tone="ok">Your identity is already verified.</Note>
                    <button className="ezo-btn" onClick={nextStep} style={{ ...S.btnP, width: '100%' }}>Start onboarding →</button>
                  </>
                ) : !otpSent ? (
                  <button className="ezo-btn" onClick={sendOtp} disabled={otpLoading} style={{ ...S.btnP, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: otpLoading ? .6 : 1 }}>
                    <IconMail size={16} />{otpLoading ? 'Sending…' : 'Email me the code'}
                  </button>
                ) : (
                  <>
                    <Fld label="Enter the 6-digit code">
                      <input className="ezo-code" style={{ ...S.inp(), height: 56, textAlign: 'center', letterSpacing: 10, fontSize: 24, fontWeight: 700 }} value={otp} onChange={e => setOtp(e.target.value)} placeholder="••••••" maxLength={6} inputMode="numeric" autoFocus />
                    </Fld>
                    <div className="ezo-actions" style={{ marginTop: 4 }}>
                      <button className="ezo-btn" onClick={verifyOtp} disabled={otpLoading || otp.length < 6} style={{ ...S.btnP, flex: 1, opacity: otpLoading || otp.length < 6 ? .6 : 1, cursor: otp.length < 6 ? 'not-allowed' : 'pointer' }}>
                        {otpLoading ? 'Verifying…' : 'Verify & start'}
                      </button>
                      <button className="ezo-btn is-ghost" onClick={() => { setOtpSent(false); setOtp('') }} style={S.btnO}>Resend</button>
                    </div>
                    <div style={{ fontSize: 12, color: TK.faint, textAlign: 'center', marginTop: 10 }}>The code is valid for 10 minutes.</div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ STEP 5: PERSONAL DETAILS ════════════════════════════ */}
        {step === 4 && (
          <div style={S.card}>
            <div className="ezo-g2">
              <Fld label="Full Name (as per Aadhaar) *">
                <input style={S.inp(!personal.full_name)} value={personal.full_name} onChange={e => setPersonal(p => ({ ...p, full_name: e.target.value }))} />
              </Fld>
              <Fld label="Date of Birth *">
                <input type="date" style={S.inp(!personal.dob)} value={personal.dob} onChange={e => setPersonal(p => ({ ...p, dob: e.target.value }))} />
              </Fld>
              <Fld label="Gender *">
                <select style={S.sel} value={personal.gender} onChange={e => setPersonal(p => ({ ...p, gender: e.target.value }))}>
                  <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Blood Group *">
                <select style={S.sel} value={personal.blood_group} onChange={e => setPersonal(p => ({ ...p, blood_group: e.target.value }))}>
                  <option value="">Select</option>{['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(g => <option key={g}>{g}</option>)}
                </select>
              </Fld>
              <Fld label="Father's Name *">
                <input style={S.inp(!personal.father_name)} value={personal.father_name} onChange={e => setPersonal(p => ({ ...p, father_name: e.target.value }))} placeholder="As per documents" />
              </Fld>
              <Fld label="Mother's Name">
                <input style={S.inp()} value={personal.mother_name} onChange={e => setPersonal(p => ({ ...p, mother_name: e.target.value }))} />
              </Fld>
              <Fld label="Marital Status *">
                <select style={S.sel} value={personal.marital_status} onChange={e => setPersonal(p => ({ ...p, marital_status: e.target.value }))}>
                  <option value="">Select</option><option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option>
                </select>
              </Fld>
              <Fld label="Nationality">
                <input style={S.inp()} value={personal.nationality} onChange={e => setPersonal(p => ({ ...p, nationality: e.target.value }))} />
              </Fld>
              <Fld label="Religion *" hint="Required for Gratuity Form III">
                <select style={S.sel} value={personal.religion} onChange={e => setPersonal(p => ({ ...p, religion: e.target.value }))}>
                  <option value="">Select</option>{['Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Parsi', 'Other'].map(r => <option key={r}>{r}</option>)}
                </select>
              </Fld>
              <Fld label="Place of Birth">
                <input style={S.inp()} value={personal.birth_place} onChange={e => setPersonal(p => ({ ...p, birth_place: e.target.value }))} placeholder="City / town" />
              </Fld>
              <div style={{ gridColumn: 'span 2' }}>
                <Fld label="Country (Citizenship) *" hint="Type to search. Select a country other than India for foreign-employee onboarding.">
                  <input list="ezer-countries" style={S.inp(!personal.country)} value={personal.country} onChange={e => setPersonal(p => ({ ...p, country: e.target.value }))} placeholder="India" />
                </Fld>
              </div>
            </div>
            {isForeign && (
              <Note>You’re joining as a foreign national, so the next step asks for your passport, visa and tax details too.</Note>
            )}
            <div className="ezo-actions">
              <button className="ezo-btn is-ghost" onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                const miss3 = missingFor(3, personal)
                if (miss3.length) { showToast(miss3.length === 1 ? miss3[0].message : `Please fill: ${miss3.map(m => m.label).join(', ')}`, 'err'); return }
                await saveStep(3, personal)
                nextStep()
              }} className="ezo-btn" style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 6: KYC & EPF (Contact + PAN + PF + Bank) ═══════ */}
        {step === 5 && (
          <div style={S.card}>
            <div className="ezo-g2">
              <Fld label="Mobile Number *"><input style={S.inp(!contact.mobile)} value={contact.mobile} onChange={e => setContact(c => ({ ...c, mobile: e.target.value }))} /></Fld>
              <Fld label="Alternate Mobile"><input style={S.inp()} value={contact.alt_mobile} onChange={e => setContact(c => ({ ...c, alt_mobile: e.target.value }))} /></Fld>
              <div style={{ gridColumn: 'span 2' }}><Fld label="Personal Email *"><input type="email" style={S.inp(!contact.personal_email)} value={contact.personal_email} onChange={e => setContact(c => ({ ...c, personal_email: e.target.value }))} /></Fld></div>
            </div>

            <Sec icon={<IconHome size={15} />}>Permanent address</Sec>
            <div className="ezo-g3">
              <div style={{ gridColumn: 'span 3' }}><Fld label="Address Line 1 *"><input style={S.inp(!contact.perm_line1)} value={contact.perm_line1} onChange={e => setPerm('perm_line1', e.target.value)} /></Fld></div>
              <Fld label="Village / Area" hint="For Gratuity Form III"><input style={S.inp()} value={contact.perm_village} onChange={e => setPerm('perm_village', e.target.value)} /></Fld>
              <Fld label="Post Office"><input style={S.inp()} value={contact.perm_po} onChange={e => setPerm('perm_po', e.target.value)} /></Fld>
              <Fld label="Thana / Police Station"><input style={S.inp()} value={contact.perm_thana} onChange={e => setPerm('perm_thana', e.target.value)} /></Fld>
              <Fld label="Sub-Division"><input style={S.inp()} value={contact.perm_sub_division} onChange={e => setPerm('perm_sub_division', e.target.value)} /></Fld>
              <Fld label="District"><input style={S.inp()} value={contact.perm_district} onChange={e => setPerm('perm_district', e.target.value)} /></Fld>
              <Fld label="City *"><input style={S.inp(!contact.perm_city)} value={contact.perm_city} onChange={e => setPerm('perm_city', e.target.value)} /></Fld>
              <Fld label="State *">
                <select style={S.sel} value={contact.perm_state} onChange={e => setPerm('perm_state', e.target.value)}>
                  <option value="">Select State</option>{STATES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Fld>
              <Fld label="PIN Code *"><input style={S.inp(!contact.perm_pin)} value={contact.perm_pin} onChange={e => setPerm('perm_pin', e.target.value)} maxLength={6} /></Fld>
            </div>

            <label className="ezo-check" style={{ margin: '4px 0 14px', alignItems: 'center' }}>
              <input type="checkbox" checked={contact.same_address} onChange={e => setContact(c => e.target.checked ? { ...copyPermToCurr(c), same_address: true } : { ...c, same_address: false })} />
              Current address same as permanent address
            </label>

            <Sec icon={<IconHome size={15} />}>Current address{contact.same_address && <span style={{ color: TK.faint, fontWeight: 500 }}> · filled from the permanent address, edit any field if it differs</span>}</Sec>
            <div className="ezo-g3">
              <div style={{ gridColumn: 'span 3' }}><Fld label="Address Line 1"><input style={S.inp()} value={contact.curr_line1} onChange={e => setCurr('curr_line1', e.target.value)} /></Fld></div>
              <Fld label="Village / Area"><input style={S.inp()} value={contact.curr_village} onChange={e => setCurr('curr_village', e.target.value)} /></Fld>
              <Fld label="Post Office"><input style={S.inp()} value={contact.curr_po} onChange={e => setCurr('curr_po', e.target.value)} /></Fld>
              <Fld label="Thana / Police Station"><input style={S.inp()} value={contact.curr_thana} onChange={e => setCurr('curr_thana', e.target.value)} /></Fld>
              <Fld label="Sub-Division"><input style={S.inp()} value={contact.curr_sub_division} onChange={e => setCurr('curr_sub_division', e.target.value)} /></Fld>
              <Fld label="District"><input style={S.inp()} value={contact.curr_district} onChange={e => setCurr('curr_district', e.target.value)} /></Fld>
              <Fld label="City"><input style={S.inp()} value={contact.curr_city} onChange={e => setCurr('curr_city', e.target.value)} /></Fld>
              <Fld label="State">
                <select style={S.sel} value={contact.curr_state} onChange={e => setCurr('curr_state', e.target.value)}>
                  <option value="">Select State</option>{STATES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Fld>
              <Fld label="PIN Code"><input style={S.inp()} value={contact.curr_pin} onChange={e => setCurr('curr_pin', e.target.value)} maxLength={6} /></Fld>
            </div>

            {/* PAN — auto-filled from AI */}
            <Sec icon={<IconCard size={15} />}>PAN</Sec>
            {aiPan && <Note tone="ok">We filled your PAN in from your PAN card. Please check it.</Note>}
            <div className="ezo-g2">
              <Fld label="PAN Number *" hint="Auto-extracted from PAN card">
                <input style={{ ...S.inp(!statutory.pan_number), background: TK.positiveTint, border: `1px solid ${TK.positiveEdge}` }} value={statutory.pan_number || aiPan} onChange={e => setStatutory(s => ({ ...s, pan_number: e.target.value.toUpperCase() }))} maxLength={10} />
              </Fld>
            </div>

            {/* PF Section */}
            <Sec icon={<IconPayroll size={15} />}>Provident Fund (PF)</Sec>
            <label className="ezo-check" style={{ margin: '4px 0 14px', alignItems: 'center' }}>
              <input type="checkbox" checked={statutory.has_uan} onChange={e => setStatutory(s => ({ ...s, has_uan: e.target.checked }))} />
              I have an existing UAN (from previous employer)
            </label>
            {statutory.has_uan && (
              <div className="ezo-g2">
                <Fld label="UAN Number" hint="12-digit Universal Account Number">
                  <input style={S.inp()} value={statutory.uan_number} onChange={e => setStatutory(s => ({ ...s, uan_number: e.target.value }))} maxLength={12} />
                </Fld>
                <Fld label="Previous PF Member ID">
                  <input style={S.inp()} value={statutory.prev_pf_id} onChange={e => setStatutory(s => ({ ...s, prev_pf_id: e.target.value }))} placeholder="e.g. MH/BN/12345" />
                </Fld>
              </div>
            )}

            {/* Other government IDs — on the employee record; optional */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Other Government IDs (optional)</div>
            <div style={S.g3}>
              {!isForeign && <Fld label="Passport Number"><input style={S.inp()} value={statutory.passport_no} onChange={e => setStatutory(s => ({ ...s, passport_no: e.target.value.toUpperCase() }))} maxLength={12} /></Fld>}
              <Fld label="Voter ID (EPIC)"><input style={S.inp()} value={statutory.voter_id} onChange={e => setStatutory(s => ({ ...s, voter_id: e.target.value.toUpperCase() }))} maxLength={12} /></Fld>
              <Fld label="Driving Licence"><input style={S.inp()} value={statutory.driving_licence} onChange={e => setStatutory(s => ({ ...s, driving_licence: e.target.value.toUpperCase() }))} maxLength={20} /></Fld>
            </div>

            {/* Bank Details */}
            <Sec icon={<IconPayroll size={15} />}>Bank account for salary</Sec>
            <Note>Bank details are encrypted. Only the Payroll team can see them.</Note>
            <div className="ezo-g2">
              <Fld label="Account Number *"><input type="password" style={S.inp(!statutory.bank_account)} value={statutory.bank_account} onChange={e => setStatutory(s => ({ ...s, bank_account: e.target.value }))} /></Fld>
              <Fld label="Confirm Account Number *"><input style={S.inp(statutory.bank_confirm && statutory.bank_confirm !== statutory.bank_account)} value={statutory.bank_confirm} onChange={e => setStatutory(s => ({ ...s, bank_confirm: e.target.value }))} /></Fld>
              <Fld label="IFSC Code *" hint="Auto-fills bank name on entry">
                <input style={S.inp(!statutory.bank_ifsc)} value={statutory.bank_ifsc} onChange={e => { const v = e.target.value.toUpperCase(); setStatutory(s => ({ ...s, bank_ifsc: v })); lookupIfsc(v) }} maxLength={11} />
              </Fld>
              <Fld label="Bank Name (auto-fill)">
                <input style={{ ...S.inp(), background: TK.positiveTint, border: `1px solid ${TK.positiveEdge}` }} value={statutory.bank_name} readOnly placeholder="Auto-fills from IFSC" />
              </Fld>
              <Fld label="Branch"><input style={{ ...S.inp(), background: TK.positiveTint, border: `1px solid ${TK.positiveEdge}` }} value={statutory.bank_branch} readOnly placeholder="Auto-fills from IFSC" /></Fld>
              <Fld label="Account Type">
                <select style={S.sel} value={statutory.account_type} onChange={e => setStatutory(s => ({ ...s, account_type: e.target.value }))}>
                  <option>Savings</option><option>Current</option>
                </select>
              </Fld>
              <div style={{ gridColumn: 'span 2' }}>
                <Fld label="Account Holder Name (as per bank)">
                  <input style={{ ...S.inp(), background: TK.positiveTint, border: `1px solid ${TK.positiveEdge}` }} value={statutory.acc_holder} onChange={e => setStatutory(s => ({ ...s, acc_holder: e.target.value }))} placeholder="In CAPITAL LETTERS" />
                </Fld>
              </div>
            </div>
            {statutory.bank_confirm && statutory.bank_confirm !== statutory.bank_account && (
              <Note tone="bad">The two account numbers don’t match.</Note>
            )}

            {isForeign && (
              <>
                <div style={{ marginTop: 18 }}><Note>As a foreign national, please also fill in the details below.</Note></div>

                <Sec>Foreign Employee — Passport</Sec>
                <div className="ezo-g3">
                  <Fld label="Passport Number *"><input style={S.inp(!statutory.fe_passport_number)} value={statutory.fe_passport_number} onChange={e => setStatutory(s => ({ ...s, fe_passport_number: e.target.value.toUpperCase() }))} /></Fld>
                  <Fld label="Passport Issuing Country">
                    <input list="ezer-countries" style={S.inp()} value={statutory.fe_passport_country} onChange={e => setStatutory(s => ({ ...s, fe_passport_country: e.target.value }))} />
                  </Fld>
                  <Fld label="Passport Expiry *"><input type="date" style={S.inp(!statutory.fe_passport_expiry)} value={statutory.fe_passport_expiry} onChange={e => setStatutory(s => ({ ...s, fe_passport_expiry: e.target.value }))} /></Fld>
                </div>

                <Sec>Visa &amp; Work Authorization</Sec>
                <div className="ezo-g3">
                  <Fld label="Visa Type">
                    <select style={S.sel} value={statutory.fe_visa_type} onChange={e => setStatutory(s => ({ ...s, fe_visa_type: e.target.value }))}>
                      <option value="">Select</option><option>Employment</option><option>Business</option><option>OCI</option><option>PIO</option>
                    </select>
                  </Fld>
                  <Fld label="Visa Number *"><input style={S.inp(!statutory.fe_visa_number)} value={statutory.fe_visa_number} onChange={e => setStatutory(s => ({ ...s, fe_visa_number: e.target.value }))} /></Fld>
                  <Fld label="Visa Expiry"><input type="date" style={S.inp()} value={statutory.fe_visa_expiry} onChange={e => setStatutory(s => ({ ...s, fe_visa_expiry: e.target.value }))} /></Fld>
                  <Fld label="Work Permit Number"><input style={S.inp()} value={statutory.fe_work_permit_number} onChange={e => setStatutory(s => ({ ...s, fe_work_permit_number: e.target.value }))} /></Fld>
                  <Fld label="FRRO Registration Number" hint="if stay > 180 days"><input style={S.inp()} value={statutory.fe_frro_number} onChange={e => setStatutory(s => ({ ...s, fe_frro_number: e.target.value }))} /></Fld>
                </div>

                <Sec>Tax &amp; Social Security</Sec>
                <div className="ezo-g2">
                  <Fld label="India Tax Residency Status">
                    <select style={S.sel} value={statutory.fe_tax_residency} onChange={e => setStatutory(s => ({ ...s, fe_tax_residency: e.target.value }))}>
                      <option value="">Select</option><option>Resident</option><option>Non-Resident</option><option>Not Ordinarily Resident</option>
                    </select>
                  </Fld>
                  <Fld label="Country of Tax Residency">
                    <input list="ezer-countries" style={S.inp()} value={statutory.fe_tax_country} onChange={e => setStatutory(s => ({ ...s, fe_tax_country: e.target.value }))} />
                  </Fld>
                  <Fld label="Foreign Tax ID / TIN"><input style={S.inp()} value={statutory.fe_foreign_tin} onChange={e => setStatutory(s => ({ ...s, fe_foreign_tin: e.target.value }))} /></Fld>
                  <Fld label="SSA Certificate of Coverage No." hint="if home country has a Social Security Agreement with India"><input style={S.inp()} value={statutory.fe_ssa_coc} onChange={e => setStatutory(s => ({ ...s, fe_ssa_coc: e.target.value }))} /></Fld>
                </div>

                <Sec>Permanent Overseas Address</Sec>
                <div className="ezo-g3">
                  <div style={{ gridColumn: 'span 3' }}><Fld label="Address Line"><input style={S.inp()} value={statutory.fe_overseas_line} onChange={e => setStatutory(s => ({ ...s, fe_overseas_line: e.target.value }))} /></Fld></div>
                  <Fld label="City"><input style={S.inp()} value={statutory.fe_overseas_city} onChange={e => setStatutory(s => ({ ...s, fe_overseas_city: e.target.value }))} /></Fld>
                  <Fld label="Country">
                    <input list="ezer-countries" style={S.inp()} value={statutory.fe_overseas_country} onChange={e => setStatutory(s => ({ ...s, fe_overseas_country: e.target.value }))} />
                  </Fld>
                </div>
              </>
            )}

            <div className="ezo-actions">
              <button className="ezo-btn is-ghost" onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                const miss4 = [...missingFor(4, contact), ...missingFor(7, statutory).filter(m => m.key !== 'pf_nominees')]
                if (miss4.length) { showToast(miss4.length === 1 ? miss4[0].message : `Please fill: ${miss4.map(m => m.label).join(', ')}`, 'err'); return }
                if (statutory.bank_account !== statutory.bank_confirm) { showToast('Account numbers do not match', 'err'); return }
                await saveStep(4, contact)
                await saveStep(7, { ...statutory, gross_monthly: grossMonthly, esic_applicable: esicApplicable, esic_details: esic, insurance, eps_family: epsFamily, eps_fallback: epsFallback })
                nextStep()
              }} className="ezo-btn" style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 9: EMERGENCY + EMPLOYMENT + EDUCATION ════════════ */}
        {step === 8 && (
          <div style={S.card}>
            <Sec icon={<IconAlert size={15} />}>Emergency contact <span style={{ color: TK.critical }}>*</span></Sec>
            <div className="ezo-g3">
              <Fld label="Name *"><input style={S.inp(!emergency.emrg1_name)} value={emergency.emrg1_name} onChange={e => setEmergency(p => ({ ...p, emrg1_name: e.target.value }))} /></Fld>
              <Fld label="Relation *">
                <select style={S.sel} value={emergency.emrg1_relation} onChange={e => setEmergency(p => ({ ...p, emrg1_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Sibling</option><option>Child</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Mobile *"><input style={S.inp(!emergency.emrg1_mobile)} value={emergency.emrg1_mobile} onChange={e => setEmergency(p => ({ ...p, emrg1_mobile: e.target.value }))} /></Fld>
            </div>

            <Sec>Second emergency contact <span style={{ color: TK.faint, fontWeight: 500 }}>(optional)</span></Sec>
            <div className="ezo-g3">
              <Fld label="Name"><input style={S.inp()} value={emergency.emrg2_name} onChange={e => setEmergency(p => ({ ...p, emrg2_name: e.target.value }))} /></Fld>
              <Fld label="Relation">
                <select style={S.sel} value={emergency.emrg2_relation} onChange={e => setEmergency(p => ({ ...p, emrg2_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Sibling</option><option>Child</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Mobile"><input style={S.inp()} value={emergency.emrg2_mobile} onChange={e => setEmergency(p => ({ ...p, emrg2_mobile: e.target.value }))} /></Fld>
            </div>

            <Sec icon={<IconBuilding size={15} />}>Previous employment</Sec>
            <label className="ezo-check" style={{ margin: '4px 0 14px', alignItems: 'center' }}>
              <input type="checkbox" checked={emergency.is_fresher} onChange={e => setEmergency(p => ({ ...p, is_fresher: e.target.checked }))} />
              I am a fresher (no previous work experience)
            </label>

            {!emergency.is_fresher && (
              <>
                {prevEmployers.map((emp, i) => (
                  <div key={i} style={{ border: `1px solid ${TK.brandEdge}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: TK.brandTint }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={BLOCK_TITLE}><span style={BLOCK_NO}>{i + 1}</span>{emp.company || `Employer ${i + 1}`}</div>
                      {prevEmployers.length > 1 && (
                        <button onClick={() => setPrevEmployers(arr => arr.filter((_, idx) => idx !== i))} style={REMOVE_BTN}>Remove</button>
                      )}
                    </div>
                    <div className="ezo-g2">
                      <Fld label="Company"><input style={S.inp()} value={emp.company} onChange={e => upEmp(i, { company: e.target.value })} /></Fld>
                      <Fld label="Designation"><input style={S.inp()} value={emp.designation} onChange={e => upEmp(i, { designation: e.target.value })} /></Fld>
                      <Fld label="From"><input type="date" style={S.inp()} value={emp.from} onChange={e => upEmp(i, { from: e.target.value })} /></Fld>
                      <Fld label="To"><input type="date" style={S.inp()} value={emp.to} onChange={e => upEmp(i, { to: e.target.value })} /></Fld>
                      <Fld label="Last CTC (Annual ₹)"><input type="number" style={S.inp()} value={emp.ctc} onChange={e => upEmp(i, { ctc: e.target.value })} /></Fld>
                      <Fld label="Reason for Leaving"><input style={S.inp()} value={emp.reason} onChange={e => upEmp(i, { reason: e.target.value })} /></Fld>
                    </div>
                    <DocUpload docCode={`EXP_${i + 1}`} docName={`Experience / Relieving Letter, Employer ${i + 1}`} required={false} compact token={token} status={docs[`EXP_${i + 1}`] || null} onRemoved={onDocRemoved}
                      onSuccess={(code, data) => { setDocs(d => ({ ...d, [code]: { doc_code: code, ai_status: data.ai_status, ai_extracted_data: data.ai_extracted, ai_confidence: data.ai_confidence, ai_flags: data.ai_flags, file_name: 'uploaded' } })); showToast('Experience letter uploaded ✓') }} />
                  </div>
                ))}
                <button onClick={() => setPrevEmployers(arr => [...arr, { company: '', designation: '', from: '', to: '', ctc: '', reason: '' }])} style={ADD_BTN}>+ Add another employer</button>
              </>
            )}

            {/* Education ladder */}
            <Sec icon={<IconLeave size={15} />}>Education</Sec>
            <div style={{ fontSize: 13, color: TK.muted, marginBottom: 12 }}>We added the usual four. Upload a certificate or marksheet for each; they’re used for background verification.</div>
            {education.map((ed, i) => (
              <div key={i} style={{ border: `1px solid ${TK.brandEdge}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: TK.brandTint }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={BLOCK_TITLE}><span style={BLOCK_NO}>{i + 1}</span>{ed.qualification || `Qualification ${i + 1}`}</div>
                  {education.length > 1 && (
                    <button onClick={() => setEducation(arr => arr.filter((_, idx) => idx !== i))} style={REMOVE_BTN}>Remove</button>
                  )}
                </div>
                <div className="ezo-g3">
                  <Fld label="Qualification"><input style={S.inp()} value={ed.qualification} onChange={e => upEdu(i, { qualification: e.target.value })} placeholder="10th / B.Tech / MBA…" /></Fld>
                  <Fld label="School / University / Board"><input style={S.inp()} value={ed.institute} onChange={e => upEdu(i, { institute: e.target.value })} /></Fld>
                  <Fld label="Year of Passing"><input style={S.inp()} value={ed.year} onChange={e => upEdu(i, { year: e.target.value })} maxLength={4} /></Fld>
                </div>
                <DocUpload docCode={`EDU_${i + 1}`} docName={`Certificate / Marksheet, ${ed.qualification || `Qualification ${i + 1}`}`} required={false} compact token={token} status={docs[`EDU_${i + 1}`] || null} onRemoved={onDocRemoved}
                  onSuccess={(code, data) => { setDocs(d => ({ ...d, [code]: { doc_code: code, ai_status: data.ai_status, ai_extracted_data: data.ai_extracted, ai_confidence: data.ai_confidence, ai_flags: data.ai_flags, file_name: 'uploaded' } })); showToast('Certificate uploaded ✓') }} />
              </div>
            ))}
            <button onClick={() => setEducation(arr => [...arr, { qualification: '', institute: '', year: '' }])} style={ADD_BTN}>+ Add qualification (Diploma / PhD / Certification)</button>

            <div className="ezo-actions">
              <button className="ezo-btn is-ghost" onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                const miss5 = missingFor(5, { ...emergency, prev_employers: prevEmployers, education })
                if (miss5.length) { showToast(miss5.length === 1 ? miss5[0].message : `Please fill: ${miss5.map(m => m.label).join(', ')}`, 'err'); return }
                await saveStep(5, { ...emergency, prev_employers: prevEmployers, education }); nextStep()
              }} className="ezo-btn" style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 3: DOCUMENT UPLOAD ════════════════════════════ */}
        {step === 2 && (
          <div style={S.card}>
            <DocsGrid docs={docs} token={token} esicApplicable={esicApplicable} isFresher={emergency.is_fresher} isForeign={isForeign} onUploaded={onDocUploaded} onRemoved={onDocRemoved} />

            <div className="ezo-actions" style={{ marginTop: 20 }}>
              <button className="ezo-btn is-ghost" onClick={prevStep} style={S.btnO}>Back</button>
              <button className="ezo-btn is-ghost" onClick={() => { setDocsDeferred(true); showToast('Skipped for now. You’ll need to upload them before the Policies step.'); nextStep() }}
                style={S.btnO}>Do this later</button>
              <button onClick={async () => {
                const notUploaded = REQUIRED_DOC_CODES(esicApplicable).filter(d => !docs[d])
                if (notUploaded.length > 0) {
                  showToast(`Please upload: ${notUploaded.join(', ')}`, 'err'); return
                }
                setDocsDeferred(false)
                await saveStep(6, { docs_uploaded: Object.keys(docs) }); nextStep()
              }} className="ezo-btn" style={{ ...S.btnP, flex: 1, minWidth: 140 }}>Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 4: AI DOCUMENT REVIEW ═════════════════════════ */}
        {step === 3 && (
          <div>
            {!Object.values(docs).some(d => d.ai_extracted_data && Object.keys(d.ai_extracted_data).length) && (
              <div style={{ ...S.card, display: 'flex', gap: 14, alignItems: 'center' }}>
                <span style={{ width: 44, height: 44, borderRadius: 13, display: 'grid', placeItems: 'center', background: TK.brandTint, color: TK.brand, flexShrink: 0 }}><IconAi size={20} /></span>
                <div><div style={{ fontSize: 14.5, fontWeight: 700 }}>Nothing to check here yet</div><div style={{ fontSize: 13, color: TK.muted, marginTop: 2 }}>We couldn’t read details from your files automatically, so you’ll type them in the next steps. HR will verify the documents.</div></div>
              </div>
            )}
            <AIReviewTable docs={docs} />
            <CrossDocCheck docs={docs} onResolve={onCrossDocResolve} onMismatchChange={setCrossDocUnresolved} />
            {crossDocUnresolved > 0 && (
              <Note tone="warn">Pick the correct value for each mismatch to continue ({crossDocUnresolved} left).</Note>
            )}
            <div className="ezo-actions">
              <button className="ezo-btn is-ghost" onClick={prevStep} style={S.btnO}>Back</button>
              <button className="ezo-btn" onClick={nextStep} disabled={crossDocUnresolved > 0}
                style={{ ...S.btnP, flex: 1, opacity: crossDocUnresolved > 0 ? .45 : 1, cursor: crossDocUnresolved > 0 ? 'not-allowed' : 'pointer' }}>Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 7: NOMINEES (PF + Gratuity) ═══════════════════ */}
        {step === 6 && (
          <div style={S.card}>
            {/* PF nominees (EPF Form 2): one or more, shares totalling 100% */}
            <Sec icon={<IconUser size={15} />}>PF nominees <span style={{ color: TK.faint, fontWeight: 500 }}>(EPF Form 2) · share total {shareTotal(statutory.pf_nominees)}%</span></Sec>
            {statutory.pf_nominees.map((row, i) => (
              <NomineeRow key={i} row={row} index={i} kind="pf" canRemove={statutory.pf_nominees.length > 1}
                onChange={patch => setStatutory(s => ({ ...s, pf_nominees: s.pf_nominees.map((r, idx) => idx === i ? { ...r, ...patch } : r) }))}
                onRemove={() => setStatutory(s => ({ ...s, pf_nominees: s.pf_nominees.filter((_, idx) => idx !== i) }))} />
            ))}
            <button className="ezo-btn is-ghost" onClick={() => setStatutory(s => ({ ...s, pf_nominees: [...s.pf_nominees, { ...EMPTY_NOMINEE, share: String(Math.max(0, 100 - shareTotal(s.pf_nominees))) }] }))} style={{ ...S.btnO, marginBottom: 4 }}>+ Add PF nominee</button>

            {/* Gratuity nominees (Form F): one or more */}
            <Sec icon={<IconUser size={15} />}>Gratuity nominees <span style={{ color: TK.faint, fontWeight: 500 }}>(Form F) · share total {shareTotal(statutory.grat_nominees)}%</span></Sec>
            {statutory.grat_nominees.map((row, i) => (
              <NomineeRow key={i} row={row} index={i} kind="grat" canRemove={statutory.grat_nominees.length > 1}
                onChange={patch => setStatutory(s => ({ ...s, grat_nominees: s.grat_nominees.map((r, idx) => idx === i ? { ...r, ...patch } : r) }))}
                onRemove={() => setStatutory(s => ({ ...s, grat_nominees: s.grat_nominees.filter((_, idx) => idx !== i) }))} />
            ))}
            <button className="ezo-btn is-ghost" onClick={() => setStatutory(s => ({ ...s, grat_nominees: [...s.grat_nominees, { ...EMPTY_NOMINEE, share: String(Math.max(0, 100 - shareTotal(s.grat_nominees))) }] }))} style={{ ...S.btnO, marginBottom: 4 }}>+ Add gratuity nominee</button>

            {/* EPS Family Members (Form 2 Part B) */}
            <Sec icon={<IconEmployees size={15} />}>Pension family members <span style={{ color: TK.faint, fontWeight: 500 }}>(Form 2 Part B)</span></Sec>
            <div style={{ fontSize: 13, color: TK.muted, marginBottom: 12 }}>Family members eligible for the Employees’ Pension Scheme.</div>
            {epsFamily.map((row, i) => (
              <EpsFamilyRow key={i} row={row} index={i} canRemove={epsFamily.length > 1}
                onChange={patch => setEpsFamily(arr => arr.map((r, idx) => idx === i ? { ...r, ...patch } : r))}
                onRemove={() => setEpsFamily(arr => arr.filter((_, idx) => idx !== i))} />
            ))}
            <button onClick={() => setEpsFamily(arr => [...arr, { name: '', address: '', dob: '', relation: '' }])} style={ADD_BTN}>+ Add family member</button>

            {/* EPS Fallback Nominee */}
            <Sec>Pension fallback nominee</Sec>
            <div className="ezo-g2">
              <Fld label="Name"><input style={S.inp()} value={epsFallback.name} onChange={e => setEpsFallback(s => ({ ...s, name: e.target.value }))} /></Fld>
              <Fld label="Relation">
                <select style={S.sel} value={epsFallback.relation} onChange={e => setEpsFallback(s => ({ ...s, relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Son</option><option>Daughter</option><option>Father</option><option>Mother</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Date of Birth"><input type="date" style={S.inp()} value={epsFallback.dob} onChange={e => setEpsFallback(s => ({ ...s, dob: e.target.value }))} /></Fld>
              <Fld label="Address"><input style={S.inp()} value={epsFallback.address} onChange={e => setEpsFallback(s => ({ ...s, address: e.target.value }))} /></Fld>
            </div>

            <div className="ezo-actions">
              <button className="ezo-btn is-ghost" onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                const bad = statutory.pf_nominees.findIndex(n => !n.name?.trim() || !n.dob || !n.address?.trim() || !n.relation)
                if (bad >= 0) { showToast(`PF nominee ${bad + 1}: name, relation, date of birth and address are required`, 'err'); return }
                const miss7 = missingFor(7, statutory)
                if (miss7.length) { showToast(miss7.length === 1 ? miss7[0].message : `Please fill: ${miss7.map(m => m.label).join(', ')}`, 'err'); return }
                if (statutory.pf_nominees.length > 1 && Math.round(shareTotal(statutory.pf_nominees)) !== 100) { showToast(`PF nominee shares add up to ${shareTotal(statutory.pf_nominees)}% — they must total 100%`, 'err'); return }
                const gr = statutory.grat_nominees.filter(n => n.name?.trim())
                if (gr.length > 1 && Math.round(shareTotal(gr)) !== 100) { showToast(`Gratuity nominee shares add up to ${shareTotal(gr)}% — they must total 100%`, 'err'); return }
                const st = withLegacyNominees({ ...statutory, grat_nominees: gr.length ? gr : statutory.grat_nominees })
                setStatutory(st)
                await saveStep(7, { ...st, gross_monthly: grossMonthly, esic_applicable: esicApplicable, esic_details: esic, insurance, eps_family: epsFamily, eps_fallback: epsFallback })
                nextStep()
              }} className="ezo-btn" style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 8: ESIC & FAMILY (only when ESIC applicable) ═══ */}
        {step === 7 && esicApplicable && (
          <div style={S.card}>
            {/* ── Family Insurance ─────────────────────────────────── */}
            <Sec icon={<IconEmployees size={15} />}>Family for medical cover{esicApplicable && <span style={{ color: TK.faint, fontWeight: 500 }}> · also used for ESIC Form 1</span>}</Sec>
            <div style={{ fontSize: 13, color: TK.muted, marginBottom: 12 }}>For group medical cover{esicApplicable ? ' and the ESIC e-Pehchan card' : ''}. Ages are worked out from the date of birth.</div>

            {personal.marital_status === 'Married' && (
              <div style={BLOCK}>
                <div style={{ ...BLOCK_TITLE, marginBottom: 12 }}>Spouse{insurance.spouse_dob ? ` · Age ${ageFromDob(insurance.spouse_dob)}` : ''}</div>
                <div className="ezo-g3">
                  <Fld label="Spouse Name"><input style={S.inp()} value={insurance.spouse_name} onChange={e => setInsurance(s => ({ ...s, spouse_name: e.target.value }))} /></Fld>
                  <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.spouse_dob} onChange={e => setInsurance(s => ({ ...s, spouse_dob: e.target.value }))} /></Fld>
                  <Fld label="Residing with you?"><select style={S.sel} value={insurance.spouse_residing} onChange={e => setInsurance(s => ({ ...s, spouse_residing: e.target.value }))}><option>Yes</option><option>No</option></select></Fld>
                </div>
              </div>
            )}
            <div style={BLOCK}>
              <div style={{ ...BLOCK_TITLE, marginBottom: 12 }}>Father{insurance.father_dob ? ` · Age ${ageFromDob(insurance.father_dob)}` : ''}</div>
              <div className="ezo-g3">
                <Fld label="Father's Name"><input style={S.inp()} value={insurance.father_name} onChange={e => setInsurance(s => ({ ...s, father_name: e.target.value }))} /></Fld>
                <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.father_dob} onChange={e => setInsurance(s => ({ ...s, father_dob: e.target.value }))} /></Fld>
                <Fld label="Residing with you?"><select style={S.sel} value={insurance.father_residing} onChange={e => setInsurance(s => ({ ...s, father_residing: e.target.value }))}><option>Yes</option><option>No</option></select></Fld>
              </div>
            </div>
            <div style={BLOCK}>
              <div style={{ ...BLOCK_TITLE, marginBottom: 12 }}>Mother{insurance.mother_dob ? ` · Age ${ageFromDob(insurance.mother_dob)}` : ''}</div>
              <div className="ezo-g3">
                <Fld label="Mother's Name"><input style={S.inp()} value={insurance.mother_name} onChange={e => setInsurance(s => ({ ...s, mother_name: e.target.value }))} /></Fld>
                <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.mother_dob} onChange={e => setInsurance(s => ({ ...s, mother_dob: e.target.value }))} /></Fld>
                <Fld label="Residing with you?"><select style={S.sel} value={insurance.mother_residing} onChange={e => setInsurance(s => ({ ...s, mother_residing: e.target.value }))}><option>Yes</option><option>No</option></select></Fld>
              </div>
            </div>
            <div className="ezo-g2">
              <div style={BLOCK}>
                <div style={{ ...BLOCK_TITLE, marginBottom: 12 }}>Child 1{insurance.kid1_dob ? ` · Age ${ageFromDob(insurance.kid1_dob)}` : ''}</div>
                <Fld label="Name"><input style={S.inp()} value={insurance.kid1_name} onChange={e => setInsurance(s => ({ ...s, kid1_name: e.target.value }))} /></Fld>
                <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.kid1_dob} onChange={e => setInsurance(s => ({ ...s, kid1_dob: e.target.value }))} /></Fld>
              </div>
              <div style={BLOCK}>
                <div style={{ ...BLOCK_TITLE, marginBottom: 12 }}>Child 2{insurance.kid2_dob ? ` · Age ${ageFromDob(insurance.kid2_dob)}` : ''}</div>
                <Fld label="Name"><input style={S.inp()} value={insurance.kid2_name} onChange={e => setInsurance(s => ({ ...s, kid2_name: e.target.value }))} /></Fld>
                <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.kid2_dob} onChange={e => setInsurance(s => ({ ...s, kid2_dob: e.target.value }))} /></Fld>
              </div>
            </div>

            {/* ── ESIC details (only when applicable) ──────────────── */}
            {esicApplicable && (
              <>
                <Sec icon={<IconCompliance size={15} />}>ESIC details <span style={{ color: TK.faint, fontWeight: 500 }}>(Form 1)</span></Sec>
                <Note>Your gross salary is within the ESIC limit (up to ₹21,000 a month), so we’ll prepare ESIC Form 1 and attach your family photo for the e-Pehchan card.</Note>
                <div className="ezo-g2">
                  <Fld label="Previous ESIC IP Number (if any)" hint="10-digit number from a previous employer / e-Pehchan card"><input style={S.inp()} value={esic.prev_ip} onChange={e => setEsic(s => ({ ...s, prev_ip: e.target.value }))} maxLength={10} /></Fld>
                  <Fld label="Preferred ESIC Dispensary / IMP" hint="Nearest ESIC dispensary to your residence"><input style={S.inp()} value={esic.dispensary} onChange={e => setEsic(s => ({ ...s, dispensary: e.target.value }))} /></Fld>
                </div>
              </>
            )}

            <div className="ezo-actions">
              <button className="ezo-btn is-ghost" onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                await saveStep(7, { ...statutory, gross_monthly: grossMonthly, esic_applicable: esicApplicable, esic_details: esic, insurance, eps_family: epsFamily, eps_fallback: epsFallback })
                nextStep()
              }} className="ezo-btn" style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 10: FORMS REVIEW & DECLARATION ════════════════ */}
        {step === 9 && (
          <div>
            {/* Phase 8 — read-only statutory form previews */}
            <StatutoryFormsPreview token={token} personal={personal} contact={contact} statutory={statutory} insurance={insurance} esic={esic} candidate={c} esicApplicable={esicApplicable} isForeign={isForeign} epsFamily={epsFamily} epsFallback={epsFallback} />
            {/* Summary */}
            <div style={S.card}>
              <Sec icon={<IconUser size={15} />}>Your summary</Sec>
              <div className="ezo-g2" style={{ gap: 8, marginBottom: 18 }}>
                {[
                  { l: 'Name', v: personal.full_name || c.full_name },
                  { l: 'DOB', v: personal.dob || '—' },
                  { l: 'Mobile', v: contact.mobile || c.mobile },
                  { l: 'Email', v: contact.personal_email || c.email },
                  { l: 'PAN', v: statutory.pan_number || '—' },
                  { l: 'Bank', v: statutory.bank_name ? `${statutory.bank_name} ...${statutory.bank_account?.slice(-4) || ''}` : '—' },
                  { l: 'PF Nominee', v: statutory.nominee_name || '—' },
                  { l: 'Documents', v: `${Object.keys(docs).length} uploaded` },
                ].map(({ l, v }) => (
                  <div key={l} style={{ padding: '10px 14px', background: TK.sunken, borderRadius: 12, border: `1px solid ${TK.line}`, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: TK.faint, textTransform: 'uppercase', letterSpacing: '.05em' }}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 650, color: TK.ink, marginTop: 2, overflowWrap: 'anywhere' }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Declaration */}
              <div style={{ background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius: 12, padding: '16px 18px', marginBottom: 14, fontSize: 13.5, color: TK.brandDeep, lineHeight: 1.75 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Declaration</div>
                I hereby declare that all information provided by me in this form is true, correct, and complete to the best of my knowledge and belief. I understand that any false or misleading information may lead to withdrawal of the offer or termination of employment. I agree to abide by all company policies and rules. I consent to background verification of my credentials.
              </div>

              <label className="ezo-check" style={declaration ? { borderColor: TK.positiveEdge, background: TK.positiveTint } : undefined}>
                <input type="checkbox" checked={declaration} onChange={e => setDeclaration(e.target.checked)} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>I have read and accept the above declaration. I confirm all details are accurate and I agree to the company's terms and conditions.</span>
              </label>
            </div>

            <div className="ezo-actions">
              <button className="ezo-btn is-ghost" onClick={prevStep} style={S.btnO}>Back</button>
              <button className="ezo-btn" onClick={nextStep} disabled={!declaration}
                style={{ ...S.btnP, flex: 1, opacity: declaration ? 1 : .45, cursor: !declaration ? 'not-allowed' : 'pointer' }}>
                Continue to Policies →
              </button>
            </div>
          </div>
        )}

        {step === 10 && (
          docsDeferred && !docsComplete ? (
            <div style={S.card}>
              <Sec icon={<IconUpload size={15} />}>A few documents are still missing</Sec>
              <Note tone="warn">You skipped your documents earlier. Upload the required ones now to unlock the policies.</Note>
              <DocsGrid docs={docs} token={token} esicApplicable={esicApplicable} isFresher={emergency.is_fresher} isForeign={isForeign} onUploaded={onDocUploaded} onRemoved={onDocRemoved} />
              <button className="ezo-btn is-ghost" onClick={prevStep} style={{ ...S.btnO, marginTop: 16 }}>Back</button>
            </div>
          ) : (
            <PolicyAckPhase token={token} onBack={prevStep} onNext={nextStep} />
          )
        )}

        {step === 11 && (
          <AckPreviewPhase token={token} onBack={prevStep} onNext={nextStep} />
        )}

        {step === 12 && (
          <ESignPhase token={token} onBack={prevStep} onSubmit={handleSubmit} submitting={submitting} />
        )}
        </div>
      </div>
      </main>
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
