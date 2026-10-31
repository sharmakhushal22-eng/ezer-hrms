'use client'
// components/letters/LettersStudio.tsx — People → Letters.
//
//   Pending           joiners whose employee code is generated and whose Letter of Appointment
//                     has not gone out: Send opens the auto-filled appointment letter
//                     (components/onboarding/AppointmentLetterModal).
//   Issue a letter    any of the twenty letters (lib/letters/catalog.ts) to any employee: find
//                     the employee by code or name, pick the letter, the form fills in from their
//                     record (lib/letters/facts.ts) and asks for what the record lacks; Preview
//                     draws the PDF, Download saves it, Send stores it, mails it to the
//                     employee's registered address and — for the letters the spec shows in ESS —
//                     puts it in their ESS.
//   Issued            the letters issued in the caller's companies, searchable, each one openable.
// Every route is app/api/letters/studio (the file link: app/api/letters/employee).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { C, W, E, R, Z } from '@/lib/ui'
import { LETTERS, LETTER_BY_CODE, STAGE_ORDER, missingFields, type LetterDef, type LetterField, type Values } from '@/lib/letters/catalog'
import AppointmentLetterModal from '@/components/onboarding/AppointmentLetterModal'

type Emp = { id: string; emp_code: string | null; full_name: string; designation: string | null; status?: string | null; company?: string | null; email?: string | null }
type Pending = { id: string; full_name: string; employee_code: string | null; designation: string | null; date_of_joining: string | null; email: string | null }
type Issued = { id: string; employee_id?: string | null; letter_name: string | null; letter_type?: string | null; doc_id?: string | null; letter_date: string; generated_at: string; emailed_at: string | null; published_to_ess_at: string | null; sent_to?: string | null; generated_by_name?: string | null; employees?: { full_name: string; emp_code: string | null } | null }
type Tab = 'pending' | 'issue' | 'issued'

async function api(path: string, init?: RequestInit) {
  return fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init?.headers || {}) }, cache: 'no-store' })
}
const day = (d?: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
const QUICK = ['APT', 'CNF', 'INC', 'PRM', 'TRF', 'REL', 'EXP']

// ── shared looks ────────────────────────────────────────────────────────────
const FONT = '"DM Sans","Segoe UI",sans-serif'
const panel: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, boxShadow: E.flat }
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: W.semi, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }
const input: React.CSSProperties = { width: '100%', height: 38, padding: '0 11px', borderRadius: R.sm, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, color: C.muted, fontWeight: W.semi, textTransform: 'uppercase', letterSpacing: '.05em', background: C.sunken, borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: Z.raised }
const td: React.CSSProperties = { padding: '11px 14px', borderBottom: `1px solid ${C.line}`, fontSize: 13, color: C.ink, verticalAlign: 'middle' }
const btn = (kind: 'primary' | 'secondary' | 'ghost' = 'secondary', small = false): React.CSSProperties => ({
  height: small ? 32 : 38, padding: small ? '0 12px' : '0 16px', borderRadius: R.sm, cursor: 'pointer', fontSize: small ? 12.5 : 13, fontWeight: W.semi, fontFamily: 'inherit', whiteSpace: 'nowrap',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  border: `1px solid ${kind === 'primary' ? C.brand : kind === 'ghost' ? 'transparent' : C.lineStrong}`,
  background: kind === 'primary' ? C.brand : kind === 'ghost' ? 'transparent' : C.surface,
  color: kind === 'primary' ? C.onAccent : kind === 'ghost' ? C.brand : C.ink,
})
const pill = (fg: string, bg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: W.semi, color: fg, background: bg, borderRadius: R.pill, padding: '2px 9px', whiteSpace: 'nowrap' })

const PATHS: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.3-4.3',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  check: 'M5 12.5 10 17l9-10',
  alert: 'M12 8v5m0 3.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  send: 'M4 12 20 4l-5 16-3-7-8-1Z',
  chevron: 'm7 10 5 5 5-5',
  x: 'M6 6l12 12M18 6 6 18',
}
function Icon({ name, size = 16, color }: { name: keyof typeof PATHS; size?: number; color?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={PATHS[name]} />
    </svg>
  )
}

