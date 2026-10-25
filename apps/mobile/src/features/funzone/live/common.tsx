// src/features/funzone/live/common.tsx — what the three live games share.
//
// The connection lifecycle of spec 08 §5.11.2 (identical in the website's
// LiveTicTacToe / LiveMemoryMatch / LiveTrivia, written once here) and the
// header / status banner / footer those components draw with @/lib/ui tokens,
// mapped to the app palette.
//
// The wire protocol is lib/funzone/live.ts, imported unchanged, so a phone and
// a browser can play each other: channel `funzone:game:<session>`, broadcast
// self:false, presence key = my employee id, event 'g', isPacket validation.
import * as React from 'react'
import { AppState, Pressable, View, type AppStateStatus } from 'react-native'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/core/supabase'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S, R } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { channelFor, EVENT, isPacket, STATUS_TEXT, type LiveStatus, type Packet } from '@web/funzone/live'

// ── app foreground / background ─────────────────────────────────────────────

/** True while the app is in the foreground. */
export function useAppActive() {
  const [active, setActive] = React.useState(() => AppState.currentState !== 'background')
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      // 'inactive' (iOS transitions, Android has none) does not end a game.
      if (s === 'active') setActive(true)
      else if (s === 'background') setActive(false)
    })
    return () => sub.remove()
  }, [])
  return active
}

// ── the channel ────────────────────────────────────────────────────────────

/**
 * Opens the session's channel and runs the §5.11.2 lifecycle:
 *   SUBSCRIBED → track({id: me}), send my sync packet, status 'waiting';
 *   CHANNEL_ERROR / TIMED_OUT → 'failed';
 *   presence sync → 'playing' with two present, else 'waiting' (sticky 'opponent_left');
 *   presence leave → 'opponent_left' once the game has started.
 * On unmount AND when the app goes to the background (spec §5.18 point 6) it
 * sends {t:'leave'} and removes the channel; on return to the foreground it
 * opens a fresh one, whose sync packet catches the board up.
 *
 * Callbacks are read through a ref, so the channel lives exactly as long as
 * (sessionId, meId, foreground) — never re-created by a re-render.
 */
export function useLiveChannel(opts: {
  sessionId: string
  meId: string
  /** A validated packet from the other player. */
  onPacket: (p: Packet) => void
  /** My sync packet (sync / memSync / quizSync) with my current list. */
  syncPacket: () => Packet
  /** Have any moves / turns / answers been made? (a leave before that is ignored) */
  hasProgress: () => boolean
  setStatus: React.Dispatch<React.SetStateAction<LiveStatus>>
}) {
  const { sessionId, meId } = opts
  const o = React.useRef(opts)
  React.useLayoutEffect(() => { o.current = opts })
  const chan = React.useRef<RealtimeChannel | null>(null)
  const active = useAppActive()
  const opened = React.useRef(false)

  const send = React.useCallback((p: Packet) => {
    const ch = chan.current
    if (!ch) return
    Promise.resolve(ch.send({ type: 'broadcast', event: EVENT, payload: p })).catch(() => {})
  }, [])

  React.useEffect(() => {
    if (!active) return
    // Back from the background: say so until the channel is up again.
    if (opened.current) o.current.setStatus(s => (s === 'opponent_left' ? s : 'connecting'))
    opened.current = true

    const ch = supabase.channel(channelFor(sessionId), {
      config: { broadcast: { self: false }, presence: { key: meId } },
    })
    chan.current = ch

    ch.on('broadcast', { event: EVENT }, ({ payload }) => {
      if (!isPacket(payload)) return              // malformed: drop, never throw
      const p = payload as Packet
      if (p.from === meId) return
      o.current.onPacket(p)
    })
    ch.on('presence', { event: 'leave' }, () => {
      if (o.current.hasProgress()) o.current.setStatus('opponent_left')
    })
    ch.on('presence', { event: 'sync' }, () => {
      const n = Object.keys(ch.presenceState()).length
      o.current.setStatus(s => (s === 'opponent_left' ? s : n >= 2 ? 'playing' : 'waiting'))
    })
    ch.subscribe(st => {
      if (st === 'SUBSCRIBED') {
        Promise.resolve(ch.track({ id: meId })).catch(() => {})
        send(o.current.syncPacket())
        o.current.setStatus('waiting')
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
        o.current.setStatus('failed')
      }
    })

    return () => {
      // Announce the exit rather than just vanishing.
      try {
        Promise.resolve(ch.send({ type: 'broadcast', event: EVENT, payload: { t: 'leave', from: meId } })).catch(() => {})
      } catch { /* closing */ }
      supabase.removeChannel(ch)
      if (chan.current === ch) chan.current = null
    }
  }, [sessionId, meId, active, send])

  return send
}

