'use client'
// components/learning/room/Room.tsx — the webinar room, full screen inside EZER Learn.
//
// The stage on the left (Stage.tsx), chat, questions and polls on the right (Panel.tsx). The
// room is read from /api/lms/room/<id>, and kept current in two ways:
//
//   Realtime   the server broadcasts every new message, vote, poll and change of state on a
//              Supabase channel whose name only people allowed in the room are given. The
//              browser listens; it sends nothing there except emoji reactions.
//   Reloads    the whole room is read again every 30 seconds and whenever the tab comes back,
//              so anything that did not come from the server disappears and anything missed
//              arrives. If the channel cannot connect, the reload runs every 8 seconds instead.
//
// A learner's browser also sends a heartbeat every 45 seconds. The server counts the time on
// its own clock, and once the person has stayed for the session's share of it, records them
// as attended (lib/lms/room.ts).
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { lmsApi, LmsApiError } from '@/lib/lms/client'
import { supabase } from '@/lib/supabase'
import { linkProps, to } from '../app/router'
import { Skel, errorWords, plural } from '../shared'
import { GArrowLeft, GLive, GUsers } from '../glyphs'
import Stage from './Stage'
import Panel, { type Tab } from './Panel'
import { RCheck, RPin, RStop } from './icons'
import type { RoomData, RoomMsg, RoomPoll } from './types'
import '../live.css'
import './room.css'

const REACTIONS = ['👏', '❤️', '😂', '🎉', '👍', '🤯']
const BEAT_MS = 45_000
const RELOAD_MS = 30_000
const FALLBACK_MS = 8_000
/** Reactions leave the browser as one message at most this often, however fast someone taps. */
const REACT_BATCH_MS = 1500
const FLOATS_MAX = 40

const IST = 'Asia/Kolkata'
const whenWords = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })

type Unseen = Record<Tab, number>
interface Float { id: number; e: string; x: number; dx: number }

const PanelMemo = memo(Panel)

function upsertMsg(d: RoomData, m: RoomMsg): RoomData {
  const key = m.kind === 'CHAT' ? 'chat' : 'questions'
  const list = d[key]
  const i = list.findIndex(x => x.id === m.id)
  let next: RoomMsg[]
  if (m.hidden && !d.me.host) next = list.filter(x => x.id !== m.id)
  else if (i >= 0) {
    const old = list[i]
    // A broadcast carries no "mine", and no name on an anonymous question: keep what this viewer knew.
    next = list.map(x => (x.id === m.id ? { ...m, mine: old.mine || m.mine, author: d.me.host && old.anonymous ? old.author : m.author } : x))
  } else next = key === 'chat' ? [...list, m].slice(-200) : [...list, m]
  const pinned = d.pinned?.id === m.id ? (m.hidden ? null : { ...d.pinned, ...m, mine: d.pinned.mine }) : d.pinned
  return { ...d, [key]: next, pinned }
}

function upsertPoll(d: RoomData, p: RoomPoll): RoomData {
  const old = d.polls.find(x => x.id === p.id)
  const mine = old?.my_vote ?? p.my_vote ?? null
  // The running count is shown to the host, to someone who answered, and once a poll closes.
  const see = d.me.host || mine != null || p.status === 'CLOSED'
  const merged: RoomPoll = { ...p, my_vote: mine, counts: see ? (p.counts ?? old?.counts ?? null) : null }
  return { ...d, polls: old ? d.polls.map(x => (x.id === p.id ? merged : x)) : [merged, ...d.polls] }
}

function Attendance({ me }: { me: RoomData['me'] }) {
  if (me.attended) return <div className="lx-attend" data-done="1"><b><RCheck size={13} /> Attendance recorded</b><span>{me.attendance_by === 'ROOM' ? 'From your time in this room.' : 'Thank you for joining.'}</span></div>
  const pct = me.need_s ? Math.min(100, Math.round((me.room_seconds / me.need_s) * 100)) : 0
  return (
    <div className="lx-attend">
      <span><b className="lx-num">{Math.floor(me.room_seconds / 60)} min</b> in the room · stay {Math.ceil(me.need_s / 60)} min to count as attending</span>
      <span className="lx-lv-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Time towards attendance"><i style={{ width: `${pct}%` }} /></span>
    </div>
  )
}

