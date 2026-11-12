'use client'
// components/learning/game/data.ts — the learner's points, fetched once and shared by the top-bar
// chip, the Home tile and the course-complete screen (../app/cache.ts).
import { useEffect, useState } from 'react'
import { cached, fetchInto, forget } from '../app/cache'

export type XpKind = 'lesson' | 'course' | 'ontime' | 'quiz' | 'perfect' | 'live' | 'recording' | 'path'
export interface Level { level: number; name: string; floor: number; next: number; into: number; need: number; pct: number }
export interface Badge { id: string; name: string; description: string; icon: string; target: number; progress: number; earned_at: string | null }
export interface GameLite {
  enabled: boolean
  leaderboard?: boolean
  xp: number
  level: Level
  streak: { current: number; best: number; today: boolean }
  week: { xp: number; goal: number; days: boolean[] }
  today_xp: number
  month_xp: number
  badges_earned: number
  badges_total: number
  badges_today: { id: string; name: string; icon: string }[]
}
export interface BoardRow { rank: number | null; xp: number; name: string; initials: string; department: string | null; me: boolean }
export interface Board { enabled: boolean; period: 'week' | 'month' | 'all'; scope: 'company' | 'department'; names: boolean; department: string | null; rows: BoardRow[]; me: BoardRow; ranked: number; people: number }
export interface GameFull extends GameLite {
  breakdown: { kind: XpKind; label: string; count: number; xp: number }[]
  badges: Badge[]
  recent: { at: string; kind: XpKind; xp: number }[]
  board: Board | null
}

export const GAME_KEY = 'game:lite'
const GAME_PATH = '/api/lms/me/game?lite=1'

/** The lite answer: whatever this tab already has at once, then the fresh one. Null while loading,
 *  and also when points are switched off or the request failed: every caller then draws nothing. */
export function useGameLite(): GameLite | null {
  const [g, setG] = useState<GameLite | null>(() => (typeof window === 'undefined' ? null : cached<GameLite>(GAME_KEY)))
  useEffect(() => {
    let live = true
    fetchInto<GameLite>(GAME_KEY, GAME_PATH).then(v => { if (live) setG(v) }).catch(() => {})
    return () => { live = false }
  }, [])
  return g?.enabled ? g : null
}

/** After something that earns points (a course finished), so the next screen asks again. */
export function refreshGame(): Promise<GameLite | null> {
  forget(GAME_KEY)
  return fetchInto<GameLite>(GAME_KEY, GAME_PATH).catch(() => null)
}

export const XP_SHORT: Record<XpKind, string> = {
  lesson: 'Lesson finished', course: 'Course completed', ontime: 'On time bonus', quiz: 'Quiz passed',
  perfect: 'Perfect score', live: 'Live session', recording: 'Recording watched', path: 'Path completed',
}
