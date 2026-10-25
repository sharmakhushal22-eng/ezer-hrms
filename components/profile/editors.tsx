'use client'
// components/profile/editors.tsx — the editors behind "Fix" and "Edit profile".
//
// Before this, every Fix and every request opened the same one-text-box modal
// for Spouse name. Each thing now gets the control it needs:
//
//   FieldEditor      one value — the right input per field (date, list, phone,
//                    email, yes/no), the current value shown, and for a
//                    request, WHO it goes to before you press Send
//   IdentityEditor   Aadhaar / PAN / UAN, validated, with the card attached
//   AddressEditor    line 1, line 2, city, state, PIN; "same as present"
//   EmergencyEditor  name, relation, mobile
//   NomineeEditor    several nominees, shares that must total exactly 100%
//   BankEditor       salary account, as one request to Payroll
//   DocumentsPanel   what is asked for, what is on file, upload per document
//
// The rules (what saves, what goes for approval) are in
// lib/profile/self-service.ts and are enforced again by the API routes.
//
// Every component here is top level. Defined inside a parent they would be a
// new type on every render, remount on each keystroke and drop focus.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  editorFor, checkFieldValue, checkAadhaar, checkPan, checkUan, checkAddress, emptyAddress,
  checkEmergency, EMERGENCY_RELATIONS, NOMINEE_RELATIONS, INDIAN_STATES, checkNominees, nomineeTotal,
  isMinor, checkBank, checkAccount, checkIfsc, goesTo, SCHEME_LABEL, DOC_TYPES_OK, DOC_MAX_BYTES,
  type Address, type NomineeRow, type Approvers, type Scheme,
} from '@/lib/profile/self-service'
import {
  editField, requestChange, selfService, loadDocuments, type DocOnFile, type DocRequired,
} from '@/lib/profile/client'
import type { ProfileField, Row, SelfInfo } from '@/lib/profile/types'

export type Done = (message: string) => void

// ── shells ───────────────────────────────────────────────────────────────

export function Modal({ title, sub, onClose, children, footer, wide }: {
  title: string; sub?: React.ReactNode; onClose: () => void
  children: React.ReactNode; footer: React.ReactNode; wide?: boolean
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={title}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="mhd">
          <div>
            <h3>{title}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="mbd">{children}</div>
        <div className="mft">{footer}</div>
      </div>
    </div>
  )
}

export function Drawer({ title, sub, onClose, children }: {
  title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="dscrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dhd">
          <div>
            <h3>{title}</h3>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="dbd">{children}</div>
      </aside>
    </div>
  )
}

/** Where a request goes, said before it is sent. */
export function GoesTo({ fieldKey, approvers }: { fieldKey: string; approvers?: Approvers | null }) {
  const g = goesTo(fieldKey, approvers)
  return (
    <div className="goes">
      <div className="gk">Goes to</div>
      <ol>{g.stages.map((s, i) => <li key={i}><span className="gn">{i + 1}</span>{s}</li>)}</ol>
      <div className="gh">Nothing changes until it is approved. You can follow it, or withdraw it, in Change history.</div>
    </div>
  )
}

function Err({ text }: { text: string | null }) {
  return text ? <div className="note bad" role="alert" style={{ marginTop: 12 }}>{text}</div> : null
}

function Lbl({ htmlFor, children, opt }: { htmlFor: string; children: React.ReactNode; opt?: boolean }) {
  return <label htmlFor={htmlFor}>{children}{opt && <span className="opt"> · optional</span>}</label>
}

function Actions({ busy, disabled, onClose, onSave, label }: {
  busy: boolean; disabled?: boolean; onClose: () => void; onSave: () => void; label: string
}) {
  return (
    <>
      <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={busy || disabled} onClick={onSave}>
        {busy ? 'Saving…' : label}
      </button>
    </>
  )
}

