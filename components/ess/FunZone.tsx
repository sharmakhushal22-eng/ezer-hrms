'use client'
// components/ess/FunZone.tsx — ESS Fun Zone: four break-time games.
// Ported from the tested prototype EZER_FunZone.html, per FunZone_Feature_Brief.md.
//
// Nothing here touches the database, deliberately (brief §3 and §7): a refresh resets
// every game and no score history is kept. That is the current design, not an oversight
// — a leaderboard or personal history would need a new table and is an open question.
//
// Hub-and-spoke (brief §8): a grid of four cards, each opening its game in the same
// panel behind a "Back" button. Open to every employee, no role check (brief §9).
//
// All sub-components are defined OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useRef, useCallback } from 'react'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'
import PlayTogether from '@/components/funzone/PlayTogether'
// One copy of the questions and the card faces, shared with the live modes.
// Both were duplicated here and both drifted — see the notes in games.ts.
import { QUIZ, MEM_FACES } from '@/lib/funzone/games'

const F = {
  navy:TK.ink, purple:TK.brand, purpleDark:TK.brandDeep, purpleSoft: TK.brandTint,
  muted:TK.muted, border: TK.brandEdge, green:TK.positive, greenBg:TK.positiveTint,
  pink: TK.critical, pinkBg: TK.criticalTint, blue:TK.info, blueBg:TK.infoTint, red:TK.critical,
}
const panel: React.CSSProperties = { background:TK.surface, borderRadius:14, padding:24, boxShadow: 'var(--ez-shadow-flat)' }
const btnPrimary: React.CSSProperties = { fontFamily:'inherit', fontSize:14, fontWeight:700, color:TK.onAccent, background:F.purple, border:'none', borderRadius:10, padding:'10px 24px', cursor:'pointer' }
const gameTitle: React.CSSProperties = { fontSize:18, fontWeight:700, marginBottom:4 }
const gameSub: React.CSSProperties = { fontSize:12, color:F.muted, marginBottom:18 }

const GAMES = [
  { k:'ttt',   icon:'⭕', name:'Tic-Tac-Toe',    desc:'Classic 2-player, take turns on this screen', badge:'Arcade', bg:F.purpleSoft, fg:F.purpleDark },
  { k:'mem',   icon:'🧩', name:'Memory Match',   desc:'Flip cards, find all the pairs',              badge:'Arcade', bg:F.purpleSoft, fg:F.purpleDark },
  { k:'quiz',  icon:'💡', name:'EZER Trivia',    desc:'How well do you know company policy?',        badge:'Quiz',   bg:F.blueBg,     fg:F.blue },
  { k:'wheel', icon:'🎡', name:'Spin the Wheel', desc:'Daily spin — win a fun shoutout or a treat',  badge:'Social', bg:F.pinkBg,     fg:F.pink },
]

function BackBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} style={{ fontFamily:'inherit', fontSize:12, fontWeight:700, color:F.purpleDark, background:F.purpleSoft, border:'none', borderRadius:10, padding:'7px 14px', cursor:'pointer', marginBottom:16 }}>Back</button>
}

