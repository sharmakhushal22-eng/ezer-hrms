'use client'
// components/profile/Profile360.tsx — the ESS profile.
//
// Follows EZER-ESS-Profile-360.html's layout, measured off the rendered
// design rather than inferred from its source:
//
//   a gradient cover with the identity card overlapping its lower edge
//   a KPI strip, each stat with a mini bar
//   a two-column shell — a 296px rail beside the tab panels
//   the rail holds the completeness ring, the reporting chain, the ID card
//   the tabs sit in their own rounded container with the legend beneath
//
// Three things the field card does NOT have, because the design does not:
// a filled pill for the state (plain coloured text at the top right), the
// source column printed underneath, and a per-field button. Editing is
// reached by clicking the card itself, and from "Edit profile" / "Request an
// update" on the identity card — which is why those exist there.
//
// WHERE IT DEPARTS, AND WHY
//
// The mockup carries its own data. Attendance percentages, the seven-day
// punch chart, leave balances and the salary head table read from modules
// this payload does not include. They are not faked: the KPI strip shows the
// four stats that are real, and the tabs that would hold the rest say which
// part of ESS owns them.
//
// The distinction the whole file turns on:
//
//   key MISSING from the payload  ->  "Restricted"  (not yours to see)
//   key present but null/empty    ->  "—"           (nobody filled it in)

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { TABS, MODEL, RECORD_CARDS, CARD_COLUMNS } from '@/lib/profile/model'
import ChangeRequests from '@/components/profile/ChangeRequests'
import { maySee, type ProfileField, type ProfilePayload, type Row, type TabId } from '@/lib/profile/types'
import { loadProfile, editField, requestChange, setProfileOwner } from '@/lib/profile/client'
import IdCard from '@/components/profile/IdCard'
import PhotoUploader from '@/components/profile/PhotoUploader'
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
  return Number.isFinite(n) ? '₹' + n.toLocaleString('en-IN') : val(v)
}
const titleise = (k: string) =>
  k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bNo\b/, 'No.')
const ini = (n: unknown) =>
  String(n || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()

/** Where a change actually goes, and what it sets off. The design puts this in
 *  the modal and it is the most useful thing on it: somebody changing an IFSC
 *  should read that it reaches Payroll and lands in the next salary batch. */
function routeNote(key: string): string {
  if (/^bank|ifsc/.test(key))
    return 'Goes to Payroll, not HR. It applies from the next salary batch, and they may ask for a cancelled cheque in the same name.'
  if (/address/.test(key))
    return 'Goes to HR. An address change also moves your Professional Tax state and HRA exemption from the next payroll month.'
  if (/marital|spouse/.test(key))
    return 'Goes to HR. It opens the family, nominee and insurance steps behind it — a nomination must total exactly 100% before it can be filed.'
  if (/passport/.test(key))
    return 'Goes to HR. Passport details are readable only by HR and Payroll.'
  return 'Goes to HR. You will see the outcome in your change history.'
}

// ── field ────────────────────────────────────────────────────────────────
function Field({ f, payload, onAct }: {
  f: ProfileField; payload: ProfilePayload; onAct: (f: ProfileField) => void
}) {
  const [shown, setShown] = useState(false)
  const emp = payload.employee
  const allowed = maySee(payload.viewer_role, f.min)
  const present = Object.prototype.hasOwnProperty.call(emp, f.key)
  const actionable = allowed && present && payload.viewer_role === 'self' && f.state !== 'locked'

  let body: React.ReactNode
  if (!allowed || !present) {
    body = <span className="no">Restricted</span>
  } else {
    const raw = emp[f.key]
    const text = /ctc|gross/.test(f.key) ? money(raw) : pretty(raw)
    body = f.mask && !shown && text !== '—'
      ? <>
          <span className="msk">{'•'.repeat(Math.min(12, Math.max(4, text.length)))}</span>
          <button className="eye" onClick={e => { e.stopPropagation(); setShown(true) }}>Reveal</button>
        </>
      : <>{text}{f.mask && shown &&
          <button className="eye" onClick={e => { e.stopPropagation(); setShown(false) }}>Hide</button>}</>
  }

  return (
    <div className={`fld${f.wide ? ' span2' : ''}${actionable ? ' act' : ''}`}
         onClick={actionable ? () => onAct(f) : undefined}
         title={actionable ? (f.state === 'direct' ? 'Click to edit' : 'Click to request a change') : undefined}>
      <span className={`st ${f.state}`}>
        {f.state.charAt(0).toUpperCase() + f.state.slice(1)}
      </span>
      <div className="k">{f.label}</div>
      <div className={`v${f.mono ? ' mono' : ''}`}>{body}</div>
      {f.hint && <div className="hint">{f.hint}</div>}
    </div>
  )
}

const Card = ({ title, sub, right, children }: {
  title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode
}) => (
  <div className="card">
    {(title || right) && (
      <div className="hd">
        <div>{title && <h3>{title}</h3>}{sub && <div className="sub">{sub}</div>}</div>
        {right}
      </div>
    )}
    {children}
  </div>
)

const Section = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <section className="sec">
    <h4>{title}</h4>
    {sub && <div className="sub">{sub}</div>}
    {children}
  </section>
)

