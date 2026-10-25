// src/features/funzone/FunZoneScreen.tsx — ESS Fun Zone (components/ess/FunZone.tsx).
//
// Hub-and-spoke, all state-driven inside one screen as on the website: the hub's
// tiles open a game; ttt/mem/quiz first ask HOW (ModeScreen); the wheel and every
// mind game open straight in. Back (header arrow, the stage's Back button, or the
// Android back key) walks the same steps back: game → modes → hub → out.
//
// Nothing here touches the database except Play Together (invites + live play).
// Solo, bot and mind-game scores reset on leaving — the footer says so.
import * as React from 'react'
import { Animated, BackHandler, Easing, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Rect } from 'react-native-svg'
import { MIND_GAMES, CATEGORY_LABEL, type Category } from '@web/funzone/mindgames'
import { useEmployeeId } from '@/core/session'
import { Screen } from '@/ui/Screen'
import { Txt } from '@/ui/primitives'
import { router } from 'expo-router'
import { accentOf, alpha, CatProvider, DISPLAY, FzScrollCtx, Key, Stage, useFz, useReduceMotion, ViewIn, type Cat } from './kit'
import { MemoryMatch, SpinWheel, TicTacToe, Trivia } from './classics'
import { MemoryVsBot, TicTacToeVsBot, TriviaVsBot } from './vs'
import { MindGame } from './mind'
import PlayTogether from './live/PlayTogether'

// ── the catalogue (FunZone.tsx GAMES / MIND_TILES) ──────────────
interface Tile { k: string; icon: string; name: string; desc: string; badge: string; cat: Cat; live?: boolean; bot?: boolean }

const GAMES: Tile[] = [
  { k: 'ttt', icon: '⭕', name: 'Tic-Tac-Toe', desc: 'Against the computer, or a colleague', badge: 'Arcade', cat: 'arcade', live: true, bot: true },
  { k: 'mem', icon: '🧩', name: 'Memory Match', desc: 'Find the pairs, alone or head to head', badge: 'Arcade', cat: 'memory', live: true, bot: true },
  { k: 'quiz', icon: '💡', name: 'EZER Trivia', desc: 'Company policy, solo or against somebody', badge: 'Quiz', cat: 'quiz', live: true, bot: true },
  { k: 'wheel', icon: '🎡', name: 'Spin the Wheel', desc: 'Daily spin: win a fun shoutout or a treat', badge: 'Social', cat: 'social' },
]
const MIND_TILES: Tile[] = MIND_GAMES.map(g => ({ k: g.code, icon: g.icon, name: g.name, desc: g.desc, badge: CATEGORY_LABEL[g.cat], cat: g.cat }))
const ALL_TILES = [...GAMES, ...MIND_TILES]

type Mode = 'solo' | 'bot' | 'live'
interface ModeDef { k: Mode; label: string; hint: string }
const MODE_ICON: Record<Mode, string> = { bot: '🤖', solo: '🎮', live: '🤝' }
const MODES: Record<string, ModeDef[]> = {
  ttt: [
    { k: 'bot', label: 'Against the computer', hint: 'Three difficulties. Hard is unbeatable: a draw is the best there is.' },
    { k: 'solo', label: 'Two players, one screen', hint: 'Pass the device back and forth.' },
    { k: 'live', label: 'With a colleague', hint: 'Invite somebody and play on two screens.' },
  ],
  mem: [
    { k: 'bot', label: 'Against the computer', hint: 'It remembers what it has seen, more of it on harder settings.' },
    { k: 'solo', label: 'On your own', hint: 'Find all eight pairs. Nothing is timed.' },
    { k: 'live', label: 'With a colleague', hint: 'Take turns on two screens.' },
  ],
  quiz: [
    { k: 'bot', label: 'Against the computer', hint: 'It answers too, and it does not always know.' },
    { k: 'solo', label: 'On your own', hint: 'Four questions, no opponent.' },
    { k: 'live', label: 'With a colleague', hint: 'Head to head on the same questions.' },
  ],
  wheel: [],
}

type Filter = 'all' | 'live' | Category
const FILTERS: { k: Filter; label: string }[] = [
  { k: 'all', label: 'All' }, { k: 'live', label: 'With a colleague' }, { k: 'puzzle', label: 'Puzzle' },
  { k: 'memory', label: 'Memory' }, { k: 'logic', label: 'Logic' }, { k: 'brain', label: 'Brain' },
  { k: 'words', label: 'Words' }, { k: 'reflex', label: 'Reflex' },
]
const matches = (t: Tile, f: Filter) => (f === 'all' ? true : f === 'live' ? !!t.live : t.cat === f)