/** A file picker that says what was picked. Checks type and size here, so
 *  the person hears about a 12 MB scan before waiting on the upload. */
export function FileField({ id, file, onChange, label = 'Attach a copy' }: {
  id: string; file: File | null; onChange: (f: File | null, err: string | null) => void; label?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="filef">
      <input ref={ref} id={id} type="file" hidden accept=".pdf,image/jpeg,image/png,image/webp"
             onChange={e => {
               const f = e.target.files?.[0] ?? null
               e.target.value = ''
               if (!f) return
               if (f.size > DOC_MAX_BYTES) return onChange(null, 'That file is over 5 MB.')
               if (f.type && !DOC_TYPES_OK.includes(f.type)) return onChange(null, 'Use a PDF, JPG, PNG or WebP.')
               onChange(f, null)
             }} />
      <button type="button" className="btn ghost sm" onClick={() => ref.current?.click()}>
        {file ? 'Choose another' : label}
      </button>
      <span className="fname">{file ? file.name : 'PDF, JPG or PNG, up to 5 MB'}</span>
      {file && <button type="button" className="lnk" onClick={() => onChange(null, null)}>Remove</button>}
    </div>
  )
}

// ── the one-value editor ─────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)

export function FieldEditor({ field, current, approvers, onClose, onDone }: {
  field: ProfileField; current: unknown; approvers?: Approvers | null; onClose: () => void; onDone: Done
}) {
  const spec = editorFor(field.key)
  const direct = field.state === 'direct'
  const initial = current === null || current === undefined ? ''
    : typeof current === 'boolean' ? String(current) : String(current)
  // A direct field starts from what is there — you are editing it. A request
  // starts empty, so "what it becomes" is never mistaken for "what it was".
  const [value, setValue] = useState(direct ? initial : '')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const check = value.trim() ? checkFieldValue(field.key, value).error : 'Enter a value.'
  const unchanged = direct && value.trim() === initial.trim()

  const save = async () => {
    setTouched(true)
    if (check || (!direct && !reason.trim())) return
    setBusy(true); setErr(null)
    const r = direct ? await editField(field.key, value) : await requestChange(field.key, value, reason)
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    const w = (r.data as { waiting_on?: string | null } | null)?.waiting_on
    onDone(direct ? `${field.label} saved.` : `Request sent${w ? ` — waiting on ${w}` : ''}.`)
  }

  const id = `fe-${field.key}`
  let input: React.ReactNode
  if (spec.kind === 'select') {
    input = (
      <select id={id} value={value} onChange={e => setValue(e.target.value)} autoFocus>
        <option value="">Choose…</option>
        {spec.options!.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  } else if (spec.kind === 'bool') {
    input = (
      <div className="seg" role="radiogroup" aria-labelledby={`${id}-l`}>
        {[['true', 'Yes'], ['false', 'No']].map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v}
                  className={value === v ? 'on' : ''} onClick={() => setValue(v)}>{l}</button>
        ))}
      </div>
    )
  } else if (spec.kind === 'textarea') {
    input = <textarea id={id} value={value} onChange={e => setValue(e.target.value)} maxLength={spec.maxLength} autoFocus />
  } else {
    input = (
      <input id={id} autoFocus value={value} onChange={e => setValue(e.target.value)}
             onBlur={() => setTouched(true)}
             type={spec.kind === 'date' ? 'date' : spec.kind === 'email' ? 'email' : spec.kind === 'number' ? 'number' : spec.kind === 'tel' ? 'tel' : 'text'}
             inputMode={spec.kind === 'tel' ? 'numeric' : spec.kind === 'number' ? 'decimal' : undefined}
             max={spec.kind === 'date' ? today() : undefined} min={spec.kind === 'number' ? 0 : undefined}
             maxLength={spec.maxLength} placeholder={spec.placeholder}
             onKeyDown={e => { if (e.key === 'Enter') save() }} />
    )
  }

  const shown = initial === 'true' ? 'Yes' : initial === 'false' ? 'No' : initial

  return (
    <Modal title={direct ? `Edit ${field.label.toLowerCase()}` : `Request a change to ${field.label.toLowerCase()}`}
           sub={direct ? 'Saves straight away.' : 'Goes for approval. Nothing changes until it is approved.'}
           onClose={onClose}
           footer={<Actions busy={busy} onClose={onClose} onSave={save}
                            disabled={unchanged} label={direct ? 'Save' : 'Send request'} />}>
      <div className="cur"><span className="ck">Current</span><span className="cv">{shown || 'Not set'}</span></div>
      <Lbl htmlFor={id}><span id={`${id}-l`}>{direct ? field.label : 'New value'}</span></Lbl>
      {input}
      {touched && check && <div className="ferr">{check}</div>}
      {field.hint && <div className="fhint">{field.hint}</div>}
      {!direct && (
        <>
          <Lbl htmlFor={`${id}-r`}>Reason</Lbl>
          <textarea id={`${id}-r`} value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Why is this changing? The approver reads this." />
          {touched && !reason.trim() && <div className="ferr">A reason is required.</div>}
          <GoesTo fieldKey={field.key} approvers={approvers} />
        </>
      )}
      <Err text={err} />
    </Modal>
  )
}

