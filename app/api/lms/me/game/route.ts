// app/api/lms/me/game/route.ts — points, streak, badges and the leaderboard.
//   ?lite=1                                   the top bar and the Home tile: points, level, streak, this week
//   ?board=week|month|all&scope=company|department   adds the leaderboard (the Achievements page)
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner } from '@/lib/lms/learner'
import { leaderboard, myGame, type Period, type Scope } from '@/lib/lms/game'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

const PERIODS: Period[] = ['week', 'month', 'all']

export async function GET(req: NextRequest) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    const sp = req.nextUrl.searchParams
    if (sp.get('lite') === '1') return NextResponse.json(await myGame(learner, { lite: true }))
    const board = sp.get('board') as Period | null
    const scope: Scope = sp.get('scope') === 'department' ? 'department' : 'company'
    if (board && PERIODS.includes(board) && sp.get('only') === 'board') return NextResponse.json({ board: await leaderboard(learner, board, scope) })
    const [me, b] = await Promise.all([
      myGame(learner),
      board && PERIODS.includes(board) ? leaderboard(learner, board, scope) : Promise.resolve(null),
    ])
    return NextResponse.json({ ...me, board: b })
  } catch (e) { return errorResponse(e) }
}