function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: R.pill, display: 'grid', placeItems: 'center', fontSize: size * .36, fontWeight: W.bold, background: C.brandTint, color: C.brand, border: `1px solid ${C.brandEdge}`, flexShrink: 0 }}>{initials(name)}</span>
}

function Kpi({ icon, value, text, tone }: { icon: keyof typeof PATHS; value: string; text: string; tone: string }) {
  return (
    <div style={{ ...panel, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 38, height: 38, borderRadius: R.md, display: 'grid', placeItems: 'center', color: tone, background: `color-mix(in srgb, ${tone} 12%, ${C.surface})` }}><Icon name={icon} size={18} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: W.bold, color: C.ink, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{text}</div>
      </div>
    </div>
  )
}

function Section({ step, title, hint, done, children, right }: { step: number; title: string; hint?: string; done?: boolean; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section style={{ ...panel }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
        <span style={{ width: 22, height: 22, borderRadius: R.pill, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: W.bold, flexShrink: 0,
          background: done ? C.positive : C.sunken, color: done ? C.onAccent : C.muted, border: `1px solid ${done ? C.positive : C.lineStrong}` }}>{done ? <Icon name="check" size={13} /> : step}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: W.semi, color: C.ink }}>{title}</div>
          {hint && <div style={{ fontSize: 12, color: C.muted }}>{hint}</div>}
        </div>
        {right}
      </header>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  )
}

function SearchBox({ value, onChange, placeholder, autoFocus, onKeyDown, big }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; onKeyDown?: (e: React.KeyboardEvent) => void; big?: boolean }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.faint, display: 'flex' }}><Icon name="search" size={16} /></span>
      <input style={{ ...input, height: big ? 42 : 36, paddingLeft: 34, paddingRight: value ? 32 : 11 }} value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} aria-label={placeholder} />
      {value && <button type="button" aria-label="Clear" onClick={() => onChange('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', color: C.faint, cursor: 'pointer', display: 'flex', padding: 4 }}><Icon name="x" size={14} /></button>}
    </div>
  )
}