/** A block this profile genuinely does not hold. Named rather than left blank
 *  — "lives in Time & Attendance" is an answer; an empty panel is a bug
 *  report waiting to happen. */
const Elsewhere = ({ title, owner }: { title: string; owner: string }) => (
  <Section title={title}>
    <div className="card"><div className="empty">
      Kept in {owner}, which owns it. Named here so the profile does not look as though
      it is missing something it never held.
    </div></div>
  </Section>
)

function Ring({ pc }: { pc: number }) {
  const r = 32, c = 2 * Math.PI * r
  return (
    <div className="ez-ring">
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="8" stroke="var(--ez-sunken)" />
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="8" stroke="var(--ez-brand)"
                strokeLinecap="round" strokeDasharray={`${c * Math.max(0, Math.min(100, pc)) / 100} ${c}`} />
      </svg>
      <div className="mid"><div><div className="num">{pc}%</div><div className="cap">complete</div></div></div>
    </div>
  )
}

// ── record table ─────────────────────────────────────────────────────────
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

// ── modal ────────────────────────────────────────────────────────────────
function ChangeModal({ field, onClose, onDone }: {
  field: ProfileField; onClose: () => void; onDone: (m: string) => void
}) {
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const direct = field.state === 'direct'

  const submit = async () => {
    setBusy(true); setErr(null)
    const r = direct ? await editField(field.key, value) : await requestChange(field.key, value, reason)
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    onDone(direct ? `${field.label} saved.` : 'Sent. You will see the outcome in your change history.')
  }

  return (
    <div className="scrim" role="dialog" aria-modal="true"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>{direct ? `Edit ${field.label}` : `Request a change to ${field.label}`}</h3>
        <div className="sub">{direct ? 'This saves straight away.'
                                     : 'Nothing changes yet — somebody reviews this first.'}</div>
        {!direct && <div className="note warn" style={{ marginTop: 10 }}>{routeNote(field.key)}</div>}

        <label htmlFor="pv">New value</label>
        <input id="pv" value={value} onChange={e => setValue(e.target.value)} autoFocus />

        {!direct && (<>
          <label htmlFor="pr">Reason</label>
          <textarea id="pr" value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Why is this changing? The approver reads this." />
        </>)}

        {field.hint && <div className="note warn" style={{ marginTop: 10 }}>{field.hint}</div>}
        {err && <div className="note bad" style={{ marginTop: 10 }}>{err}</div>}

        <div className="row">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !value.trim() || (!direct && !reason.trim())}
                  onClick={submit}>{busy ? 'Sending…' : direct ? 'Save' : 'Send request'}</button>
        </div>
      </div>
    </div>
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
  const [editing, setEditing] = useState<ProfileField | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  // Held locally so a freshly uploaded picture appears at once. The payload is
  // only refetched on mount, and waiting for that would make Save look inert.
  const [photo, setPhoto] = useState<string | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)

  const load = useCallback(async () => {
    if (initial) return
    setProfileOwner(employeeId ?? null)
    const r = await loadProfile(code)
    if (r.error) { setErr(r.error.message); setPayload(null); return }
    setErr(null); setPayload(r.data); setPhoto(r.data?.photoUrl ?? null)
  }, [code, employeeId, initial])
  useEffect(() => { load() }, [load])

  const cardsFor = useMemo(() => (t: TabId) => RECORD_CARDS.filter(c => c.tab === t), [])

  if (err) return <div className="ezp"><div className="card"><div className="note bad">{err}</div></div></div>
  if (!payload) return <div className="ezp"><div className="card"><div className="empty">Loading…</div></div></div>

  const emp = payload.employee
  // Identity, not positional role. viewer_role is 'hr' for an HR person on
  // their own profile, which used to hide their own ID card and photo button
  // from them. Falls back to the old test for a payload without the flag.
  const self = payload.isSelf ?? payload.viewer_role === 'self'
  const groups = MODEL[tab] ?? []
  const pending = payload.completeness.pending ?? []

  const chain = ([['rm_l1_name', 'Reporting Manager L1'], ['rm_l2_name', 'Reporting Manager L2'],
                  ['hod_name', 'Head of Department'], ['md_name', 'Managing Director']] as const)
                .filter(([k]) => emp[k])

  // Only the stats this payload can actually fill. The design also shows
  // attendance and leave balance; those live in other modules and are not
  // invented here.
  const kpis: { k: string; v: string; unit?: string; pc: number }[] = [
    { k: 'Tenure', v: String(emp.tenure_years ?? '—'), unit: 'yrs',
      pc: Math.min(100, (Number(emp.tenure_years) || 0) * 10) },
    { k: 'Profile score', v: String(payload.completeness.score), unit: '%',
      pc: payload.completeness.score },
    { k: 'Reportees', v: String(emp.reportee_count ?? 0), unit: 'people',
      pc: Math.min(100, (Number(emp.reportee_count) || 0) * 20) },
    { k: 'Open items', v: String(pending.length), unit: 'pending',
      pc: pending.length ? Math.min(100, pending.length * 20) : 0 },
  ]

  const firstRequestable = () => {
    for (const gs of Object.values(MODEL)) for (const g of gs ?? [])
      for (const f of g.fields) if (f.state === 'request') return f
    return null
  }

  return (
    <div className="ezp">
      {flash && <div className="note good" style={{ marginBottom: 12 }} role="status">{flash}</div>}

      {/* ── cover + identity ── */}
      <div className="cover">
        <div className="coveracts">
          <button onClick={() => setTab('records')}>Records</button>
          <button onClick={() => setTab('statutory')}>Digital ID</button>
          <button onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="idcard">
        {/* The avatar was initials and nothing else, with no way to set a
            picture — PhotoUploader existed but nothing rendered it. Your own
            profile gets an overlay button; a colleague's is just a face. */}
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
          <h2>{val(emp.full_name)}</h2>
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
            {emp.tenure_years !== undefined
              ? <span><span className="k">Tenure</span> {val(emp.tenure_years)}y {val(emp.tenure_months)}m</span> : null}
            {emp.workstation ? <span><span className="k">Seat</span> {val(emp.workstation)}</span> : null}
          </div>
        </div>
        {self && (
          <div className="idacts">
            <button className="btn" onClick={() => setTab('personal')}>Edit profile</button>
            <button className="btn ghost" onClick={() => { const f = firstRequestable(); if (f) setEditing(f) }}>
              Request an update
            </button>
            <button className="lnk" onClick={() => setTab('records')}>Change history</button>
          </div>
        )}
      </div>

      {/* ── KPI strip ── */}
      <div className="kpis">
        {kpis.map(s => (
          <div className="kpi" key={s.k}>
            <div className="k">{s.k}</div>
            <div className="v">{s.v}{s.unit && <small>{s.unit}</small>}</div>
            <div className="bar"><i style={{ width: `${s.pc}%` }} /></div>
          </div>
        ))}
      </div>

      {/* ── two columns ── */}
      <div className="shell">
        <aside className="rail">
          <Card title="Profile completeness"
                right={pending.length ? <span className="pill warn">{pending.length} pending</span> : null}>
            <div className="ringrow">
              <Ring pc={payload.completeness.score} />
              <p>Finishing these keeps payroll and statutory records clean.</p>
            </div>
            {pending.length > 0 && (
              <ul className="todo">
                {pending.map((p, i) => (
                  <li key={i}><i />{p}
                    <button className="fix" onClick={() => { const f = firstRequestable(); if (f) setEditing(f) }}>
                      Fix
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Reporting chain"
                right={<span className="sub">{val(emp.reportee_count)} reportees</span>}>
            {!chain.length ? <div className="empty">No reporting chain recorded.</div> : (
              <ul className="chain">
                {chain.map(([k, label]) => (
                  <li key={k}>
                    <span className="p">{ini(emp[k])}</span>
                    <div><div className="n">{val(emp[k])}</div><div className="r">{label}</div></div>
                  </li>
                ))}
                <li className="me">
                  <span className="p">{ini(emp.full_name)}</span>
                  <div>
                    <div className="n">{val(emp.full_name)}</div>
                    <div className="r">{self ? 'You' : 'Subject'} · {val(emp.designation)}</div>
                  </div>
                </li>
              </ul>
            )}
          </Card>

          {self ? (
            <IdCard
              name={val(emp.full_name)} designation={val(emp.designation)}
              company={val(emp.company_name)} code={val(emp.employee_code)}
              doj={emp.date_of_joining as string | null}
              blood={emp.blood_group as string | null}
              emergency={emp.emergency_contact_1 as string | null} />
          ) : (
            /* A colleague's gate code is not yours to mint, so their card is
               shown as a face and nothing more. */
            <div className="dig">
              <div className="brandline"><span className="mark">EZ</span>{val(emp.company_name)}</div>
              <div className="top">
                <div className="ph">{ini(emp.full_name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{val(emp.full_name)}</div>
                  <div className="ds">{val(emp.designation)}</div>
                </div>
              </div>
              <div className="note">A gate code can only be issued for your own card.</div>
            </div>
          )}
        </aside>

        <div className="main">
          <div className="tabwrap">
            <div className="tabs" role="tablist">
              {TABS.map(t => (
                <button key={t.id} role="tab" aria-selected={tab === t.id}
                        className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>

          <div className="legend">
            <span><b className="direct">Direct</b> — change it yourself</span>
            <span><b className="request">Request</b> — goes for approval</span>
            <span><b className="locked">Locked</b> — HR maintains it</span>
            <span><b className="event">Event</b> — starts another workflow</span>
          </div>

          {tab === 'overview' && (
            <>
              <Section title="At a glance" sub="The things you would otherwise open four screens to find.">
                <div className="g2">
                  <Card title="Coming up">
                    <ul className="chain">
                      {emp.date_of_joining ? (
                        <li><span className="p">🎉</span><div>
                          <div className="n">Work anniversary</div>
                          <div className="r">{pretty(emp.date_of_joining)} · {val(emp.tenure_years)} years</div>
                        </div></li>) : null}
                      {emp.date_of_birth ? (
                        <li><span className="p">🎂</span><div>
                          <div className="n">Birthday</div><div className="r">{pretty(emp.date_of_birth)}</div>
                        </div></li>) : null}
                      <li><span className="p">💰</span><div>
                        <div className="n">Payroll cut-off</div><div className="r">25th of every month</div>
                      </div></li>
                    </ul>
                  </Card>
                  <Card title="Employment">
                    <div className="g2">
                      {([['Employment type', val(emp.employment_type)],
                         ['Category', val(emp.employee_category)],
                         ['Notice period', emp.notice_period_days ? `${val(emp.notice_period_days)} days` : '—'],
                         ['Weekly off', val(emp.weekly_off)]] as const).map(([k, v]) => (
                        <div className="fld" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
                      ))}
                    </div>
                  </Card>
                </div>
              </Section>
              <Elsewhere title="Attendance and leave" owner="Time & Attendance and the Leave section of ESS" />
            </>
          )}

          {groups.map(g => (
            <Section title={g.title} key={g.title}>
              <div className="g3">
                {g.fields.map(f => <Field key={f.key} f={f} payload={payload} onAct={setEditing} />)}
              </div>
            </Section>
          ))}

          {tab === 'personal' && (
            <>
              <Section title="Family"
                       sub="A family member has to be verified before insurance or a nomination can point at them.">
                {!payload.family.length ? <div className="card"><div className="empty">No family members recorded.</div></div> : (
                  <div className="g2">
                    {payload.family.map((m, i) => (
                      <div className="pc" key={String(m.id ?? i)}>
                        <div className="ph">{ini(m.member_name)}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="n">{val(m.member_name)}</div>
                          <div className="s">{val(m.relation)}{m.date_of_birth ? ` · ${pretty(m.date_of_birth)}` : ''}</div>
                          <div className="pl">
                            {m.is_verified ? <span className="pill good">Verified</span>
                                           : <span className="pill warn">Proof pending</span>}
                            {m.is_insured ? <span className="pill brand">Insured</span>
                                          : <span className="pill">Not insured</span>}
                            {m.is_dependent ? <span className="pill">Dependent</span> : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Nominations"
                       sub="Each record is separate and must total exactly 100% before it can be filed.">
                {!payload.nominations.length
                  ? <div className="card"><div className="empty">No nominee recorded. PF and gratuity both need one.</div></div>
                  : (() => {
                      const by = new Map<string, Row[]>()
                      for (const n of payload.nominations) {
                        const k = String(n.scheme ?? 'Other')
                        by.set(k, [...(by.get(k) ?? []), n])
                      }
                      return (
                        <div className="g2">
                          {[...by.entries()].map(([scheme, rows]) => {
                            const total = rows.reduce((a, r) => a + (Number(r.share_percent) || 0), 0)
                            return (
                              <div className="nom" key={scheme}>
                                <div className="top">
                                  <div style={{ minWidth: 0 }}>
                                    <div className="n">{scheme}</div>
                                    <div className="s">
                                      {rows.map(r => `${val(r.nominee_name)} ${val(r.share_percent)}%`).join(' · ')}
                                    </div>
                                  </div>
                                  <span className={total === 100 ? 'pc100' : 'pcbad'}>{total}%</span>
                                </div>
                                <div className="meter"><i style={{ width: `${Math.min(100, total)}%` }} /></div>
                                <div className="foot">
                                  <span>{total === 100 ? 'Ready to file' : `Adds up to ${total}%, not 100%`}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
              </Section>

              <Section title="Insurance" sub="Enrolment is separate from adding a family member.">
                {!payload.insurance.length ? <div className="card"><div className="empty">No active policy recorded.</div></div> : (
                  <div className="g3">
                    {payload.insurance.map((p, i) => (
                      <div className="pc" key={String(p.id ?? i)}>
                        <div className="ph">🛡️</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="n">{val(p.policy_type)}</div>
                          <div className="s">{money(p.sum_insured)}</div>
                          <div className="pl">
                            {p.policy_name ? <span className="pill">{val(p.policy_name)}</span> : null}
                            {p.valid_to ? <span className="pill good">to {pretty(p.valid_to)}</span> : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}

          {tab === 'job' && (
            <Section title="Movement history" sub="What the employee record itself holds.">
              <div className="card">
                <ul className="chain">
                  {emp.confirmation_date ? (
                    <li><span className="p">✓</span><div>
                      <div className="n">Confirmed in service</div>
                      <div className="r">{pretty(emp.confirmation_date)} · probation closed</div>
                    </div></li>) : null}
                  {emp.date_of_joining ? (
                    <li><span className="p">→</span><div>
                      <div className="n">Joined {val(emp.company_name)}</div>
                      <div className="r">{pretty(emp.date_of_joining)} · {val(emp.designation)}</div>
                    </div></li>) : null}
                </ul>
                {!emp.date_of_joining && <div className="empty">No dates recorded.</div>}
              </div>
            </Section>
          )}

          {tab === 'statutory' && (
            <div className="note warn">
              Full PAN and passport are readable only by HR, Payroll and Admin. Everybody else
              sees the last four digits — in reports and exports too, not just on this screen.
            </div>
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
            ) : <Elsewhere title="Salary structure" owner="the Payroll section of ESS" />
          )}
          {tab === 'time' && <Elsewhere title="Attendance, punches and leave" owner="Time & Attendance" />}

          {tab === 'growth' && (
            <>
              <Section title="Performance" sub="From the PMS cycle, not entered here.">
                <div className="card">
                  {!payload.performance ? <div className="empty">No appraisal recorded yet.</div> : (
                    <div className="g3">
                      {([['Cycle', val((payload.performance.period as Row | null)?.period_name)],
                         ['Stage', val((payload.performance.period as Row | null)?.status)],
                         ['Rating', payload.performance.final_rating_code
                                      ? `${val(payload.performance.final_rating_code)} · ${val(payload.performance.final_rating)}`
                                      : 'Not finalised'],
                         ['Score', val(payload.performance.final_score)],
                         ['KRAs', val(payload.performance.kra_count)],
                         ['One to one', val(payload.performance.one_to_one_count)],
                         ['Acknowledged', payload.performance.employee_ack ? 'Yes' : 'Not yet'],
                         ['Finalised', pretty(payload.performance.finalised_at)]] as const)
                        .map(([k, v]) => (
                          <div className="fld" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
                        ))}
                    </div>
                  )}
                </div>
              </Section>

              <Section title="Recognition" sub="Shoutouts and awards from the Wall of Fame.">
                {!(payload.recognition ?? []).length
                  ? <div className="card"><div className="empty">Nothing on the wall yet.</div></div>
                  : (
                    <div className="g2">
                      {(payload.recognition ?? []).map((r, i) => (
                        <div className="pc" key={String(r.id ?? i)}>
                          <div className="ph">🏆</div>
                          <div style={{ minWidth: 0 }}>
                            <div className="n">{val(r.kind)}{r.cycle_label ? ` · ${val(r.cycle_label)}` : ''}</div>
                            <div className="s">{String(r.message ?? '').slice(0, 110) || '—'}</div>
                            <div className="pl">
                              <span className="pill">{pretty(r.created_at)}</span>
                              {r.badge_ref ? <span className="pill brand">{val(r.badge_ref)}</span> : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </Section>
            </>
          )}

          {tab === 'records' && (payload.app_access ?? []).length > 0 && (
            <Section title="Application access" sub="What this person can sign in to.">
              <div className="g3">
                {(payload.app_access ?? []).map((a, i) => (
                  <div className="fld" key={String(a.id ?? i)}>
                    <span className="st locked">Locked</span>
                    <div className="k">{val(a.app_name)}</div>
                    <div className="v">{val(a.access_role)}</div>
                    {a.granted_on ? <div className="hint" style={{ color: 'var(--ez-muted)' }}>
                      Since {pretty(a.granted_on)}</div> : null}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {cardsFor(tab).filter(c => c.key !== 'app_access').map(c => (
            <RecordTable key={c.key as string} title={c.title}
                         rows={(payload[c.key as keyof ProfilePayload] as Row[]) ?? []}
                         columns={CARD_COLUMNS[c.key as string] ?? []} empty={c.empty} />
          ))}
        </div>
      </div>

      {/* Below the shell rather than inside a panel: the 360 layout above is
          measured off the design and stays exactly as it is. Own profile only
          — a colleague's requests are not yours to read, and the queue that
          matters to an approver is on their own page. */}
      <ChangeRequests canSee={self} />

      {editing && (
        <ChangeModal field={editing} onClose={() => setEditing(null)}
                     onDone={m => { setEditing(null); setFlash(m); load()
                                    setTimeout(() => setFlash(null), 4500) }} />
      )}

      {/* Inside .ezp deliberately: PhotoUploader's classes are un-namespaced,
          so profile.css scopes them under .ezp and they only bite here. */}
      {self && (
        <PhotoUploader
          open={photoOpen}
          onClose={() => setPhotoOpen(false)}
          onDone={url => {
            setPhoto(url)
            setFlash('Profile photo updated.')
            setTimeout(() => setFlash(null), 4500)
          }} />
      )}
    </div>
  )
}
