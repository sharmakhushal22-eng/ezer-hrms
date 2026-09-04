'use client'
// components/profile/Profile360.tsx — the ESS profile.
//
// Layout follows EZER-ESS-Profile-360.html; the colours are EZER's own (see
// profile.css). Everything it draws comes from get_employee_profile(), which
// has already decided what this viewer may read — so a field the payload does
// not carry is one this person is not allowed to see, and that is drawn as a
// statement rather than left blank.
//
// The distinction runs through the whole file and is the thing most worth
// preserving in an edit:
//
//   key missing from the payload  ->  "Restricted"    (not yours to see)
//   key present but null/empty    ->  "—"             (nobody has filled it in)
//
// Collapsing those two is how a screen ends up telling somebody their PAN is
// blank when in fact it is simply none of their business.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { TABS, MODEL, FIELD_TABS, RECORD_CARDS, CARD_COLUMNS } from '@/lib/profile/model'
import { maySee, type ProfileField, type ProfilePayload, type Row, type TabId } from '@/lib/profile/types'
import { loadProfile, editField, requestChange } from '@/lib/profile/client'
import '@/components/profile/profile.css'

const val = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

/** Dates arrive as ISO. Nobody reads 1994-03-19 as quickly as 19 Mar 1994. */
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
  k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
   .replace(/\bNo\b/, 'No.').replace(/\bDob\b/, 'Date of birth')

