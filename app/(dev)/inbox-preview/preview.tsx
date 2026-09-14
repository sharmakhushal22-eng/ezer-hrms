'use client'
/**
 * Preview harness — /inbox-preview (development only; see page.tsx).
 *
 * Every component, mock data, no backend. The three groups are the same markup
 * InboxShell renders, so what you see here is what the portal shows.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import '@/components/ess/inbox/inbox.css'
import { BroadcastView } from '@/components/ess/inbox/BroadcastView'
import { CatchUp } from '@/components/ess/inbox/CatchUp'
import { ComposeSheet } from '@/components/ess/inbox/ComposeSheet'
import { ConversationList } from '@/components/ess/inbox/ConversationList'
import { FolderRail } from '@/components/ess/inbox/FolderRail'
import { ThreadPane } from '@/components/ess/inbox/ThreadPane'
import { WallInboxView } from '@/components/ess/inbox/WallInboxView'
import { selectConversations } from '@/components/ess/inbox/selectors'
import { ToastHost, useInboxOffset, useTick } from '@/components/ess/inbox/ui'
import { Ic } from '@/components/ess/inbox/icons'
import type {
  ConversationVM, FolderVM, InboxStatus, ListFilter, MessageVM, WallStream,
} from '@/components/ess/inbox/types'
import {
  MOCK_BROADCASTS, MOCK_CONVERSATIONS, MOCK_DIRECTORY, MOCK_FOLDERS,
  MOCK_MESSAGES, MOCK_NOTES, MOCK_WALL,
} from '@/components/ess/inbox/__preview__/mock-data'

type Group = 'messages' | 'wall' | 'broadcast'

/**
 * The harness is driven by the query string so every state can be reached
 * without clicking — ?group=wall&theme=dark&open=c1&compose=1&bc=ready
 */
function param(k: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(k)
}