// ── Tic-Tac-Toe ─────────────────────────────────────────────────
// Standard 2-player, same-screen turns (brief §4). Cross-device play would need a
// backend, and is an open question — this is the break-room version.
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
function TicTacToe({ onBack }: { onBack: () => void }) {
  const [board, setBoard] = useState<string[]>(Array(9).fill(''))
  const [turn, setTurn] = useState<'X'|'O'>('X')

  // Winner is derived from the board rather than tracked in its own state, so the
  // status line can never disagree with the squares it is describing.
  const line = WIN_LINES.find(([a,b,c]) => board[a] && board[a] === board[b] && board[a] === board[c])
  const win = line ? board[line[0]] : null
  const draw = !win && board.every(Boolean)
  const over = !!win || draw

  const move = (i: number) => {
    if (board[i] || over) return
    const next = [...board]; next[i] = turn
    setBoard(next); setTurn(t => t === 'X' ? 'O' : 'X')
  }
  const reset = () => { setBoard(Array(9).fill('')); setTurn('X') }
  const status = win ? `🎉 Player ${win} wins!` : draw ? "It's a draw!" : `Player ${turn}'s turn`

  return (
    <div style={panel}>
      <BackBtn onClick={onBack} />
      <div style={gameTitle}>⭕ Tic-Tac-Toe</div>
      <div style={gameSub}>Two players, take turns tapping a square</div>
      <div style={{ textAlign:'center', fontWeight:700, marginBottom:12, fontSize:15, color: win ? F.green : F.navy }}>{status}</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,80px)', gridTemplateRows:'repeat(3,80px)', gap:6, margin:'0 auto 16px', justifyContent:'center' }}>
        {board.map((v, i) => {
          const inWin = !!line && line.includes(i)
          return (
            <button key={i} onClick={() => move(i)} style={{ background: inWin ? F.greenBg : F.purpleSoft, border: inWin ? `2px solid ${F.green}` : 'none', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:32, fontWeight:700, cursor: (v || over) ? 'default' : 'pointer', color: inWin ? F.green : F.purpleDark, fontFamily:'inherit' }}>{v}</button>
          )
        })}
      </div>
      <div style={{ textAlign:'center' }}><button onClick={reset} style={btnPrimary}>New Game</button></div>
    </div>
  )
}

// ── Memory Match ────────────────────────────────────────────────
// Eight DISTINCT faces. They were eight empty strings, which meant
// Fisher–Yates. sort(() => Math.random() - 0.5) — what the prototype used — is not a
// uniform shuffle; some layouts come up far more often than others.
function shuffleDeck(): string[] {
  const d = [...MEM_FACES, ...MEM_FACES]
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]] }
  return d
}
function MemoryMatch({ onBack }: { onBack: () => void }) {
  // Cards are dealt in an effect, not in the initial state: Math.random() during render
  // would deal one deck on the server and a different one in the browser.
  const [cards, setCards] = useState<string[]>([])
  const [flipped, setFlipped] = useState<number[]>([])
  const [matched, setMatched] = useState<number[]>([])
  const [lock, setLock] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setCards(shuffleDeck()); setFlipped([]); setMatched([]); setLock(false)
  }, [])
  useEffect(() => { reset(); return () => { if (timer.current) clearTimeout(timer.current) } }, [reset])

  const flip = (i: number) => {
    if (lock || flipped.includes(i) || matched.includes(i)) return
    const next = [...flipped, i]
    setFlipped(next)
    if (next.length < 2) return
    const [a, b] = next
    if (cards[a] === cards[b]) { setMatched(m => [...m, a, b]); setFlipped([]); return }
    // Board locks during the flip-back so a third card can't be turned mid-check.
    setLock(true)
    timer.current = setTimeout(() => { setFlipped([]); setLock(false) }, 800)
  }

  const pairs = matched.length / 2
  return (
    <div style={panel}>
      <BackBtn onClick={onBack} />
      <div style={gameTitle}>Memory Match</div>
      <div style={gameSub}>{pairs === MEM_FACES.length ? 'You found them all!' : `Find all 8 pairs — ${pairs} found`}</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,70px)', gap:8, margin:'0 auto 16px', justifyContent:'center' }}>
        {cards.map((emoji, i) => {
          const isUp = flipped.includes(i), isDone = matched.includes(i)
          return (
            <button key={i} onClick={() => flip(i)} style={{ width:70, height:70, border:'none', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, cursor: isDone ? 'default' : 'pointer', fontFamily:'inherit', transition:'background .2s', background: isDone ? F.greenBg : isUp ? F.purpleSoft : F.purple, opacity: isDone ? .6 : 1 }}>
              {(isUp || isDone) ? emoji : ''}
            </button>
          )
        })}
      </div>
      <div style={{ textAlign:'center' }}><button onClick={reset} style={btnPrimary}>New Game</button></div>
    </div>
  )
}

