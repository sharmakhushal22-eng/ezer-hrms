'use client'
// components/profile/Profile360.tsx — the ESS profile ("My Details").
//
// LAYOUT
//
//   identity header   photo (click to change), name, role, chips, facts, and
//                     the three things people come here to do: Edit profile,
//                     Digital ID, Change history
//   two columns       a short side column — completeness (top three, "Show
//                     all"), the reporting chain, open requests — beside the
//                     tabs. Kept short on purpose: it used to carry the ID card
//                     and its download too and ran three screens long next to
//                     a mostly empty right half.
//   drawers           Edit profile, Digital ID, Change history, Documents open
//                     on demand instead of all being on the page at once.
//
// The KPI strip is gone: its four tiles repeated the facts line (tenure), the
// completeness ring (score, open items) and the chain (reportees), each with a
// progress bar that measured nothing. So is the Direct / Request / Locked /
// Event legend: each field now says what pressing it does ("Edit", "Add",
// "Request change"), and the rule is one tap away under "How editing works".
//
// EDITING
//
// Every completeness item's Fix opens the editor for THAT item — the photo
// cropper, an Aadhaar form, an address form, the nominee form — mapped from the
// sentence by lib/profile/self-service fixActionFor(). It used to open Spouse
// name for all of them. What saves straight away and what goes for approval
// (and to whom, by name) is written at the top of that file.
//
// After any save the payload is reloaded (ring, pending list, cards, ID card),
// the request list refreshes, and 'ez:profile-updated' is fired on window so
// the portal header's avatar follows.
//
// The distinction the whole file still turns on:
//
//   key MISSING from the payload  ->  "Restricted"  (not yours to see)
//   key present but null/empty    ->  "—"           (nobody filled it in)

import React, { useCallback, useEffect, useState } from 'react'
import { TABS, MODEL, RECORD_CARDS, CARD_COLUMNS } from '@/lib/profile/model'
import ChangeRequests, { RequestsSummary, useChangeRequests } from '@/components/profile/ChangeRequests'
import { maySee, type ProfileField, type ProfilePayload, type Row, type TabId } from '@/lib/profile/types'
import { loadProfile, setProfileOwner, announceProfileUpdate } from '@/lib/profile/client'
import {
  fixActionFor, FIX_TAB, FIX_MODE, addressOneLine, goesTo, SCHEME_LABEL, type Scheme,
} from '@/lib/profile/self-service'
import IdCard from '@/components/profile/IdCard'
import IdCardDownload from '@/components/profile/IdCardDownload'
import PhotoUploader from '@/components/profile/PhotoUploader'
import {
  Drawer, FieldEditor, IdentityEditor, AddressEditor, EmergencyEditor, NomineeEditor, BankEditor,
  DocumentsPanel,
} from '@/components/profile/editors'
import '@/components/profile/profile.css'

const val = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}
const pretty = (v: unknown): string => {
  const s = val(v)
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? s
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
const money = (v: unknown): string => {
  const n = Number(v)
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? '₹' + n.toLocaleString('en-IN') : val(v)
}
const titleise = (k: string) =>
  k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bNo\b/, 'No.')
const ini = (n: unknown) =>
  String(n || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()

const ALL_FIELDS: ProfileField[] = Object.values(MODEL).flatMap(gs => (gs ?? []).flatMap(g => g.fields))
const fieldByKey = (k: string) => ALL_FIELDS.find(f => f.key === k) ?? null

type Editor =
  | { kind: 'field'; field: ProfileField }
  | { kind: 'identity'; which: 'aadhaar' | 'pan' | 'uan' }
  | { kind: 'address'; which: 'present' | 'permanent' }
  | { kind: 'emergency'; slot: 1 | 2 }
  | { kind: 'nominee'; scheme: Scheme }
  | { kind: 'bank' }

type DrawerId = 'edit' | 'request' | 'id' | 'history' | 'docs'

// ── what a field shows, and what pressing it does ────────────────────────

const ID_HAS: Record<string, 'has_pan' | 'has_aadhaar' | 'has_uan'> = { pan: 'has_pan', aadhaar: 'has_aadhaar', uan: 'has_uan' }

/** The value as a person should read it. The view flattens addresses to two
 *  lines; your own profile carries the full one, city, state and PIN. */
function shownValue(f: ProfileField, p: ProfilePayload): { text: string; restricted: boolean } {
  const emp = p.employee
  const present = Object.prototype.hasOwnProperty.call(emp, f.key)
  if (f.key === 'pan' && !present && p.self?.ids?.pan_masked) return { text: p.self.ids.pan_masked, restricted: false }
  if (!maySee(p.viewer_role, f.min) || !present) {
    if (f.key === 'pan' && p.self && !p.self.ids.has_pan) return { text: '—', restricted: false }
    return { text: 'Restricted', restricted: true }
  }
  if ((f.key === 'present_address' || f.key === 'permanent_address') && p.self) {
    const a = p.self.addresses[f.key === 'present_address' ? 'present' : 'permanent']
    if (a) return { text: addressOneLine(a), restricted: false }
  }
  const raw = emp[f.key]
  return { text: /ctc|gross/.test(f.key) ? money(raw) : pretty(raw), restricted: false }
}

interface Mode { kind: 'none' | 'edit' | 'add' | 'request'; label: string }

function fieldMode(f: ProfileField, p: ProfilePayload, self: boolean): Mode {
  const none: Mode = { kind: 'none', label: '' }
  if (!self) return none
  const { text, restricted } = shownValue(f, p)
  const empty = text === '—'
  if (f.addable && f.editor) {
    // self.ids is authoritative (it sees PAN, which the payload strips below
    // HR); without it — an older payload, the preview — go by what is shown.
    const has = p.self?.ids ? p.self.ids[ID_HAS[f.editor]] : !empty
    return has ? none : { kind: 'add', label: 'Add' }
  }
  if (restricted || f.state === 'locked') return none
  if (f.editor === 'bank') return { kind: 'request', label: p.self?.ids?.has_bank ? 'Request change' : 'Add' }
  if (f.editor === 'present_address' || f.editor === 'permanent_address') {
    return empty ? { kind: 'add', label: 'Add' } : { kind: 'request', label: 'Request change' }
  }
  if (f.state === 'direct') return { kind: empty ? 'add' : 'edit', label: empty ? 'Add' : 'Edit' }
  return { kind: 'request', label: 'Request change' }
}

const LockGlyph = () => (
  <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
)

function FieldCard({ f, payload, self, onAct }: {
  f: ProfileField; payload: ProfilePayload; self: boolean; onAct: (f: ProfileField) => void
}) {
  const [shown, setShown] = useState(false)
  const { text, restricted } = shownValue(f, payload)
  const mode = fieldMode(f, payload, self)
  const act = mode.kind !== 'none'
  // Reveal only applies to the real value (HR's view). A masked PAN from
  // self.ids is already safe to show.
  const masked = f.mask && !shown && text !== '—' && !restricted && !text.includes('•')

  return (
    <div className={`fld${f.wide ? ' span2' : ''}${act ? ' act' : ''}`}
         onClick={act ? () => onAct(f) : undefined}
         role={act ? 'button' : undefined} tabIndex={act ? 0 : undefined}
         onKeyDown={act ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAct(f) } } : undefined}>
      <div className="k">
        <span>{f.label}</span>
        {act ? <span className={`fa ${mode.kind}`}>{mode.label}</span>
             : self && f.state === 'locked' && !restricted
               ? <span className="lk" title="Maintained by HR — ask HR to correct it"><LockGlyph /></span> : null}
      </div>
      <div className={`v${f.mono ? ' mono' : ''}`}>
        {restricted ? <span className="no">Restricted</span>
          : masked ? <>
              <span className="msk">{'•'.repeat(Math.min(12, Math.max(4, text.length)))}</span>
              <button className="eye" onClick={e => { e.stopPropagation(); setShown(true) }}>Reveal</button>
            </>
          : <>{text === '—' ? <span className="nil">Not added</span> : text}
              {f.mask && shown && <button className="eye" onClick={e => { e.stopPropagation(); setShown(false) }}>Hide</button>}</>}
      </div>
      {f.hint && <div className="hint">{f.hint}</div>}
    </div>
  )
}

