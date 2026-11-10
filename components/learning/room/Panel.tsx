'use client'
// components/learning/room/Panel.tsx — the right half of the webinar room: chat, questions and
// polls, each with what the host may do to it. Every button is a call to /api/lms/room/<id>; the
// room reloads what the server says, so nothing here decides who may do what.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { plural } from '../shared'
import { RAsk, RChat, RCheck, RHide, RPin, RPoll, RSend, RUp } from './icons'
import type { RoomData, RoomMsg, RoomPoll } from './types'

export type Tab = 'chat' | 'questions' | 'polls'
export type Act = (body: Record<string, unknown>) => Promise<any>

const CHAT_MAX = 500, QUESTION_MAX = 500
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()

/** Where people type. Enter sends, Shift+Enter starts a new line. */
function Composer({ label, placeholder, max, onSend, anon, off }: {
  label: string; placeholder: string; max: number; onSend: (text: string, anonymous: boolean) => Promise<void>
  anon?: boolean
  /** Why nothing can be written here, if so. */
  off?: string | null
}) {
  const [text, setText] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (off) return <div className="lx-compose"><div className="lx-compose-note">{off}</div></div>
  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    const t = text.trim()
    if (!t || busy) return
    setBusy(true); setErr('')
    try { await onSend(t, anonymous); setText('') } catch (x: any) { setErr(x?.message || 'That did not send.') } finally { setBusy(false) }
  }
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }
  return (
    <form className="lx-compose" onSubmit={send}>
      <div className="lx-compose-row">
        <textarea aria-label={label} placeholder={placeholder} value={text} maxLength={max} rows={1} onChange={e => setText(e.target.value)} onKeyDown={key} />
        <button className="lx-btn lx-btn--primary lx-btn--icon" type="submit" disabled={busy || !text.trim()} aria-label="Send"><RSend size={17} /></button>
      </div>
      <div className="lx-compose-meta">
        {anon ? <label><input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} /> Ask without my name</label> : <span>Enter to send · Shift+Enter for a new line</span>}
        <span className="lx-num">{text.length}/{max}</span>
      </div>
      {err && <div className="lx-compose-err" role="alert">{err}</div>}
    </form>
  )
}

function HostTools({ m, act, pinned }: { m: RoomMsg; act: Act; pinned: boolean }) {
  const [busy, setBusy] = useState(false)
  const run = (body: Record<string, unknown>) => async () => { setBusy(true); try { await act(body) } finally { setBusy(false) } }
  return (
    <div className="lx-msg-tools">
      {!m.hidden && <button className="lx-msg-tool" disabled={busy} onClick={run({ action: 'pin', message_id: pinned ? null : m.id })}><RPin size={12} /> {pinned ? 'Unpin' : 'Pin'}</button>}
      <button className="lx-msg-tool" disabled={busy} onClick={run({ action: m.hidden ? 'unhide' : 'hide', message_id: m.id })}><RHide size={12} /> {m.hidden ? 'Show again' : 'Hide'}</button>
    </div>
  )
}

// ── Chat ────────────────────────────────────────────────────────────────────
function Chat({ data, act }: { data: RoomData; act: Act }) {
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [behind, setBehind] = useState(false)
  const list = data.chat
  const last = list[list.length - 1]?.id
  // Follow the conversation while the reader is at the bottom; leave them where they are if
  // they scrolled up to read, and offer a way back down.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    if (stick.current) { el.scrollTop = el.scrollHeight; setBehind(false) } else setBehind(true)
  }, [last])
  const onScroll = () => {
    const el = box.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (stick.current) setBehind(false)
  }
  const s = data.session
  const off = !data.me.can_post ? (data.me.read_only ? 'You are viewing someone else’s portal.' : 'Only attendees can write here.')
    : !s.room_chat && !data.me.host ? 'The host has turned chat off.' : s.phase === 'cancelled' ? 'This session was cancelled.' : null
  return (
    <>
      <div ref={box} className="lx-feed" onScroll={onScroll} role="log" aria-label="Chat messages" aria-live="off">
        {!list.length && <div className="lx-feed-empty">No messages yet. Say hello, and keep questions for the host in Q&amp;A so they are not lost.</div>}
        {list.map(m => (
          <div key={m.id} className="lx-msg" data-host={m.is_host ? '1' : '0'} data-mine={m.mine ? '1' : '0'} data-hidden={m.hidden ? '1' : '0'}>
            <div className="lx-msg-head"><b>{m.mine ? 'You' : m.author}</b>{m.is_host && <span className="lx-tag lx-tag--brand" style={{ height: 18, fontSize: 10.5 }}>Host</span>}<span>{clock(m.created_at)}</span>{m.hidden && <span>· hidden</span>}</div>
            <div className="lx-msg-body">{m.body}</div>
            {data.me.host && <HostTools m={m} act={act} pinned={data.session.pinned_message_id === m.id} />}
          </div>
        ))}
        {behind && <button className="lx-feed-new" onClick={() => { stick.current = true; const el = box.current; if (el) el.scrollTop = el.scrollHeight; setBehind(false) }}>New messages ↓</button>}
      </div>
      <Composer label="Write a message" placeholder="Write to everyone…" max={CHAT_MAX} off={off} onSend={t => act({ action: 'chat', body: t })} />
    </>
  )
}

