'use client'
// components/funzone/PlayTogether.tsx — invite a colleague, answer an invite,
// and share a result.
//
// The invite is the whole feature from the employee's side: everything else
// follows from somebody saying yes. So this screen is mostly about making the
// state of an invite obvious — who it is waiting on, and how long is left on
// it — rather than about the games.
//
// 090 is not applied yet, so every read can come back PGRST205. That is a
// state to render, not an error to swallow.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { C, F, W, S, R } from '@/lib/ui'
import { LIVE_GAMES, gameByCode } from '@/lib/funzone/games'
import { canInvite, canAccept, canDecline, canCancel, effectiveStatus,
         minutesLeft, inboxOrder, STATUS_LABEL, inviteLine,
         INVITE_TTL_MINUTES, type Invite } from '@/lib/funzone/invite'
import LiveTicTacToe from './LiveTicTacToe'

const MISSING = 'PGRST205'
const nowIso = () => new Date().toISOString()

interface Colleague { id: string; name: string; code?: string | null }

export default function PlayTogether({ meId }: { meId: string }) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [people, setPeople] = useState<Colleague[]>([])
  const [ready, setReady] = useState<boolean | null>(null)
  const [game, setGame] = useState(LIVE_GAMES[0].code)
  const [who, setWho] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [live, setLive] = useState<
    { sessionId: string; hostId: string; opponent: string } | null>(null)
  // Re-render on a timer so the countdown on a pending invite actually counts
  // down, rather than sitting at the value it had when the page loaded.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    const r = await supabase.from('game_invites')
      .select('id,game_code,from_employee,to_employee,status,created_at,message,session_id')
      .or(`from_employee.eq.${meId},to_employee.eq.${meId}`)
      .order('created_at', { ascending: false }).limit(40)
    if (r.error) {
      setReady((r.error as { code?: string }).code !== MISSING)
      return
    }
    setReady(true)
    const rows = (r.data ?? []) as Record<string, unknown>[]
    const ids = [...new Set(rows.flatMap(x =>
      [String(x.from_employee), String(x.to_employee)]))].filter(i => i !== meId)
    const names = new Map<string, string>()
    if (ids.length) {
      const e = await supabase.from('employees').select('id,full_name').in('id', ids)
      for (const x of (e.data ?? []) as { id: string; full_name: string }[]) {
        names.set(x.id, x.full_name)
      }
    }
    setInvites(rows.map(x => ({
      id: String(x.id), gameCode: String(x.game_code),
      fromId: String(x.from_employee), fromName: names.get(String(x.from_employee)) ?? null,
      toId: String(x.to_employee), toName: names.get(String(x.to_employee)) ?? null,
      status: String(x.status) as Invite['status'],
      createdAt: String(x.created_at), message: (x.message as string) ?? null,
    })))
  }, [meId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    (async () => {
      const me = await supabase.from('employees').select('company_id').eq('id', meId).maybeSingle()
      const cid = (me.data as { company_id?: string } | null)?.company_id
      let q = supabase.from('employees').select('id,full_name,emp_code')
        .neq('id', meId).is('date_of_leaving', null).order('full_name').limit(300)
      if (cid) q = q.eq('company_id', cid)
      const r = await q
      setPeople(((r.data ?? []) as { id: string; full_name: string; emp_code: string }[])
        .map(x => ({ id: x.id, name: x.full_name, code: x.emp_code })))
    })()
  }, [meId])

  if (live) {
    return (
      <LiveTicTacToe sessionId={live.sessionId} meId={meId} hostId={live.hostId}
        opponentName={live.opponent} onExit={() => { setLive(null); load() }} />
    )
  }

  if (ready === false) {
    return (
      <div style={{ background: C.warningTint, border: `1px solid ${C.warning}`,
                    borderRadius: R.lg, padding: '16px 18px' }}>
        <div style={{ fontSize: F.body, fontWeight: W.bold, color: C.ink }}>
          Playing together is not switched on yet
        </div>
        <div style={{ fontSize: F.small, color: C.muted, marginTop: 8, lineHeight: 1.7 }}>
          The games all work on their own. Inviting somebody needs{' '}
          <code style={{ background: C.sunken, padding: '1px 6px', borderRadius: 6 }}>
            090_funzone_multiplayer.sql
          </code>, which is handed to Nayan rather than run from here.
        </div>
      </div>
    )
  }

  const now = nowIso()
  const verdict = canInvite(meId, who, game, {
    liveGames: LIVE_GAMES.map(g => g.code), existing: invites, now,
  })

  const send = async () => {
    setBusy(true); setErr(null)
    const me = await supabase.from('employees').select('company_id').eq('id', meId).maybeSingle()
    const r = await supabase.from('game_invites').insert({
      company_id: (me.data as { company_id?: string } | null)?.company_id,
      game_code: game, from_employee: meId, to_employee: who,
      message: note.trim() || null,
    })
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    setWho(''); setNote(''); load()
  }

  const accept = async (inv: Invite) => {
    setBusy(true); setErr(null)
    const r = await supabase.rpc('accept_game_invite', { p_invite: inv.id })
    setBusy(false)
    if (r.error) { setErr(r.error.message); load(); return }
    const d = r.data as { session_id?: string } | null
    if (d?.session_id) {
      setLive({ sessionId: d.session_id, hostId: inv.fromId,
                opponent: inv.fromName ?? 'your opponent' })
    }
  }

  const answer = async (inv: Invite, status: 'DECLINED' | 'CANCELLED') => {
    setBusy(true)
    await supabase.from('game_invites')
      .update({ status, answered_at: now }).eq('id', inv.id)
    setBusy(false); load()
  }

  return (
    <div style={{ display: 'grid', gap: S.md }}>
      <section style={{ background: C.surface, border: `1px solid ${C.line}`,
                        borderRadius: R.lg, padding: '16px 18px' }}>
        <h3 style={{ margin: 0, fontSize: F.body, fontWeight: W.bold, color: C.ink }}>
          Ask somebody to play
        </h3>
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3, marginBottom: 12 }}>
          They get it in their inbox. Invites last {INVITE_TTL_MINUTES} minutes — it is an
          offer to play now, not an appointment.
        </div>

        <div style={{ display: 'grid', gap: S.sm,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px,100%), 1fr))' }}>
          <label style={{ display: 'block' }}>
            <span style={lbl}>Game</span>
            <select value={game} onChange={e => setGame(e.target.value as typeof game)}
                    style={fld}>
              {LIVE_GAMES.map(g => <option key={g.code} value={g.code}>{g.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span style={lbl}>Who</span>
            <select value={who} onChange={e => setWho(e.target.value)} style={fld}>
              <option value="">Choose a colleague</option>
              {people.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span style={lbl}>Say something (optional)</span>
            <input value={note} onChange={e => setNote(e.target.value)} style={fld}
                   placeholder="Best of three?" />
          </label>
        </div>

        {who && !verdict.ok && (
          <div style={{ fontSize: F.micro, color: C.warning, marginTop: 8 }}>
            {verdict.because}
          </div>
        )}
        {err && <div style={{ fontSize: F.micro, color: C.critical, marginTop: 8 }}>{err}</div>}

        <button onClick={send} disabled={!who || !verdict.ok || busy}
          style={{ marginTop: 12, fontFamily: 'inherit', fontSize: F.small,
                   fontWeight: W.bold, padding: '9px 18px', borderRadius: R.sm,
                   border: 'none', cursor: who && verdict.ok ? 'pointer' : 'not-allowed',
                   background: who && verdict.ok ? C.brand : C.sunken,
                   color: who && verdict.ok ? C.onAccent : C.faint }}>
          {busy ? 'Sending…' : 'Send the invite'}
        </button>
      </section>

      <section style={{ background: C.surface, border: `1px solid ${C.line}`,
                        borderRadius: R.lg, padding: '16px 18px' }}>
        <h3 style={{ margin: 0, fontSize: F.body, fontWeight: W.bold, color: C.ink }}>
          Invites
        </h3>
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3, marginBottom: 12 }}>
          Waiting on you first.
        </div>

        {invites.length === 0 ? (
          <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.7 }}>
            Nothing yet. Send one above, and it appears in their inbox straight away.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {inboxOrder(invites, meId, now).map(inv => {
              const st = effectiveStatus(inv, now)
              const mine = inv.fromId === meId
              const g = gameByCode(inv.gameCode)
              const waiting = st === 'PENDING'
              return (
                <div key={inv.id}
                  style={{ border: `1px solid ${waiting && !mine ? C.brand : C.line}`,
                           background: waiting && !mine ? C.brandTint : C.surface,
                           borderRadius: R.sm, padding: '10px 13px',
                           display: 'flex', gap: 10, alignItems: 'center',
                           flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>
                      {mine
                        ? `You invited ${inv.toName ?? 'a colleague'} to ${g?.name ?? inv.gameCode}`
                        : inviteLine(inv, g?.name ?? inv.gameCode)}
                    </div>
                    <div style={{ fontSize: F.micro, color: C.muted, marginTop: 2 }}>
                      {waiting
                        ? `${STATUS_LABEL[st]} · ${minutesLeft(inv, now)} min left`
                        : STATUS_LABEL[st]}
                      {inv.message ? ` · “${inv.message}”` : ''}
                    </div>
                  </div>
                  {waiting && !mine && (
                    <>
                      <button onClick={() => accept(inv)}
                        disabled={busy || !canAccept(inv, meId, now).ok} style={btnGo}>
                        Play
                      </button>
                      <button onClick={() => answer(inv, 'DECLINED')}
                        disabled={busy || !canDecline(inv, meId, now).ok} style={btnQuiet}>
                        No thanks
                      </button>
                    </>
                  )}
                  {waiting && mine && (
                    <button onClick={() => answer(inv, 'CANCELLED')}
                      disabled={busy || !canCancel(inv, meId, now).ok} style={btnQuiet}>
                      Withdraw
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

const lbl: React.CSSProperties = {
  display: 'block', fontSize: F.micro, fontWeight: W.bold, color: C.inkSoft,
  textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5,
}
const fld: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: R.sm, fontSize: F.small,
  fontFamily: 'inherit', background: C.surface, color: C.ink,
  border: `1px solid ${C.line}`,
}
const btnGo: React.CSSProperties = {
  fontFamily: 'inherit', fontSize: F.tiny, fontWeight: W.bold, padding: '7px 14px',
  borderRadius: R.sm, border: 'none', background: C.brand, color: C.onAccent,
  cursor: 'pointer',
}
const btnQuiet: React.CSSProperties = {
  fontFamily: 'inherit', fontSize: F.tiny, fontWeight: W.semi, padding: '7px 12px',
  borderRadius: R.sm, border: `1px solid ${C.line}`, background: C.surface,
  color: C.muted, cursor: 'pointer',
}