// ── Aadhaar / PAN / UAN ──────────────────────────────────────────────────

const ID_META = {
  aadhaar: { title: 'Add your Aadhaar', label: 'Aadhaar number', ph: '1234 5678 9012', check: checkAadhaar,
             note: 'Only the last four digits are kept on your record. The full number never is.' },
  pan:     { title: 'Add your PAN', label: 'PAN', ph: 'ABCDE1234F', check: checkPan,
             note: 'Used for TDS on your salary. Without it, tax is deducted at a higher rate.' },
  uan:     { title: 'Add your UAN', label: 'Universal Account Number (UAN)', ph: '100123456789', check: checkUan,
             note: 'From your previous employer’s payslip or the EPFO portal. New to PF? Leave it — payroll generates one.' },
} as const

export function IdentityEditor({ which, onFile, masked, onClose, onDone }: {
  which: 'aadhaar' | 'pan' | 'uan'; onFile: boolean; masked?: string | null; onClose: () => void; onDone: Done
}) {
  const m = ID_META[which]
  const [num, setNum] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const check = m.check(num)

  if (onFile) {
    return (
      <Modal title={m.label} onClose={onClose}
             footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
        <div className="cur"><span className="ck">On file</span><span className="cv mono">{masked || 'Recorded'}</span></div>
        <p className="para">HR maintains this once it is on file, because payroll and statutory returns already use it.
          If it is wrong, contact HR to correct it.</p>
      </Modal>
    )
  }

  const save = async () => {
    setTouched(true)
    if (check) return
    setBusy(true); setErr(null)
    const r = await selfService({ action: 'identity', kind: which, number: num }, file)
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    onDone(r.data?.message ?? 'Saved.')
  }

  return (
    <Modal title={m.title} sub="Saves straight away. HR verifies the card if you attach one." onClose={onClose}
           footer={<Actions busy={busy} onClose={onClose} onSave={save} label="Save" />}>
      <Lbl htmlFor="id-num">{m.label}</Lbl>
      <input id="id-num" className="mono" autoFocus value={num} placeholder={m.ph}
             inputMode={which === 'pan' ? 'text' : 'numeric'} autoComplete="off"
             maxLength={which === 'pan' ? 10 : 14}
             onChange={e => setNum(which === 'pan' ? e.target.value.toUpperCase() : e.target.value.replace(/[^\d ]/g, ''))}
             onBlur={() => setTouched(true)} />
      {touched && check ? <div className="ferr">{check}</div> : <div className="fhint muted">{m.note}</div>}
      <Lbl htmlFor="id-file" opt>Copy of the card</Lbl>
      <FileField id="id-file" file={file} onChange={(f, e) => { setFile(f); setErr(e) }} />
      <Err text={err} />
    </Modal>
  )
}