/** funzone.css .fz-title span:nth-child(n) — one colour per letter of "Fun Zone". */
const TITLE = 'Fun Zone'.split('')
const LETTER = ['#C4B5FD', '#FCD34D', '#5EEAD4', '', '#F9A8D4', '#93C5FD', '#86EFAC', '#FDBA74']
/** The hero's "Surprise me" key (funzone.css .fz-hero .fz-key). */
const AMBER = '#FBBF24', AMBER_INK = '#1E1B4B'

// ── hub pieces (module level) ───────────────────────────────────
function Letter({ ch, i, calm }: { ch: string; i: number; calm: boolean }) {
  const v = React.useState(() => new Animated.Value(calm ? 1 : 0))[0]
  React.useEffect(() => {
    if (calm) return
    Animated.timing(v, { toValue: 1, duration: 700, delay: i * 45, easing: Easing.bezier(0.2, 0.9, 0.25, 1.15), useNativeDriver: true }).start()
  }, [v, i, calm])
  if (ch === ' ') return <View style={{ width: 13 }} />
  return (
    <Animated.Text style={{ fontFamily: DISPLAY, fontSize: 48, lineHeight: 50, letterSpacing: -1.6, color: LETTER[i], opacity: v,
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '0deg'] }) }] }}>
      {ch}
    </Animated.Text>
  )
}

const Dice = () => (
  <Svg width={18} height={18} viewBox="0 0 20 20" fill="none">
    <Rect x={2.5} y={2.5} width={15} height={15} rx={3.5} stroke={AMBER_INK} strokeWidth={2} />
    <Circle cx={7} cy={7} r={1.4} fill={AMBER_INK} /><Circle cx={13} cy={13} r={1.4} fill={AMBER_INK} /><Circle cx={10} cy={10} r={1.4} fill={AMBER_INK} />
  </Svg>
)

function GameTile({ t, i, big, onOpen, width }: { t: Tile; i: number; big?: boolean; onOpen: (k: string) => void; width: number }) {
  const fz = useFz()
  const ac = accentOf(t.cat, fz.isDark)
  const calm = useReduceMotion()
  const v = React.useState(() => new Animated.Value(calm ? 1 : 0))[0]
  React.useEffect(() => {
    if (calm) return
    Animated.timing(v, { toValue: 1, duration: 550, delay: i * 40, easing: Easing.bezier(0.2, 0.9, 0.25, 1.15), useNativeDriver: true }).start()
  }, [v, i, calm])
  return (
    <Animated.View style={{ width, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: [`${(i - 3) * 1.4}deg`, '0deg'] }) }] }}>
      <Pressable onPress={() => onOpen(t.k)} accessibilityRole="button" accessibilityLabel={`${t.name}. ${t.desc}`}
        style={({ pressed }) => ({
          padding: 8, borderRadius: 20, backgroundColor: fz.C.surface, borderWidth: 1.5, borderColor: pressed ? ac.a : fz.edge,
          borderBottomWidth: pressed ? 3 : 6, borderBottomColor: pressed ? ac.a : fz.keycap, marginTop: pressed ? 3 : 0,
        })}>
        <View style={{ height: 84, borderRadius: 14, backgroundColor: ac.tint, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={big ? 42 : 40} style={{ lineHeight: 50 }}>{t.icon}</Txt>
        </View>
        <View style={{ paddingTop: 12, paddingHorizontal: 8, paddingBottom: 6 }}>
          <Txt size={17} w={800} style={{ fontFamily: DISPLAY, letterSpacing: -0.3, lineHeight: 20 }}>{t.name}</Txt>
          <Txt size={12.5} tone="muted" style={{ marginTop: 4, lineHeight: 18 }}>{t.desc}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: ac.tint }}><Txt size={11} w={700} color={ac.ink}>{t.badge}</Txt></View>
            {t.bot && <View style={{ paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: fz.C.line }}><Txt size={11} w={700} tone="muted">🤖 Bot</Txt></View>}
            {t.live && <View style={{ paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: fz.C.line }}><Txt size={11} w={700} tone="muted">🤝 Live</Txt></View>}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}

function Grid({ tiles, start, big, onOpen }: { tiles: Tile[]; start: number; big?: boolean; onOpen: (k: string) => void }) {
  const { width } = useWindowDimensions()
  // ≤560px: two columns, gap 12 (funzone.css). The screen has 16dp gutters.
  const inner = Math.min(width, 760) - 32
  const cols = inner >= 560 ? (big ? 4 : 3) : 2
  const w = Math.floor((inner - 12 * (cols - 1)) / cols)
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {tiles.map((t, i) => <GameTile key={t.k} t={t} i={start + i} big={big} width={w} onOpen={onOpen} />)}
    </View>
  )
}