export default function Preview() {
  const rootRef = useRef<HTMLElement>(null)
  const [group, setGroup] = useState<Group>('messages')
  const [convs, setConvs] = useState<ConversationVM[]>(MOCK_CONVERSATIONS)
  const [wall, setWall] = useState(MOCK_WALL)
  const [wallStream, setWallStream] = useState<WallStream>('all')
  const [bcStatus, setBcStatus] = useState<InboxStatus>('absent')
  const [openId, setOpenId] = useState<string | null>(null)
  const [folder, setFolder] = useState<FolderVM['code']>('ALL')
  const [filter, setFilter] = useState<ListFilter>('all')
  const [query, setQuery] = useState('')
  const [railMin, setRailMin] = useState(false)
  const [compose, setCompose] = useState(false)
  const [unreadAtOpen, setUnreadAtOpen] = useState(0)
  const [messages, setMessages] = useState<Record<string, MessageVM[]>>(MOCK_MESSAGES)

  const folders = useMemo(
    () => Object.fromEntries(MOCK_FOLDERS.map(f => [f.code, f])) as Record<string, FolderVM>, [])
  const visible = useMemo(
    () => selectConversations(convs, { folder, filter, query }), [convs, folder, filter, query])
  const open = convs.find(c => c.id === openId) ?? null
  const messagesUnread = convs.reduce((n, c) => n + c.unread, 0)
  const wallUnread = wall.filter(w => w.unread).length
  const wallVisible = wall.filter(w => wallStream === 'all' || w.type === wallStream)

  // The mock timestamps are relative to whenever the module was evaluated, so
  // the server's are minutes older than the browser's and every relative time
  // would mismatch on hydration. Nothing here is server-rendered for real, so
  // the harness simply waits for the client.
  const [ready, setReady] = useState(false)

  // Read the query string once, after mount.
  useEffect(() => {
    setReady(true)
    const g = param('group'); if (g === 'wall' || g === 'broadcast' || g === 'messages') setGroup(g)
    const t = param('theme'); if (t) document.documentElement.dataset.ezTheme = t
    const o = param('open'); if (o) { setOpenId(o); setUnreadAtOpen(MOCK_CONVERSATIONS.find(c => c.id === o)?.unread ?? 0) }
    if (param('compose') === '1') setCompose(true)
    const b = param('bc'); if (b === 'ready' || b === 'error' || b === 'loading') setBcStatus(b)
    const f = param('folder'); if (f) setFolder(f as FolderVM['code'])
    const fl = param('filter'); if (fl === 'unread' || fl === 'starred') setFilter(fl)
    if (param('rail') === 'min') setRailMin(true)
  }, [])

  useInboxOffset(rootRef)

  function openThread(id: string) {
    setUnreadAtOpen(convs.find(x => x.id === id)?.unread ?? 0)
    setOpenId(id)
    setConvs(cs => cs.map(x => (x.id === id ? { ...x, unread: 0 } : x)))
  }

  async function send(body: string) {
    if (!openId) return
    const m: MessageVM = { id: `m${Date.now()}`, mine: true, body, sentAt: new Date().toISOString(), deleted: false }
    setMessages(all => ({ ...all, [openId]: [...(all[openId] ?? []), m] }))
    setConvs(cs => cs.map(c => (c.id === openId ? { ...c, preview: `You: ${body}`, updatedAt: m.sentAt } : c)))
  }

  function act(id: string, a: 'star' | 'mute' | 'close' | 'unread') {
    setConvs(cs => cs.map(c => c.id !== id ? c : ({
      ...c,
      starred: a === 'star' ? !c.starred : c.starred,
      muted: a === 'mute' ? !c.muted : c.muted,
      closed: a === 'close' ? !c.closed : c.closed,
      unread: a === 'unread' ? Math.max(1, c.unread) : c.unread,
    })))
    if (a === 'unread') setOpenId(null)
  }

  /** What a 20 s poll would surface: a reply lands while you are reading. */
  function incoming() {
    const target = convs.find(c => c.id === 'c5') ?? convs[0]
    const m: MessageVM = {
      id: `m${Date.now()}`, mine: false, deleted: false, sentAt: new Date().toISOString(),
      body: 'Also — can you share the Q2 headcount deck before the sync?',
    }
    setMessages(all => ({ ...all, [target.id]: [...(all[target.id] ?? []), m] }))
    setConvs(cs => cs.map(c => c.id === target.id
      ? { ...c, unread: openId === c.id ? 0 : c.unread + 1, preview: m.body, updatedAt: m.sentAt }
      : c))
  }

  return (
    <ToastHost>
      <div className="ibp-bar">
        <b>Inbox preview</b><span>mock data · no network</span>
        <span className="sp" />
        <button type="button" onClick={cycleTheme}>Theme</button>
        <button type="button" onClick={incoming}>Simulate incoming</button>
        <button type="button" onClick={() => setBcStatus(s => (s === 'absent' ? 'ready' : 'absent'))}>
          Broadcasts: {bcStatus}
        </button>
      </div>

      <main className="ib" ref={rootRef}>
        {!ready ? null : <>
        <header className="groups">
          <div className="seg" role="tablist" aria-label="Inbox groups">
            <span className="pill" aria-hidden="true" />
            <Tab id="messages" label="Messages" count={messagesUnread} active={group === 'messages'} onPick={setGroup} icon={Ic.chat()} />
            <Tab id="wall" label="Wall of Fame" count={wallUnread} active={group === 'wall'} onPick={setGroup} icon={Ic.star()} />
            <Tab id="broadcast" label="Broadcasts" count={bcStatus === 'ready' ? MOCK_BROADCASTS.filter(b => b.unread).length : 0} active={group === 'broadcast'} onPick={setGroup} icon={Ic.megaphone()} />
          </div>
          <div className="blurb"><span key={group}>{
            group === 'messages' ? 'Conversations with colleagues and desks'
              : group === 'wall' ? 'Notes, comments and replies about your recognition'
              : 'Company-wide notices. Read only — nobody replies in public'
          }</span></div>
          <div className="live"><i /><span>Updated just now</span></div>
        </header>

        <section className="group" role="tabpanel" hidden={group !== 'messages'}>
          <div className="ib-messages" data-pane={open ? 'thread' : 'list'} data-rail={railMin ? 'min' : ''}>
            <div className="panes">
              <FolderRail
                folders={MOCK_FOLDERS} totalUnread={messagesUnread} active={folder} collapsed={railMin}
                onPick={setFolder} onCompose={() => setCompose(true)} onToggleCollapse={() => setRailMin(v => !v)}
              />
              <ConversationList
                title={folder === 'ALL' ? 'All' : folders[folder]?.label ?? 'All'}
                conversations={visible} folders={folders} openId={openId} filter={filter} query={query}
                status="ready" searchInputRef={{ current: null }}
                onFilter={setFilter} onQuery={setQuery} onOpen={openThread}
                onMarkAllRead={() => setConvs(cs => cs.map(c => ({ ...c, unread: 0 })))}
                onQuick={(id, a) => act(id, a === 'read' ? 'unread' : a)}
              />
              {open ? (
                <ThreadPane
                  conversation={open} folder={folders[open.folder]}
                  messages={open.kind === 'SYSTEM' ? [] : (messages[open.id] ?? [])}
                  notes={open.kind === 'SYSTEM' ? (MOCK_NOTES[open.id] ?? []) : []}
                  unreadAtOpen={unreadAtOpen} loading={false} autoFocus={false}
                  onBack={() => setOpenId(null)} onSend={async b => send(b)}
                  onAction={a => act(open.id, a)}
                  onDeleteMessage={id => setMessages(all => ({
                    ...all,
                    [open.id]: (all[open.id] ?? []).map(m => (m.id === id ? { ...m, deleted: true, body: '' } : m)),
                  }))}
                  onWriteToDesk={() => setCompose(true)}
                />
              ) : (
                <CatchUp firstName="Rajesh" conversations={convs} folders={folders} onOpen={openThread} onCompose={() => setCompose(true)} />
              )}
            </div>
          </div>
        </section>

        <section className="group" role="tabpanel" hidden={group !== 'wall'}>
          <div className="wall">
            <WallInboxView
              items={wallVisible} stream={wallStream} onStream={setWallStream}
              onThankBack={w => setWall(ws => ws.map(x => (x.id === w.id ? { ...x, thanked: true, unread: false } : x)))}
              onMarkRead={w => setWall(ws => ws.map(x => (x.id === w.id ? { ...x, unread: false } : x)))}
            />
          </div>
        </section>

        <section className="group" role="tabpanel" hidden={group !== 'broadcast'}>
          <div className="bc">
            <BroadcastView status={bcStatus} reason="088_broadcast_channel.sql"
              items={MOCK_BROADCASTS} onReplyPrivately={async () => {}} />
          </div>
        </section>

        {/* Inside .ib, because every rule in inbox.css is scoped to it — a
            <dialog> in the top layer is still a descendant for CSS. This is
            where MessagesInbox puts it too. */}
        <ComposeSheet
          open={compose} folders={folders} onClose={() => setCompose(false)}
          fetchDirectory={async q => filterDirectory(q)}
          onPickPerson={() => { setCompose(false); openThread('c1') }}
          onPickDesk={() => { setCompose(false); openThread('c2') }}
        />
        </>}
      </main>

      <style>{`
        .ibp-bar{ display:flex; align-items:center; gap:10px; max-width:1480px; margin:0 auto; padding:12px 22px 0;
          font-size:12.5px; color:var(--ez-muted) }
        .ibp-bar b{ color:var(--ez-ink) } .ibp-bar .sp{ flex:1 }
        .ibp-bar button{ border:1px solid var(--ez-line); background:var(--ez-surface); border-radius:8px;
          padding:6px 11px; font-size:12px; font-weight:600; color:var(--ez-ink); cursor:pointer }
      `}</style>
    </ToastHost>
  )
}

function Tab({ id, label, count, active, onPick, icon }: {
  id: Group; label: string; count: number; active: boolean; onPick: (g: Group) => void; icon: React.ReactNode
}) {
  const tick = useTick(count)
  return (
    <button role="tab" type="button" aria-selected={active} onClick={() => onPick(id)}>
      {icon}{label}<span className={`cnt ${tick}`}>{count > 0 ? count : ''}</span>
    </button>
  )
}

function filterDirectory(q: string) {
  const n = q.trim().toLowerCase()
  if (!n) return MOCK_DIRECTORY
  return {
    desks: MOCK_DIRECTORY.desks.filter(d => d.name.toLowerCase().includes(n) || d.hint.toLowerCase().includes(n)),
    people: MOCK_DIRECTORY.people.filter(p => `${p.name} ${p.code} ${p.designation}`.toLowerCase().includes(n)),
  }
}

function cycleTheme() {
  const r = document.documentElement
  const order = ['auto', 'light', 'dark']
  r.dataset.ezTheme = order[(order.indexOf(r.dataset.ezTheme ?? 'auto') + 1) % order.length]
}