// ── address ──────────────────────────────────────────────────────────────

export function AddressEditor({ which, self, onFile, onClose, onDone }: {
  which: 'present' | 'permanent'; self?: SelfInfo | null
  /** Whether an address is on file at all — the server decides the same way
   *  (line 1 present -> request, blank -> save). */
  onFile: boolean; onClose: () => void; onDone: Done
}) {
  const current = self?.addresses?.[which] ?? null
  const present = self?.addresses?.present ?? null
  const asRequest = onFile || !!current
  const [a, setA] = useState<Address>(current ? { ...current } : emptyAddress())
  const [same, setSame] = useState(false)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const value = same && present ? present : a
  const check = checkAddress(value)
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setA(x => ({ ...x, [k]: k === 'pin' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value }))
  const label = which === 'present' ? 'present address' : 'permanent address'

  const save = async () => {
    setTouched(true)
    if (check || (asRequest && !reason.trim())) return
    setBusy(true); setErr(null)
    const r = await selfService({ action: 'address', which, address: value, reason })
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    onDone(r.data?.message ?? 'Saved.')
  }

  return (
    <Modal title={asRequest ? `Change your ${label}` : `Add your ${label}`}
           sub={asRequest ? 'An address on file decides your Professional Tax state and HRA exemption, so a change goes to HR.'
                          : 'Saves straight away.'}
           onClose={onClose} wide
           footer={<Actions busy={busy} onClose={onClose} onSave={save} label={asRequest ? 'Send request' : 'Save address'} />}>
      {which === 'permanent' && present && (
        <label className="chk">
          <input type="checkbox" checked={same} onChange={e => setSame(e.target.checked)} />
          Same as my present address
        </label>
      )}
      <fieldset disabled={same} className="fs">
        <Lbl htmlFor="ad-1">Address line 1</Lbl>
        <input id="ad-1" value={value.line1} onChange={set('line1')} placeholder="House / flat no., building, street" autoFocus maxLength={120} />
        <Lbl htmlFor="ad-2" opt>Address line 2</Lbl>
        <input id="ad-2" value={value.line2} onChange={set('line2')} placeholder="Area, locality, landmark" maxLength={120} />
        <div className="g3f">
          <div>
            <Lbl htmlFor="ad-c">City</Lbl>
            <input id="ad-c" value={value.city} onChange={set('city')} maxLength={60} />
          </div>
          <div>
            <Lbl htmlFor="ad-s">State</Lbl>
            <select id="ad-s" value={value.state} onChange={set('state')}>
              <option value="">Choose…</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Lbl htmlFor="ad-p">PIN code</Lbl>
            <input id="ad-p" className="mono" value={value.pin} onChange={set('pin')} inputMode="numeric" placeholder="560038" />
          </div>
        </div>
      </fieldset>
      {touched && check && <div className="ferr">{check}</div>}
      {asRequest && (
        <>
          <Lbl htmlFor="ad-r">Reason</Lbl>
          <textarea id="ad-r" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Moved to a new flat from 1 November" />
          {touched && !reason.trim() && <div className="ferr">A reason is required.</div>}
          <GoesTo fieldKey={`${which}_address`} approvers={self?.approvers} />
        </>
      )}
      <Err text={err} />
    </Modal>
  )
}

// ── emergency contact ────────────────────────────────────────────────────