// ── Questions ───────────────────────────────────────────────────────────────
function AnswerBox({ m, act }: { m: RoomMsg; act: Act }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(m.answer || '')
  const [busy, setBusy] = useState(false)
  const run = async (body: Record<string, unknown>) => { setBusy(true); try { await act(body); setOpen(false) } finally { setBusy(false) } }
  if (m.answered_at && !open) {
    return (
      <div className="lx-msg-tools">
        <button className="lx-msg-tool" disabled={busy} onClick={() => setOpen(true)}>Edit answer</button>
        <button className="lx-msg-tool" disabled={busy} onClick={() => void run({ action: 'answer', message_id: m.id, undo: true })}>Mark unanswered</button>
      </div>
    )
  }
  if (!open) {
    return (
      <div className="lx-msg-tools">
        <button className="lx-msg-tool" disabled={busy} onClick={() => void run({ action: 'answer', message_id: m.id })}><RCheck size={12} /> Answered live</button>
        <button className="lx-msg-tool" disabled={busy} onClick={() => setOpen(true)}>Type an answer</button>
      </div>
    )
  }
  return (
    <form style={{ display: 'grid', gap: 6 }} onSubmit={e => { e.preventDefault(); void run({ action: 'answer', message_id: m.id, answer: text }) }}>
      <textarea className="lx-input" style={{ height: 70, padding: 8, fontSize: 13, resize: 'vertical' }} aria-label="Your answer" value={text} maxLength={1000} onChange={e => setText(e.target.value)} />
      <div className="lx-msg-tools"><button className="lx-msg-tool" type="submit" disabled={busy}>Save answer</button><button className="lx-msg-tool" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  )
}

function Question({ m, data, act, voted }: { m: RoomMsg; data: RoomData; act: Act; voted: boolean }) {
  const [busy, setBusy] = useState(false)
  const canVote = data.me.learner && !data.me.read_only && !m.hidden
  const vote = async () => { setBusy(true); try { await act({ action: 'vote', message_id: m.id, on: !voted }) } finally { setBusy(false) } }
  return (
    <div className="lx-q" data-answered={m.answered_at ? '1' : '0'} data-hidden={m.hidden ? '1' : '0'}>
      <button className="lx-vote" aria-pressed={voted} disabled={!canVote || busy} onClick={vote}
        aria-label={`${voted ? 'Remove your upvote' : 'Upvote'}: ${plural(m.upvotes, 'vote')}`} title={canVote ? (voted ? 'Remove your upvote' : 'Upvote this question') : plural(m.upvotes, 'vote')}>
        <RUp size={16} /><span>{m.upvotes}</span>
      </button>
      <div className="lx-msg" style={{ alignContent: 'start' }}>
        <div className="lx-msg-head">
          <b>{m.mine ? (m.anonymous ? 'You (without your name)' : 'You') : m.author}</b>
          {m.anonymous && data.me.host && <span>· asked without a name</span>}
          <span>{clock(m.created_at)}</span>
          {m.answered_at && <span className="lx-tag lx-tag--positive" style={{ height: 18, fontSize: 10.5 }}><RCheck size={10} /> Answered</span>}
          {m.hidden && <span>· hidden</span>}
        </div>
        <div className="lx-msg-body">{m.body}</div>
        {m.answer && <div className="lx-q-answer"><b>Host:</b> {m.answer}</div>}
        {data.me.host && <><AnswerBox m={m} act={act} /><HostTools m={m} act={act} pinned={data.session.pinned_message_id === m.id} /></>}
      </div>
    </div>
  )
}