export default function Room({ sessionId, onLeave }: { sessionId: string; onLeave: () => void }) {
  const [data, setData] = useState<RoomData | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('chat')
  const [unseen, setUnseen] = useState<Unseen>({ chat: 0, questions: 0, polls: 0 })
  const [rt, setRt] = useState<'connecting' | 'on' | 'off'>('connecting')
  const [skew, setSkew] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState('')
  const [floats, setFloats] = useState<Float[]>([])
  const dataRef = useRef<RoomData | null>(null)
  const tabRef = useRef<Tab>('chat')
  const chan = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const pending = useRef<Record<number, number>>({})
  const saidAt = useRef(0)
  const floatId = useRef(0)
  const hostReload = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { tabRef.current = tab }, [tab])

  const api = `/api/lms/room/${sessionId}`
  const load = useCallback(() => lmsApi<RoomData>(api).then(d => {
    setData(d); setErr('')
    setSkew(new Date(d.server_now).getTime() - Date.now())
  }).catch(e => setErr(errorWords(e) + (e instanceof LmsApiError && e.status === 404 ? ' It may have been removed, or you are not on its list.' : ''))), [api])
  useEffect(() => { void load() }, [load])

  /** Screen readers hear what changed, at most every few seconds. */
  const announce = useCallback((text: string) => {
    if (Date.now() - saidAt.current < 4000) return
    saidAt.current = Date.now(); setSay(text)
  }, [])

  const bump = useCallback((t: Tab) => { if (tabRef.current !== t) setUnseen(u => ({ ...u, [t]: u[t] + 1 })) }, [])
  const onTab = useCallback((t: Tab) => { setTab(t); setUnseen(u => ({ ...u, [t]: 0 })) }, [])

  const spawn = useCallback((idx: number, n = 1) => {
    const e = REACTIONS[idx]
    if (!e) return
    const add: Float[] = []
    for (let i = 0; i < Math.min(n, 6); i++) add.push({ id: ++floatId.current, e, x: 8 + Math.random() * 84, dx: Math.round((Math.random() - 0.5) * 80) })
    setFloats(f => [...f, ...add].slice(-FLOATS_MAX))
    const ids = new Set(add.map(a => a.id))
    setTimeout(() => setFloats(f => f.filter(x => !ids.has(x.id))), 2900)
  }, [])

  // ── Live updates ──
  const topic = data?.topic
  useEffect(() => {
    if (!topic) return
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => {
      const m = payload as RoomMsg
      const d = dataRef.current
      if (!d || !m?.id) return
      const isNew = ![...d.chat, ...d.questions].some(x => x.id === m.id)
      if (isNew && !m.hidden) {
        bump(m.kind === 'CHAT' ? 'chat' : 'questions')
        if (m.kind === 'QUESTION') announce(`New question from ${m.author}`)
      }
      setData(x => (x ? upsertMsg(x, m) : x))
    })
    ch.on('broadcast', { event: 'hide' }, ({ payload }) => {
      const id = (payload as { id?: string })?.id
      if (!id) return
      setData(d => {
        if (!d) return d
        const drop = (l: RoomMsg[]) => (d.me.host ? l.map(x => (x.id === id ? { ...x, hidden: true } : x)) : l.filter(x => x.id !== id))
        return { ...d, chat: drop(d.chat), questions: drop(d.questions), pinned: d.pinned?.id === id ? null : d.pinned }
      })
    })
    ch.on('broadcast', { event: 'poll' }, ({ payload }) => {
      const p = payload as RoomPoll
      const d = dataRef.current
      if (!d || !p?.id) return
      if (!d.polls.some(x => x.id === p.id)) { bump('polls'); announce(`New poll: ${p.question}`) }
      setData(x => (x ? upsertPoll(x, p) : x))
      // A poll that hides its results sends no count; the host's screen reads it instead.
      if (d.me.host && p.counts == null) {
        if (hostReload.current) clearTimeout(hostReload.current)
        hostReload.current = setTimeout(() => void load(), 1500)
      }
    })
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      const st = payload as Partial<RoomData['session']> & { pinned?: RoomMsg | null }
      setData(d => {
        if (!d || !st) return d
        if (st.phase && st.phase !== d.session.phase) announce(st.phase === 'live' ? 'The session is live.' : st.phase === 'ended' ? 'The session has ended.' : '')
        const { pinned, ...flags } = st
        return { ...d, session: { ...d.session, ...flags }, ...(pinned !== undefined ? { pinned } : {}) }
      })
    })
    ch.on('broadcast', { event: 'react' }, ({ payload }) => {
      // From other browsers, so trusted for nothing: known reactions only, a few at a time.
      const c = (payload as { c?: Record<string, number> })?.c
      if (!c || typeof c !== 'object') return
      for (const [k, v] of Object.entries(c).slice(0, REACTIONS.length)) {
        const idx = Number(k), n = Math.floor(Number(v))
        if (Number.isInteger(idx) && idx >= 0 && idx < REACTIONS.length && n > 0) spawn(idx, Math.min(n, 4))
      }
    })
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') setRt('on')
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRt('off')
    })
    chan.current = ch
    const giveUp = setTimeout(() => setRt(r => (r === 'connecting' ? 'off' : r)), 10_000)
    return () => { clearTimeout(giveUp); chan.current = null; void supabase.removeChannel(ch) }
  }, [topic, bump, announce, spawn, load])

  // The room read again: every half minute (every 8 s without the channel) and on coming back.
  useEffect(() => {
    if (!topic) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, rt === 'on' ? RELOAD_MS : FALLBACK_MS)
    const vis = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [topic, rt, load])

  // Reactions go out in batches.
  useEffect(() => {
    const t = setInterval(() => {
      const c = pending.current
      if (!Object.keys(c).length || !chan.current) return
      pending.current = {}
      void chan.current.send({ type: 'broadcast', event: 'react', payload: { c } })
    }, REACT_BATCH_MS)
    return () => clearInterval(t)
  }, [])
  const react = (idx: number) => { spawn(idx); pending.current[idx] = Math.min(9, (pending.current[idx] || 0) + 1) }

  // ── Heartbeat ── (the host runs the session; their time in the room is not attendance)
  const learner = !!data?.me.learner && !data.me.read_only && !data.me.host
  useEffect(() => {
    if (!learner) return
    let stopped = false
    const beat = () => lmsApi<{ viewers: number; room_seconds: number; need_s: number; attended: boolean }>(api, { action: 'beat' }).then(r => {
      if (stopped) return
      const was = dataRef.current?.me.attended
      if (r.attended && !was) announce('Your attendance is recorded.')
      setData(d => (d ? { ...d, viewers: r.viewers, me: { ...d.me, room_seconds: r.room_seconds, need_s: r.need_s, attended: r.attended || d.me.attended } } : d))
    }).catch(() => {})
    void beat()
    const t = setInterval(beat, BEAT_MS)
    return () => { stopped = true; clearInterval(t) }
  }, [learner, api, announce])

  // The clock: every second while counting down, otherwise every 15 seconds.
  const phase = data?.session.phase
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), phase === 'before' ? 1000 : 15_000)
    return () => clearInterval(t)
  }, [phase])
  const serverNow = now + skew
  // The start time arriving moves the room on by itself; the server confirms on the next read.
  const startsAt = data ? new Date(data.session.starts_at).getTime() : 0
  useEffect(() => { if (phase === 'before' && startsAt && serverNow >= startsAt) void load() }, [phase, startsAt, serverNow >= startsAt, load]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Acting ──
  const act = useCallback(async (body: Record<string, unknown>) => {
    // A host says so, so the server checks their rights on this call too (app/api/lms/room).
    const r: any = await lmsApi(api, dataRef.current?.me.host ? { ...body, as_host: true } : body)
    setData(d => {
      if (!d) return d
      let x = d
      if (r.message) x = upsertMsg(x, r.message)
      if (r.poll) x = upsertPoll(x, r.poll)
      if (r.session) x = { ...x, session: { ...x.session, ...r.session } }
      if ('pinned' in r) x = { ...x, pinned: r.pinned }
      if (body.action === 'vote' && typeof r.upvotes === 'number') {
        const id = String(body.message_id)
        x = { ...x, questions: x.questions.map(q => (q.id === id ? { ...q, upvotes: r.upvotes } : q)), my_votes: r.voted ? [...new Set([...x.my_votes, id])] : x.my_votes.filter(v => v !== id) }
      }
      return x
    })
    if (body.action === 'hide' || body.action === 'unhide' || body.action === 'pin') void load()
    return r
  }, [api, load])

  const host = async (action: 'go_live' | 'end') => {
    if (action === 'end' && !window.confirm('End the session for everyone? The stream stops showing and time in the room stops counting. You can go live again if you need to.')) return
    setBusy(true)
    try { await act({ action }) } catch (e) { window.alert(errorWords(e)) } finally { setBusy(false) }
  }

  if (!data) {
    return (
      <div className="lx-room">
        <div className="lx-room-bar"><button className="lx-btn lx-btn--sm" onClick={onLeave}><GArrowLeft size={15} /> Leave</button></div>
        {err ? (
          <div className="lx-empty" style={{ margin: 24 }}>
            <h3>The room could not open</h3><p>{err}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}><button className="lx-btn lx-btn--primary" onClick={() => void load()}>Try again</button><button className="lx-btn" onClick={onLeave}>Leave</button></div>
          </div>
        ) : <div className="lx-room-body"><Skel h={420} r={16} /><Skel h={420} r={16} /></div>}
      </div>
    )
  }

  const s = data.session
  const me = data.me
  return (
    <div className="lx-room">
      <header className="lx-room-bar">
        <button className="lx-btn lx-btn--sm" onClick={onLeave} aria-label="Leave the room"><GArrowLeft size={15} /> <span className="lx-hide-narrow">Leave</span></button>
        <div className="lx-room-title">
          <b>{s.title}</b>
          <span>{[s.host_name && `Hosted by ${s.host_name}`, `${whenWords(s.starts_at)} IST`, s.course_title && `Part of ${s.course_title}`].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="lx-room-acts">
          {s.phase === 'live' && <span className="lx-tag lx-tag--critical"><span className="lx-live-dot" /> Live</span>}
          {s.phase === 'ended' && <span className="lx-tag">Ended</span>}
          <span className="lx-room-viewers" title={rt === 'on' ? 'Live updates on' : 'Refreshing every few seconds'}><GUsers size={15} /> {plural(data.viewers, 'watching', 'watching')}</span>
          {me.host && s.phase !== 'cancelled' && (s.phase === 'live'
            ? <button className="lx-btn lx-btn--sm" disabled={busy} onClick={() => void host('end')}><RStop size={14} /> End session</button>
            : <button className="lx-btn lx-btn--primary lx-btn--sm" disabled={busy} onClick={() => void host('go_live')}><GLive size={15} /> {s.phase === 'ended' ? 'Go live again' : 'Go live'}</button>)}
        </div>
      </header>

      <div className="lx-room-body">
        <div className="lx-room-main">
          <Stage data={data} now={serverNow} busy={busy} onGoLive={() => void host('go_live')}>
            <div className="lx-react-layer" aria-hidden>
              {floats.map(f => <span key={f.id} className="lx-react-float" style={{ left: `${f.x}%`, ['--dx' as string]: `${f.dx}px` }}>{f.e}</span>)}
            </div>
          </Stage>

          <div className="lx-room-under">
            {s.phase !== 'cancelled' && s.phase !== 'ended' && (
              <div className="lx-react-bar" role="group" aria-label="Send a reaction">
                {REACTIONS.map((e, i) => <button key={e} type="button" onClick={() => react(i)} aria-label={`React ${e}`}>{e}</button>)}
              </div>
            )}
            {me.learner && !me.read_only && !me.host && s.phase !== 'cancelled' && (s.phase !== 'ended' || me.attended) && <Attendance me={me} />}
          </div>

          {data.pinned && (
            <div className="lx-pin" role="note">
              <RPin size={16} />
              <div style={{ minWidth: 0 }}><b>Pinned · {data.pinned.author}</b><p>{data.pinned.body}</p></div>
            </div>
          )}

          {me.host && (
            <div className="lx-room-host">
              <b>You are hosting.</b>
              {data.checkin_code && <span>Attendance code <code>{data.checkin_code}</code></span>}
              <span style={{ color: 'var(--ez-muted)' }}>People also count as attending after staying {Math.ceil(me.need_s / 60)} min in this room.</span>
              <a className="lx-btn lx-btn--sm" style={{ marginLeft: 'auto' }} {...linkProps(to.studio('live', s.id))}>Register and settings</a>
            </div>
          )}

          {(s.description || s.location) && (
            <section className="lx-room-about" aria-label="About this session">
              <h1>About this session</h1>
              {s.description && <p>{s.description}</p>}
              {s.location && <p>Where: {s.location}</p>}
            </section>
          )}
        </div>

        <PanelMemo data={data} act={act} tab={tab} onTab={onTab} unseen={unseen} />
      </div>
      <div className="lx-sr" aria-live="polite" role="status">{say}</div>
    </div>
  )
}