export function EmergencyEditor({ slot, self, onClose, onDone }: {
  slot: 1 | 2; self?: SelfInfo | null; onClose: () => void; onDone: Done
}) {
  const cur = self?.emergency?.[slot] ?? null
  const [e, setE] = useState({ name: cur?.name ?? '', relation: cur?.relation ?? '', mobile: cur?.mobile ?? '' })
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const check = checkEmergency(e)

  const save = async () => {
    setTouched(true)
    if (check) return
    setBusy(true); setErr(null)
    const r = await selfService({ action: 'emergency', slot, ...e })
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    onDone(r.data?.message ?? 'Saved.')
  }

  return (
    <Modal title={`${cur ? 'Edit' : 'Add'} emergency contact${slot === 2 ? ' 2' : ''}`}
           sub="Saves straight away. Printed on your ID card and used only in an emergency." onClose={onClose}
           footer={<Actions busy={busy} onClose={onClose} onSave={save} label="Save" />}>
      <Lbl htmlFor="em-n">Name</Lbl>
      <input id="em-n" autoFocus value={e.name} maxLength={80} onChange={x => setE({ ...e, name: x.target.value })} />
      <div className="g2f">
        <div>
          <Lbl htmlFor="em-r">Relation</Lbl>
          <select id="em-r" value={e.relation} onChange={x => setE({ ...e, relation: x.target.value })}>
            <option value="">Choose…</option>
            {EMERGENCY_RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <Lbl htmlFor="em-m">Mobile</Lbl>
          <input id="em-m" type="tel" inputMode="numeric" value={e.mobile} placeholder="10-digit mobile"
                 onChange={x => setE({ ...e, mobile: x.target.value })} />
        </div>
      </div>
      {touched && check && <div className="ferr">{check}</div>}
      <Err text={err} />
    </Modal>
  )
}

// ── nominees ─────────────────────────────────────────────────────────────

const blankRow = (): NomineeRow => ({ name: '', relation: '', dob: '', share: '' })

export function NomineeEditor({ scheme, nominations, family, onClose, onDone }: {
  scheme: Scheme; nominations: Row[]; family: Row[]; onClose: () => void; onDone: Done
}) {
  const famById = useMemo(() => new Map(family.map(f => [String(f.id), f])), [family])
  const [rows, setRows] = useState<NomineeRow[]>(() => {
    const mine = nominations.filter(n => String(n.scheme) === scheme)
    if (!mine.length) return [blankRow()]
    return mine.map(n => ({
      name: String(n.nominee_name ?? ''), relation: String(n.relation ?? ''),
      dob: String(famById.get(String(n.member_id))?.date_of_birth ?? '').slice(0, 10),
      share: String(Number(n.share_percent) || ''),
    }))
  })
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const total = nomineeTotal(rows)
  const check = checkNominees(rows)
  const upd = (i: number, k: keyof NomineeRow, v: string) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const picked = new Set(rows.map(r => r.name.trim().toLowerCase()))
  const suggestions = family.filter(f => !picked.has(String(f.member_name ?? '').trim().toLowerCase()))

  const addFrom = (f: Row) => setRows(rs => {
    const r = { name: String(f.member_name ?? ''), relation: NOMINEE_RELATIONS.includes(String(f.relation)) ? String(f.relation) : 'Other',
                dob: String(f.date_of_birth ?? '').slice(0, 10), share: '' }
    // Replace a blank first row rather than leaving it dangling above.
    return rs.length === 1 && !rs[0].name ? [r] : [...rs, r]
  })
  const split = () => setRows(rs => {
    const n = rs.length, base = Math.floor(10000 / n) / 100
    return rs.map((r, i) => ({ ...r, share: String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base) }))
  })

  const save = async () => {
    setTouched(true)
    if (check) return
    setBusy(true); setErr(null)
    const r = await selfService({ action: 'nominees', scheme, rows })
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    onDone(r.data?.message ?? 'Saved.')
  }

  const left = Math.round((100 - total) * 100) / 100
  return (
    <Modal title={`${SCHEME_LABEL[scheme]} nominees`} wide onClose={onClose}
           sub="Saves straight away. HR files the statutory form from it. Shares must total exactly 100%."
           footer={<Actions busy={busy} onClose={onClose} onSave={save} label="Save nominees" disabled={total !== 100} />}>
      {suggestions.length > 0 && (
        <div className="picks">
          <span className="pk">From your family</span>
          {suggestions.map(f => (
            <button type="button" key={String(f.id)} className="chipbtn" onClick={() => addFrom(f)}>
              + {String(f.member_name)} <span>· {String(f.relation)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="nomrows">
        {rows.map((r, i) => (
          <div className="nomrow" key={i}>
            <div className="nr-name">
              <Lbl htmlFor={`nm-n-${i}`}>Name</Lbl>
              <input id={`nm-n-${i}`} value={r.name} maxLength={80} onChange={e => upd(i, 'name', e.target.value)} autoFocus={i === 0 && !r.name} />
            </div>
            <div>
              <Lbl htmlFor={`nm-r-${i}`}>Relation</Lbl>
              <select id={`nm-r-${i}`} value={r.relation} onChange={e => upd(i, 'relation', e.target.value)}>
                <option value="">Choose…</option>
                {NOMINEE_RELATIONS.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div>
              <Lbl htmlFor={`nm-d-${i}`} opt>Date of birth</Lbl>
              <input id={`nm-d-${i}`} type="date" max={today()} value={r.dob} onChange={e => upd(i, 'dob', e.target.value)} />
            </div>
            <div className="nr-share">
              <Lbl htmlFor={`nm-s-${i}`}>Share %</Lbl>
              <input id={`nm-s-${i}`} type="number" min={1} max={100} step="0.01" inputMode="decimal"
                     value={r.share} onChange={e => upd(i, 'share', e.target.value)} />
            </div>
            <button type="button" className="rm" aria-label={`Remove nominee ${i + 1}`} disabled={rows.length === 1}
                    onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>×</button>
            {isMinor(r.dob) && <div className="nr-note">Under 18 — HR will ask for a guardian when filing the form.</div>}
          </div>
        ))}
      </div>
      <div className="nomfoot">
        <button type="button" className="btn ghost sm" onClick={() => setRows(rs => [...rs, blankRow()])}>Add a nominee</button>
        {rows.length > 1 && <button type="button" className="lnk" onClick={split}>Split equally</button>}
        <span className="grow" />
        <span className={`tot ${total === 100 ? 'ok' : 'off'}`}>
          Total {total}%{total !== 100 && (left > 0 ? ` · ${left}% left to assign` : ` · ${-left}% over`)}
        </span>
      </div>
      <div className="meter"><i className={total === 100 ? 'ok' : total > 100 ? 'over' : ''} style={{ width: `${Math.min(100, total)}%` }} /></div>
      {touched && check && <div className="ferr">{check}</div>}
      <Err text={err} />
    </Modal>
  )
}

// ── salary account ───────────────────────────────────────────────────────

export function BankEditor({ self, current, onClose, onDone }: {
  self?: SelfInfo | null; current: { bank_name?: unknown; ifsc?: unknown }; onClose: () => void; onDone: Done
}) {
  const [b, setB] = useState({ bank_name: '', account: '', confirm: '', ifsc: '', holder: '' })
  const [reason, setReason] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const mismatch = b.confirm && b.confirm.replace(/\s/g, '') !== b.account.replace(/\s/g, '')
  const check = checkBank(b) ?? (!b.confirm ? 'Type the account number again to confirm it.' : mismatch ? 'The two account numbers do not match.' : null)
  const onFile = self?.ids?.has_bank

  const save = async () => {
    setTouched(true)
    if (check) return
    setBusy(true); setErr(null)
    const r = await selfService({ action: 'bank', bank_name: b.bank_name, account: b.account, ifsc: b.ifsc, holder: b.holder, reason }, file)
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    onDone(r.data?.message ?? 'Sent to Payroll.')
  }

  return (
    <Modal title={onFile ? 'Change your salary account' : 'Add your salary account'} wide onClose={onClose}
           sub="Your salary is paid into this account, so Payroll checks every change before it applies — including the first."
           footer={<Actions busy={busy} onClose={onClose} onSave={save} label="Send to Payroll" />}>
      {onFile && (
        <div className="cur"><span className="ck">On file</span>
          <span className="cv">{String(current.bank_name ?? '—')} · {self?.ids?.bank_masked ?? '—'} · {String(current.ifsc ?? '—')}</span></div>
      )}
      <div className="g2f">
        <div>
          <Lbl htmlFor="bk-n">Bank name</Lbl>
          <input id="bk-n" autoFocus value={b.bank_name} maxLength={80} onChange={e => setB({ ...b, bank_name: e.target.value })} placeholder="e.g. HDFC Bank" />
        </div>
        <div>
          <Lbl htmlFor="bk-h">Account holder name</Lbl>
          <input id="bk-h" value={b.holder} maxLength={80} onChange={e => setB({ ...b, holder: e.target.value })} placeholder="As printed on the passbook" />
        </div>
        <div>
          <Lbl htmlFor="bk-a">Account number</Lbl>
          <input id="bk-a" className="mono" value={b.account} inputMode="numeric" autoComplete="off"
                 onChange={e => setB({ ...b, account: e.target.value.replace(/[^\d]/g, '').slice(0, 18) })} />
          {touched && b.account && checkAccount(b.account) && <div className="ferr">{checkAccount(b.account)}</div>}
        </div>
        <div>
          <Lbl htmlFor="bk-c">Confirm account number</Lbl>
          <input id="bk-c" className="mono" value={b.confirm} inputMode="numeric" autoComplete="off"
                 onPaste={e => e.preventDefault()}
                 onChange={e => setB({ ...b, confirm: e.target.value.replace(/[^\d]/g, '').slice(0, 18) })} />
          {mismatch && <div className="ferr">Does not match.</div>}
        </div>
        <div>
          <Lbl htmlFor="bk-i">IFSC</Lbl>
          <input id="bk-i" className="mono" value={b.ifsc} maxLength={11} placeholder="HDFC0001234"
                 onChange={e => setB({ ...b, ifsc: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
          {touched && b.ifsc && checkIfsc(b.ifsc) && <div className="ferr">{checkIfsc(b.ifsc)}</div>}
        </div>
        <div>
          <Lbl htmlFor="bk-r" opt>Reason</Lbl>
          <input id="bk-r" value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="e.g. Moved my salary to a new bank" />
        </div>
      </div>
      <Lbl htmlFor="bk-f" opt>Cancelled cheque or passbook page</Lbl>
      <FileField id="bk-f" file={file} onChange={(f, e) => { setFile(f); setErr(e) }} label="Attach proof" />
      {touched && check && <div className="ferr">{check}</div>}
      <GoesTo fieldKey="salary_account" approvers={self?.approvers} />
      <Err text={err} />
    </Modal>
  )
}

// ── documents ────────────────────────────────────────────────────────────

const DOC_STATUS: Record<string, { text: string; tone: string }> = {
  verified: { text: 'Verified', tone: 'good' },
  uploaded: { text: 'With HR for verification', tone: 'warn' },
  pending:  { text: 'With HR for verification', tone: 'warn' },
  rejected: { text: 'Not accepted — upload again', tone: 'bad' },
  expired:  { text: 'Expired — upload a current one', tone: 'bad' },
}

function DocRow({ req, doc, busy, onUpload }: {
  req: DocRequired; doc: DocOnFile | undefined; busy: boolean; onUpload: (code: string, f: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const st = doc ? DOC_STATUS[doc.status] ?? DOC_STATUS.uploaded : null
  return (
    <li className="docrow">
      <div className="dl">
        <div className="dn">{req.label}{req.mandatory ? '' : <span className="opt"> · optional</span>}</div>
        <div className="ds">
          {st ? <span className={`pill ${st.tone}`}>{st.text}</span> : <span className="pill">Not uploaded</span>}
          {doc?.source === 'onboarding' && <span className="dsrc">from onboarding</span>}
          {doc?.remarks && doc.status === 'rejected' && <span className="drem">{doc.remarks}</span>}
          {!doc && req.hint && <span className="dsrc">{req.hint}</span>}
        </div>
      </div>
      <div className="da">
        {doc?.url && <a className="lnk" href={doc.url} target="_blank" rel="noreferrer">View</a>}
        <input ref={ref} type="file" hidden accept=".pdf,image/jpeg,image/png,image/webp"
               onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(req.code, f) }} />
        <button type="button" className={`btn sm${doc ? ' ghost' : ''}`} disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? 'Uploading…' : doc ? 'Replace' : 'Upload'}
        </button>
      </div>
    </li>
  )
}

export function DocumentsPanel({ onChanged }: { onChanged: Done }) {
  const [data, setData] = useState<{ required: DocRequired[]; documents: DocOnFile[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await loadDocuments()
    if (r.error) { setErr(r.error.message); return }
    setErr(null); setData({ required: r.data?.required ?? [], documents: r.data?.documents ?? [] })
  }, [])
  useEffect(() => { void load() }, [load])

  const upload = async (code: string, f: File) => {
    if (f.size > DOC_MAX_BYTES) { setErr('That file is over 5 MB.'); return }
    if (f.type && !DOC_TYPES_OK.includes(f.type)) { setErr('Use a PDF, JPG, PNG or WebP.'); return }
    setBusy(code); setErr(null)
    const r = await selfService({ action: 'document', doc_type: code }, f)
    setBusy(null)
    if (r.error) { setErr(r.error.message); return }
    await load()
    onChanged(r.data?.message ?? 'Uploaded.')
  }

  if (!data) return err ? <div className="note bad">{err}</div> : <div className="empty">Loading documents…</div>

  // The newest copy per type wins: a re-upload here outranks the one from
  // onboarding, which is what HR would expect to verify.
  const latest = new Map<string, DocOnFile>()
  for (const d of [...data.documents].sort((a, b) => String(b.uploaded_at ?? '').localeCompare(String(a.uploaded_at ?? '')))) {
    if (!latest.has(d.doc_type)) latest.set(d.doc_type, d)
  }
  const asked = new Set(data.required.map(r => r.code))
  const others = [...latest.values()].filter(d => !asked.has(d.doc_type))
  const done = data.required.filter(r => r.mandatory && latest.get(r.code)).length
  const need = data.required.filter(r => r.mandatory).length

  return (
    <div className="docs">
      <div className="docsum">
        <b>{done} of {need}</b> required documents on file. Uploads save straight away; HR verifies each one.
      </div>
      {err && <div className="note bad" style={{ marginBottom: 10 }}>{err}</div>}
      <ul className="doclist">
        {data.required.map(r => (
          <DocRow key={r.code} req={r} doc={latest.get(r.code)} busy={busy === r.code} onUpload={upload} />
        ))}
      </ul>
      {others.length > 0 && (
        <>
          <div className="dsub">Also on file</div>
          <ul className="doclist">
            {others.map(d => (
              <li className="docrow" key={d.id}>
                <div className="dl">
                  <div className="dn">{d.label}</div>
                  <div className="ds"><span className={`pill ${(DOC_STATUS[d.status] ?? DOC_STATUS.uploaded).tone}`}>
                    {(DOC_STATUS[d.status] ?? DOC_STATUS.uploaded).text}</span>
                    {d.source === 'onboarding' && <span className="dsrc">from onboarding</span>}</div>
                </div>
                <div className="da">{d.url && <a className="lnk" href={d.url} target="_blank" rel="noreferrer">View</a>}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
