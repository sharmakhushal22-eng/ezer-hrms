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
import { listInvites, funzone } from '@/lib/funzone/client'
import { C, F, W, S, R } from '@/lib/ui'
import { LIVE_GAMES, gameByCode } from '@/lib/funzone/games'
import { canInvite, canAccept, canDecline, canCancel, effectiveStatus,
         minutesLeft, inboxOrder, STATUS_LABEL, inviteLine,
         INVITE_TTL_MINUTES, type Invite } from '@/lib/funzone/invite'
import LiveTicTacToe from './LiveTicTacToe'
import LiveMemoryMatch from './LiveMemoryMatch'
import LiveTrivia from './LiveTrivia'

const MISSING = 'PGRST205'
const nowIso = () => new Date().toISOString()

interface Colleague { id: string; name: string; code?: string | null }

export default function PlayTogether({ meId }: { meId: string }) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [people, setPeople] = useState<Colleague[]>([])
  const [query, setQuery] = useState('')
  /** Held separately from the search results, which are cleared on pick —
   *  otherwise the field would forget who it is addressed to. */
  const [chosen, setChosen] = useState<Colleague | null>(null)
  const [searching, setSearching] = useState(false)
  const [ready, setReady] = useState<boolean | null>(null)
  const [game, setGame] = useState(LIVE_GAMES[0].code)
  const [who, setWho] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [live, setLive] = useState<
    { sessionId: string; hostId: string; opponent: string
      gameCode: string; seed: number } | null>(null)
  // Re-render on a timer so the countdown on a pending invite actually counts
  // down, rather than sitting at the value it had when the page loaded.
  const [, tick] = useState(0)
  useEffect(() => {
    // It also REFETCHES now. This used to only bump the counter, so an invite
    // arriving while the tab was open never appeared — the page had to be
    // reloaded to see it. That, with the missing notification, is why invites
    // looked like they went nowhere.
    const t = setInterval(() => { tick(n => n + 1); load() }, 15_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    // One call. The route resolves who I am, reads both sides of the invite
    // list and resolves the names, so there is no second trip to employees.
    const r = await listInvites()
    if (r.error) { setReady(false); return }
    setReady(r.data?.installed !== false)
    setInvites(r.data?.invites ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  // Search, never browse. This used to pull up to 300 colleagues into a
  // dropdown the moment the tab opened — the whole company directory handed
  // to everybody, whether or not they had somebody in mind. Now you type at
  // least two characters of a name or an employee code and the server returns
  // at most ten matches.
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setPeople([]); setSearching(false); return }
    setSearching(true)
    // Debounced: a keystroke per request would fire one for every letter of a
    // name, and the answers could arrive out of order.
    const t = setTimeout(async () => {
      const r = await funzone<{ people: Colleague[] }>('search', { q: term })
      setSearching(false)
      setPeople(r.error ? [] : (r.data?.people ?? []))
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  if (live) {
    const shared = {
      sessionId: live.sessionId, seed: live.seed, meId, hostId: live.hostId,
      opponentName: live.opponent, onExit: () => { setLive(null); load() },
    }
    if (live.gameCode === 'mem')  return <LiveMemoryMatch {...shared} />
    if (live.gameCode === 'quiz') return <LiveTrivia {...shared} />
    return <LiveTicTacToe sessionId={shared.sessionId} meId={meId} hostId={live.hostId}
             opponentName={live.opponent} onExit={shared.onExit} />
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
    // The route files the invite AND notifies the recipient. The insert used
    // to happen right here, and nothing ever told the other person.
    const r = await funzone('send', { to: who, game, message: note.trim() || null })
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    // Clear the whole picker, not just the id — leaving the name behind
    // would suggest the next invite is already addressed.
    setWho(''); setChosen(null); setQuery(''); setPeople([]); setNote(''); load()
  }

  const accept = async (inv: Invite) => {
    setBusy(true); setErr(null)
    const r = await funzone<{ session?: { session_id?: string; seed?: number; game_code?: string } }>(
      'accept', { id: inv.id })
    setBusy(false)
    if (r.error) { setErr(r.error.message); load(); return }
    const d = r.data?.session
    if (d?.session_id) {
      setLive({ sessionId: d.session_id, hostId: inv.fromId,
                opponent: inv.fromName ?? 'your opponent',
                gameCode: d.game_code ?? inv.gameCode, seed: d.seed ?? 1 })
    }
    load()
  }

  const answer = async (inv: Invite, status: 'DECLINED' | 'CANCELLED') => {
    setBusy(true); setErr(null)
    // Was a bare UPDATE with no ownership test — anybody could decline
    // anybody's invite. The route checks who may decline and who may cancel.
    const r = await funzone('answer', { id: inv.id, status })
    setBusy(false)
    if (r.error) setErr(r.error.message)
    load()
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
            {/* Once somebody is chosen the search box is replaced by their
                name, so the field always shows who the invite is actually
                for rather than whatever was last typed. */}
            {who ? (
              <div style={{ ...fld, display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', gap: 8 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis',
                               whiteSpace: 'nowrap' }}>
                  {chosen ? `${chosen.name}${chosen.code ? ` (${chosen.code})` : ''}` : ''}
                </span>
                <button type="button"
                        onClick={() => { setWho(''); setChosen(null); setQuery(''); setPeople([]) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer',
                                 color: C.muted, fontSize: F.micro, padding: 0 }}>
                  change
                </button>
              </div>
            ) : (
              <input value={query} onChange={e => setQuery(e.target.value)}
                     placeholder="Name or employee code" style={fld}
                     aria-label="Search for a colleague by name or employee code" />
            )}
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
        {err && <div style={{ fontSize: F.micro, color: C.critical, marginTop: 8 }}>{err}</div>}        {/* Only rendered while searching. There is no idle state listing
            everybody — that is the point of the change. */}
        {!who && query.trim().length >= 2 && (
          <div style={{ marginTop: S.sm, border: `1px solid ${C.line}`,
                        borderRadius: R.md, overflow: 'hidden' }}>
            {searching && (
              <div style={{ padding: '8px 10px', fontSize: F.micro, color: C.muted }}>
                Searching…
              </div>
            )}
            {!searching && !people.length && (
              <div style={{ padding: '8px 10px', fontSize: F.micro, color: C.muted }}>
                Nobody matches “{query.trim()}”. Try a different spelling, or their employee code.
              </div>
            )}
            {!searching && people.map(pp => (
              <button key={pp.id} type="button"
                      onClick={() => { setWho(pp.id); setChosen(pp); setPeople([]) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left',
                               padding: '8px 10px', background: 'none', cursor: 'pointer',
                               border: 'none', borderTop: `1px solid ${C.line}`,
                               fontSize: F.micro, color: C.ink }}>
                <b>{pp.name}</b>
                {pp.code ? <span style={{ color: C.muted }}> · {pp.code}</span> : null}
              </button>
            ))}
          </div>
        )}



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