function Questions({ data, act }: { data: RoomData; act: Act }) {
  const [order, setOrder] = useState<'top' | 'new'>('top')
  const voted = useMemo(() => new Set(data.my_votes), [data.my_votes])
  const list = useMemo(() => {
    const qs = [...data.questions]
    // Unanswered first either way: what still needs the host stays on top.
    return qs.sort((a, b) => (a.answered_at ? 1 : 0) - (b.answered_at ? 1 : 0)
      || (order === 'top' ? b.upvotes - a.upvotes : 0) || b.created_at.localeCompare(a.created_at))
  }, [data.questions, order])
  const s = data.session
  const off = data.me.host ? 'Attendees ask here; you answer, pin or hide from the list.' : !data.me.learner ? 'Only attendees can ask.'
    : data.me.read_only ? 'You are viewing someone else’s portal.'
    : !s.room_questions ? 'The host is not taking questions right now.' : s.phase === 'cancelled' ? 'This session was cancelled.' : null
  return (
    <>
      <div className="lx-feed" role="region" aria-label="Questions">
        <div className="lx-panel-tools">
          <span className="lx-num">{plural(data.questions.length, 'question')}{data.questions.some(q => q.answered_at) ? ` · ${data.questions.filter(q => q.answered_at).length} answered` : ''}</span>
          <div className="lx-tabs" role="tablist" aria-label="Order" style={{ padding: 2 }}>
            <button role="tab" aria-selected={order === 'top'} style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => setOrder('top')}>Top</button>
            <button role="tab" aria-selected={order === 'new'} style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => setOrder('new')}>Newest</button>
          </div>
        </div>
        {!list.length && <div className="lx-feed-empty">No questions yet. Ask one, or upvote the ones you want answered most.</div>}
        {list.map(m => <Question key={m.id} m={m} data={data} act={act} voted={voted.has(m.id)} />)}
      </div>
      <Composer label="Ask a question" placeholder="Ask the host a question…" max={QUESTION_MAX} anon off={off} onSend={(t, anonymous) => act({ action: 'ask', body: t, anonymous })} />
    </>
  )
}

