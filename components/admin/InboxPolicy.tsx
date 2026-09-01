'use client'
// components/admin/InboxPolicy.tsx — Admin Setup → Inbox.
//
// The ESS inbox ships reaching group-wide. That was agreed as a starting
// setting rather than a permanent one, on the condition HR could change it
// without a code change — which is why reach lives in inbox_policy, and why
// this panel exists at all.
//
// Written as its own file rather than a fourth section of admin/page.tsx,
// which is already 1,400 lines and carries type errors of its own.
//
// Every write goes to /api/admin/inbox, which re-checks the caller's roles
// server-side. Nothing here is load-bearing for security: hiding this panel
// from somebody who is not an HR admin is a courtesy, not the control.

import { useState, useEffect, useCallback } from 'react'
import { C as TK, W, R } from '@/lib/ui'

type Reach = 'GROUP' | 'COMPANY' | 'CHAIN_HR' | 'NO_COLD_UP'

/** Said in the words an HR user would use, not the words the column uses.
 *  The consequence line matters more than the name — "who can reach whom"
 *  is the decision being made, and the cost of getting it wrong is people
 *  quietly unable to ask a question. */
const REACH: { code: Reach; label: string; what: string; cost: string }[] = [
  { code: 'GROUP', label: 'Anyone in the group',
    what: 'Every active employee across all companies can message every other.',
    cost: 'Simplest to understand. A junior can write to anyone, including the MD.' },
  { code: 'COMPANY', label: 'Within their own company only',
    what: 'Sharma Retail talks to Sharma Retail. The three entities stay separate.',
    cost: 'Somebody working across two entities loses half their contacts.' },
  { code: 'CHAIN_HR', label: 'Reporting line and team only',
    what: 'Your manager, your skip, your reportees, and peers under the same manager.',
    cost: 'Tightest. Reaching a colleague in another team needs a desk instead.' },
  { code: 'NO_COLD_UP', label: 'Open, but no cold messages upward',
    what: 'As group-wide, except writing to someone two or more levels above you needs them to have written first.',
    cost: 'Keeps senior inboxes quiet without walling anyone off.' },
]

const card: React.CSSProperties = {
  background: TK.surface, borderRadius: R.lg, border: `1px solid ${TK.line}`,
  padding: 18, marginBottom: 16,
}
const h2: React.CSSProperties = {
  fontSize: 14, fontWeight: W.bold, color: TK.ink, marginBottom: 4,
}
const sub: React.CSSProperties = {
  fontSize: 12.5, color: TK.muted, marginBottom: 14, lineHeight: 1.6,
}
const btn = (primary = false): React.CSSProperties => ({
  height: 34, padding: '0 14px', borderRadius: R.md, cursor: 'pointer',
  fontSize: 13, fontWeight: W.semi, fontFamily: 'inherit',
  border: `1px solid ${primary ? TK.brandDeep : TK.lineStrong}`,
  background: primary ? `linear-gradient(180deg, ${TK.brand}, ${TK.brandDeep})` : TK.surface,
  color: primary ? TK.onAccent : TK.ink,
})