function Shelf({ title, note, children }: { title?: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 28 }}>
      {!!title && (
        <View style={{ marginBottom: 14, marginHorizontal: 2 }}>
          <Txt size={22} w={800} style={{ fontFamily: DISPLAY, letterSpacing: -0.4, lineHeight: 26 }}>{title}</Txt>
          {!!note && <Txt size={13} tone="muted" style={{ marginTop: 2 }}>{note}</Txt>}
        </View>
      )}
      {children}
    </View>
  )
}

function Hub({ employeeId, onOpen }: { employeeId?: string; onOpen: (k: string) => void }) {
  const fz = useFz()
  const calm = useReduceMotion()
  const [filter, setFilter] = React.useState<Filter>('all')
  const shown = React.useMemo(() => ALL_TILES.filter(t => matches(t, filter)), [filter])
  const surprise = () => {
    const pool = shown.length ? shown : ALL_TILES
    onOpen(pool[Math.floor(Math.random() * pool.length)].k)
  }
  const count = (f: Filter) => ALL_TILES.filter(t => matches(t, f)).length
  return (
    <ViewIn>
      <View style={{ backgroundColor: fz.stage, borderRadius: 20, paddingTop: 22, paddingHorizontal: 18, paddingBottom: 20, marginBottom: 26, borderWidth: 1.5, borderColor: fz.edge, overflow: 'hidden' }}>
        <View pointerEvents="none" style={{ position: 'absolute', right: -80, top: -120, width: 300, height: 300, borderRadius: 150, backgroundColor: alpha('#8B5CF6', 0.28) }} />
        <View accessible accessibilityRole="header" accessibilityLabel="Fun Zone" style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
          {TITLE.map((ch, i) => <Letter key={i} ch={ch} i={i} calm={calm} />)}
        </View>
        <Txt size={14.5} color={fz.onStage2} style={{ lineHeight: 23 }}>
          Take a break. Play on your own, against the computer, or with a colleague on two screens. Nothing here is scored towards anything.
        </Txt>
        <View style={{ marginTop: 20, alignItems: 'flex-start' }}>
          <CatProvider cat="arcade">
            <Key size="lg" title="Surprise me" onPress={surprise} bg={AMBER} fg={AMBER_INK} shadow="#8A6612" icon={<Dice />}>
              <Txt size={16} w={700} color={AMBER_INK}>Surprise me</Txt>
            </Key>
          </CatProvider>
          <Txt size={12.5} color={fz.onStage2} style={{ marginTop: 10 }}>{ALL_TILES.length} games, {GAMES.filter(g => g.live).length} of them live</Txt>
        </View>
        <View accessibilityLabel="Show games" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 22 }}>
          {FILTERS.map(f => {
            const on = filter === f.k
            return (
              <Pressable key={f.k} onPress={() => setFilter(f.k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ minHeight: 36, justifyContent: 'center', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: on ? fz.onStage : 'rgba(255,255,255,0.18)', backgroundColor: on ? fz.onStage : 'transparent' }}>
                <Txt size={13} w={600} color={on ? fz.stage : fz.onStage}>{f.label} <Txt size={13} w={500} color={on ? fz.stage : fz.onStage} style={{ opacity: 0.6 }}>{count(f.k)}</Txt></Txt>
              </Pressable>
            )
          })}
        </View>
      </View>

      {filter === 'all' ? (
        <>
          <Shelf title="Classics" note={`On your own, against the computer, or head to head with a colleague${employeeId ? '' : ' once you are signed in'}.`}>
            <Grid tiles={GAMES} start={0} big onOpen={onOpen} />
          </Shelf>
          <Shelf title="Mind games" note="Quick solo puzzles for a five-minute break.">
            <Grid tiles={MIND_TILES} start={4} onOpen={onOpen} />
          </Shelf>
        </>
      ) : (
        <Shelf><Grid key={filter} tiles={shown} start={0} onOpen={onOpen} /></Shelf>
      )}
      <Txt size={12.5} tone="muted" center style={{ marginTop: 6, marginBottom: 4 }}>Scores reset when you leave a game. Nothing here is saved or ranked.</Txt>
    </ViewIn>
  )
}