// ── EZER Trivia ─────────────────────────────────────────────────
// Questions are hardcoded (brief §5). Making them HR-editable is an open question —
// it would need a table and a config screen.
function Trivia({ onBack }: { onBack: () => void }) {
  const [idx, setIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const restart = () => { if (timer.current) clearTimeout(timer.current); setIdx(0); setScore(0); setPicked(null) }
  const answer = (i: number) => {
    if (picked !== null) return   // one answer per question — ignore double taps
    setPicked(i)
    if (i === QUIZ[idx].correct) setScore(s => s + 1)
    timer.current = setTimeout(() => { setIdx(n => n + 1); setPicked(null) }, 900)
  }

  const done = idx >= QUIZ.length
  const item = done ? null : QUIZ[idx]
  return (
    <div style={panel}>
      <BackBtn onClick={onBack} />
      <div style={gameTitle}>EZER Trivia</div>
      <div style={{ textAlign:'right', fontWeight:700, color:F.purple, fontSize:13, marginBottom:14 }}>Score: {score} / {QUIZ.length}</div>
      {done ? (
        <>
          <div style={{ textAlign:'center', fontSize:16, fontWeight:700, color:F.purpleDark, margin:'10px 0 16px' }}>Quiz done! You scored {score}/{QUIZ.length}</div>
          <div style={{ textAlign:'center' }}><button onClick={restart} style={btnPrimary}>Play Again</button></div>
        </>
      ) : (
        <>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>Q{idx + 1}. {item!.q}</div>
          {item!.opts.map((o, i) => {
            const reveal = picked !== null
            const isCorrect = reveal && i === item!.correct
            const isWrong = reveal && i === picked && i !== item!.correct
            return (
              <button key={i} onClick={() => answer(i)} style={{ display:'block', width:'100%', textAlign:'left', borderRadius:10, padding:'10px 14px', marginBottom:8, cursor: reveal ? 'default' : 'pointer', fontFamily:'inherit', fontSize:13, color:F.navy, background: isCorrect ? F.greenBg : isWrong ? TK.criticalTint : F.purpleSoft, border:`2px solid ${isCorrect ? F.green : isWrong ? F.red : 'transparent'}` }}>{o}</button>
            )
          })}
        </>
      )}
    </div>
  )
}

// ── Spin the Wheel ──────────────────────────────────────────────
const PRIZES = ['Free Coffee ☕','Shoutout 📣','Extra Break ⏰','High-Five 🙌','WFH Day 🏠','Snack Treat 🍪']
const SEG = 360 / PRIZES.length
function SpinWheel({ onBack }: { onBack: () => void }) {
  const [deg, setDeg] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const spin = () => {
    if (spinning) return
    setSpinning(true); setResult('')
    // Rotation accumulates instead of restarting from 0, so a second spin never
    // animates backwards. The prize is read off where it stops — nothing is picked
    // in advance, so the wheel genuinely decides.
    const next = deg + (5 + Math.random() * 3) * 360 + Math.random() * 360
    setDeg(next)
    timer.current = setTimeout(() => {
      const resting = (360 - (next % 360)) % 360
      setResult(PRIZES[Math.floor(resting / SEG)])
      setSpinning(false)
    }, 4100)
  }

  return (
    <div style={panel}>
      <BackBtn onClick={onBack} />
      <div style={gameTitle}>Spin the Wheel</div>
      <div style={gameSub}>Tap spin for today&apos;s surprise</div>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
        <div style={{ width:0, height:0, borderLeft:'14px solid transparent', borderRight:'14px solid transparent', borderTop:`22px solid ${F.navy}`, marginBottom:-6, zIndex:2 }} />
        <div style={{ width:260, height:260, borderRadius:'50%', position:'relative', marginBottom:20, transform:`rotate(${deg}deg)`, transition:'transform 4s cubic-bezier(0.17,0.67,0.12,0.99)', background: `conic-gradient(${TK.brand} 0deg 60deg,${TK.critical} 60deg 120deg,${TK.brand} 120deg 180deg,${TK.positive} 180deg 240deg,${TK.warning} 240deg 300deg,${TK.brand} 300deg 360deg)` }}>
          {PRIZES.map((p, i) => (
            <div key={p} style={{ position:'absolute', top:'50%', left:'50%', color:TK.onAccent, fontWeight:700, fontSize:10, width:90, textAlign:'center', transformOrigin:'left center', transform:`rotate(${i * SEG + SEG / 2}deg) translateX(30px)` }}>{p.split(' ')[0]}</div>
          ))}
        </div>
        <button onClick={spin} disabled={spinning} style={{ ...btnPrimary, opacity: spinning ? .6 : 1, cursor: spinning ? 'wait' : 'pointer' }}>{spinning ? 'Spinning…' : 'Spin!'}</button>
        {result && <div style={{ textAlign:'center', fontSize:16, fontWeight:700, color:F.purpleDark, marginTop:10 }}>You got: {result}</div>}
      </div>
    </div>
  )
}

// ── Hub ─────────────────────────────────────────────────────────
/**
 * The hub. `employeeId` is optional so the four solo games still render for
 * any caller that has not got one — playing together is what needs to know
 * who you are, not Memory Match.
 */
export default function FunZone({ employeeId }: { employeeId?: string }) {
  const [game, setGame] = useState<string | null>(null)
  const back = () => setGame(null)

  if (game === 'together' && employeeId) return (
    <div>
      <BackBtn onClick={back} />
      <div style={gameTitle}>Play together</div>
      <div style={gameSub}>Invite a colleague and play on two screens, live.</div>
      <PlayTogether meId={employeeId} />
    </div>
  )
  if (game === 'ttt')   return <TicTacToe onBack={back} />
  if (game === 'mem')   return <MemoryMatch onBack={back} />
  if (game === 'quiz')  return <Trivia onBack={back} />
  if (game === 'wheel') return <SpinWheel onBack={back} />

  return (
    <div>
      <div style={{ fontSize:13, color:F.muted, marginBottom:16 }}>
        Take a break. The four games below are yours alone and nothing is saved
        — play together keeps a record of who played whom, and nothing else.
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:14 }}>
        {employeeId && (
          <button onClick={() => setGame('together')}
            style={{ ...panel, padding:20, cursor:'pointer', textAlign:'left',
                     fontFamily:'inherit', color:F.navy,
                     border:`2px solid ${TK.brand}` }}>
            <div style={{ fontSize:32, marginBottom:8 }}>&#127918;</div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:3 }}>Play together</div>
            <div style={{ fontSize:12, color:F.muted }}>
              Invite a colleague and play live, on two screens
            </div>
            <span style={{ display:'inline-block', fontSize:10, fontWeight:700,
                           padding:'2px 8px', borderRadius:999, marginTop:8,
                           background:TK.brandTint, color:TK.brandDeep }}>Live</span>
          </button>
        )}
        {GAMES.map(g => (
          <button key={g.k} onClick={() => setGame(g.k)} style={{ ...panel, padding:20, cursor:'pointer', border:`2px solid ${F.border}`, textAlign:'left', fontFamily:'inherit', color:F.navy }}>
            <div style={{ fontSize:32, marginBottom:8 }}>{g.icon}</div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:3 }}>{g.name}</div>
            <div style={{ fontSize:12, color:F.muted }}>{g.desc}</div>
            <span style={{ display:'inline-block', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:999, marginTop:8, background:g.bg, color:g.fg }}>{g.badge}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