// ── header, banner, footer ─────────────────────────────────────────────────

const PILL: Record<LiveStatus, string> = {
  playing: 'Live', connecting: 'Connecting', waiting: 'Waiting', failed: 'No connection',
  opponent_left: 'Ended', ended: 'Ended',
}

/** Header row: bold left text, muted right text, status pill (spec §5.11.2). */
export function LiveHead({ strong, soft, status }: { strong: string; soft: string; status: LiveStatus }) {
  const { C } = useTheme()
  const live = status === 'playing'
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.sm, marginBottom: S.md }}>
      <Txt size={F.small} w={700}>{strong}</Txt>
      <Txt size={F.small} tone="muted" style={{ flexShrink: 1 }}>{soft}</Txt>
      <View style={{ marginLeft: 'auto', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: live ? C.positiveTint : C.sunken }}>
        <Txt size={F.micro} w={600} color={live ? C.positive : C.muted}>{PILL[status]}</Txt>
      </View>
    </View>
  )
}

/** Memory / Trivia header (`Head` in LiveMemoryMatch.tsx). */
export function ScoreHead({ me, opponentName, status, scores }: {
  me: 'HOST' | 'GUEST'; opponentName: string; status: LiveStatus; scores: { HOST: number; GUEST: number }
}) {
  const mine = scores[me], theirs = scores[me === 'HOST' ? 'GUEST' : 'HOST']
  return <LiveHead strong={`You ${mine}`} soft={`${opponentName} ${theirs}`} status={status} />
}

/** The STATUS_TEXT banner, when there is one. */
export function StatusBanner({ status }: { status: LiveStatus }) {
  const { C } = useTheme()
  const text = STATUS_TEXT[status]
  if (!text) return null
  const failed = status === 'failed'
  return (
    <View accessibilityLiveRegion="polite" style={{ borderRadius: R.sm, paddingVertical: 9, paddingHorizontal: 12, marginBottom: S.md, backgroundColor: failed ? C.criticalTint : C.warningTint }}>
      <Txt size={F.small} color={failed ? C.critical : C.warning}>{text}</Txt>
    </View>
  )
}

/** "Play again" (when there is a result and they have not left) + "Leave". */
export function Foot({ ended, status, onAgain, onExit }: {
  ended: boolean; status: LiveStatus; onAgain: () => void; onExit: () => void
}) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: S.sm, justifyContent: 'center', marginTop: S.md }}>
      {ended && status !== 'opponent_left' && (
        <Pressable onPress={onAgain} accessibilityRole="button"
          style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: R.sm, backgroundColor: C.brand, opacity: pressed ? 0.85 : 1 })}>
          <Txt size={F.tiny} w={700} color={C.onAccent}>Play again</Txt>
        </Pressable>
      )}
      <Pressable onPress={onExit} accessibilityRole="button"
        style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: R.sm, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.sunken : C.surface })}>
        <Txt size={F.tiny} w={600} color={C.inkSoft}>Leave</Txt>
      </Pressable>
    </View>
  )
}

/** A centred square grid `cols` wide, at most `maxWidth`, `gap` apart (CSS grid repeat(n,1fr) + aspect-ratio 1). */
export function SquareGrid({ count, cols, maxWidth, gap = 8, children }: {
  count: number; cols: number; maxWidth: number; gap?: number
  children: (i: number, size: number) => React.ReactNode
}) {
  const [w, setW] = React.useState(0)
  const size = w > 0 ? Math.floor((w - gap * (cols - 1)) / cols) : 0
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)}
      style={{ width: '100%', maxWidth, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {size > 0 && Array.from({ length: count }, (_, i) => children(i, size))}
    </View>
  )
}