function ModeCard({ m, cat, onPick }: { m: ModeDef; cat: Cat; onPick: (m: Mode) => void }) {
  const fz = useFz()
  const ac = accentOf(cat, fz.isDark)
  return (
    <Pressable onPress={() => onPick(m.k)} accessibilityRole="button" accessibilityLabel={`${m.label}. ${m.hint}`}
      style={({ pressed }) => ({
        gap: 8, padding: 18, borderRadius: 18, backgroundColor: fz.C.surface, borderWidth: 1.5, borderColor: pressed ? ac.a : fz.edge,
        borderBottomWidth: pressed ? 2 : 5, borderBottomColor: pressed ? ac.a : fz.keycap, marginTop: pressed ? 3 : 0,
      })}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: ac.tint, alignItems: 'center', justifyContent: 'center' }}><Txt size={24} style={{ lineHeight: 30 }}>{MODE_ICON[m.k]}</Txt></View>
      <Txt size={18} w={800} style={{ fontFamily: DISPLAY, letterSpacing: -0.2 }}>{m.label}</Txt>
      <Txt size={12.5} tone="muted" style={{ lineHeight: 19 }}>{m.hint}</Txt>
    </Pressable>
  )
}

function ModeScreen({ game, employeeId, onPick, onBack }: { game: string; employeeId?: string; onPick: (m: Mode) => void; onBack: () => void }) {
  const g = GAMES.find(x => x.k === game)!
  const opts = (MODES[game] ?? []).filter(m => m.k !== 'live' || employeeId)
  return (
    <Stage cat={g.cat} icon={g.icon} title={g.name} sub="How do you want to play?" onBack={onBack} left>
      <View style={{ gap: 14 }}>
        {opts.map(m => <ModeCard key={m.k} m={m} cat={g.cat} onPick={onPick} />)}
      </View>
      {!employeeId && <Txt size={12} tone="muted" center>Playing with a colleague needs you to be signed in to ESS.</Txt>}
    </Stage>
  )
}

export default function FunZoneScreen() {
  const employeeId = useEmployeeId()
  const [game, setGame] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<Mode | null>(null)
  const [scrollOn, setScrollOn] = React.useState(true)
  const scroll = React.useRef<ScrollView>(null)
  const back = React.useCallback(() => { setGame(null); setMode(null) }, [])
  const backToModes = React.useCallback(() => setMode(null), [])

  // Every screen change starts at the top, not wherever the hub was scrolled to.
  React.useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }) }, [game, mode])

  // The header arrow and the Android back key walk the same steps as Back.
  const step = React.useCallback(() => {
    if (game && mode) { setMode(null); return true }
    if (game) { back(); return true }
    return false
  }, [game, mode, back])
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', step)
    return () => sub.remove()
  }, [step])

  let screen: React.ReactNode = null
  if (game === 'wheel') screen = <SpinWheel onBack={back} />
  else if (game && MIND_GAMES.some(m => m.code === game)) screen = <MindGame code={game} onBack={back} />
  else if (game && !mode) screen = <ModeScreen game={game} employeeId={employeeId} onPick={setMode} onBack={back} />
  else if (game && mode) {
    const g = GAMES.find(x => x.k === game)!
    if (mode === 'live' && employeeId) {
      screen = (
        <Stage cat={g.cat} icon="🤝" title="Play together" sub="Invite a colleague and play on two screens, live." onBack={backToModes} left>
          <PlayTogether meId={employeeId} />
        </Stage>
      )
    } else if (mode === 'bot' && game === 'ttt') screen = <TicTacToeVsBot onBack={backToModes} />
    else if (mode === 'bot' && game === 'mem') screen = <MemoryVsBot onBack={backToModes} />
    else if (mode === 'bot' && game === 'quiz') screen = <TriviaVsBot onBack={backToModes} />
    else if (game === 'ttt') screen = <TicTacToe onBack={backToModes} />
    else if (game === 'mem') screen = <MemoryMatch onBack={backToModes} />
    else if (game === 'quiz') screen = <Trivia onBack={backToModes} />
  }

  const scrollCtx = React.useMemo(() => ({ setScrollEnabled: setScrollOn }), [])
  return (
    <Screen title="Fun Zone" subtitle="Take a break: play a quick game with your team" scroll={false} padded={false}
      onBack={() => { if (step()) return; if (router.canGoBack()) router.back(); else router.replace('/') }}>
      <FzScrollCtx.Provider value={scrollCtx}>
        <ScrollView ref={scroll} scrollEnabled={scrollOn} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {screen ?? <Hub employeeId={employeeId} onOpen={k => { setGame(k); setMode(null) }} />}
        </ScrollView>
      </FzScrollCtx.Provider>
    </Screen>
  )
}
