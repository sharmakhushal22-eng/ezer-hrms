'use client'
// components/ess/Celebrations.tsx — today's birthdays and work anniversaries,
// with a button to actually wish somebody.
//
// This is the half of the notification feature people see. The bell shows what
// arrived; this is where a notification gets CREATED by one colleague for
// another, which is the case the catalogue document does not cover — it has
// BIRTHDAY and ANNIVERSARY, but both are system date-matches that tell you
// about your own day.
//
// Renders nothing at all when nobody is celebrating. An empty "No birthdays
// today" card every day is worse than no card.

import { useCallback, useEffect, useState } from 'react'
import { C, R, W } from '@/lib/ui'
import { essAuthHeaders } from '@/lib/ess-session-client'
import { supabase } from '@/lib/supabase'

/**
 * Both endpoints sit behind requireDashboardUser, which reads a Bearer token.
 * An ESS employee carries the ESS session; an admin previewing somebody's
 * portal carries a Supabase session instead, so fall back to that — otherwise
 * every call 401s and the strip silently does nothing.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const h = essAuthHeaders()
  if (h.Authorization) return h
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token
  return t ? { Authorization: `Bearer ${t}` } : {}
}

interface Celebrant {
  id: string; emp_code: string | null; full_name: string
  designation: string | null; dept_name: string | null
  years?: number; already_wished: boolean
}
interface Payload {
  birthdays: Celebrant[]
  anniversaries: Celebrant[]
  mine: { birthday: boolean; anniversary: boolean }
}

const initials = (n: string) =>
  n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

export default function Celebrations({ employeeId, onSent }: { employeeId: string; onSent?: () => void }) {
  const [data, setData] = useState<Payload | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/ess/celebrations?employee_id=${employeeId}`, { headers: await authHeaders() })
      if (!r.ok) return setData(null)
      setData(await r.json())
    } catch { setData(null) }
  }, [employeeId])

  useEffect(() => { load() }, [load])

  const wish = async (c: Celebrant, kind: 'BIRTHDAY' | 'ANNIVERSARY') => {
    setBusy(c.id)
    try {
      const r = await fetch('/api/ess/celebrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ to_employee_id: c.id, kind }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        // A wish to somebody with no ESS login is stored but unreadable. Say so
        // rather than showing the same tick as a delivered one.
        setNote(j.warning ? j.warning
          : j.duplicate ? `Already wished ${c.full_name.split(' ')[0]} today`
          : `Wish sent to ${c.full_name.split(' ')[0]}`)
        await load(); onSent?.()
      } else {
        setNote(j.error || 'Could not send that wish')
      }
    } catch {
      setNote('Could not send that wish')
    } finally {
      setBusy(null)
      setTimeout(() => setNote(null), 3000)
    }
  }

  if (!data) return null
  const { birthdays, anniversaries, mine } = data
  if (!birthdays.length && !anniversaries.length && !mine.birthday && !mine.anniversary) return null

  const Row = ({ c, kind }: { c: Celebrant; kind: 'BIRTHDAY' | 'ANNIVERSARY' }) => (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:`1px solid ${C.brandEdge}` }}>
      <div aria-hidden style={{ width:34, height:34, borderRadius:'50%', flexShrink:0, background:C.brandTint, color:C.brandDeep,
        display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:W.bold }}>
        {initials(c.full_name)}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {c.full_name}
          {kind === 'ANNIVERSARY' && c.years ? <span style={{ color:C.muted, fontWeight:500 }}> · {c.years} yr{c.years > 1 ? 's' : ''}</span> : null}
        </div>
        <div style={{ fontSize:11, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {/* Code included because names repeat — two active employees share
              the name "Sunita Kapoor". */}
          {[c.emp_code, c.designation, c.dept_name].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
      <button
        onClick={() => wish(c, kind)}
        disabled={c.already_wished || busy === c.id}
        style={{
          flexShrink:0, padding:'6px 12px', borderRadius:R.md, fontSize:12, fontWeight:600, fontFamily:'inherit',
          cursor: c.already_wished ? 'default' : 'pointer',
          border: c.already_wished ? `1px solid ${C.brandEdge}` : 'none',
          background: c.already_wished ? 'transparent' : C.brand,
          color: c.already_wished ? C.muted : C.onAccent,
          opacity: busy === c.id ? .6 : 1,
        }}>
        {c.already_wished ? 'Wished' : busy === c.id ? '…' : kind === 'BIRTHDAY' ? 'Wish' : 'Congratulate'}
      </button>
    </div>
  )

  return (
    <div style={{ background:C.surface, border:`1px solid ${C.brandEdge}`, borderRadius:14, padding:'14px 16px', marginBottom:16 }}>
      {(mine.birthday || mine.anniversary) && (
        <div style={{ background:C.brandTint, color:C.brandDeep, borderRadius:10, padding:'10px 12px', marginBottom:12, fontSize:13, fontWeight:600 }}>
          {mine.birthday ? '🎂 Happy birthday!' : '🌟 Happy work anniversary!'} From everyone at EZER.
        </div>
      )}

      {birthdays.length > 0 && (
        <>
          <div style={{ fontSize:12, fontWeight:W.bold, color:C.muted, letterSpacing:.3, textTransform:'uppercase', marginBottom:4 }}>
            🎂 Birthdays today
          </div>
          {birthdays.map(c => <Row key={c.id} c={c} kind="BIRTHDAY" />)}
        </>
      )}

      {anniversaries.length > 0 && (
        <>
          <div style={{ fontSize:12, fontWeight:W.bold, color:C.muted, letterSpacing:.3, textTransform:'uppercase', marginTop: birthdays.length ? 14 : 0, marginBottom:4 }}>
            🌟 Work anniversaries today
          </div>
          {anniversaries.map(c => <Row key={c.id} c={c} kind="ANNIVERSARY" />)}
        </>
      )}

      {note && <div style={{ marginTop:10, fontSize:12, color:C.brandDeep }}>{note}</div>}
    </div>
  )
}