// ── one field ────────────────────────────────────────────────────────────
function Field({ f, payload, onAct }: {
  f: ProfileField
  payload: ProfilePayload
  onAct: (f: ProfileField) => void
}) {
  const [shown, setShown] = useState(false)
  const emp = payload.employee
  const allowed = maySee(payload.viewer_role, f.min)
  const present = Object.prototype.hasOwnProperty.call(emp, f.key)

  let body: React.ReactNode
  if (!allowed || !present) {
    // The RPC strips what you may not read, so an absent key means the same
    // thing as failing the client-side check — say so either way.
    body = <span className="no">Restricted — not visible to you</span>
  } else {
    const raw = emp[f.key]
    const text = f.key.includes('ctc') || f.key.includes('gross') ? money(raw) : pretty(raw)
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

// ── a record card ────────────────────────────────────────────────────────
function RecordCard({ title, rows, columns, empty }: {
  title: string; rows: Row[]; columns: string[]; empty: string
}) {
  return (
    <div className="pcard">
      <h3>{title}</h3>
      {!rows.length ? <div className="empty">{empty}</div> : (
        <div className="tbl">
          <table>
            <thead><tr>{columns.map(c => <th key={c}>{titleise(c)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={String(r.id ?? i)}>
                  {columns.map(c => (
                    <td key={c}>
                      {c.includes('sum_insured') || c.includes('amount')
                        ? money(r[c]) : pretty(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── the change modal ─────────────────────────────────────────────────────
function ChangeModal({ field, onClose, onDone }: {
  field: ProfileField
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const direct = field.state === 'direct'

  const submit = async () => {
    setBusy(true); setErr(null)
    const r = direct
      ? await editField(field.key, value)
      : await requestChange(field.key, value, reason)
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    onDone(direct ? `${field.label} saved.` : `Sent to HR. They will review it.`)
  }

  return (
    <div className="scrim" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>{direct ? `Edit ${field.label}` : `Request a change to ${field.label}`}</h3>
        <div className="sub">
          {direct
            ? 'This saves straight away.'
            : 'This does not change anything yet — HR sees the request and decides.'}
        </div>

        <label htmlFor="pv">New value</label>
        <input id="pv" value={value} onChange={e => setValue(e.target.value)} autoFocus />

        {!direct && (
          <>
            <label htmlFor="pr">Reason</label>
            <textarea id="pr" value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Why is this changing? HR reads this." />
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

// ── the page ─────────────────────────────────────────────────────────────
export default function Profile360({ code }: { code?: string }) {
  const [payload, setPayload] = useState<ProfilePayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [editing, setEditing] = useState<ProfileField | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await loadProfile(code)
    if (r.error) { setErr(r.error.message); setPayload(null); return }
    setErr(null); setPayload(r.data)
  }, [code])

  useEffect(() => { load() }, [load])

  const cardsFor = useMemo(
    () => (t: TabId) => RECORD_CARDS.filter(c => c.tab === t), [])

  if (err) {
    return <div className="ezp"><div className="pcard"><div className="note bad">{err}</div></div></div>
  }
  if (!payload) {
    return <div className="ezp"><div className="pcard"><div className="empty">Loading…</div></div></div>
  }

  const emp = payload.employee
  const initials = String(emp.full_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const groups = MODEL[tab] ?? []
  const cards = cardsFor(tab)

  return (
    <div className="ezp">
      {flash && <div className="note good" role="status">{flash}</div>}

      {/* Identity, always on screen — the tabs change beneath it. */}
      <div className="pcard">
        <div className="who">
          <div className="av">{initials}</div>
          <div style={{ minWidth: 0 }}>
            <h2>{val(emp.full_name)}</h2>
            <div className="role">
              {val(emp.designation)}
              {emp.department_name ? ` · ${val(emp.department_name)}` : ''}
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="pill brand">{val(emp.employee_code)}</span>
              <span className="pill">{val(emp.status)}</span>
              {payload.viewer_role !== 'self' && (
                <span className="pill">Viewing as {payload.viewer_role}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="ptabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id}
                  className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="pcard">
            <h3>Profile completeness</h3>
            <div className="sub">{payload.completeness.score}% complete</div>
            <div className="meter"><i style={{ width: `${payload.completeness.score}%` }} /></div>
            {payload.completeness.pending?.length > 0 && (
              <ul className="todo">
                {payload.completeness.pending.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}
          </div>

          <div className="pcard">
            <h3>Reporting chain</h3>
            <div className="grid g3">
              {([['Reporting manager', 'rm_l1_name'], ['Second level', 'rm_l2_name'],
                 ['Head of department', 'hod_name'], ['Managing director', 'md_name']] as const)
                .filter(([, k]) => emp[k])
                .map(([label, k]) => (
                  <div className="fld" key={k}>
                    <div className="k">{label}</div>
                    <div className="v">{val(emp[k])}</div>
                  </div>
                ))}
              <div className="fld">
                <div className="k">Reportees</div>
                <div className="v">{val(emp.reportee_count)}</div>
              </div>
            </div>
          </div>

          <div className="pcard">
            <h3>What the chips mean</h3>
            <div className="legend">
              <span><i style={{ background: 'var(--ez-muted)' }} />Locked — owned by HR or payroll</span>
              <span><i style={{ background: 'var(--ez-positive)' }} />Direct — you can change it yourself</span>
              <span><i style={{ background: 'var(--ez-warning)' }} />Request — HR approves it</span>
              <span><i style={{ background: 'var(--ez-info)' }} />Event — opens a longer process</span>
            </div>
          </div>
        </>
      )}

      {FIELD_TABS.includes(tab) && groups.map(g => (
        <div className="pcard" key={g.title}>
          <h3>{g.title}</h3>
          <div className="grid g3">
            {g.fields.map(f => (
              <Field key={f.key} f={f} payload={payload} onAct={setEditing} />
            ))}
          </div>
        </div>
      ))}

      {cards.map(c => (
        <RecordCard key={c.key as string} title={c.title}
                    rows={(payload[c.key as keyof ProfilePayload] as Row[]) ?? []}
                    columns={CARD_COLUMNS[c.key as string] ?? []}
                    empty={c.empty} />
      ))}

      {tab === 'time' && (
        <div className="pcard">
          <h3>Time & Leave</h3>
          <div className="empty">
            Attendance and leave balances live in the Time section of ESS, which owns
            them. This tab is here so the profile does not look as though it is missing
            something it never held.
          </div>
        </div>
      )}

      {editing && (
        <ChangeModal field={editing} onClose={() => setEditing(null)}
                     onDone={msg => { setEditing(null); setFlash(msg); load()
                                      setTimeout(() => setFlash(null), 4000) }} />
      )}
    </div>
  )
}