/** Find an employee by code or name — the first thing HR does. */
function EmployeeSearch({ value, onPick, onClear }: { value: Emp | null; onPick: (e: Emp) => void; onClear: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Emp[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off)
  }, [])
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setHits([]); setState('idle'); return }
    setState('loading'); setOpen(true)
    let alive = true
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/letters/studio?search=${encodeURIComponent(term)}`)
        const j = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) { setError(j.error || `Search failed (${r.status}).`); setHits([]); setState('error'); return }
        setHits(j.employees || []); setActive(0); setState('done')
      } catch (e: any) { if (alive) { setError(e?.message || 'Search failed.'); setState('error') } }
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q])
  const pick = (h: Emp) => { onPick(h); setQ(''); setOpen(false) }
  const keys = (e: React.KeyboardEvent) => {
    if (!hits.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  if (value) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: R.md, background: C.sunken, border: `1px solid ${C.line}` }}>
      <Avatar name={value.full_name} size={40} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: W.semi, fontSize: 14, color: C.ink }}>{value.full_name} <span style={{ color: C.muted, fontWeight: W.medium }}>· {value.emp_code}</span></div>
        <div style={{ fontSize: 12, color: C.muted }}>{[value.designation, value.company].filter(Boolean).join(' · ') || '—'}</div>
      </div>
      {value.status && value.status !== 'Active' && <span style={pill(C.warning, C.warningTint)}>{value.status}</span>}
      <button type="button" style={btn('secondary', true)} onClick={onClear}>Change</button>
    </div>
  )
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onFocus={() => q.trim().length >= 2 && setOpen(true)}>
        <SearchBox big value={q} onChange={setQ} onKeyDown={keys} placeholder="Search employee by code or name, e.g. STC9073" />
      </div>
      {open && q.trim().length >= 2 && (
        <div role="listbox" style={{ position: 'absolute', top: 46, left: 0, right: 0, maxHeight: 340, overflowY: 'auto', ...panel, boxShadow: E.overlay, padding: 4, zIndex: Z.sticky }}>
          {state === 'loading' && <div style={{ padding: '12px 12px', fontSize: 13, color: C.muted }}>Searching…</div>}
          {state === 'error' && <div style={{ padding: '12px 12px', fontSize: 13, color: C.critical, display: 'flex', gap: 8 }}><Icon name="alert" />{error}</div>}
          {state === 'done' && hits.length === 0 && <div style={{ padding: '12px 12px', fontSize: 13, color: C.muted }}>No employee matches “{q.trim()}” in the companies you can issue letters for.</div>}
          {state === 'done' && hits.map((h, i) => (
            <button key={h.id} type="button" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => pick(h)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: R.sm, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: i === active ? C.brandTint : 'transparent' }}>
              <Avatar name={h.full_name} size={30} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: W.semi, color: C.ink }}>{h.full_name}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[h.designation, h.company].filter(Boolean).join(' · ') || '—'}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: W.semi, color: C.inkSoft, fontFamily: 'ui-monospace, monospace' }}>{h.emp_code}</span>
              {h.status && h.status !== 'Active' && <span style={pill(C.muted, C.sunken)}>{h.status}</span>}
            </button>
          ))}
        </div>
      )}
      {q.trim().length === 1 && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 5 }}>Type at least 2 characters.</div>}
    </div>
  )
}

/** The letter type: a searchable list grouped by stage, plus the common ones as chips. */
function LetterPicker({ value, onPick }: { value: LetterDef | null; onPick: (d: LetterDef) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off)
  }, [])
  const term = q.trim().toLowerCase()
  const hits = LETTERS.filter(l => !term || `${l.name} ${l.code} ${l.stage} ${l.about}`.toLowerCase().includes(term))
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox"
        style={{ ...input, height: 42, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' }}>
        {value ? <>
          <span style={{ fontSize: 10.5, fontWeight: W.bold, color: C.brand, background: C.brandTint, border: `1px solid ${C.brandEdge}`, borderRadius: R.sm, padding: '2px 6px' }}>{value.code}</span>
          <span style={{ flex: 1, fontWeight: W.semi }}>{value.name}</span>
        </> : <span style={{ flex: 1, color: C.faint }}>Select letter type</span>}
        <span style={{ color: C.muted, display: 'flex' }}><Icon name="chevron" /></span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 46, left: 0, right: 0, ...panel, boxShadow: E.overlay, zIndex: Z.sticky, overflow: 'hidden' }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}><SearchBox autoFocus value={q} onChange={setQ} placeholder="Search letters: appointment, increment, relieving…" /></div>
          <div role="listbox" style={{ maxHeight: 340, overflowY: 'auto', padding: 4 }}>
            {hits.length === 0 && <div style={{ padding: 12, fontSize: 13, color: C.muted }}>No letter matches “{q}”.</div>}
            {STAGE_ORDER.map(stage => {
              const list = hits.filter(h => h.stage === stage)
              if (!list.length) return null
              return (
                <div key={stage}>
                  <div style={{ padding: '8px 10px 4px', fontSize: 10.5, fontWeight: W.bold, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted }}>{stage}</div>
                  {list.map(l => (
                    <button key={l.code} type="button" role="option" aria-selected={value?.code === l.code} onClick={() => { onPick(l); setQ(''); setOpen(false) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: R.sm, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: value?.code === l.code ? C.brandTint : 'transparent' }}>
                      <span style={{ fontSize: 10.5, fontWeight: W.bold, color: C.brand, background: C.brandTint, border: `1px solid ${C.brandEdge}`, borderRadius: R.sm, padding: '2px 6px', minWidth: 32, textAlign: 'center' }}>{l.code}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: W.semi, color: C.ink }}>{l.name}</span>
                        <span style={{ display: 'block', fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.about}</span>
                      </span>
                      {!l.ess && <span style={pill(C.warning, C.warningTint)}>Not in ESS</span>}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {QUICK.map(c => LETTER_BY_CODE[c]).filter(Boolean).map(l => (
          <button key={l.code} type="button" onClick={() => onPick(l)}
            style={{ height: 28, padding: '0 10px', borderRadius: R.pill, fontSize: 12, fontWeight: W.medium, fontFamily: 'inherit', cursor: 'pointer',
              border: `1px solid ${value?.code === l.code ? C.brand : C.line}`, background: value?.code === l.code ? C.brandTint : C.surface, color: value?.code === l.code ? C.brand : C.inkSoft }}>{l.name.replace(/^Letter of /, '')}</button>
        ))}
      </div>
    </div>
  )
}

function FieldInput({ f, value, fromRecord, onChange }: { f: LetterField; value: string; fromRecord: boolean; onChange: (v: string) => void }) {
  const missing = f.required && !value.trim()
  const style: React.CSSProperties = { ...input, ...(f.type === 'textarea' ? { height: 'auto', minHeight: 84, padding: '9px 11px', lineHeight: 1.5, resize: 'vertical' } : {}),
    ...(missing ? { borderColor: C.critical } : {}) }
  return (
    <div style={{ gridColumn: f.wide || f.type === 'textarea' ? '1 / -1' : undefined }}>
      <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{f.label}{f.required && <span style={{ color: C.critical }}> *</span>}</span>
        {fromRecord && <span title="Filled from the employee record" style={{ ...pill(C.positive, C.positiveTint), padding: '0 6px', fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>Auto</span>}
      </label>
      {f.type === 'textarea' ? <textarea style={style} value={value} placeholder={f.hint} onChange={e => onChange(e.target.value)} />
        : f.type === 'select' ? <select style={style} value={value} onChange={e => onChange(e.target.value)}><option value="">Select…</option>{(f.options || []).map(o => <option key={o}>{o}</option>)}</select>
        : <input style={style} type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'money' || f.type === 'number' ? 'numeric' : undefined} value={value} placeholder={f.hint} onChange={e => onChange(e.target.value)} />}
      {missing && <div style={{ fontSize: 11.5, color: C.critical, marginTop: 4 }}>Not on record — please enter.</div>}
      {!missing && f.hint && f.type !== 'textarea' && f.type !== 'text' && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>{f.hint}</div>}
    </div>
  )
}

function Empty({ icon, title, text }: { icon: keyof typeof PATHS; title: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 16px', color: C.muted }}>
      <span style={{ width: 48, height: 48, borderRadius: R.pill, display: 'inline-grid', placeItems: 'center', background: C.sunken, color: C.faint, marginBottom: 10 }}><Icon name={icon} size={22} /></span>
      <div style={{ fontSize: 14, fontWeight: W.semi, color: C.inkSoft }}>{title}</div>
      <div style={{ fontSize: 12.5, marginTop: 3 }}>{text}</div>
    </div>
  )
}

export default function LettersStudio() {
  const [tab, setTab] = useState<Tab>('pending')
  const [pending, setPending] = useState<Pending[] | null>(null)
  const [issued, setIssued] = useState<Issued[] | null>(null)
  const [listErr, setListErr] = useState('')
  const [apptFor, setApptFor] = useState<{ onboardingId?: string | null; employeeId?: string | null; name: string } | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null)
  const [pq, setPq] = useState('')
  const [iq, setIq] = useState('')
  const [itype, setItype] = useState('')

  // Issue-a-letter state
  const [def, setDef] = useState<LetterDef | null>(null)
  const [emp, setEmp] = useState<Emp | null>(null)
  const [record, setRecord] = useState<Values>({})
  const [vals, setVals] = useState<Values>({})
  const [onboardingId, setOnboardingId] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [loadingEmp, setLoadingEmp] = useState(false)
  const [busy, setBusy] = useState<'' | 'preview' | 'send'>('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfName, setPdfName] = useState('')
  const [err, setErr] = useState('')
  const urlRef = useRef('')

  const loadLists = useCallback(async () => {
    const [p, r] = await Promise.all([api('/api/letters/studio?pending=1'), api('/api/letters/studio?recent=1')])
    const pj = await p.json().catch(() => ({})), rj = await r.json().catch(() => ({}))
    setPending(p.ok ? (pj.items || []) : []); setIssued(r.ok ? (rj.items || []) : [])
    setListErr(p.ok ? '' : (pj.error || 'Could not load the letters.'))
  }, [])
  useEffect(() => { void loadLists() }, [loadLists])
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  // The employee's details whenever the employee changes.
  useEffect(() => {
    if (!emp) { setRecord({}); setVals({}); setTo(''); setOnboardingId(null); return }
    let alive = true
    setLoadingEmp(true); setErr('')
    ;(async () => {
      const r = await api(`/api/letters/studio?employee_id=${encodeURIComponent(emp.id)}`)
      const j = await r.json().catch(() => ({}))
      if (!alive) return
      if (!r.ok) { setErr(j.error || 'Could not load the employee.'); setLoadingEmp(false); return }
      setRecord(j.values || {}); setVals(j.values || {}); setTo(j.employee?.email || ''); setOnboardingId(j.onboarding_id || null); setLoadingEmp(false)
    })()
    return () => { alive = false }
  }, [emp])
  // A new letter or employee invalidates the preview.
  useEffect(() => { setPdfUrl(''); setPdfName('') }, [def, emp])

  const missing = useMemo(() => def ? missingFields(def, vals) : [], [def, vals])
  const ready = !!def && def.code !== 'APT' && !!emp && !loadingEmp && missing.length === 0
  const autoCount = def ? def.fields.filter(f => record[f.key] && vals[f.key] === record[f.key]).length : 0

  const notify = (msg: string, tone: 'ok' | 'err' = 'ok') => { setToast({ msg, tone }); setTimeout(() => setToast(null), 6000) }

  const preview = async () => {
    if (!def || !emp) return
    setBusy('preview'); setErr('')
    try {
      const r = await api('/api/letters/studio', { method: 'POST', body: JSON.stringify({ action: 'preview', type: def.code, employee_id: emp.id, values: vals }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not draw the letter.')
      const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || `${def.code}.pdf`
      const url = URL.createObjectURL(await r.blob())
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = url; setPdfUrl(url); setPdfName(name)
    } catch (e: any) { setErr(e.message) }
    setBusy('')
  }
  const download = () => {
    if (!pdfUrl) return
    const a = document.createElement('a'); a.href = pdfUrl; a.download = pdfName || 'letter.pdf'; document.body.appendChild(a); a.click(); a.remove()
  }
  const send = async () => {
    if (!def || !emp) return
    if (!window.confirm(`Send the ${def.name} to ${emp.full_name} at ${to || 'their registered email'}?${def.ess ? ' It will also appear in their ESS.' : ''}`)) return
    setBusy('send'); setErr('')
    try {
      const r = await api('/api/letters/studio', { method: 'POST', body: JSON.stringify({ action: 'send', type: def.code, employee_id: emp.id, values: vals, to }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Could not send the letter.')
      notify(j.emailed ? `${def.name} (${j.doc_id}) sent to ${j.sent_to}${j.ess ? ' and saved in their ESS' : ''}.` : `${def.name} (${j.doc_id}) saved${j.ess ? ' to their ESS' : ''}, but the email did not go: ${j.mail_error}.`, j.emailed ? 'ok' : 'err')
      void loadLists()
    } catch (e: any) { setErr(e.message) }
    setBusy('')
  }
  const openIssued = async (row: Issued) => {
    if (!row.employee_id) return
    const w = window.open('', '_blank')
    const r = await api(`/api/letters/employee?employee_id=${encodeURIComponent(row.employee_id)}&file=${encodeURIComponent(row.id)}`)
    const j = await r.json().catch(() => ({}))
    if (r.ok && j.url) { if (w) w.location.href = j.url; else window.open(j.url, '_blank') }
    else { w?.close(); notify(j.error || 'Could not open the letter.', 'err') }
  }

  const month = new Date().toISOString().slice(0, 7)
  const thisMonth = (issued || []).filter(r => String(r.generated_at || '').slice(0, 7) === month)
  const pendingRows = (pending || []).filter(p => !pq.trim() || `${p.full_name} ${p.employee_code} ${p.designation} ${p.email}`.toLowerCase().includes(pq.trim().toLowerCase()))
  const issuedRows = (issued || []).filter(r => (!itype || r.letter_type === itype)
    && (!iq.trim() || `${r.doc_id} ${r.letter_name} ${r.employees?.full_name} ${r.employees?.emp_code} ${r.sent_to}`.toLowerCase().includes(iq.trim().toLowerCase())))

  const TABS: [Tab, string, number | null][] = [['pending', 'Pending appointment letters', pending?.length ?? null], ['issue', 'Issue a letter', null], ['issued', 'Issued letters', issued?.length ?? null]]

  return (
    <div style={{ background: C.canvas, minHeight: '100vh', fontFamily: FONT, color: C.ink, fontSize: 13 }}>
      <div style={{ maxWidth: 1380, margin: '0 auto', padding: '20px 20px 64px', boxSizing: 'border-box' }}>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>People <span style={{ color: C.faint }}>/</span> <span style={{ color: C.inkSoft }}>Letters</span></div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: W.bold, letterSpacing: '-.01em', color: C.ink }}>HR Letters</h1>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>Generate, preview and issue {LETTERS.length} letter types on company letterhead. Issued letters are emailed to the employee and saved to their ESS.</div>
          </div>
          <button style={btn('primary')} onClick={() => setTab('issue')}><Icon name="file" />Issue a letter</button>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, calc(50% - 6px)), 1fr))', gap: 12, marginBottom: 16 }}>
          <Kpi icon="clock" tone={C.warning} value={pending === null ? '…' : String(pending.length)} text="Appointment letters pending" />
          <Kpi icon="file" tone={C.brand} value={issued === null ? '…' : String(thisMonth.length)} text="Letters issued this month" />
          <Kpi icon="mail" tone={C.positive} value={issued === null ? '…' : String(thisMonth.filter(r => r.emailed_at).length)} text="Emailed this month" />
          <Kpi icon="user" tone={C.info} value={issued === null ? '…' : String(thisMonth.filter(r => r.published_to_ess_at).length)} text="Released to ESS this month" />
        </div>

        {/* Tabs */}
        <div role="tablist" style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${C.line}`, marginBottom: 16, overflowX: 'auto' }}>
          {TABS.map(([k, l, n]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              style={{ height: 40, padding: '0 14px', border: 'none', borderBottom: `2px solid ${tab === k ? C.brand : 'transparent'}`, marginBottom: -1, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13.5, fontWeight: tab === k ? W.semi : W.medium, color: tab === k ? C.brand : C.muted, display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              {l}{n !== null && <span style={{ ...pill(tab === k ? C.brand : C.muted, tab === k ? C.brandTint : C.sunken), padding: '1px 8px' }}>{n}</span>}
            </button>
          ))}
        </div>

        {toast && <div role="status" style={{ marginBottom: 14, padding: '10px 14px', borderRadius: R.md, fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', background: toast.tone === 'ok' ? C.positiveTint : C.criticalTint, border: `1px solid ${toast.tone === 'ok' ? C.positiveEdge : C.criticalEdge}`, color: C.ink }}>
          <Icon name={toast.tone === 'ok' ? 'check' : 'alert'} color={toast.tone === 'ok' ? C.positive : C.critical} />{toast.msg}</div>}
        {listErr && <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: R.md, fontSize: 13, background: C.criticalTint, border: `1px solid ${C.criticalEdge}` }}>{listErr}</div>}

        {tab === 'pending' && (
          <div style={panel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px' }}>
                <div style={{ fontSize: 14, fontWeight: W.semi }}>Joiners awaiting their appointment letter</div>
                <div style={{ fontSize: 12, color: C.muted }}>Employee code generated, letter not yet sent. The letter opens pre-filled from the record, MRF and offer.</div>
              </div>
              <div style={{ width: 280, maxWidth: '100%' }}><SearchBox value={pq} onChange={setPq} placeholder="Filter by name or code" /></div>
            </div>
            {pending === null ? <div style={{ padding: 20, color: C.faint }}>Loading…</div>
              : pending.length === 0 ? <Empty icon="check" title="All caught up" text="Every joiner with an employee code has received their appointment letter." />
              : pendingRows.length === 0 ? <Empty icon="search" title="No match" text={`Nobody pending matches “${pq}”.`} />
              : <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Employee', 'Code', 'Designation', 'Date of joining', 'Email', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{pendingRows.map(p => (
                    <tr key={p.id}>
                      <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar name={p.full_name} size={30} /><span style={{ fontWeight: W.semi }}>{p.full_name}</span></div></td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{p.employee_code || '—'}</td>
                      <td style={{ ...td, color: C.inkSoft }}>{p.designation || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{day(p.date_of_joining)}</td>
                      <td style={{ ...td, color: p.email ? C.inkSoft : C.critical }}>{p.email || 'No email'}</td>
                      <td style={{ ...td, textAlign: 'right' }}><button style={btn('primary', true)} onClick={() => setApptFor({ onboardingId: p.id, name: p.full_name })}><Icon name="send" size={14} />Send letter</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>}
          </div>
        )}

        {tab === 'issue' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(480px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
              <Section step={1} title="Employee" hint="Search by employee code or name" done={!!emp}>
                <EmployeeSearch value={emp} onPick={setEmp} onClear={() => setEmp(null)} />
              </Section>
              <Section step={2} title="Letter type" hint={def ? def.about : 'Choose from the letter catalogue'} done={!!def}
                right={def && <span style={def.ess ? pill(C.positive, C.positiveTint) : pill(C.warning, C.warningTint)}>{def.ess ? 'Visible in ESS' : 'Not shown in ESS'}</span>}>
                <LetterPicker value={def} onPick={setDef} />
              </Section>
              <Section step={3} title="Letter details" done={ready}
                hint={def && emp && !loadingEmp ? `${autoCount} of ${def.fields.length} fields filled from the record` : 'Auto-filled from the employee record'}
                right={def && emp && !loadingEmp && def.code !== 'APT' && (missing.length ? <span style={pill(C.critical, C.criticalTint)}>{missing.length} required</span> : <span style={pill(C.positive, C.positiveTint)}><Icon name="check" size={12} />Complete</span>)}>
                {!def || !emp ? <div style={{ fontSize: 13, color: C.faint }}>Select an employee and a letter type — details on record fill in automatically.</div>
                  : def.code === 'APT' ? (
                    <div style={{ padding: '14px 16px', borderRadius: R.md, background: C.brandTint, border: `1px solid ${C.brandEdge}`, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      <span style={{ color: C.brand, display: 'flex' }}><Icon name="file" size={22} /></span>
                      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: W.semi, color: C.ink }}>Full appointment letter (employment contract)</div>
                        <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 2 }}>All 20 sections, signatures and Annexures A (salary, as negotiated), B (leave) and C (code of conduct), filled from {emp.full_name}’s record. Review, preview and send from the letter window.</div>
                      </div>
                      <button style={btn('primary')} onClick={() => setApptFor(onboardingId ? { onboardingId, name: emp.full_name } : { employeeId: emp.id, name: emp.full_name })}><Icon name="file" />Open appointment letter</button>
                    </div>
                  )
                  : loadingEmp ? <div style={{ fontSize: 13, color: C.faint }}>Loading {emp.full_name}’s record…</div>
                  : <>
                    {missing.length > 0 && <div style={{ marginBottom: 14, padding: '9px 12px', borderRadius: R.md, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, fontSize: 12.5, display: 'flex', gap: 8 }}>
                      <Icon name="alert" color={C.critical} /><span><b>Not on record:</b> {missing.join(', ')}. Please fill in.</span></div>}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))', gap: 14 }}>
                      {def.fields.map(f => <FieldInput key={f.key} f={f} value={vals[f.key] || ''} fromRecord={!!record[f.key] && vals[f.key] === record[f.key]} onChange={v => setVals(s => ({ ...s, [f.key]: v }))} />)}
                    </div>
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
                      <label style={label}>Send to <span style={{ color: C.critical }}>*</span></label>
                      <input style={{ ...input, ...(to.trim() ? {} : { borderColor: C.critical }) }} value={to} onChange={e => setTo(e.target.value)} placeholder="employee@company.com" />
                      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>Registered email from the employee record.</div>
                    </div>
                  </>}
              </Section>
              {err && <div style={{ padding: '10px 12px', borderRadius: R.md, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, fontSize: 13, display: 'flex', gap: 8 }}><Icon name="alert" color={C.critical} />{err}</div>}
              <div style={{ ...panel, padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', position: 'sticky', bottom: 12, zIndex: Z.raised, boxShadow: E.floating }}>
                <span style={{ flex: '1 1 160px', fontSize: 12.5, color: C.muted }}>{!emp ? 'Select an employee' : !def ? 'Select a letter type' : def.code === 'APT' ? 'Use “Open appointment letter” above' : missing.length ? `${missing.length} required field${missing.length > 1 ? 's' : ''} left` : pdfUrl ? 'Preview ready' : 'Ready — preview before sending'}</span>
                <button style={{ ...btn('secondary'), opacity: ready && !busy ? 1 : .5 }} disabled={!ready || !!busy} onClick={preview}><Icon name="eye" />{busy === 'preview' ? 'Generating…' : 'Preview'}</button>
                <button style={{ ...btn('secondary'), opacity: pdfUrl && !busy ? 1 : .5 }} disabled={!pdfUrl || !!busy} onClick={download}><Icon name="download" />Download</button>
                <button style={{ ...btn('primary'), opacity: ready && to.trim() && !busy ? 1 : .5 }} disabled={!ready || !to.trim() || !!busy} onClick={send}><Icon name="send" size={15} />{busy === 'send' ? 'Sending…' : 'Send letter'}</button>
              </div>
            </div>

            <div style={{ ...panel, position: 'sticky', top: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 14, fontWeight: W.semi, flex: 1 }}>Preview</span>
                {pdfName && <span style={{ fontSize: 12, color: C.muted, fontFamily: 'ui-monospace, monospace' }}>{pdfName.replace(/\.pdf$/, '')}</span>}
              </div>
              {pdfUrl ? <iframe title="Letter preview" src={pdfUrl} style={{ width: '100%', height: 'min(78vh, 900px)', border: 'none', background: C.sunken }} />
                : <div style={{ height: 'min(78vh, 900px)', display: 'grid', placeItems: 'center', background: C.sunken }}>
                  <Empty icon="file" title="No preview yet" text="Complete the details and click Preview to see the letter on letterhead." />
                </div>}
            </div>
          </div>
        )}

        {tab === 'issued' && (
          <div style={panel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px', fontSize: 14, fontWeight: W.semi }}>Issued letters <span style={{ fontSize: 12, color: C.muted, fontWeight: W.regular }}>· latest {issued?.length ?? 0}</span></div>
              <select style={{ ...input, height: 36, width: 220, maxWidth: '100%' }} value={itype} onChange={e => setItype(e.target.value)} aria-label="Letter type">
                <option value="">All letter types</option>
                {LETTERS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
              <div style={{ width: 280, maxWidth: '100%' }}><SearchBox value={iq} onChange={setIq} placeholder="Search employee, code or document ID" /></div>
            </div>
            {issued === null ? <div style={{ padding: 20, color: C.faint }}>Loading…</div>
              : issuedRows.length === 0 ? <Empty icon="file" title={issued.length ? 'No match' : 'No letters issued yet'} text={issued.length ? 'Try a different search or letter type.' : 'Letters you issue appear here.'} />
              : <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Document ID', 'Letter', 'Employee', 'Issued on', 'Email', 'ESS', 'Issued by', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{issuedRows.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, whiteSpace: 'nowrap', color: C.inkSoft }}>{r.doc_id || '—'}</td>
                      <td style={{ ...td, fontWeight: W.semi }}>{r.letter_name || (r.letter_type ? LETTER_BY_CODE[r.letter_type]?.name : 'Letter')}</td>
                      <td style={td}>{r.employees ? <>{r.employees.full_name} <span style={{ color: C.muted }}>· {r.employees.emp_code || ''}</span></> : '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{day(r.letter_date || r.generated_at)}</td>
                      <td style={td}>{r.emailed_at ? <span title={r.sent_to || ''} style={pill(C.positive, C.positiveTint)}><Icon name="check" size={12} />Sent</span> : <span style={pill(C.critical, C.criticalTint)}>Not sent</span>}</td>
                      <td style={td}>{r.published_to_ess_at ? <span style={pill(C.positive, C.positiveTint)}>Visible</span> : <span style={pill(C.muted, C.sunken)}>Hidden</span>}</td>
                      <td style={{ ...td, color: C.muted }}>{r.generated_by_name || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.employee_id && <button style={btn('ghost', true)} onClick={() => void openIssued(r)}><Icon name="eye" size={14} />View</button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>}
          </div>
        )}
      </div>

      {apptFor && <AppointmentLetterModal onboardingId={apptFor.onboardingId} employeeId={apptFor.employeeId} name={apptFor.name} onClose={() => setApptFor(null)}
        onDone={(m, t) => { notify(m, t === 'err' ? 'err' : 'ok'); setApptFor(null); void loadLists() }} />}
    </div>
  )
}
