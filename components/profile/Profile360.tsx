'use client'
// components/profile/Profile360.tsx — the ESS profile.
//
// Follows EZER-ESS-Profile-360.html: the same eight tabs, the same field card
// with its state chip and source line, the same card blocks — At a glance,
// Family, Nominations with share meters, Insurance, Movement history, the
// statutory note — drawn in EZER's own tokens (see profile.css).
//
// WHERE IT DEPARTS FROM THE DESIGN, AND WHY
//
// The design file is a mockup with its own data. Several of its blocks read
// from modules this payload does not carry: attendance percentages, the last
// seven days of punches, leave balances, the salary head table. Those are not
// faked here. Each gets a card that says which part of ESS owns it, because a
// card that quietly shows nothing reads as broken, and one filled with
// plausible numbers is worse.
//
// The distinction that runs through the whole file:
//
//   key missing from the payload  ->  "Restricted"    (not yours to see)
//   key present but null/empty    ->  "—"             (nobody has filled it in)

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { TABS, MODEL, RECORD_CARDS, CARD_COLUMNS } from '@/lib/profile/model'
import { maySee, type ProfileField, type ProfilePayload, type Row, type TabId } from '@/lib/profile/types'
import { loadProfile, editField, requestChange } from '@/lib/profile/client'
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
const initials = (n: unknown) =>
  String(n || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

/** Where a change request actually goes, and what it sets off. The design
 *  shows this in the modal, and it is the most useful thing on it: somebody
 *  about to change their IFSC should know it reaches Payroll and lands in the
 *  next salary batch, not that a form was submitted. Mirrors the routing 101
 *  seeds into profile_field_config. */
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

  let body: React.ReactNode
  if (!allowed || !present) {
    body = <span className="no">Restricted — not visible to you</span>
  } else {
    const raw = emp[f.key]
    const text = /ctc|gross/.test(f.key) ? money(raw) : pretty(raw)
    body = f.mask && !shown && text !== '—'
      ? <>
          <span className="msk">{'•'.repeat(Math.min(12, Math.max(4, text.length)))}</span>
          <button className="eye" onClick={() => setShown(true)}>Reveal</button>
        </>
      : <>{text}{f.mask && shown && <button className="eye" onClick={() => setShown(false)}>Hide</button>}</>
  }

  const canAct = allowed && present && payload.viewer_role === 'self'
    && (f.state === 'direct' || f.state === 'request' || f.state === 'event')

  return (
    <div className={`fld${f.wide ? ' span2' : ''}`}>
      <span className={`st ${f.state}`}>{f.state}</span>
      <div className="k">{f.label}</div>
      <div className={`v${f.mono ? ' mono' : ''}`}>{body}</div>
      {f.hint && <div className="hint">{f.hint}</div>}
      <div className="src">{f.source}</div>
      {canAct && (
        <div className="fx">
          <button onClick={() => onAct(f)}>
            {f.state === 'direct' ? 'Edit' : f.state === 'event' ? 'Start' : 'Request'}
          </button>
        </div>
      )}
    </div>
  )
}

const Card = ({ title, sub, right, children }: {
  title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode
}) => (
  <div className="pcard">
    {(title || right) && (
      <div className="cardhd">
        <div>
          {title && <h3>{title}</h3>}
          {sub && <div className="sub">{sub}</div>}
        </div>
        {right}
      </div>
    )}
    {children}
  </div>
)

/** A card for something this profile genuinely does not hold. Named rather
 *  than left empty — "lives in Time & Attendance" is an answer; a blank panel
 *  is a bug report waiting to happen. */
const Elsewhere = ({ title, owner }: { title: string; owner: string }) => (
  <Card title={title}>
    <div className="empty">
      This is kept in {owner}, which owns it. It is named here so the profile does not
      look as though it is missing something it never held.
    </div>
  </Card>
)

const Meter = ({ pc }: { pc: number }) => (
  <div className="meter"><i style={{ width: `${Math.max(0, Math.min(100, pc))}%` }} /></div>
)