const Card = ({ title, sub, right, children, className }: {
  title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string
}) => (
  <div className={`card${className ? ` ${className}` : ''}`}>
    {(title || right) && (
      <div className="hd">
        <div>{title && <h3>{title}</h3>}{sub && <div className="sub">{sub}</div>}</div>
        {right}
      </div>
    )}
    {children}
  </div>
)

const Section = ({ title, sub, right, children }: {
  title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode
}) => (
  <section className="sec">
    <div className="sechd">
      <div><h4>{title}</h4>{sub && <div className="sub">{sub}</div>}</div>
      {right}
    </div>
    {children}
  </section>
)

function Ring({ pc }: { pc: number }) {
  const r = 26, c = 2 * Math.PI * r
  return (
    <div className="ez-ring">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" stroke="var(--ez-sunken)" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" stroke="var(--ez-brand)"
                strokeLinecap="round" strokeDasharray={`${c * Math.max(0, Math.min(100, pc)) / 100} ${c}`} />
      </svg>
      <div className="mid"><div className="num">{pc}%</div></div>
    </div>
  )
}

const RecordTable = ({ title, rows, columns, empty }: {
  title: string; rows: Row[]; columns: string[]; empty: string
}) => (
  <Section title={title}>
    <div className="card">
      {!rows.length ? <div className="empty">{empty}</div> : (
        <div className="tbl"><table>
          <thead><tr>{columns.map(c => <th key={c}>{titleise(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={String(r.id ?? i)}>
              {columns.map(c => <td key={c}>{/sum_insured|amount/.test(c) ? money(r[c]) : pretty(r[c])}</td>)}
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  </Section>
)

// ── side column ──────────────────────────────────────────────────────────

const fixLabel = (a: string | null) =>
  a === 'photo' || a === 'documents' ? 'Upload' : a && FIX_MODE[a as keyof typeof FIX_MODE] === 'payroll' ? 'Request' : 'Add'

function Completeness({ score, pending, self, onFix }: {
  score: number; pending: string[]; self: boolean; onFix: (sentence: string) => void
}) {
  const [all, setAll] = useState(false)
  const list = all ? pending : pending.slice(0, 3)
  return (
    <Card title="Profile completeness"
          right={pending.length ? <span className="pill warn">{pending.length} to do</span> : <span className="pill good">Complete</span>}>
      <div className="ez-ringrow">
        <Ring pc={score} />
        <p>{pending.length
          ? 'A complete profile keeps payroll, PF and tax filings right.'
          : 'Everything payroll and statutory filings need is on file.'}</p>
      </div>
      {pending.length > 0 && (
        <>
          <ul className="todo">
            {list.map(p => {
              const a = fixActionFor(p)
              return (
                <li key={p}><i />
                  <span className="tt">{p}</span>
                  {self && <button type="button" className="fix" onClick={() => onFix(p)}>{fixLabel(a)}</button>}
                </li>
              )
            })}
          </ul>
          {pending.length > 3 && (
            <button type="button" className="lnk more" onClick={() => setAll(x => !x)}>
              {all ? 'Show fewer' : `Show all ${pending.length}`}
            </button>
          )}
        </>
      )}
    </Card>
  )
}

/** One row per PERSON, not per role. The same person often holds two slots —
 *  your L1 is also the MD in a small company, a HOD is their own HOD — and
 *  the chain used to list them twice. Matched on employee code. */
function chainOf(emp: Row) {
  const slots: [string, string][] = [['rm_l1', 'Reporting manager'], ['rm_l2', 'Second-level manager'],
                                     ['hod', 'Head of department'], ['md', 'Managing director']]
  const out: { key: string; name: string; roles: string[]; me: boolean }[] = []
  const meCode = String(emp.employee_code ?? '')
  for (const [k, role] of slots) {
    const name = emp[`${k}_name`]
    if (!name) continue
    const code = String(emp[`${k}_code`] ?? '')
    const key = code || String(name)
    const me = !!code && code === meCode
    const hit = out.find(x => x.key === key)
    if (hit) hit.roles.push(role)
    else out.push({ key, name: String(name), roles: [role], me })
  }
  return out
}

function Chain({ emp, self }: { emp: Row; self: boolean }) {
  const people = chainOf(emp)
  const above = people.filter(p => !p.me)
  const myRoles = people.find(p => p.me)?.roles ?? []
  const n = Number(emp.reportee_count) || 0
  return (
    <Card title="Reporting chain" right={n ? <span className="sub">{n} reportee{n === 1 ? '' : 's'}</span> : null}>
      {!above.length && !myRoles.length ? <div className="empty">No reporting chain recorded.</div> : (
        <ul className="chain">
          {above.map(p => (
            <li key={p.key}>
              <span className="p">{ini(p.name)}</span>
              <div><div className="n">{p.name}</div><div className="r">{p.roles.join(' · ')}</div></div>
            </li>
          ))}
          <li className="me">
            <span className="p">{ini(emp.full_name)}</span>
            <div>
              <div className="n">{val(emp.full_name)}</div>
              <div className="r">{[self ? 'You' : val(emp.designation), ...myRoles].join(' · ')}</div>
            </div>
          </li>
        </ul>
      )}
    </Card>
  )
}

function HowEditing({ onClose }: { onClose: () => void }) {
  return (
    <div className="howpop" role="dialog" aria-label="How editing works">
      <div className="hhd"><b>How editing works</b><button type="button" className="x" onClick={onClose} aria-label="Close">×</button></div>
      <dl>
        <dt className="edit">Edit · Add</dt><dd>Saves straight away — contact details, emergency contacts, blood group, nominees, a missing PAN, UAN, Aadhaar or address.</dd>
        <dt className="request">Request change</dt><dd>Goes for approval and says to whom. Changing an address, spouse or marital status goes to HR; the salary account goes to Payroll.</dd>
        <dt className="locked"><LockGlyph /> Locked</dt><dd>Maintained by HR — your name, date of birth, job details. Ask HR to correct these.</dd>
      </dl>
    </div>
  )
}

// ── the Edit profile drawer ──────────────────────────────────────────────

function HubRow({ label, value, action, sub, onClick }: {
  label: string; value: string | null; action: string; sub?: string; onClick: () => void
}) {
  return (
    <li className="hub">
      <div className="hl">
        <div className="hk">{label}</div>
        {value !== null && (
          <div className={`hv${value === '—' || !value ? ' nil' : ''}`}>{value && value !== '—' ? value : 'Not added'}</div>
        )}
        {sub && <div className="hs">{sub}</div>}
      </div>
      <button type="button" className="btn ghost sm" onClick={onClick}>{action}</button>
    </li>
  )
}

function EditHub({ payload, focus, onField, onAction, onFix }: {
  payload: ProfilePayload; focus: 'edit' | 'request'
  onField: (f: ProfileField) => void; onAction: (a: string) => void; onFix: (s: string) => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus === 'request') ref.current?.scrollIntoView({ block: 'start' })
  }, [focus])
  const ap = payload.self?.approvers
  const pending = payload.completeness.pending ?? []
  const nom = (s: Scheme) => {
    const rows = payload.nominations.filter(n => String(n.scheme) === s)
    return rows.length ? rows.map(r => `${val(r.nominee_name)} ${Number(r.share_percent)}%`).join(', ') : ''
  }

  const mine: ProfileField[] = [], approval: ProfileField[] = [], locked: ProfileField[] = []
  for (const f of ALL_FIELDS) {
    const m = fieldMode(f, payload, true)
    if (m.kind === 'edit' || m.kind === 'add') mine.push(f)
    else if (m.kind === 'request') { if (f.editor !== 'bank') approval.push(f) }
    else if (f.state === 'locked' && maySee(payload.viewer_role, f.min)) locked.push(f)
  }

  return (
    <div className="hubwrap">
      {pending.length > 0 && (
        <section className="hubsec">
          <h4>To complete</h4>
          <ul className="todo">
            {pending.map(p => (
              <li key={p}><i /><span className="tt">{p}</span>
                <button type="button" className="fix" onClick={() => onFix(p)}>{fixLabel(fixActionFor(p))}</button></li>
            ))}
          </ul>
        </section>
      )}

      <section className="hubsec">
        <h4>Change it yourself</h4>
        <div className="sub">Saves straight away.</div>
        <ul className="hublist">
          <HubRow label="Profile photo" value={payload.photoUrl ? 'Set' : ''} action={payload.photoUrl ? 'Change' : 'Upload'}
                  onClick={() => onAction('photo')} />
          {mine.map(f => (
            <HubRow key={f.key} label={f.label} value={shownValue(f, payload).text}
                    action={fieldMode(f, payload, true).label} onClick={() => onField(f)} />
          ))}
          {(['pf', 'gratuity'] as Scheme[]).map(s => (
            <HubRow key={s} label={`${SCHEME_LABEL[s]} nominees`} value={nom(s)} action={nom(s) ? 'Edit' : 'Add'}
                    onClick={() => onAction(s === 'pf' ? 'nominee_pf' : 'nominee_gratuity')} />
          ))}
          <HubRow label="Documents" value={null} action="Open" sub="Aadhaar, PAN, certificates — HR verifies each upload"
                  onClick={() => onAction('documents')} />
        </ul>
      </section>

      <section className="hubsec" ref={ref}>
        <h4>Needs approval</h4>
        <div className="sub">Nothing changes until the approver accepts it. Follow it in Change history.</div>
        <ul className="hublist">
          {approval.map(f => (
            <HubRow key={f.key} label={f.label} value={shownValue(f, payload).text} action="Request change"
                    sub={`Goes to ${goesTo(f.key, ap).summary}`} onClick={() => onField(f)} />
          ))}
          <HubRow label="Salary account"
                  value={payload.self?.ids?.has_bank ? `${val(payload.employee.bank_name)} · ${payload.self.ids.bank_masked ?? ''}` : ''}
                  action={payload.self?.ids?.has_bank ? 'Request change' : 'Add'}
                  sub={`Goes to ${goesTo('salary_account', ap).summary}`} onClick={() => onAction('bank')} />
        </ul>
      </section>

      {locked.length > 0 && (
        <details className="hubsec lockd">
          <summary>Maintained by HR ({locked.length})</summary>
          <p className="sub">Your organisation keeps these. If one is wrong, ask HR to correct it.</p>
          <div className="lockgrid">{locked.map(f => <span key={f.key}>{f.label}</span>)}</div>
        </details>
      )}
    </div>
  )
}

// ── tabs ─────────────────────────────────────────────────────────────────

/** The next time a date's day and month come round, and how far off it is. */
function nextOf(iso: unknown): { date: Date; days: number; years: number } | null {
  const s = String(iso ?? '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  const d = new Date(s); if (isNaN(d.getTime())) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const n = new Date(t.getFullYear(), d.getMonth(), d.getDate())
  if (n < t) n.setFullYear(n.getFullYear() + 1)
  return { date: n, days: Math.round((n.getTime() - t.getTime()) / 86400000), years: n.getFullYear() - d.getFullYear() }
}
const inDays = (n: number) => n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
const dm = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
    </dl>
  )
}

function NomineeCard({ scheme, rows, self, onEdit }: { scheme: Scheme; rows: Row[]; self: boolean; onEdit: () => void }) {
  const total = Math.round(rows.reduce((a, r) => a + (Number(r.share_percent) || 0), 0) * 100) / 100
  return (
    <div className="nom">
      <div className="top">
        <div style={{ minWidth: 0 }}>
          <div className="n">{SCHEME_LABEL[scheme]}</div>
          <div className="s">{rows.length ? rows.map(r => `${val(r.nominee_name)} (${val(r.relation)}) ${Number(r.share_percent)}%`).join(' · ')
                                          : 'No nominee yet.'}</div>
        </div>
        {rows.length > 0 && <span className={total === 100 ? 'pc100' : 'pcbad'}>{total}%</span>}
      </div>
      <div className="meter"><i className={total === 100 ? 'ok' : ''} style={{ width: `${Math.min(100, total)}%` }} /></div>
      <div className="foot">
        <span>{!rows.length ? 'Required for the statutory form' : total === 100 ? (rows.some(r => r.is_filed) ? 'Filed' : 'Ready for HR to file') : `Adds up to ${total}%, not 100%`}</span>
        {self && <button type="button" onClick={onEdit}>{rows.length ? 'Edit nominees' : 'Add nominee'}</button>}
      </div>
    </div>
  )
}

function Overview({ p, self, onAction, openTab }: {
  p: ProfilePayload; self: boolean; onAction: (a: string) => void; openTab: (t: TabId) => void
}) {
  const emp = p.employee
  const ann = nextOf(emp.date_of_joining), bday = emp.date_of_birth ? nextOf(emp.date_of_birth) : null
  const pf = p.nominations.filter(n => String(n.scheme) === 'pf')
  const gr = p.nominations.filter(n => String(n.scheme) === 'gratuity')
  const nomState = (rows: Row[]) => {
    if (!rows.length) return <span className="tag warn">Not added</span>
    const t = rows.reduce((a, r) => a + (Number(r.share_percent) || 0), 0)
    return t === 100 ? <span className="tag good">{rows.length} nominee{rows.length === 1 ? '' : 's'} · 100%</span>
                     : <span className="tag warn">{t}% assigned</span>
  }
  const e1 = emp.emergency_contact_1
  return (
    <div className="g2x">
      <Card title="Contact" right={self ? <button type="button" className="lnk" onClick={() => openTab('personal')}>All details</button> : null}>
        <KV rows={[
          ['Work email', val(emp.official_email)],
          ['Mobile', Object.prototype.hasOwnProperty.call(emp, 'mobile') ? val(emp.mobile) : 'Restricted'],
          ['Personal email', Object.prototype.hasOwnProperty.call(emp, 'personal_email') ? val(emp.personal_email) : 'Restricted'],
          ['Location', [emp.location_name, emp.workstation].filter(Boolean).map(String).join(' · ') || '—'],
          ...(self ? [['Emergency', e1 ? String(e1)
            : <button type="button" className="lnk" onClick={() => onAction('emergency')}>Add an emergency contact</button>] as [string, React.ReactNode]] : []),
        ]} />
      </Card>

      <Card title="Key dates">
        <KV rows={[
          ['Joined', emp.date_of_joining ? `${pretty(emp.date_of_joining)} · ${val(emp.tenure_years)}y ${val(emp.tenure_months)}m` : '—'],
          ...(ann && emp.date_of_joining ? [['Work anniversary', `${ann.years} year${ann.years === 1 ? '' : 's'} on ${dm(ann.date)} · ${inDays(ann.days)}`] as [string, string]] : []),
          ...(bday ? [['Birthday', `${dm(bday.date)} · ${inDays(bday.days)}`] as [string, string]] : []),
          ['Confirmed', emp.confirmation_date ? pretty(emp.confirmation_date) : emp.probation_months ? `On probation (${val(emp.probation_months)} months)` : '—'],
        ]} />
      </Card>

      <Card title="Employment" right={<button type="button" className="lnk" onClick={() => openTab('job')}>More</button>}>
        <KV rows={[
          ['Type', [emp.employment_type, emp.employee_category].filter(Boolean).map(String).join(' · ') || '—'],
          ['Grade', [emp.grade, emp.job_level].filter(Boolean).map(String).join(' · ') || '—'],
          ['Notice period', emp.notice_period_days ? `${val(emp.notice_period_days)} days` : '—'],
          ['Weekly off', val(emp.weekly_off)],
        ]} />
      </Card>

      <Card title="Family & nominees" right={<button type="button" className="lnk" onClick={() => openTab('family')}>Open</button>}>
        <KV rows={[
          ['Family members', p.family.length ? `${p.family.length} recorded` : '—'],
          ['PF nominee', <span key="pf" className="kvact">{nomState(pf)}{self && <button type="button" className="lnk" onClick={() => onAction('nominee_pf')}>{pf.length ? 'Edit' : 'Add'}</button>}</span>],
          ['Gratuity nominee', <span key="gr" className="kvact">{nomState(gr)}{self && <button type="button" className="lnk" onClick={() => onAction('nominee_gratuity')}>{gr.length ? 'Edit' : 'Add'}</button>}</span>],
          ['Insurance', p.insurance.length ? `${p.insurance.length} active polic${p.insurance.length === 1 ? 'y' : 'ies'}` : '—'],
        ]} />
      </Card>
    </div>
  )
}

function FamilyTab({ p, self, onAction }: { p: ProfilePayload; self: boolean; onAction: (a: string) => void }) {
  return (
    <>
      <Section title="Nominations" sub="Who receives your PF and gratuity. Each must total exactly 100%; HR files the form from it.">
        <div className="g2">
          {(['pf', 'gratuity'] as Scheme[]).map(s => (
            <NomineeCard key={s} scheme={s} rows={p.nominations.filter(n => String(n.scheme) === s)} self={self}
                         onEdit={() => onAction(s === 'pf' ? 'nominee_pf' : 'nominee_gratuity')} />
          ))}
        </div>
      </Section>

      <Section title="Family" sub="Adding a nominee adds them here. HR verifies a member before insurance can cover them.">
        {!p.family.length ? <div className="card"><div className="empty">No family members recorded.</div></div> : (
          <div className="g2">
            {p.family.map((m, i) => (
              <div className="pc" key={String(m.id ?? i)}>
                <div className="ph">{ini(m.member_name)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="n">{val(m.member_name)}</div>
                  <div className="s">{val(m.relation)}{m.date_of_birth ? ` · ${pretty(m.date_of_birth)}` : ''}</div>
                  <div className="pl">
                    {m.is_verified ? <span className="pill good">Verified</span> : <span className="pill warn">Proof pending</span>}
                    {m.is_insured ? <span className="pill brand">Insured</span> : null}
                    {m.is_dependent ? <span className="pill">Dependent</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Insurance" sub="Enrolment is handled by HR during the policy window.">
        {!p.insurance.length ? <div className="card"><div className="empty">No active policy recorded.</div></div> : (
          <div className="g2">
            {p.insurance.map((x, i) => (
              <div className="pc" key={String(x.id ?? i)}>
                <div style={{ minWidth: 0 }}>
                  <div className="n">{val(x.policy_type)}{x.policy_name ? ` · ${val(x.policy_name)}` : ''}</div>
                  <div className="s">Sum insured {money(x.sum_insured)}{x.valid_to ? ` · valid to ${pretty(x.valid_to)}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

// ── page ─────────────────────────────────────────────────────────────────
export default function Profile360({ code, employeeId, initial }: {
  code?: string
  /** The portal owner's id. Needed only so the shared dashboard login can
   *  resolve whose profile to serve — an ESS session ignores it. */
  employeeId?: string
  /** Preloaded payload. Only the dev harness passes this. */
  initial?: ProfilePayload
}) {
  const [payload, setPayload] = useState<ProfilePayload | null>(initial ?? null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [drawer, setDrawer] = useState<DrawerId | null>(null)
  const [howOpen, setHowOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [reqKey, setReqKey] = useState(0)
  // Held locally so a freshly uploaded picture appears at once, before the
  // reload lands.
  const [photo, setPhoto] = useState<string | null>(initial?.photoUrl ?? null)
  const [photoOpen, setPhotoOpen] = useState(false)

  const load = useCallback(async () => {
    if (initial) return
    setProfileOwner(employeeId ?? null)
    const r = await loadProfile(code)
    if (r.error) { setErr(r.error.message); setPayload(null); return }
    setErr(null); setPayload(r.data); setPhoto(r.data?.photoUrl ?? null)
  }, [code, employeeId, initial])
  useEffect(() => { load() }, [load])

  const isMine = payload ? (payload.isSelf ?? payload.viewer_role === 'self') : false
  const req = useChangeRequests(isMine && !initial, reqKey)

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 5000)
    return () => clearTimeout(t)
  }, [flash])

  /** Every save lands here: reload what the page shows, refresh the request
   *  list, and tell the rest of the portal. */
  const afterSave = useCallback((msg: string, photoUrl?: string | null) => {
    setEditor(null)
    setFlash(msg)
    void load()
    setReqKey(k => k + 1)
    announceProfileUpdate(photoUrl !== undefined ? { photoUrl } : {})
  }, [load])

  const closeEditor = useCallback(() => setEditor(null), [])
  const closeDrawer = useCallback(() => setDrawer(null), [])

  if (err) return <div className="ezp"><div className="card"><div className="note bad">{err}</div></div></div>
  if (!payload) return <div className="ezp"><div className="card"><div className="empty">Loading…</div></div></div>

  const emp = payload.employee
  const self = isMine
  const groups = MODEL[tab] ?? []
  const pending = payload.completeness.pending ?? []
  const pendingReqs = req.mine.filter(r => r.status.startsWith('pending')).length

  /** One switchboard for Fix, the Edit drawer and the field cards. */
  const openAction = (a: string) => {
    switch (a) {
      case 'photo': setPhotoOpen(true); return
      case 'aadhaar': case 'pan': case 'uan': setEditor({ kind: 'identity', which: a }); return
      case 'bank': setEditor({ kind: 'bank' }); return
      case 'present_address': setEditor({ kind: 'address', which: 'present' }); return
      case 'permanent_address': setEditor({ kind: 'address', which: 'permanent' }); return
      case 'emergency': setEditor({ kind: 'emergency', slot: payload.self?.emergency?.[1] ? 2 : 1 }); return
      case 'emergency1': setEditor({ kind: 'emergency', slot: 1 }); return
      case 'emergency2': setEditor({ kind: 'emergency', slot: 2 }); return
      case 'nominee_pf': setEditor({ kind: 'nominee', scheme: 'pf' }); return
      case 'nominee_gratuity': setEditor({ kind: 'nominee', scheme: 'gratuity' }); return
      case 'documents': setDrawer('docs'); return
      case 'blood_group': { const f = fieldByKey('blood_group'); if (f) setEditor({ kind: 'field', field: f }); return }
    }
  }
  const onFix = (sentence: string) => {
    const a = fixActionFor(sentence)
    // A sentence this screen does not know yet: land on the tab that holds it
    // rather than opening something unrelated.
    if (!a) { setDrawer(null); setTab('personal'); return }
    if (a === 'documents') { setDrawer('docs'); return }
    setDrawer(null)
    openAction(a)
    if (!['photo'].includes(a)) setTab(FIX_TAB[a] as TabId)
  }
  const onField = (f: ProfileField) => {
    if (f.editor) { openAction(f.editor); return }
    setEditor({ kind: 'field', field: f })
  }

  return (
    <div className="ezp">
      {flash && <div className="toast" role="status">{flash}</div>}

      {/* ── identity ── */}
      <div className="cover" />
      <div className="idcard">
        <div className={'face' + (photo ? ' hasimg' : '')}>
          {photo
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={photo} alt="" />
            : ini(emp.full_name)}
          {self && (
            <button type="button" className="facebtn" onClick={() => setPhotoOpen(true)}
                    aria-label={photo ? 'Change your profile photo' : 'Add a profile photo'}
                    title={photo ? 'Change photo' : 'Add photo'}>
              <svg viewBox="0 0 20 20" width={14} height={14} fill="none" stroke="currentColor"
                   strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3.5 6.8h2.4l1.1-1.7h5.9l1.1 1.7h2.5v8.2h-13z" />
                <circle cx="10" cy="10.9" r="2.6" />
              </svg>
            </button>
          )}
        </div>
        <div className="who">
          <h2>{val(emp.display_name && emp.display_name !== emp.full_name ? `${emp.full_name} (${emp.display_name})` : emp.full_name)}</h2>
          <div className="role">
            {val(emp.designation)}{emp.department_name ? <> · <b>{val(emp.department_name)}</b></> : null}
          </div>
          <div className="chips">
            <span className="pill brand">{val(emp.employee_code)}</span>
            <span className="pill good">{val(emp.status)}</span>
            {emp.grade ? <span className="pill">{val(emp.grade)}{emp.job_level ? ` · ${val(emp.job_level)}` : ''}</span> : null}
            {emp.employment_type ? <span className="pill">{val(emp.employment_type)}</span> : null}
            {!self && <span className="pill warn">Viewing as {payload.viewer_role}</span>}
          </div>
          <div className="facts">
            {emp.company_name ? <span><span className="k">Company</span> {val(emp.company_name)}</span> : null}
            {emp.location_name ? <span><span className="k">Location</span> {val(emp.location_name)}</span> : null}
            {emp.date_of_joining ? <span><span className="k">Joined</span> {pretty(emp.date_of_joining)}</span> : null}
            {emp.tenure_years !== undefined && emp.tenure_years !== null
              ? <span><span className="k">Tenure</span> {val(emp.tenure_years)}y {val(emp.tenure_months)}m</span> : null}
          </div>
        </div>
        <div className="idacts">
          {self && <button type="button" className="btn" onClick={() => setDrawer('edit')}>Edit profile</button>}
          {self && <button type="button" className="btn ghost" onClick={() => setDrawer('request')}>Request a change</button>}
          <button type="button" className="btn ghost" onClick={() => setDrawer('id')}>Digital ID</button>
          {self && (
            <button type="button" className="lnk" onClick={() => setDrawer('history')}>
              Change history{pendingReqs ? ` · ${pendingReqs} open` : ''}
            </button>
          )}
        </div>
      </div>

      {/* ── two columns ── */}
      <div className="shell">
        <aside className="rail">
          <Completeness score={payload.completeness.score} pending={pending} self={self} onFix={onFix} />
          <Chain emp={emp} self={self} />
          {self && <RequestsSummary req={req} onOpen={() => setDrawer('history')} />}
        </aside>

        <div className="main">
          <div className="tabwrap">
            <div className="tabs" role="tablist">
              {TABS.map(t => (
                <button key={t.id} role="tab" aria-selected={tab === t.id}
                        className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>
            {self && (
              <button type="button" className="howbtn" aria-expanded={howOpen} onClick={() => setHowOpen(o => !o)}
                      title="How editing works" aria-label="How editing works">?</button>
            )}
            {howOpen && <HowEditing onClose={() => setHowOpen(false)} />}
          </div>

          {tab === 'overview' && <Overview p={payload} self={self} onAction={openAction} openTab={setTab} />}

          {groups.map(g => (
            <Section title={g.title} key={g.title}
                     right={tab === 'payroll' && g.title === 'Salary account' && self
                       ? <button type="button" className="btn ghost sm" onClick={() => openAction('bank')}>
                           {payload.self?.ids?.has_bank ? 'Request change' : 'Add account'}</button> : undefined}>
              <div className="g3">
                {g.fields.map(f => <FieldCard key={f.key} f={f} payload={payload} self={self} onAct={onField} />)}
              </div>
            </Section>
          ))}

          {tab === 'family' && <FamilyTab p={payload} self={self} onAction={openAction} />}

          {tab === 'job' && (
            <>
              <Section title="Movement history">
                <div className="card">
                  {!emp.date_of_joining && !emp.confirmation_date ? <div className="empty">No dates recorded.</div> : (
                    <ul className="chain">
                      {emp.confirmation_date ? (
                        <li><span className="p dot" /><div>
                          <div className="n">Confirmed in service</div>
                          <div className="r">{pretty(emp.confirmation_date)}</div>
                        </div></li>) : null}
                      {emp.date_of_joining ? (
                        <li><span className="p dot" /><div>
                          <div className="n">Joined {val(emp.company_name)}</div>
                          <div className="r">{pretty(emp.date_of_joining)} · {val(emp.designation)}</div>
                        </div></li>) : null}
                    </ul>
                  )}
                </div>
              </Section>
              {(payload.app_access ?? []).length > 0 && (
                <Section title="Application access">
                  <div className="card">
                    <KV rows={(payload.app_access ?? []).map(a => [val(a.app_name),
                      `${val(a.access_role)}${a.granted_on ? ` · since ${pretty(a.granted_on)}` : ''}`] as [string, string])} />
                  </div>
                </Section>
              )}
            </>
          )}

          {tab === 'statutory' && (
            <p className="foot-note">
              A missing PAN, UAN or Aadhaar you can add yourself; once on file they are kept by HR, because payroll and
              statutory returns use them. Only HR and Payroll see a full PAN.
            </p>
          )}

          {tab === 'payroll' && (
            payload.salary ? (
              <Section title="Salary structure"
                       sub={`Head wise, effective ${pretty(payload.salary.effective_date)}${payload.salary.fy ? ` · FY ${val(payload.salary.fy)}` : ''}.`}>
                <div className="card">
                  <div className="tbl"><table>
                    <thead><tr><th>Head</th><th style={{ textAlign: 'right' }}>Monthly</th>
                               <th style={{ textAlign: 'right' }}>Annual</th></tr></thead>
                    <tbody>
                      {([['Basic', 'basic_monthly'], ['House rent allowance', 'hra_monthly'],
                         ['Conveyance', 'conveyance'], ['Gratuity', 'gratuity_monthly'],
                         ['Provident fund — employee', 'employee_pf'],
                         ['Provident fund — employer', 'employer_pf']] as const)
                        .filter(([, k]) => payload.salary?.[k] !== null && payload.salary?.[k] !== undefined)
                        .map(([label, k]) => (
                          <tr key={k}>
                            <td>{label}</td>
                            <td style={{ textAlign: 'right' }}>{money(payload.salary?.[k])}</td>
                            <td style={{ textAlign: 'right' }}>{money(Number(payload.salary?.[k]) * 12)}</td>
                          </tr>
                        ))}
                      <tr>
                        <td><b>Gross</b></td>
                        <td style={{ textAlign: 'right' }}><b>{money(payload.salary.gross_monthly)}</b></td>
                        <td style={{ textAlign: 'right' }}><b>{money(payload.salary.gross_annual)}</b></td>
                      </tr>
                    </tbody>
                  </table></div>
                </div>
              </Section>
            ) : <p className="foot-note">No salary structure is on file yet. Payslips and tax are in the Payroll section of ESS.</p>
          )}

          {tab === 'documents' && (
            self
              ? <Section title="Documents" sub="Upload what is asked for. HR verifies each one; you can replace an upload at any time.">
                  <div className="card"><DocumentsPanel onChanged={m => afterSave(m)} /></div>
                </Section>
              : <RecordTable title="Documents" rows={payload.documents ?? []} columns={CARD_COLUMNS.documents} empty="Nothing uploaded yet." />
          )}

          {tab === 'growth' && (
            <>
              <Section title="Performance" sub="From the PMS cycle.">
                <div className="card">
                  {!payload.performance ? <div className="empty">No appraisal recorded yet.</div> : (
                    <KV rows={([['Cycle', val((payload.performance.period as Row | null)?.period_name)],
                       ['Stage', val((payload.performance.period as Row | null)?.status)],
                       ['Rating', payload.performance.final_rating_code
                                    ? `${val(payload.performance.final_rating_code)} · ${val(payload.performance.final_rating)}`
                                    : 'Not finalised'],
                       ['Score', val(payload.performance.final_score)],
                       ['KRAs', val(payload.performance.kra_count)],
                       ['One to ones', val(payload.performance.one_to_one_count)],
                       ['Acknowledged', payload.performance.employee_ack ? 'Yes' : 'Not yet']] as [string, string][])} />
                  )}
                </div>
              </Section>
              {(payload.recognition ?? []).length > 0 && (
                <Section title="Recognition">
                  <div className="g2">
                    {(payload.recognition ?? []).map((r, i) => (
                      <div className="pc" key={String(r.id ?? i)}>
                        <div style={{ minWidth: 0 }}>
                          <div className="n">{val(r.kind)}{r.cycle_label ? ` · ${val(r.cycle_label)}` : ''}</div>
                          <div className="s">{String(r.message ?? '').slice(0, 110) || '—'}</div>
                          <div className="pl"><span className="pill">{pretty(r.created_at)}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          {RECORD_CARDS.filter(c => c.tab === tab).map(c => (
            <RecordTable key={c.key as string} title={c.title}
                         rows={(payload[c.key as keyof ProfilePayload] as Row[]) ?? []}
                         columns={CARD_COLUMNS[c.key as string] ?? []} empty={c.empty} />
          ))}
        </div>
      </div>

      {/* ── drawers ── */}
      {(drawer === 'edit' || drawer === 'request') && self && (
        <Drawer title="Edit profile" sub="Pick what to change. Each item says whether it saves at once or goes for approval."
                onClose={closeDrawer}>
          <EditHub payload={payload} focus={drawer} onFix={onFix}
                   onField={f => { setDrawer(null); onField(f) }}
                   onAction={a => { if (a !== 'documents') setDrawer(null); openAction(a) }} />
        </Drawer>
      )}

      {drawer === 'id' && (
        <Drawer title="Digital ID" sub={self ? 'Show the QR at the gate. The code refreshes every few seconds.' : undefined}
                onClose={closeDrawer}>
          {self ? (
            <div className="idwrap">
              <IdCard
                name={val(emp.full_name)} designation={val(emp.designation)}
                company={val(emp.company_name)} code={val(emp.employee_code)}
                doj={emp.date_of_joining as string | null}
                blood={emp.blood_group as string | null}
                emergency={emp.emergency_contact_1 as string | null}
                photoUrl={photo} />
              <IdCardDownload
                name={val(emp.full_name)} code={val(emp.employee_code)} company={val(emp.company_name)}
                designation={emp.designation as string | null} department={emp.department_name as string | null}
                location={emp.location_name as string | null} doj={emp.date_of_joining as string | null}
                blood={emp.blood_group as string | null} photoUrl={photo} />
            </div>
          ) : (
            <div className="dig">
              <div className="brandline"><span className="mark">EZ</span>{val(emp.company_name)}</div>
              <div className="top">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="ph">{photo ? <img src={photo} alt="" /> : ini(emp.full_name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{val(emp.full_name)}</div>
                  <div className="ds">{val(emp.designation)}</div>
                </div>
              </div>
              <div className="note">A gate code can only be issued for your own card.</div>
            </div>
          )}
        </Drawer>
      )}

      {drawer === 'history' && self && (
        <Drawer title="Change history" sub="Everything you have asked to change, and who has it now." onClose={closeDrawer}>
          <ChangeRequests req={req} />
        </Drawer>
      )}

      {drawer === 'docs' && self && (
        <Drawer title="Documents" sub="Uploads save straight away. HR verifies each one." onClose={closeDrawer}>
          <DocumentsPanel onChanged={m => afterSave(m)} />
        </Drawer>
      )}

      {/* ── editors ── */}
      {editor?.kind === 'field' && (
        <FieldEditor field={editor.field} current={payload.employee[editor.field.key]}
                     approvers={payload.self?.approvers} onClose={closeEditor} onDone={m => afterSave(m)} />
      )}
      {editor?.kind === 'identity' && (
        <IdentityEditor which={editor.which} onFile={!!payload.self?.ids?.[ID_HAS[editor.which]]}
                        masked={editor.which === 'pan' ? payload.self?.ids?.pan_masked
                          : editor.which === 'aadhaar' && emp.aadhar_last4 ? `•••• •••• ${String(emp.aadhar_last4)}` : val(emp.uan)}
                        onClose={closeEditor} onDone={m => afterSave(m)} />
      )}
      {editor?.kind === 'address' && (
        <AddressEditor which={editor.which} self={payload.self}
                       onFile={!!payload.self?.addresses?.[editor.which] || !!emp[`${editor.which}_address`]}
                       onClose={closeEditor} onDone={m => afterSave(m)} />
      )}
      {editor?.kind === 'emergency' && (
        <EmergencyEditor slot={editor.slot} self={payload.self} onClose={closeEditor} onDone={m => afterSave(m)} />
      )}
      {editor?.kind === 'nominee' && (
        <NomineeEditor scheme={editor.scheme} nominations={payload.nominations} family={payload.family}
                       onClose={closeEditor} onDone={m => afterSave(m)} />
      )}
      {editor?.kind === 'bank' && (
        <BankEditor self={payload.self} current={{ bank_name: emp.bank_name, ifsc: emp.ifsc }}
                    onClose={closeEditor} onDone={m => afterSave(m)} />
      )}

      {/* Inside .ezp deliberately: PhotoUploader's classes are un-namespaced,
          so profile.css scopes them under .ezp and they only bite here.
          Mounted only while open, so every open starts from fresh state. */}
      {self && photoOpen && (
        <PhotoUploader
          open
          onClose={() => setPhotoOpen(false)}
          onDone={url => {
            setPhoto(url)
            afterSave('Profile photo updated.', url)
          }} />
      )}
    </div>
  )
}
