'use client'
// components/ess/InboxTabs.tsx — two inboxes, side by side, never merged.
//
// The existing Inbox is untouched by this file: it is not read, not wrapped,
// not re-queried. It renders exactly as it did, and the Wall of Fame streams
// sit beside it as a second group.
//
// TWO COUNTS, NEVER SUMMED.
//
// A pending request and a colleague's thank-you note are not the same kind of
// unread. One number for both teaches people to ignore the number, and the
// appreciation is what goes unread first. So each group carries its own
// badge, and there is no total anywhere on this screen.
//
// Sub-components at module scope.

import { useState } from 'react'
import Inbox from './Inbox'
import WallInbox from '@/components/wall/WallInbox'
import BroadcastInbox from '@/components/ess/BroadcastInbox'
// WHITE ON THE BRAND FILL IS A TRAP THIS CODEBASE ALREADY DOCUMENTED.
//
// tokens.ts says it plainly next to onAccent: the brand blue lightens in dark
// mode and white on it falls to 2.5:1. Measured here at 2.54 on the Send
// button. C.onAccent is the theme-aware ink for an accent fill and is what
// every one of these should have used from the start.
import { C, F, W, S, R } from '@/lib/ui'

type Group = 'messages' | 'wall' | 'broadcast'

function GroupTab({ label, blurb, on, n, onPick }: {
  label: string; blurb: string; on: boolean; n: number; onPick: () => void
}) {
  return (
    <button type="button" onClick={onPick} aria-pressed={on}
      style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
               padding: '10px 14px', borderRadius: R.sm, flex: '1 1 220px', minWidth: 0,
               border: `1px solid ${on ? C.brand : C.line}`,
               background: on ? C.brandTint : C.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: on ? C.brand : C.ink }}>
          {label}
        </span>
        {n > 0 && (
          <span style={{ fontSize: F.micro, fontWeight: W.bold, padding: '1px 7px',
                         borderRadius: 999, background: on ? C.brand : C.sunken,
                         color: on ? C.onAccent : C.inkSoft }}>{n}</span>
        )}
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3, lineHeight: 1.45 }}>
        {blurb}
      </div>
    </button>
  )
}

export default function InboxTabs({ employeeId, onUnread }: {
  employeeId: string
  /** Reported to the shell as the MESSAGES count only. The wall's unread is
   *  deliberately not added to it — see the note at the top. */
  onUnread?: (n: number) => void
}) {
  const [group, setGroup] = useState<Group>('messages')
  const [msgUnread, setMsgUnread] = useState(0)
  const [wallUnread, setWallUnread] = useState(0)
  const [bcUnread, setBcUnread] = useState(0)

  return (
    <div>
      <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap', marginBottom: S.md }}>
        <GroupTab label="Messages" blurb="Conversations with colleagues and desks"
          on={group === 'messages'} n={msgUnread} onPick={() => setGroup('messages')} />
        <GroupTab label="Wall of Fame" blurb="Notes, comments and replies about your recognition"
          on={group === 'wall'} n={wallUnread} onPick={() => setGroup('wall')} />
        <GroupTab label="Broadcasts" blurb="Company-wide notices. Read only — nobody replies in public"
          on={group === 'broadcast'} n={bcUnread} onPick={() => setGroup('broadcast')} />
      </div>

      {/* Both stay mounted. Switching groups should not throw away a half
          -written reply or re-fetch a list somebody just read. */}
      <div hidden={group !== 'messages'}>
        <Inbox employeeId={employeeId}
               onUnread={n => { setMsgUnread(n); onUnread?.(n) }} />
      </div>
      <div hidden={group !== 'wall'}>
        <WallInbox onUnread={setWallUnread} />
      </div>
      <div hidden={group !== 'broadcast'}>
        <BroadcastInbox employeeId={employeeId} onUnread={setBcUnread} />
      </div>
    </div>
  )
}
