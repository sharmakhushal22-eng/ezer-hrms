'use client'
// components/ess/Inbox.tsx — the ESS inbox.
//
// Three panes, because the brief asked for three different jobs on one screen
// and stacking them costs a click each time:
//
//   FOLDERS   who this is from. Direct messages, then one folder per
//             department — the segregation the brief asked for, driven by
//             lib/inbox/streams rather than by anything typed here.
//   LIST      the conversations in that folder, newest first.
//   THREAD    the conversation, and the box to answer it.
//
// On a phone it becomes one pane at a time with a back arrow, because three
// columns at 380px is three unusable columns.
//
// It never touches the inbox tables directly. Everything goes through
// /api/ess/inbox, which resolves the caller from the session — the anon key
// is in every page load, so a private conversation read from the browser
// would be a private conversation anyone could read.

import { useState, useEffect, useCallback, useRef } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import {
  C, F, W, S, R, E, eyebrow, IconSearch, IconClose, IconPlus, IconChevron,
} from '@/lib/ui'
import { STREAMS, streamInk } from '@/lib/inbox/streams'

type Folder = { code: string; label: string; hint?: string; total: number; unread: number }
type Conv = {
  id: string; kind: 'DIRECT' | 'DESK' | 'SYSTEM'; stream: string; title: string
  subject: string | null; members: any[]; last_message_at: string | null
  preview: string | null; message_count: number; unread: number
  muted: boolean; starred: boolean; is_closed: boolean; as_agent: boolean
}
type Msg = {
  id: string; kind: string; body: string | null; deleted: boolean
  link: string | null; notification_code: string | null
  created_at: string; mine: boolean; sender: any
}

const initials = (n: string) =>
  (n || '?').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase()