export default function InboxPolicy() {
  const [state, setState] = useState<'loading' | 'ready' | 'absent' | 'denied' | 'error'>('loading')
  const [reason, setReason] = useState('')
  const [pol, setPol] = useState<any>(null)
  const [roles, setRoles] = useState<any[]>([])
  const [overrides, setOverrides] = useState<any[]>([])
  const [desks, setDesks] = useState<any[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<any[]>([])
  const [staffing, setStaffing] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/inbox')
      const j = await r.json()
      if (r.status === 403) {
        setState('denied')
        setReason(j.holds?.length
          ? `You hold ${j.holds.join(', ')}. Changing who can message whom needs an HR admin role.`
          : 'Changing who can message whom needs an HR admin role.')
        return
      }
      if (!r.ok) { setState('error'); setReason(j.error || 'Could not load the policy.'); return }
      if (j.installed === false) { setState('absent'); setReason(j.reason || ''); return }
      setPol(j.policy); setRoles(j.roles || []); setOverrides(j.overrides || [])
      setDesks(j.desks || []); setDirty(false); setState('ready')
    } catch (e: any) { setState('error'); setReason(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true); setMsg('')
    try {
      const r = await fetch('/api/admin/inbox', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: pol }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(j.error || 'Not saved.'); return }
      setMsg('Saved. It applies to the next message anyone sends — nothing already open is affected.')
      setDirty(false); load()
    } finally { setSaving(false) }
  }

  const setOverride = async (role_id: string, reach_mode: string) => {
    await fetch('/api/admin/inbox', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ override: { role_id, reach_mode } }),
    })
    load()
  }

  const search = async (text: string) => {
    setQ(text)
    if (text.trim().length < 2) { setFound([]); return }
    const r = await fetch(`/api/admin/inbox?q=${encodeURIComponent(text)}`)
    const j = await r.json().catch(() => ({ people: [] }))
    setFound(j.people || [])
  }
  const staff = async (desk_code: string, employee_id: string, action: 'add' | 'remove') => {
    await fetch('/api/admin/inbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desk_code, employee_id, action }),
    })
    setQ(''); setFound([]); setStaffing(null); load()
  }

  if (state === 'loading') return <Wrap><div style={sub}>Loading…</div></Wrap>
  if (state === 'denied') return (
    <Wrap>
      <div style={card}>
        <div style={h2}>Inbox policy</div>
        <div style={sub}>{reason}</div>
      </div>
    </Wrap>
  )
  if (state === 'absent') return (
    <Wrap>
      <div style={card}>
        <div style={h2}>Not switched on yet</div>
        <div style={sub}>
          {reason} Until it runs there is no policy to edit, and the Inbox tab in
          ESS tells employees the same thing rather than showing a broken screen.
        </div>
      </div>
    </Wrap>
  )
  if (state === 'error') return (
    <Wrap><div style={{ ...card, color: TK.critical }}>{reason}</div></Wrap>
  )

  const ovr = (roleId: string) => overrides.find(o => o.role_id === roleId)?.reach_mode || ''
  const unstaffed = desks.filter(d => !d.agents?.length)

  return (
    <Wrap>
      {/* ── reach ─────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={h2}>Who can message whom</div>
        <div style={sub}>
          Applies to starting a NEW conversation. Nothing already open is closed
          by tightening this, because ending a conversation somebody is mid-way
          through would lose them the thread rather than protect anyone.
        </div>

        {REACH.map(r => {
          const on = pol?.reach_mode === r.code
          return (
            <label key={r.code} style={{
              display: 'flex', gap: 11, alignItems: 'flex-start', cursor: 'pointer',
              padding: 12, borderRadius: 10, marginBottom: 8,
              border: `1px solid ${on ? TK.brand : TK.line}`,
              background: on ? TK.brandTint : 'transparent',
            }}>
              <input type="radio" name="reach" checked={on} style={{ marginTop: 3 }}
                onChange={() => { setPol({ ...pol, reach_mode: r.code }); setDirty(true) }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: W.semi, color: TK.ink }}>
                  {r.label}
                </span>
                <span style={{ display: 'block', fontSize: 12.5, color: TK.inkSoft, marginTop: 2, lineHeight: 1.55 }}>
                  {r.what}
                </span>
                {/* The trade-off, said out loud. A settings screen that lists
                    only benefits makes the wrong choice easy. */}
                <span style={{ display: 'block', fontSize: 12, color: TK.muted, marginTop: 3, lineHeight: 1.5 }}>
                  {r.cost}
                </span>
              </span>
            </label>
          )
        })}

        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 14 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: TK.ink }}>
            <input type="checkbox" checked={!!pol?.allow_desk_threads}
              onChange={e => { setPol({ ...pol, allow_desk_threads: e.target.checked }); setDirty(true) }} />
            Allow messages to departments (HR, Payroll, IT)
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: TK.ink }}>
            <input type="checkbox" checked={!!pol?.allow_group_threads}
              onChange={e => { setPol({ ...pol, allow_group_threads: e.target.checked }); setDirty(true) }} />
            Allow group conversations
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: TK.ink }}>
            People in one conversation
            <input type="number" min={2} max={200} value={pol?.max_direct_members ?? 25}
              onChange={e => { setPol({ ...pol, max_direct_members: e.target.value }); setDirty(true) }}
              style={{ width: 70, height: 32, padding: '0 8px', borderRadius: 8,
                       border: `1px solid ${TK.lineStrong}`, background: TK.surface,
                       color: TK.ink, fontFamily: 'inherit', fontSize: 13 }} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
          <button onClick={save} disabled={!dirty || saving} style={{ ...btn(true), opacity: !dirty || saving ? .55 : 1 }}>
            {saving ? 'Saving…' : 'Save policy'}
          </button>
          {msg && <span style={{ fontSize: 12.5, color: TK.muted }}>{msg}</span>}
        </div>
      </div>

      {/* ── per-role exceptions ───────────────────────────────────── */}
      <div style={card}>
        <div style={h2}>Exceptions by role</div>
        <div style={sub}>
          A role listed here ignores the setting above. Use it to give HR org-wide
          reach while everyone else stays narrow — the widest of a person's roles
          wins, so adding one never takes reach away.
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {roles.map(r => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
              borderRadius: 8, border: `1px solid ${TK.line}`,
            }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: TK.ink }}>
                {r.role_name}
                <span style={{ color: TK.faint, fontSize: 11.5, marginLeft: 6,
                               fontFamily: 'ui-monospace, monospace' }}>{r.role_code}</span>
              </span>
              <select value={ovr(r.id)} onChange={e => setOverride(r.id, e.target.value)}
                style={{ height: 30, borderRadius: 7, border: `1px solid ${TK.lineStrong}`,
                         background: TK.surface, color: TK.ink, fontSize: 12.5,
                         fontFamily: 'inherit', padding: '0 7px' }}>
                <option value="">Use the setting above</option>
                {REACH.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}
              </select>
            </div>
          ))}
          {roles.length === 0 && <div style={sub}>No ESS roles are defined yet.</div>}
        </div>
      </div>

      {/* ── desks ─────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={h2}>Department desks</div>
        <div style={sub}>
          Who answers when an employee writes to a department. Membership takes
          effect immediately, including on conversations that are already open —
          a desk follows whoever staffs it today, not whoever staffed it when
          the thread started.
        </div>
        {unstaffed.length > 0 && (
          <div style={{
            fontSize: 12.5, color: TK.warning, background: TK.warningTint,
            border: `1px solid ${TK.warning}33`, borderRadius: 8,
            padding: '9px 11px', marginBottom: 12, lineHeight: 1.55,
          }}>
            {unstaffed.length === desks.length
              ? 'No desk has anyone assigned. Employees are told so before they write, but until somebody is added these desks cannot answer.'
              : `${unstaffed.map(d => d.label).join(', ')} ${unstaffed.length === 1 ? 'has' : 'have'} nobody assigned.`}
          </div>
        )}

        {desks.map(d => (
          <div key={d.id} style={{
            border: `1px solid ${TK.line}`, borderRadius: 10, padding: 12, marginBottom: 9,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0,
                             background: d.accent || TK.brand }} />
              <span style={{ fontSize: 13.5, fontWeight: W.semi, color: TK.ink }}>{d.label}</span>
              <span style={{ fontSize: 12, color: TK.muted, flex: 1, minWidth: 0 }}>{d.description}</span>
              <button onClick={() => { setStaffing(staffing === d.desk_code ? null : d.desk_code); setQ(''); setFound([]) }}
                style={btn()}>
                {staffing === d.desk_code ? 'Close' : 'Add someone'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(d.agents || []).map((a: any) => (
                <span key={a.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5,
                  padding: '5px 8px 5px 10px', borderRadius: 8,
                  background: TK.sunken, border: `1px solid ${TK.line}`, color: TK.ink,
                }}>
                  {a.name}
                  <span style={{ color: TK.faint, fontSize: 11 }}>{a.code}</span>
                  <button onClick={() => staff(d.desk_code, a.employee_id, 'remove')}
                    title="Remove from this desk"
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer',
                             color: TK.muted, fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
              {(d.agents || []).length === 0 && (
                <span style={{ fontSize: 12.5, color: TK.muted }}>Nobody assigned.</span>
              )}
            </div>

            {staffing === d.desk_code && (
              <div style={{ marginTop: 10 }}>
                <input value={q} onChange={e => search(e.target.value)} autoFocus
                  placeholder="Search a name or employee code…"
                  style={{ width: '100%', maxWidth: 340, height: 34, padding: '0 10px',
                           borderRadius: 8, border: `1px solid ${TK.lineStrong}`,
                           background: TK.surface, color: TK.ink, fontFamily: 'inherit', fontSize: 13 }} />
                <div style={{ marginTop: 6, display: 'grid', gap: 4, maxWidth: 340 }}>
                  {found.map(p => (
                    <button key={p.id} onClick={() => staff(d.desk_code, p.id, 'add')}
                      style={{ ...btn(), height: 'auto', padding: '7px 10px', textAlign: 'left',
                               justifyContent: 'flex-start' }}>
                      <span style={{ fontSize: 13, color: TK.ink }}>{p.full_name}</span>
                      <span style={{ fontSize: 11.5, color: TK.muted, marginLeft: 7 }}>
                        {[p.emp_code, p.designation].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  ))}
                  {q.trim().length >= 2 && found.length === 0 && (
                    <span style={{ fontSize: 12.5, color: TK.muted }}>Nobody matches that.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Wrap>
  )
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '18px 24px 40px', maxWidth: 940 }}>{children}</div>
}
