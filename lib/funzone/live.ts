// lib/funzone/live.ts — the wire protocol for a live game.
//
// Supabase Realtime broadcast. Verified working on this project with the anon
// key: SUBSCRIBED, and a broadcast echoed back in about 2.6 seconds on a cold
// channel. Nothing else in this app uses Realtime — the inbox deliberately
// polls — so this is the first, and the reasons are spelled out below.
//
// WHY BROADCAST AND NOT postgres_changes
//
// A move is not worth a database round trip. Broadcast is client to client
// through Supabase's socket: a tap on one screen appears on the other without
// touching Postgres. Only the START and the FINISH are persisted, because
// those are the parts anybody looks at afterwards.
//
// WHICH MEANS THE PEER IS NOT TRUSTED. There is no server in the loop during
// play, so every packet is validated against the pure rules in games.ts
// before it is applied, and the final score is written by an API route that
// RE-DERIVES the winner from the move list rather than believing whoever
// claims to have won. Two colleagues playing tic-tac-toe are not an
// adversary, but a leaderboard that can be typed into is not worth showing.
//
// WHAT THIS DOES NOT DO. No matchmaking queue, no spectators, no reconnect
// into a game whose opponent has gone. A dropped opponent ends the game with
// "they left" rather than a rejoin protocol, which for a break-time game is
// the honest amount of engineering.

import type { Move } from './games'

/** One channel per session. Namespaced so a session id can never collide
 *  with another feature's channel on the same project. */
export function channelFor(sessionId: string): string {
  return `funzone:game:${sessionId}`
}

export type Packet =
  /** I have arrived and this is the state I hold. Sent on join and on any
   *  disagreement, so a late or reloaded client can catch up without a
   *  server. */
  | { t: 'sync'; from: string; moves: Move[] }
  /** One move. `n` is its index in the move list — see canApply. */
  | { t: 'move'; from: string; move: Move }
  /** Deliberately leaving, as opposed to a socket that simply died. */
  | { t: 'leave'; from: string }
  /** Play again on the same channel. Both must send it. */
  | { t: 'rematch'; from: string }

export const EVENT = 'g'

/**
 * Is this packet shaped like a packet?
 *
 * It arrives as JSON from another browser, so nothing about it is guaranteed
 * — not the type, not the fields, not that `moves` is an array. A malformed
 * packet is dropped silently rather than throwing, because an exception here
 * would take down the game for the well-behaved player.
 */
export function isPacket(v: unknown): v is Packet {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  if (typeof p.from !== 'string' || !p.from) return false
  switch (p.t) {
    case 'sync':    return Array.isArray(p.moves) && p.moves.every(isMove)
    case 'move':    return isMove(p.move)
    case 'leave':
    case 'rematch': return true
    default:        return false
  }
}

function isMove(v: unknown): v is Move {
  if (!v || typeof v !== 'object') return false
  const m = v as Record<string, unknown>
  return Number.isInteger(m.n) && Number.isInteger(m.cell) &&
         (m.by === 'X' || m.by === 'O')
}

/**
 * Which of two move lists is authoritative?
 *
 * Both clients are equal, so "the longer one wins" is the rule — a longer
 * list can only have been reached by applying legal moves to the shorter one.
 * On equal length, the local one is kept: they are the same game, and
 * swapping identical state would only cause a render.
 *
 * This is what makes a reload survivable. The returning client sends a sync
 * with an empty list, the other answers with the real one, and the board
 * comes back.
 */
export function reconcile(mine: Move[], theirs: Move[]): Move[] {
  return theirs.length > mine.length ? theirs : mine
}

/** Ignore our own broadcasts. `self: true` is enabled so a sender sees its
 *  own packet and can confirm the socket is alive, but applying it twice
 *  would double every move. */
export function isMine(p: Packet, me: string): boolean {
  return p.from === me
}

export type LiveStatus =
  | 'connecting' | 'waiting' | 'playing' | 'opponent_left' | 'ended' | 'failed'

export const STATUS_TEXT: Record<LiveStatus, string> = {
  connecting:    'Connecting…',
  waiting:       'Waiting for them to join…',
  playing:       '',
  opponent_left: 'They left the game.',
  ended:         '',
  failed:        'The live connection could not be opened. The game cannot be played across two screens right now.',
}

/** Who plays which mark. Fixed from the session rather than negotiated: the
 *  person who SENT the invite is X and opens, so neither client has to agree
 *  anything at connect time and a reload cannot swap sides. */
export function markFor(employeeId: string, hostId: string): 'X' | 'O' {
  return employeeId === hostId ? 'X' : 'O'
}
