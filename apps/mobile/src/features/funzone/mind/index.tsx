// src/features/funzone/mind/index.tsx — the ten solo mind games (components/funzone/MindGames.tsx).
//
// Screens and timers only. Every rule is in lib/funzone/mindgames.ts, pure and
// imported unchanged. Nothing here calls the network or the database: leaving
// a screen forgets it, and no score is kept anywhere ("best" is per sitting).
//
// Each game opens straight in from the hub (no mode screen). Every component
// is declared at module scope (no remount, no focus loss).
import * as React from 'react'
import type { MindCode } from '@web/funzone/mindgames'
import type { Props } from './frame'
import { Tiles, SlidePuzzle } from './puzzles'
import { Echo, QuickDraw } from './reflexes'
import { Scramble, MathSprint, ColourClash } from './timed'
import { CodeBreaker, LightsOut, Minesweeper } from './logic'

const SCREENS: Record<MindCode, React.ComponentType<Props>> = {
  tiles: Tiles, simon: Echo, reflex: QuickDraw, scramble: Scramble, slide: SlidePuzzle,
  sprint: MathSprint, clash: ColourClash, codebreak: CodeBreaker, lights: LightsOut, mines: Minesweeper,
}

/** Open one of the ten by its code. Unknown codes go back to the hub rather
 *  than rendering nothing. */
export function MindGame({ code, onBack }: { code: string; onBack: () => void }) {
  const Screen = SCREENS[code as MindCode]
  React.useEffect(() => { if (!Screen) onBack() }, [Screen, onBack])
  return Screen ? <Screen onBack={onBack} /> : null
}

export default MindGame