function when(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  const mins = (now.getTime() - d.getTime()) / 60000
  if (mins < 1) return 'now'
  if (mins < 60) return Math.floor(mins) + 'm'
  if (mins < 60 * 24 && d.getDate() === now.getDate())
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  if (mins < 60 * 48) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

const INBOX_CSS = `
/* --ib has to resolve ON THE ELEMENT THAT CARRIES --ib-l, not on an
   ancestor. Scoped to the wrapper first time round, it read --ib-l at the
   grid container — where it is not set — so every var(--ib) resolved to
   nothing: no folder dots, no unread badges, no tinted bubbles. Anything
   that sets the pair inline also wears .ez-ib-h. */
.ez-ib-h{ --ib: var(--ib-l) }
:root:not([data-ez-theme="light"]) .ez-ib-h{ --ib: var(--ib-d) }
@media (prefers-color-scheme: light){
  :root:not([data-ez-theme="dark"]) .ez-ib-h{ --ib: var(--ib-l) }
}
:root[data-ez-theme="dark"]  .ez-ib-h{ --ib: var(--ib-d) }
:root[data-ez-theme="light"] .ez-ib-h{ --ib: var(--ib-l) }

.ez-ib-folder{
  display:flex; align-items:center; gap:9px; width:100%; text-align:left;
  padding:8px 10px; border-radius:9px; border:none; cursor:pointer;
  background:transparent; font-family:inherit; font-size:13px; font-weight:600;
  color:var(--ez-ink); transition:background .16s ease, transform .16s ease;
}
.ez-ib-folder:hover{ background:color-mix(in srgb, var(--ib) 11%, transparent); transform:translateX(2px) }
.ez-ib-folder-on{ background:color-mix(in srgb, var(--ib) 15%, transparent) }
.ez-ib-dot{ width:8px; height:8px; border-radius:3px; background:var(--ib); flex-shrink:0 }

.ez-ib-row{
  display:block; width:100%; text-align:left; cursor:pointer; font-family:inherit;
  border:none; border-bottom:1px solid var(--ez-line); background:transparent;
  padding:11px 13px; transition:background .16s ease;
}
.ez-ib-row:hover{ background:color-mix(in srgb, var(--ib) 8%, transparent) }
.ez-ib-row-on{ background:color-mix(in srgb, var(--ib) 13%, transparent) }

/* A message is a surface, not a paragraph: the tint and the single soft
   shadow are what separate one person's turn from the next without a rule
   between every line. */
.ez-ib-bub{
  max-width:min(72%, 560px); padding:9px 13px; border-radius:14px;
  font-size:13.5px; line-height:1.5; white-space:pre-wrap; word-break:break-word;
  box-shadow:0 1px 2px rgba(15,23,42,.07);
}
.ez-ib-mine{ background:linear-gradient(180deg, var(--ez-brand), var(--ez-brand-deep));
             color:var(--ez-on-accent); border-bottom-right-radius:5px }
.ez-ib-theirs{ background:var(--ez-surface); border:1px solid var(--ez-line);
               color:var(--ez-ink); border-bottom-left-radius:5px }
.ez-ib-note{ background:color-mix(in srgb, var(--ib) 10%, var(--ez-surface));
             border:1px solid color-mix(in srgb, var(--ib) 26%, transparent);
             color:var(--ez-ink); max-width:min(86%, 640px) }

@keyframes ezIbIn{ from{ opacity:0; transform:translateY(6px) } to{ opacity:1; transform:none } }
.ez-ib-anim{ animation:ezIbIn .22s ease both }
@media (prefers-reduced-motion: reduce){
  .ez-ib-anim{ animation:none }
  .ez-ib-folder, .ez-ib-row{ transition:none }
  .ez-ib-folder:hover{ transform:none }
}
`

export default function Inbox({ employeeId, onUnread }: {
  employeeId: string
  /** Lets the portal's bell show the same number this screen does. */
  onUnread?: (n: number) => void
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'absent' | 'error'>('loading')
  const [reason, setReason] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [convs, setConvs] = useState<Conv[]>([])
  const [folder, setFolder] = useState('ALL')
  const [sel, setSel] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [composing, setComposing] = useState(false)
  const [q, setQ] = useState('')
  const [dir, setDir] = useState<{ people: any[]; desks: any[] } | null>(null)
  const [err, setErr] = useState('')
  const [pane, setPane] = useState<'list' | 'thread'>('list')   // phone only
  const [narrow, setNarrow] = useState(false)
  const feed = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < 900)
    f(); window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])

  /**
   * The portal's own auth, not a guess at it. This read
   * localStorage['ess_token'] — a key nothing writes — so every request went
   * out unauthenticated and the inbox showed "Sign in first". The shared
   * helper checks the ESS session AND the Supabase one, because an admin
   * opening somebody's portal has only the latter.
   */
  const headers = useCallback(() => authHeaders(), [])

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/ess/inbox?employee_id=${employeeId}`, { headers: await headers() })
      const j = await r.json()
      if (!r.ok) { setState('error'); setReason(j.error || 'Could not open the inbox.'); return }
      if (j.installed === false) { setState('absent'); setReason(j.reason || ''); return }
      setFolders(j.folders || []); setConvs(j.conversations || [])
      onUnread?.(Number(j.unread) || 0)
      setState('ready')
    } catch (e: any) { setState('error'); setReason(String(e?.message || e)) }
  }, [employeeId, headers, onUnread])

  useEffect(() => { load() }, [load])
  // Polled, not pushed. Nothing else in this app uses Supabase realtime, and
  // one screen opening a websocket would be the only thing in the codebase
  // that does. 20s is well under the time it takes to notice a missing reply.
  useEffect(() => {
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  const openThread = useCallback(async (id: string) => {
    setSel(id); setPane('thread'); setMsgs([]); setErr('')
    try {
      const r = await fetch(`/api/ess/inbox/messages?id=${id}&employee_id=${employeeId}`, { headers: await headers() })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Could not open that conversation.'); return }
      setMsgs(j.messages || [])
      onUnread?.(Number(j.unread) || 0)
      setConvs(cs => cs.map(c => c.id === id ? { ...c, unread: 0 } : c))
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [employeeId, headers, onUnread])

  useEffect(() => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight
  }, [msgs])

  const send = async () => {
    const text = draft.trim()
    if (!text || !sel || sending) return
    setSending(true); setErr('')
    try {
      const r = await fetch('/api/ess/inbox/messages', {
        method: 'POST', headers: await headers(),
        body: JSON.stringify({ id: sel, body: text, employee_id: employeeId }),
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error || 'Not sent.'); return }
      setDraft('')
      await openThread(sel); await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    finally { setSending(false) }
  }

  const openCompose = async () => {
    setComposing(true); setDir(null)
    const r = await fetch(`/api/ess/inbox/directory?employee_id=${employeeId}`, { headers: await headers() })
    setDir(await r.json().catch(() => ({ people: [], desks: [] })))
  }
  const searchPeople = async (text: string) => {
    setQ(text)
    const r = await fetch(`/api/ess/inbox/directory?q=${encodeURIComponent(text)}&employee_id=${employeeId}`,
                          { headers: await headers() })
    setDir(await r.json().catch(() => ({ people: [], desks: [] })))
  }
  const startWith = async (payload: any) => {
    const r = await fetch('/api/ess/inbox', {
      method: 'POST', headers: await headers(),
      body: JSON.stringify({ ...payload, employee_id: employeeId }),
    })
    const j = await r.json()
    if (!r.ok) { setErr(j.error || 'Could not start that conversation.'); return }
    setComposing(false); await load(); openThread(j.id)
  }

  // ── states before the screen ──────────────────────────────────────────
  if (state === 'loading') return <Shell><div style={pad}>Opening your inbox…</div></Shell>
  if (state === 'absent') return (
    <Shell>
      <div style={{ ...pad, maxWidth: 560 }}>
        <div style={{ ...eyebrow, marginBottom: 8 }}>Inbox</div>
        <div style={{ fontSize: 14, fontWeight: W.semi, color: C.ink, marginBottom: 6 }}>
          Not switched on yet
        </div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
          {reason || 'The inbox tables are not in the database yet.'} Your notifications
          still arrive on the bell in the meantime — nothing has been lost, and they
          will appear here once it is enabled.
        </div>
      </div>
    </Shell>
  )
  if (state === 'error') return (
    <Shell><div style={{ ...pad, color: C.critical, fontSize: 13 }}>{reason}</div></Shell>
  )

  const shown = convs.filter(c =>
    folder === 'ALL' ? true :
    folder === 'UNREAD' ? c.unread > 0 :
    folder === 'STARRED' ? c.starred :
    folder === 'DIRECT' ? c.kind === 'DIRECT' :
    c.stream === folder)

  const current = convs.find(c => c.id === sel) || null
  const ink = (code: string) => streamInk(code === 'ALL' || code === 'UNREAD' || code === 'STARRED' ? 'DIRECT' : code)

  const showList = !narrow || pane === 'list'
  const showThread = !narrow || pane === 'thread'

  return (
    <Shell>
      <div className="ez-ib" style={{
        display: 'grid', gap: 12, alignItems: 'start',
        gridTemplateColumns: narrow ? '1fr' : '196px 300px 1fr',
        height: narrow ? 'auto' : 'calc(100vh - 210px)', minHeight: 460,
      }}>
        {/* ── folders ─────────────────────────────────────────────── */}
        {(!narrow || pane === 'list') && (
          <div style={{ ...card, padding: 8, overflowY: 'auto', height: '100%' }}>
            <button onClick={openCompose} style={{
              ...T_btnP, width: '100%', marginBottom: 8, gap: 7,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <IconPlus size={15} /> New message
            </button>
            {folders.map(f => {
              const k = ink(f.code)
              return (
                <button key={f.code} onClick={() => { setFolder(f.code); setSel(null) }}
                  className={`ez-ib-h ez-ib-folder${folder === f.code ? ' ez-ib-folder-on' : ''}`}
                  title={f.hint}
                  style={{ ['--ib-l' as string]: k.l, ['--ib-d' as string]: k.d }}>
                  <span className="ez-ib-dot" aria-hidden />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.label}
                  </span>
                  {f.unread > 0 && (
                    <span style={{
                      fontSize: 10.5, fontWeight: W.bold, minWidth: 18, textAlign: 'center',
                      padding: '2px 5px', borderRadius: 6, color: C.onAccent,
                      background: 'var(--ib)', fontVariantNumeric: 'tabular-nums',
                    }}>{f.unread}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* ── conversation list ───────────────────────────────────── */}
        {showList && (
          <div style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex',
                        flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '10px 13px', borderBottom: `1px solid ${C.line}`,
                          fontSize: 12, fontWeight: W.bold, color: C.ink,
                          letterSpacing: '.06em', textTransform: 'uppercase' }}>
              {folders.find(f => f.code === folder)?.label || 'All'}
              <span style={{ color: C.muted, fontWeight: W.medium, marginLeft: 6,
                             textTransform: 'none', letterSpacing: 0 }}>
                {shown.length}
              </span>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {shown.length === 0 && (
                <div style={{ padding: 16, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
                  Nothing here yet.{folder === 'ALL' ? ' Start a conversation, or write to a desk.' : ''}
                </div>
              )}
              {shown.map(c => {
                const k = ink(c.stream)
                return (
                  <button key={c.id} onClick={() => openThread(c.id)}
                    className={`ez-ib-h ez-ib-row${sel === c.id ? ' ez-ib-row-on' : ''}`}
                    style={{ ['--ib-l' as string]: k.l, ['--ib-d' as string]: k.d }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: c.unread ? W.bold : W.semi,
                                     color: C.ink, flex: 1, minWidth: 0, overflow: 'hidden',
                                     whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {c.title}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: W.medium, color: C.muted, flexShrink: 0 }}>
                        {when(c.last_message_at)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <span style={{
                        fontSize: 9.5, fontWeight: W.bold, letterSpacing: '.06em',
                        textTransform: 'uppercase', color: 'var(--ib)', flexShrink: 0,
                      }}>
                        {c.kind === 'DESK' ? 'Desk' : c.kind === 'SYSTEM' ? 'Updates' : 'Direct'}
                        {c.as_agent ? ' · you staff this' : ''}
                      </span>
                      {c.unread > 0 && (
                        <span style={{
                          fontSize: 10, fontWeight: W.bold, padding: '1px 6px', borderRadius: 6,
                          background: 'var(--ib)', color: C.onAccent,
                        }}>{c.unread}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, overflow: 'hidden',
                                  whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {c.preview || 'No messages yet'}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── thread ──────────────────────────────────────────────── */}
        {showThread && (
          <div style={{ ...card, padding: 0, display: 'flex', flexDirection: 'column',
                        height: '100%', minHeight: 420, overflow: 'hidden' }}>
            {!current ? (
              <div style={{ ...pad, color: C.muted, fontSize: 13 }}>
                Pick a conversation on the left.
              </div>
            ) : (
              <>
                <div style={{ padding: '11px 14px', borderBottom: `1px solid ${C.line}`,
                              display: 'flex', alignItems: 'center', gap: 10 }}>
                  {narrow && (
                    <button onClick={() => setPane('list')} aria-label="Back"
                      style={{ ...T_btnO, height: 30, padding: '0 8px' }}>
                      <span style={{ display: 'inline-flex', transform: 'rotate(90deg)' }}>
                        <IconChevron size={14} />
                      </span>
                    </button>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: W.bold, color: C.ink,
                                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {current.title}
                    </div>
                    <div style={{ fontSize: 11.5, fontWeight: W.medium, color: C.muted }}>
                      {current.kind === 'SYSTEM' ? 'Automatic updates — nobody to reply to'
                       : current.kind === 'DESK'
                         ? (current.as_agent ? 'You are answering for this desk' : 'A desk — whoever staffs it will answer')
                         : current.members.map(m => m.designation).filter(Boolean).join(' · ') || 'Direct message'}
                    </div>
                  </div>
                </div>

                <div ref={feed} className="ez-scroll"
                     style={{ flex: 1, overflowY: 'auto', padding: 14,
                              display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {msgs.length === 0 && (
                    <div style={{ fontSize: 13, color: C.muted }}>No messages yet.</div>
                  )}
                  {msgs.map(m => {
                    const k = ink(current.stream)
                    const note = m.kind !== 'TEXT'
                    return (
                      <div key={m.id} className="ez-ib-anim"
                           style={{ display: 'flex', flexDirection: 'column',
                                    alignItems: note ? 'stretch' : m.mine ? 'flex-end' : 'flex-start' }}>
                        {!note && !m.mine && m.sender && (
                          <div style={{ fontSize: 11, fontWeight: W.bold, color: 'var(--ib)',
                                        marginBottom: 3, paddingLeft: 4 }}>
                            {m.sender.name}
                            {/* A desk answer names the desk to the employee and the
                                person underneath it — the migration stores both so
                                an answer is never unattributable. */}
                            {m.sender.desk && m.sender.by ? ` · ${m.sender.by}` : ''}
                          </div>
                        )}
                        <div className={`ez-ib-h ez-ib-bub ${note ? 'ez-ib-note' : m.mine ? 'ez-ib-mine' : 'ez-ib-theirs'}`}
                             style={{ ['--ib-l' as string]: k.l, ['--ib-d' as string]: k.d }}>
                          {m.deleted
                            ? <span style={{ fontStyle: 'italic', opacity: .75 }}>Message deleted</span>
                            : m.body}
                          {m.link && (
                            <div style={{ marginTop: 6 }}>
                              <a href={m.link} style={{ fontSize: 12, fontWeight: W.semi,
                                                        color: 'var(--ib)', textDecoration: 'none' }}>
                                Open →
                              </a>
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: W.medium, color: C.muted,
                                      marginTop: 3, padding: '0 4px' }}>
                          {when(m.created_at)}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {err && (
                  <div style={{ padding: '8px 14px', fontSize: 12.5, color: C.critical,
                                borderTop: `1px solid ${C.line}` }}>{err}</div>
                )}

                {current.kind === 'SYSTEM' ? (
                  <div style={{ padding: '11px 14px', borderTop: `1px solid ${C.line}`,
                                fontSize: 12.5, color: C.muted }}>
                    This is a feed of automatic updates. To ask about one of them,
                    write to the desk that owns it.
                  </div>
                ) : (
                  <div style={{ padding: 11, borderTop: `1px solid ${C.line}`,
                                display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea
                      value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        // Enter sends, Shift+Enter breaks the line — the
                        // convention people already have from every other
                        // workplace chat.
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                      }}
                      rows={2} placeholder="Write a reply…  (Enter to send, Shift+Enter for a new line)"
                      style={{
                        flex: 1, resize: 'none', fontFamily: 'inherit', fontSize: 13.5,
                        lineHeight: 1.5, padding: '9px 11px', borderRadius: 10,
                        border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink,
                      }} />
                    <button onClick={send} disabled={sending || !draft.trim()}
                      style={{ ...T_btnP, opacity: sending || !draft.trim() ? .55 : 1 }}>
                      {sending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {composing && (
        <Compose
          dir={dir} q={q} onSearch={searchPeople}
          onClose={() => setComposing(false)} onPick={startWith} />
      )}
      <style>{INBOX_CSS}</style>
    </Shell>
  )
}

// ── the new-message picker ────────────────────────────────────────────────
function Compose({ dir, q, onSearch, onClose, onPick }: {
  dir: any; q: string; onSearch: (s: string) => void
  onClose: () => void; onPick: (p: any) => void
}) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(8,12,22,.42)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.surface, borderRadius: 16, width: 'min(520px, 100%)',
        maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px -18px rgba(8,12,22,.5)', border: `1px solid ${C.line}`,
      }}>
        <div style={{ padding: '13px 15px', borderBottom: `1px solid ${C.line}`,
                      display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: W.bold, color: C.ink, flex: 1 }}>
            New message
          </span>
          <button onClick={onClose} aria-label="Close" style={{ ...T_btnO, height: 30, padding: '0 9px' }}>
            <IconClose size={14} />
          </button>
        </div>

        <div style={{ padding: 12, borderBottom: `1px solid ${C.line}`, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 22, top: '50%',
                         transform: 'translateY(-50%)', color: C.faint, display: 'flex' }}>
            <IconSearch size={15} />
          </span>
          <input value={q} onChange={e => onSearch(e.target.value)} autoFocus
            placeholder="Search a colleague by name or code…"
            style={{ width: '100%', height: 38, paddingLeft: 32, paddingRight: 11,
                     borderRadius: 10, border: `1px solid ${C.lineStrong}`,
                     background: C.surface, color: C.ink, fontSize: 13.5, fontFamily: 'inherit' }} />
        </div>

        <div style={{ overflowY: 'auto', padding: 8 }}>
          {!dir && <div style={{ padding: 12, fontSize: 13, color: C.muted }}>Loading…</div>}

          {dir?.desks?.length > 0 && (
            <>
              <div style={{ ...eyebrow, padding: '8px 8px 4px' }}>Departments</div>
              {dir.desks.map((d: any) => (
                <button key={d.desk_code} onClick={() => onPick({ action: 'desk', desk_code: d.desk_code })}
                  className="ez-ib-h ez-ib-folder"
                  style={{ ['--ib-l' as string]: d.accent || '#6C2FB1',
                           ['--ib-d' as string]: d.accent || '#A576DB' }}>
                  <span className="ez-ib-dot" aria-hidden />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block' }}>{d.label}</span>
                    <span style={{ display: 'block', fontSize: 11.5, fontWeight: W.medium, color: C.muted }}>
                      {d.description}
                    </span>
                  </span>
                </button>
              ))}
              {dir.unstaffed_desks && (
                // Better to say it than to take a message into a queue nobody
                // reads and let it look delivered.
                <div style={{ padding: '6px 10px 10px', fontSize: 11.5, color: C.warning, lineHeight: 1.5 }}>
                  No one is assigned to these desks yet, so a message may sit unanswered.
                  HR can assign people in Admin Setup → Inbox.
                </div>
              )}
            </>
          )}

          <div style={{ ...eyebrow, padding: '10px 8px 4px' }}>People</div>
          {dir && dir.people?.length === 0 && (
            <div style={{ padding: '4px 10px 12px', fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>
              Nobody matches that.
              {dir.reach_mode && dir.reach_mode !== 'GROUP' &&
                ' Your access covers only part of the directory.'}
            </div>
          )}
          {dir?.people?.map((p: any) => (
            <button key={p.id} onClick={() => onPick({ action: 'start', to: [p.id] })}
              className="ez-ib-h ez-ib-folder"
              style={{ ['--ib-l' as string]: '#1F5BC1', ['--ib-d' as string]: '#588BE4' }}>
              <span style={{
                width: 28, height: 28, borderRadius: 9, flexShrink: 0, fontSize: 11,
                fontWeight: W.bold, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'color-mix(in srgb, var(--ib) 15%, var(--ez-surface))', color: 'var(--ib)',
              }}>{initials(p.name)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block' }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 11.5, fontWeight: W.medium, color: C.muted }}>
                  {[p.code, p.designation].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── small shared bits ─────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: C.surface, borderRadius: R.lg, border: `1px solid ${C.line}`,
  boxShadow: E.raised,
}
const pad: React.CSSProperties = { padding: 18, fontSize: 13.5, color: C.ink }
const T_btnP: React.CSSProperties = {
  height: 36, padding: '0 15px', borderRadius: R.md, border: `1px solid ${C.brandDeep}`,
  cursor: 'pointer', fontSize: F.small, fontWeight: W.semi, fontFamily: 'inherit',
  background: `linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color: C.onAccent,
}
const T_btnO: React.CSSProperties = {
  height: 34, padding: '0 12px', borderRadius: R.md, border: `1px solid ${C.lineStrong}`,
  cursor: 'pointer', fontSize: F.small, fontWeight: W.medium, fontFamily: 'inherit',
  background: C.surface, color: C.ink, display: 'inline-flex', alignItems: 'center',
}
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ minWidth: 0 }}>{children}</div>
}
