// src/features/intro/EntranceIntro.tsx — arriving at work, in 2.6 seconds.
//
// It starts as the system splash: the same emblem, centred, on the same ground, so
// the hand-over shows no join. The emblem lifts to the logo's place above a building
// that rises under it, the lights come on floor by floor, you walk up the path, your
// badge reads green, the doors slide, and the camera goes through them. There is no
// cut: the doorway is a hole, and what is behind it is the real next screen (see
// scene.tsx). The logo never leaves, it just stops being the intro's copy.
//
// One clock drives every layer on the UI thread, so a busy JS thread (Home loading
// underneath) cannot make it stutter. A tap runs out the clock. With reduced motion
// on, none of the movement plays: the logo holds for a moment and fades.
import * as React from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import Animated, {
  cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion,
  useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/ThemeProvider'
import { tick } from '@/ui/feel'
import { Emblem } from '@/ui/Logo'
import { LobbyHeader } from './Lobby'
import { Backdrop, Office, scenePalette, span, stageOf, TL, Walker } from './scene'
import { headerGap, reveal } from './state'

const EMBLEM = 112
const SKIP_MS = 300
const HEADER_H = 104 // the logo block's height, near enough, for placing the tower under it

export function EntranceIntro({ line, onDone }: { line: string; onDone: () => void }) {
  const { C, isDark } = useTheme()
  const { width: W, height: H } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const still = useReducedMotion()
  const [hour] = React.useState(() => new Date().getHours())
  const headerTop = insets.top + headerGap()
  const st = React.useMemo(() => stageOf(W, H, headerTop + HEADER_H), [W, H, headerTop])
  const pal = React.useMemo(() => scenePalette(isDark, hour, C.canvas, C.logoWord, C.logoWordSoft), [isDark, hour, C])

  const clock = useSharedValue(0)
  const fade = useSharedValue(1)
  const doneOnce = React.useRef(false)
  const finish = React.useCallback(() => {
    if (doneOnce.current) return
    doneOnce.current = true
    reveal.set(1)
    onDone()
  }, [onDone])

  React.useEffect(() => {
    if (still) {
      reveal.set(1)
      fade.set(withDelay(520, withTiming(0, { duration: 260, reduceMotion: ReduceMotion.Never }, ok => { if (ok) runOnJS(finish)() })))
    } else {
      clock.set(withTiming(TL.END, { duration: TL.END, easing: Easing.linear }, ok => { if (ok) runOnJS(finish)() }))
    }
    // A safety net: nothing about an animation may ever keep someone out of the app.
    const net = setTimeout(finish, TL.END + 2000)
    return () => clearTimeout(net)
  }, [still, clock, fade, finish])

  useAnimatedReaction(() => clock.get(), v => { reveal.set(span(v, TL.reveal)) })
  useAnimatedReaction(() => clock.get() >= TL.ping[0], (read, was) => { if (read && was === false) runOnJS(tick)() })

  const skip = () => {
    if (still) return
    cancelAnimation(clock)
    clock.set(withTiming(TL.END, { duration: SKIP_MS, easing: Easing.linear }, ok => { if (ok) runOnJS(finish)() }))
  }

  const camera = useAnimatedStyle(() => {
    const z = Math.max(0, Math.min(1, (clock.get() - TL.zoom[0]) / (TL.zoom[1] - TL.zoom[0])))
    return { transform: [{ scale: 1 + (st.zoom - 1) * z * z * z }] }
  })
  const cover = useAnimatedStyle(() => ({ opacity: 1 - span(clock.get(), TL.coverOut) }))
  const lightBehind = useAnimatedStyle(() => ({ opacity: 1 - span(clock.get(), TL.lightOut) }))
  const emblem = useAnimatedStyle(() => {
    const p = span(clock.get(), TL.emblem)
    const toY = headerTop + 20 - H / 2
    return {
      opacity: 1 - span(clock.get(), [TL.header[0] + 40, TL.header[1] - 40]),
      transform: [{ translateX: -p * 56 * (W / 360) }, { translateY: p * toY }, { scale: 1 - p * 0.65 }],
    }
  })
  const header = useAnimatedStyle(() => ({ opacity: span(clock.get(), TL.header) * (1 - span(clock.get(), TL.reveal)) }))
  const all = useAnimatedStyle(() => ({ opacity: fade.get() }))

  if (still) {
    return (
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.canvas }, all]}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: headerTop }}><LobbyHeader line={line} /></View>
      </Animated.View>
    )
  }

  const full = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 }
  return (
    <Pressable onPress={skip} accessibilityLabel="Skip the intro" style={full}>
      {pal.night && !isDark && <StatusBar style="light" />}
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H, transformOrigin: [st.cx, st.cy, 0] }, camera]}>
        <Backdrop st={st} pal={pal} hour={hour} />
        {/* Inside the doors: the light you walk into, until the real screen takes over. */}
        <Animated.View style={[{ position: 'absolute', left: st.dx, top: st.dy, width: st.door.w, height: st.door.h, backgroundColor: pal.light }, lightBehind]} />
        <Office st={st} pal={pal} clock={clock} />
        <Walker st={st} pal={pal} clock={clock} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[full, { backgroundColor: C.canvas }, cover]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: headerTop }, header]}>
        <LobbyHeader line={line} ink={pal.onSky} soft={pal.onSkySoft} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: W / 2 - (EMBLEM * (108 / 105)) / 2, top: H / 2 - EMBLEM / 2 }, emblem]}>
        <Emblem size={EMBLEM} id="ezintro" />
      </Animated.View>
    </Pressable>
  )
}