// ── record table ─────────────────────────────────────────────────────────
function RecordCard({ title, rows, columns, empty }: {
  title: string; rows: Row[]; columns: string[]; empty: string
}) {
  return (
    <Card title={title}>
      {!rows.length ? <div className="empty">{empty}</div> : (
        <div className="tbl">
          <table>
            <thead><tr>{columns.map(c => <th key={c}>{titleise(c)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={String(r.id ?? i)}>
                  {columns.map(c => (
                    <td key={c}>{/sum_insured|amount/.test(c) ? money(r[c]) : pretty(r[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

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
    const r = direct ? await editField(field.key, value)
                     : await requestChange(field.key, value, reason)
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    onDone(direct ? `${field.label} saved.` : 'Sent. You will see the outcome in your change history.')
  }

  return (
    <div className="scrim" role="dialog" aria-modal="true"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>{direct ? `Edit ${field.label}` : `Request a change to ${field.label}`}</h3>
        <div className="sub">
          {direct ? 'This saves straight away.'
                  : 'Nothing changes yet — somebody reviews this first.'}
        </div>

        {/* The route, not just "submitted". This is the design's best idea. */}
        {!direct && <div className="note warn">{routeNote(field.key)}</div>}

        <label htmlFor="pv">New value</label>
        <input id="pv" value={value} onChange={e => setValue(e.target.value)} autoFocus />

        {!direct && (
          <>
            <label htmlFor="pr">Reason</label>
            <textarea id="pr" value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Why is this changing? The approver reads this." />
          </>
        )}

        {field.hint && <div className="note warn">{field.hint}</div>}
        {err && <div className="note bad">{err}</div>}

        <div className="row">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !value.trim() || (!direct && !reason.trim())}
                  onClick={submit}>
            {busy ? 'Sending…' : direct ? 'Save' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── page ─────────────────────────────────────────────────────────────────
export default function Profile360({ code, initial }: {
  code?: string
  /** Preloaded payload. Only the dev harness passes this; in the product the
   *  component always fetches, so there is no path where a caller can inject
   *  a profile the server did not authorise. */
  initial?: ProfilePayload
}) {
  const [payload, setPayload] = useState<ProfilePayload | null>(initial ?? null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [editing, setEditing] = useState<ProfileField | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (initial) return                    // harness: nothing to fetch
    const r = await loadProfile(code)
    if (r.error) { setErr(r.error.message); setPayload(null); return }
    setErr(null); setPayload(r.data)
  }, [code, initial])
  useEffect(() => { load() }, [load])

  const cardsFor = useMemo(() => (t: TabId) => RECORD_CARDS.filter(c => c.tab === t), [])

  if (err) return <div className="ezp"><div className="pcard"><div className="note bad">{err}</div></div></div>
  if (!payload) return <div className="ezp"><div className="pcard"><div className="empty">Loading…</div></div></div>

  const emp = payload.employee
  const groups = MODEL[tab] ?? []
  const self = payload.viewer_role === 'self'
  const first = String(emp.full_name || '').split(' ')[0]

  // The chain, bottom-up, as the design draws it.
  const chain = ([
    ['rm_l1_name', 'Reporting manager'], ['rm_l2_name', 'Second level'],
    ['hod_name', 'Head of department'], ['md_name', 'Managing director'],
  ] as const).filter(([k]) => emp[k])

  return (
    <div className="ezp">
      {flash && <div className="note good" role="status">{flash}</div>}

      <div className="pcard">
        <div className="who">
          <div className="av">{initials(emp.full_name)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2>{val(emp.full_name)}</h2>
            <div className="role">
              {val(emp.designation)}{emp.department_name ? ` · ${val(emp.department_name)}` : ''}
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="pill brand">{val(emp.employee_code)}</span>
              <span className="pill">{val(emp.status)}</span>
              {emp.location_name ? <span className="pill">{val(emp.location_name)}</span> : null}
              {!self && <span className="pill">Viewing as {payload.viewer_role}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="ptabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
                  className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── Overview: "the things you would otherwise open four screens to find" ── */}
      {tab === 'overview' && (
        <>
          <div className="grid g2">
            <Card title="Profile completeness"
                  sub={`${payload.completeness.score}% — ${payload.completeness.pending.length} thing${payload.completeness.pending.length === 1 ? '' : 's'} outstanding`}>
              <Meter pc={payload.completeness.score} />
              {payload.completeness.pending.length > 0 && (
                <ul className="todo">
                  {payload.completeness.pending.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              )}
            </Card>

            <Card title="Team" sub={self ? 'Who you report to' : `Who ${first} reports to`}>
              {!chain.length ? <div className="empty">No reporting chain recorded.</div> : (
                <ul className="chain">
                  {chain.map(([k, label]) => (
                    <li key={k}>
                      <span className="p">{initials(emp[k])}</span>
                      <div><div className="n">{val(emp[k])}</div><div className="r">{label}</div></div>
                    </li>
                  ))}
                  <li className="self">
                    <span className="p">{initials(emp.full_name)}</span>
                    <div>
                      <div className="n">{self ? 'You' : val(emp.full_name)}</div>
                      <div className="r">{val(emp.reportee_count)} reportees</div>
                    </div>
                  </li>
                </ul>
              )}
            </Card>
          </div>

          <div className="grid g2">
            <Card title="Coming up">
              <ul className="feed">
                {emp.date_of_joining ? (
                  <li><span className="i">🎉</span><div>
                    <div className="t">Work anniversary</div>
                    <div className="s">{pretty(emp.date_of_joining)} · {val(emp.tenure_years)} years so far</div>
                  </div></li>
                ) : null}
                {emp.date_of_birth ? (
                  <li><span className="i">🎂</span><div>
                    <div className="t">Birthday</div><div className="s">{pretty(emp.date_of_birth)}</div>
                  </div></li>
                ) : null}
                <li><span className="i">💰</span><div>
                  <div className="t">Payroll cut-off</div><div className="s">25th of every month</div>
                </div></li>
              </ul>
            </Card>

            <Card title="At a glance">
              <div className="grid g2">
                {([['Tenure', `${val(emp.tenure_years)}y ${val(emp.tenure_months)}m`],
                   ['Employment type', val(emp.employment_type)],
                   ['Grade', val(emp.grade)],
                   ['Notice period', emp.notice_period_days ? `${val(emp.notice_period_days)} days` : '—']] as const)
                  .map(([k, v]) => (
                    <div className="fld" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
                  ))}
              </div>
            </Card>
          </div>

          <Card title="What the chips mean">
            <div className="legend">
              <span><i style={{ background: 'var(--ez-muted)' }} />Locked — owned by HR or payroll</span>
              <span><i style={{ background: 'var(--ez-positive)' }} />Direct — you can change it yourself</span>
              <span><i style={{ background: 'var(--ez-warning)' }} />Request — somebody approves it</span>
              <span><i style={{ background: 'var(--ez-info)' }} />Event — opens a longer process</span>
            </div>
          </Card>
        </>
      )}

      {/* ── field groups ── */}
      {groups.map(g => (
        <Card title={g.title} key={g.title}>
          <div className="grid g3">
            {g.fields.map(f => <Field key={f.key} f={f} payload={payload} onAct={setEditing} />)}
          </div>
        </Card>
      ))}

      {/* ── Personal: family, nominations, insurance as cards ── */}
      {tab === 'personal' && (
        <>
          <Card title="Family"
                sub="A family member has to be verified before insurance or a nomination can point at them.">
            {!payload.family.length ? <div className="empty">No family members recorded.</div> : (
              <div className="grid g2">
                {payload.family.map((m, i) => (
                  <div className="pc" key={String(m.id ?? i)}>
                    <div className="ph">{initials(m.member_name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="n">{val(m.member_name)}</div>
                      <div className="s">{val(m.relation)}{m.date_of_birth ? ` · ${pretty(m.date_of_birth)}` : ''}</div>
                      <div className="pl">
                        {m.is_dependent ? <span className="pill">Dependent</span> : null}
                        {m.is_insured ? <span className="pill brand">Insured</span> : null}
                        {m.is_verified ? <span className="pill">Verified</span>
                                       : <span className="pill">Unverified</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Nominations"
                sub="Each record is separate, and must total exactly 100% before it can be filed.">
            {!payload.nominations.length
              ? <div className="empty">No nominee recorded. PF and gratuity both need one.</div>
              : (() => {
                  // Grouped by scheme, because the 100% rule is per scheme —
                  // showing a flat list would hide the only thing that matters.
                  const bySch = new Map<string, Row[]>()
                  for (const n of payload.nominations) {
                    const k = String(n.scheme ?? 'Other')
                    bySch.set(k, [...(bySch.get(k) ?? []), n])
                  }
                  return [...bySch.entries()].map(([scheme, rows]) => {
                    const total = rows.reduce((a, r) => a + (Number(r.share_percent) || 0), 0)
                    return (
                      <div key={scheme} style={{ marginBottom: 14 }}>
                        <div className="mrow">
                          <b>{scheme}</b>
                          <span className={total === 100 ? 'pill brand' : 'pill'}>{total}%</span>
                        </div>
                        <Meter pc={total} />
                        <div className="sub" style={{ marginTop: 6 }}>
                          {rows.map(r => `${val(r.nominee_name)} (${val(r.relation)}) ${val(r.share_percent)}%`).join(' · ')}
                        </div>
                        {total !== 100 && (
                          <div className="note warn">
                            This adds up to {total}%, not 100%, so it cannot be filed yet.
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
          </Card>

          <Card title="Insurance" sub="Enrolment is separate from adding a family member.">
            {!payload.insurance.length ? <div className="empty">No active policy recorded.</div> : (
              <div className="grid g3">
                {payload.insurance.map((p, i) => (
                  <div className="pc" key={String(p.id ?? i)}>
                    <div className="ph">🛡️</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="n">{val(p.policy_type)}</div>
                      <div className="s">{val(p.policy_name)}</div>
                      <div className="pl">
                        <span className="pill">{money(p.sum_insured)}</span>
                        {p.valid_to ? <span className="pill">to {pretty(p.valid_to)}</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── Employment: movement history ── */}
      {tab === 'job' && (
        <Card title="Movement history" sub="Joining, confirmation and the changes this profile records.">
          <div className="tl">
            {([[emp.confirmation_date, 'Confirmed in service', 'Probation closed'],
               [emp.date_of_joining, `Joined ${val(emp.company_name)}`, val(emp.designation)]] as const)
              .filter(([w]) => w)
              .map(([w, t, s], i) => (
                <div className="it" key={i}>
                  <div className="w">{pretty(w)}</div>
                  <div className="t">{t}</div>
                  <div className="s">{s}</div>
                </div>
              ))}
          </div>
          {!emp.date_of_joining && <div className="empty">No dates recorded.</div>}
          <div className="sub" style={{ marginTop: 10 }}>
            Promotions and transfers are recorded by the Transfer module; this list shows
            what the employee record itself holds.
          </div>
        </Card>
      )}

      {/* ── Statutory: the masking note, verbatim in spirit from the design ── */}
      {tab === 'statutory' && (
        <div className="note warn">
          Full PAN and passport are readable only by HR, Payroll and Admin. Everybody else
          sees the last four digits — in reports and exports too, not just on this screen.
        </div>
      )}

      {tab === 'payroll' && (
        <Elsewhere title="Salary structure and payslips" owner="the Payroll section of ESS" />
      )}

      {tab === 'time' && (
        <>
          <Elsewhere title="Attendance and punches" owner="Time & Attendance" />
          <Elsewhere title="Leave balances" owner="the Leave section of ESS" />
        </>
      )}

      {cardsFor(tab).map(c => (
        <RecordCard key={c.key as string} title={c.title}
                    rows={(payload[c.key as keyof ProfilePayload] as Row[]) ?? []}
                    columns={CARD_COLUMNS[c.key as string] ?? []} empty={c.empty} />
      ))}

      {editing && (
        <ChangeModal field={editing} onClose={() => setEditing(null)}
                     onDone={m => { setEditing(null); setFlash(m); load()
                                    setTimeout(() => setFlash(null), 4500) }} />
      )}
    </div>
  )
}