// ── Polls ───────────────────────────────────────────────────────────────────
function NewPoll({ act, onDone }: { act: Act; onDone: () => void }) {
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState(['', ''])
  const [show, setShow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ready = q.trim() && opts.filter(o => o.trim()).length >= 2
  const launch = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await act({ action: 'poll', question: q, options: opts, show_results: show }); onDone() } catch (x: any) { setErr(x?.message || 'The poll did not start.') } finally { setBusy(false) }
  }
  return (
    <form className="lx-poll-new" onSubmit={launch}>
      <input className="lx-input" aria-label="Poll question" placeholder="Ask the room…" maxLength={300} value={q} onChange={e => setQ(e.target.value)} />
      {opts.map((o, i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <input className="lx-input" aria-label={`Answer ${i + 1}`} placeholder={`Answer ${i + 1}`} maxLength={120} value={o} onChange={e => setOpts(x => x.map((y, j) => (j === i ? e.target.value : y)))} />
          {opts.length > 2 && <button type="button" className="lx-msg-tool" style={{ height: 36 }} aria-label={`Remove answer ${i + 1}`} onClick={() => setOpts(x => x.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      <div className="lx-poll-foot">
        {opts.length < 6 ? <button type="button" className="lx-msg-tool" onClick={() => setOpts(x => [...x, ''])}>+ Add an answer</button> : <span>Up to 6 answers</span>}
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} style={{ accentColor: 'var(--ez-brand)' }} /> Show results to people who answer</label>
      </div>
      {err && <div className="lx-compose-err" role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="lx-btn lx-btn--primary lx-btn--sm" disabled={busy || !ready}>{busy ? 'Starting…' : 'Launch the poll'}</button>
        <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}

function Poll({ p, data, act }: { p: RoomPoll; data: RoomData; act: Act }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const host = data.me.host
  const canVote = p.status === 'OPEN' && p.my_vote == null && data.me.learner && !data.me.read_only
  const counts = p.counts
  const total = counts ? counts.reduce((a, b) => a + b, 0) : 0
  const run = async (body: Record<string, unknown>) => { setBusy(true); setErr(''); try { await act(body) } catch (x: any) { setErr(x?.message || 'That did not work.') } finally { setBusy(false) } }
  return (
    <section className="lx-poll" data-open={p.status === 'OPEN' ? '1' : '0'} aria-label={`Poll: ${p.question}`}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3>{p.question}</h3>
        <span className={`lx-tag ${p.status === 'OPEN' ? 'lx-tag--brand' : ''}`} style={{ flexShrink: 0 }}>{p.status === 'OPEN' ? 'Open' : 'Closed'}</span>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {p.options.map((o, i) => {
          const n = counts?.[i] ?? 0
          const pct = counts && total ? Math.round((n / total) * 100) : 0
          const inner = <>{counts && <i style={{ width: `${pct}%` }} />}<span>{o}{p.my_vote === i ? ' · your answer' : ''}</span>{counts && <span>{pct}%</span>}</>
          return canVote
            ? <button key={i} className="lx-poll-opt" disabled={busy} onClick={() => void run({ action: 'poll_vote', poll_id: p.id, option: i })}>{inner}</button>
            : <div key={i} className="lx-poll-opt" data-mine={p.my_vote === i ? '1' : '0'}>{inner}</div>
        })}
      </div>
      <div className="lx-poll-foot">
        <span className="lx-num">{counts ? plural(total, 'answer') : p.my_vote != null ? 'Answer recorded. Results are shared by the host.' : p.status === 'OPEN' ? 'Choose one answer.' : 'This poll has closed.'}</span>
        {host && <button className="lx-msg-tool" disabled={busy} onClick={() => void run({ action: p.status === 'OPEN' ? 'poll_close' : 'poll_open', poll_id: p.id })}>{p.status === 'OPEN' ? 'Close the poll' : 'Reopen'}</button>}
      </div>
      {err && <div className="lx-compose-err" role="alert">{err}</div>}
    </section>
  )
}

function Polls({ data, act }: { data: RoomData; act: Act }) {
  const [making, setMaking] = useState(false)
  const list = [...data.polls].sort((a, b) => (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1) || b.created_at.localeCompare(a.created_at))
  return (
    <div className="lx-feed" role="region" aria-label="Polls">
      {data.me.host && (making ? <NewPoll act={act} onDone={() => setMaking(false)} /> : <button className="lx-btn lx-btn--sm" onClick={() => setMaking(true)}><RPoll size={14} /> New poll</button>)}
      {!list.length && !making && <div className="lx-feed-empty">{data.me.host ? 'Ask the room something: a quick check of understanding, or what to cover next.' : 'No polls yet. When the host asks one, it appears here.'}</div>}
      {list.map(p => <Poll key={p.id} p={p} data={data} act={act} />)}
    </div>
  )
}

// ── The panel ───────────────────────────────────────────────────────────────
export default function Panel({ data, act, tab, onTab, unseen }: { data: RoomData; act: Act; tab: Tab; onTab: (t: Tab) => void; unseen: Record<Tab, number> }) {
  const s = data.session
  const [toggling, setToggling] = useState(false)
  const flip = async (k: 'room_chat' | 'room_questions') => { setToggling(true); try { await act({ action: 'settings', [k]: !s[k] }) } finally { setToggling(false) } }
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'chat', label: 'Chat', icon: <RChat size={15} /> },
    { key: 'questions', label: 'Q&A', icon: <RAsk size={15} /> },
    { key: 'polls', label: 'Polls', icon: <RPoll size={15} /> },
  ]
  // An open poll pulls attention to the Polls tab once, without stealing focus.
  const openPoll = data.polls.find(p => p.status === 'OPEN' && p.my_vote == null && data.me.learner)?.id
  const seenPoll = useRef<string | null>(null)
  useEffect(() => { if (openPoll && openPoll !== seenPoll.current) { seenPoll.current = openPoll; if (tab !== 'polls') onTab('polls') } }, [openPoll]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <aside className="lx-panel-room" aria-label="Chat, questions and polls">
      <div className="lx-panel-room-head">
        <div className="lx-tabs" role="tablist">
          {tabs.map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} aria-controls={`room-${t.key}`} onClick={() => onTab(t.key)}>
              {t.icon}{t.label}{!!unseen[t.key] && tab !== t.key && <span className="lx-nav-count">{unseen[t.key] > 99 ? '99+' : unseen[t.key]}</span>}
            </button>
          ))}
        </div>
        {data.me.host && (
          <div className="lx-panel-tools">
            <label><input type="checkbox" checked={s.room_chat} disabled={toggling} onChange={() => void flip('room_chat')} /> Chat on</label>
            <label><input type="checkbox" checked={s.room_questions} disabled={toggling} onChange={() => void flip('room_questions')} /> Taking questions</label>
          </div>
        )}
      </div>
      <div id={`room-${tab}`} role="tabpanel" className="lx-panel-room-body">
        {tab === 'chat' && <Chat data={data} act={act} />}
        {tab === 'questions' && <Questions data={data} act={act} />}
        {tab === 'polls' && <Polls data={data} act={act} />}
      </div>
    </aside>
  )
}
