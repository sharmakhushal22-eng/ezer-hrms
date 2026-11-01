// src/features/intro/scene.tsx — the office. Everything here is a flat, painted
// layer: motion comes only from moving those layers (transform and opacity), which
// the phone's GPU does by itself, so a mid-range handset keeps up.
//
// THE DOORWAY IS A REAL HOLE. The sky and the building are drawn with a door-shaped
// gap (even-odd fill). Whatever sits underneath the intro, the login screen or
// Home, is what you see through it, so pushing through the doors needs no cut and
// no fake second screen.
import * as React from 'react'
import { View } from 'react-native'
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Circle, Defs, LinearGradient as SvgLinear, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

/** The running order, in ms. The whole thing is one clock. */
export const TL = {
  END: 2600,
  coverOut: [40, 340], emblem: [60, 560], header: [420, 700], rise: [100, 720],
  floors: 280, floorStep: 60, walk: [380, 1520], ping: [1380, 1700], doors: [1480, 1800],
  gone: [1640, 1820], zoom: [1760, 2560], lightOut: [2060, 2380], reveal: [2000, 2560],
} as const

const seg = (v: number, r: readonly [number, number]) => { 'worklet'; return Math.max(0, Math.min(1, (v - r[0]) / (r[1] - r[0]))) }
export const smooth = (x: number) => { 'worklet'; return x * x * (3 - 2 * x) }
export const span = (v: number, r: readonly [number, number]) => { 'worklet'; return smooth(seg(v, r)) }

export interface ScenePalette {
  night: boolean
  sky: [string, string, string]; orb: string; far: string; near: string
  ground: string; path: string; lane: string
  towerA: string; towerB: string; trim: string; lobby: string
  winOff: string; winOn: string; glass: string; frame: string
  figure: string; jacket: string; bag: string; badge: string
  light: string; onSky: string; onSkySoft: string
}

/** Dark theme, or after hours, is the night scene; the door is lit either way. */
export function scenePalette(isDark: boolean, hour: number, light: string, ink: string, soft: string): ScenePalette {
  const night = isDark || hour >= 18 || hour < 6
  return night ? {
    night, sky: ['#070F2B', '#12235A', '#1E3A8A'], orb: 'rgba(219,234,254,0.85)', far: '#0E1B45', near: '#0B1638',
    ground: '#0A1430', path: '#101D42', lane: 'rgba(255,255,255,0.16)',
    towerA: '#1E3A8A', towerB: '#0B1D4D', trim: '#070F2B', lobby: 'rgba(253,230,138,0.20)',
    winOff: 'rgba(255,255,255,0.07)', winOn: '#FDE68A', glass: 'rgba(147,197,253,0.42)', frame: '#60A5FA',
    figure: '#BFDBFE', jacket: '#60A5FA', bag: '#1E3A8A', badge: '#FDE68A',
    light, onSky: '#FFFFFF', onSkySoft: 'rgba(255,255,255,0.72)',
  } : {
    night, sky: ['#BFDBFE', '#DBEAFE', '#EFF6FF'], orb: 'rgba(255,255,255,0.95)', far: '#D6E4F7', near: '#C3D6F0',
    ground: '#E8EEF7', path: '#D9E3F1', lane: 'rgba(255,255,255,0.95)',
    towerA: '#3B82F6', towerB: '#1D4ED8', trim: '#1E3A8A', lobby: 'rgba(224,242,254,0.30)',
    winOff: 'rgba(255,255,255,0.16)', winOn: '#E0F2FE', glass: 'rgba(191,219,254,0.78)', frame: '#0B1D4D',
    figure: '#0B1D4D', jacket: '#1D4ED8', bag: '#0B1D4D', badge: '#38BDF8',
    light, onSky: ink, onSkySoft: soft,
  }
}

/** Everything's position, from the screen's size. */
export function stageOf(W: number, H: number, headerBottom: number) {
  const u = W / 360
  const horizon = H * 0.76
  const door = { w: 76 * u, h: Math.min(110 * u, H * 0.15) }
  const dx = (W - door.w) / 2, dy = horizon - door.h
  const towerW = 184 * u, towerX = (W - towerW) / 2, towerTop = Math.max(H * 0.3, headerBottom + 18)
  const wingW = 50 * u, wingTop = horizon - (horizon - towerTop) * 0.5
  const rowH = 26 * u
  const firstRow = towerTop + 16 * u
  const rows = Math.max(3, Math.floor((dy - 30 * u - firstRow) / rowH))
  // How far the camera must push for the door to clear the screen on every side.
  const zoom = Math.max(W / door.w, (2 * Math.max(dy + door.h / 2, H - dy - door.h / 2)) / door.h) * 1.08
  return { u, W, H, horizon, door, dx, dy, towerW, towerX, towerTop, wingW, wingTop, rowH, firstRow, rows, zoom, cx: W / 2, cy: dy + door.h / 2 }
}
export type Stage = ReturnType<typeof stageOf>

const box = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}z`

/** Sky, far city and street. Painted once. */
export function Backdrop({ st, pal, hour }: { st: Stage; pal: ScenePalette; hour: number }) {
  const { W, H, horizon, u, dx, dy, door } = st
  const orbX = hour < 12 ? W * 0.14 : W * 0.86
  const stars = pal.night ? [[.08, .1], [.2, .19], [.34, .07], [.62, .12], [.78, .2], [.9, .09], [.14, .28], [.86, .3]] : []
  const far: [number, number, number][] = [[-6, 58, .46], [46, 44, .36], [84, 40, .5], [236, 46, .42], [276, 40, .54], [312, 60, .4]]
  const near: [number, number, number][] = [[-10, 52, .3], [36, 38, .22], [262, 42, .26], [300, 70, .33]]
  const bottom = W / 2
  return (
    <Svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
      <Defs>
        <SvgLinear id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={pal.sky[0]} /><Stop offset="0.55" stopColor={pal.sky[1]} /><Stop offset="1" stopColor={pal.sky[2]} />
        </SvgLinear>
        <RadialGradient id="orb" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={pal.orb} /><Stop offset="0.24" stopColor={pal.orb} /><Stop offset="1" stopColor={pal.orb} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Path d={`${box(0, 0, W, horizon)}${box(dx, dy, door.w, door.h)}`} fill="url(#sky)" fillRule="evenodd" />
      <Circle cx={orbX} cy={H * 0.3} r={70 * u} fill="url(#orb)" />
      {stars.map(([x, y], i) => <Circle key={i} cx={W * x} cy={H * y} r={1.1} fill="#FFFFFF" opacity={0.7} />)}
      {far.map(([x, w, h], i) => <Rect key={i} x={x * u} y={horizon - H * h} width={w * u} height={H * h} fill={pal.far} />)}
      {near.map(([x, w, h], i) => <Rect key={i} x={x * u} y={horizon - H * h} width={w * u} height={H * h} fill={pal.near} />)}
      <Rect x={0} y={horizon} width={W} height={H - horizon} fill={pal.ground} />
      {/* The path to the door, in perspective, with its lane markings. */}
      <Path d={`M${W / 2 - door.w * 0.55} ${horizon}L${W / 2 + door.w * 0.55} ${horizon}L${W / 2 + bottom * 1.05} ${H}L${W / 2 - bottom * 1.05} ${H}Z`} fill={pal.path} />
      {[.12, .3, .56].map((p, i) => {
        const y = horizon + (H - horizon) * p, l = (H - horizon) * .1 * (1 + i)
        return <Path key={i} d={`M${W / 2 - (1 + i)} ${y}h${2 + 2 * i}l${1 + i} ${l}h${-(4 + 4 * i)}z`} fill={pal.lane} />
      })}
    </Svg>
  )
}

/** The tower and its wings, with the doorway cut out. */
function Building({ st, pal }: { st: Stage; pal: ScenePalette }) {
  const { W, H, horizon, dx, dy, door, towerX, towerW, towerTop, wingW, wingTop, u } = st
  const l = towerX - wingW, r = towerX + towerW + wingW, tr = towerX + towerW, c = 10 * u
  const outline = `M${l} ${horizon}V${wingTop}H${towerX}V${towerTop + c}Q${towerX} ${towerTop} ${towerX + c} ${towerTop}H${tr - c}Q${tr} ${towerTop} ${tr} ${towerTop + c}V${wingTop}H${r}V${horizon}Z`
  const lobbyY = dy + 8 * u
  return (
    <Svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
      <Defs>
        <SvgLinear id="tower" x1="0" y1="0" x2="0.6" y2="1">
          <Stop offset="0" stopColor={pal.towerA} /><Stop offset="1" stopColor={pal.towerB} />
        </SvgLinear>
      </Defs>
      <Path d={`${outline}${box(dx, dy, door.w, door.h)}`} fill="url(#tower)" fillRule="evenodd" />
      {/* a sheet of reflected light across the glass */}
      <Path d={`M${towerX} ${towerTop + 80 * u}L${towerX + 70 * u} ${towerTop}H${towerX + 112 * u}L${towerX} ${towerTop + 130 * u}Z`} fill="#FFFFFF" opacity={0.07} />
      <Rect x={W / 2 - 1} y={towerTop - 22 * u} width={2} height={22 * u} fill={pal.trim} />
      <Rect x={towerX + 26 * u} y={towerTop - 4 * u} width={towerW - 52 * u} height={4 * u} rx={2} fill={pal.trim} />
      {/* the glass ground floor either side of the door */}
      <Rect x={l + 8 * u} y={lobbyY} width={dx - l - 16 * u} height={horizon - lobbyY} fill={pal.lobby} />
      <Rect x={dx + door.w + 8 * u} y={lobbyY} width={r - dx - door.w - 16 * u} height={horizon - lobbyY} fill={pal.lobby} />
      {/* canopy and frame */}
      <Rect x={dx - 15 * u} y={dy - 13 * u} width={door.w + 30 * u} height={7 * u} rx={3} fill={pal.trim} />
      <Rect x={dx - 2.5} y={dy - 2.5} width={door.w + 5} height={door.h + 2.5} fill="none" stroke={pal.frame} strokeWidth={3} />
    </Svg>
  )
}

/** One floor of windows. Lights come on a floor at a time, from the street up. */
function Floor({ st, pal, clock, index }: { st: Stage; pal: ScenePalette; clock: SharedValue<number>; index: number }) {
  const { u, towerX, towerW, wingW, firstRow, rowH, rows, wingTop } = st
  const y = firstRow + index * rowH
  const wings = y >= wingTop + 8 * u
  const x0 = wings ? towerX - wingW + 8 * u : towerX + 10 * u
  const width = wings ? towerW + wingW * 2 - 16 * u : towerW - 20 * u
  const cols = wings ? 9 : 6, gap = 5 * u, w = (width - gap * (cols - 1)) / cols, h = rowH - 9 * u
  // Not every window: a building where every light is on looks like a diagram.
  const lit = (c: number) => (c * 7 + index * 5) % 4 !== 0
  const start = TL.floors + (rows - 1 - index) * TL.floorStep
  const on = useAnimatedStyle(() => ({ opacity: interpolate(clock.get(), [start, start + 180], [0, 1], Extrapolation.CLAMP) }))
  const row = (ink: (c: number) => string | null) => Array.from({ length: cols }, (_, c) => {
    const bg = ink(c)
    return <View key={c} style={{ position: 'absolute', left: c * (w + gap), top: 0, width: w, height: h, borderRadius: 1.5, backgroundColor: bg ?? 'transparent' }} />
  })
  return (
    <View style={{ position: 'absolute', left: x0, top: y, width, height: h }}>
      {row(() => pal.winOff)}
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width, height: h }, on]}>{row(c => (lit(c) ? pal.winOn : null))}</Animated.View>
    </View>
  )
}

/** The building, the doors and the badge reader. Rises into place as a single layer. */
export function Office({ st, pal, clock }: { st: Stage; pal: ScenePalette; clock: SharedValue<number> }) {
  const { dx, dy, door, u, W, H } = st
  const rise = useAnimatedStyle(() => {
    const p = span(clock.get(), TL.rise)
    return { opacity: p, transform: [{ translateY: (1 - p) * 26 * u }] }
  })
  const left = useAnimatedStyle(() => ({ transform: [{ translateX: -span(clock.get(), TL.doors) * (door.w / 2 - 3 * u) }] }))
  const right = useAnimatedStyle(() => ({ transform: [{ translateX: span(clock.get(), TL.doors) * (door.w / 2 - 3 * u) }] }))
  const ring = useAnimatedStyle(() => {
    const p = span(clock.get(), TL.ping)
    return { opacity: clock.get() < TL.ping[0] ? 0 : (1 - p) * 0.9, transform: [{ scale: 0.5 + p * 2.2 }] }
  })
  const granted = useAnimatedStyle(() => ({ opacity: clock.get() >= TL.ping[0] ? 1 : 0 }))
  const bloom = useAnimatedStyle(() => ({ opacity: span(clock.get(), TL.doors) }))
  const panel = { position: 'absolute' as const, top: 0, bottom: 0, width: door.w / 2, backgroundColor: pal.glass }
  const R = door.w * 1.5
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H }, rise]}>
      <Building st={st} pal={pal} />
      {Array.from({ length: st.rows }, (_, i) => <Floor key={i} st={st} pal={pal} clock={clock} index={i} />)}
      {/* the glow that spills from the open doors */}
      <Animated.View style={[{ position: 'absolute', left: st.cx - R, top: st.cy - R, width: R * 2, height: R * 2 }, bloom]}>
        <Svg width={R * 2} height={R * 2}>
          <Defs>
            <RadialGradient id="spill" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={pal.light} stopOpacity={0.75} /><Stop offset="1" stopColor={pal.light} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={R} cy={R} r={R} fill="url(#spill)" />
        </Svg>
      </Animated.View>
      <View style={{ position: 'absolute', left: dx, top: dy, width: door.w, height: door.h, overflow: 'hidden' }}>
        <Animated.View style={[panel, { left: 0, borderRightWidth: 1, borderRightColor: pal.frame }, left]}>
          <View style={{ position: 'absolute', right: 5 * u, top: '42%', width: 2.5 * u, height: 18 * u, borderRadius: 2, backgroundColor: pal.frame }} />
        </Animated.View>
        <Animated.View style={[panel, { right: 0, borderLeftWidth: 1, borderLeftColor: pal.frame }, right]}>
          <View style={{ position: 'absolute', left: 5 * u, top: '42%', width: 2.5 * u, height: 18 * u, borderRadius: 2, backgroundColor: pal.frame }} />
        </Animated.View>
      </View>
      {/* the badge reader: blue, a ping, then green */}
      <View style={{ position: 'absolute', left: dx + door.w + 7 * u, top: dy + door.h * 0.46, width: 8 * u, height: 12 * u, borderRadius: 2, backgroundColor: pal.trim, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 3.5 * u, height: 3.5 * u, borderRadius: 2, backgroundColor: '#38BDF8' }} />
        <Animated.View style={[{ position: 'absolute', width: 3.5 * u, height: 3.5 * u, borderRadius: 2, backgroundColor: '#34D399' }, granted]} />
        <Animated.View style={[{ position: 'absolute', width: 16 * u, height: 16 * u, borderRadius: 8 * u, borderWidth: 1.5, borderColor: '#34D399' }, ring]} />
      </View>
    </Animated.View>
  )
}

const LEG_H = 66, FIG_W = 64, FIG_H = 160

/** The stride, 2.5 cycles over the walk, slowing as you reach the door. */
const gait = (v: number) => { 'worklet'; return span(v, [TL.walk[0], TL.walk[1] + 200]) * Math.PI * 2 * 2.5 }

/** A limb shortens as it swings forward: a leg seen from behind has no other tell. */
function useLimb(clock: SharedValue<number>, side: 1 | -1, reach: number) {
  return useAnimatedStyle(() => ({ transform: [{ scaleY: 1 - reach * Math.max(0, side * Math.sin(gait(clock.get()))) }] }))
}

/** You, from behind, walking up to the door. Bigger near the camera, smaller there. */
export function Walker({ st, pal, clock }: { st: Stage; pal: ScenePalette; clock: SharedValue<number> }) {
  const { H, horizon, door, u, W } = st
  const near = 1.05 * u, far = (door.h * 0.72) / FIG_H
  const startY = H + 150 * u
  const body = useAnimatedStyle(() => {
    const v = clock.get()
    const p = Math.max(0, Math.min(1, (v - TL.walk[0]) / (TL.walk[1] - TL.walk[0])))
    // Screen height and size both fall as 1 / distance, which is what makes it read as depth.
    const k = 3, f = (1 / (1 + k * p) - 1 / (1 + k)) / (1 - 1 / (1 + k))
    const s = far + (near - far) * f
    const foot = horizon + (startY - horizon) * f
    const stride = Math.sin(gait(v))
    return {
      opacity: v < TL.walk[0] ? 0 : 1 - span(v, TL.gone),
      transform: [{ translateY: foot - FIG_H - Math.abs(stride) * 3 * s }, { scale: s }, { rotate: `${stride * 1.6}deg` }],
    }
  })
  const legL = useLimb(clock, 1, 0.2), legR = useLimb(clock, -1, 0.2), armL = useLimb(clock, -1, 0.14), armR = useLimb(clock, 1, 0.14)
  const limb = { position: 'absolute' as const, backgroundColor: pal.figure, transformOrigin: 'top' as const }
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: W / 2 - FIG_W / 2, top: 0, width: FIG_W, height: FIG_H, transformOrigin: [FIG_W / 2, FIG_H, 0] }, body]}>
      <View style={{ position: 'absolute', left: -6, right: -6, bottom: -7, height: 15, borderRadius: 40, backgroundColor: '#0B1D4D', opacity: 0.16 }} />
      <Animated.View style={[limb, { left: 14, top: FIG_H - LEG_H - 2, width: 16, height: LEG_H, borderRadius: 8 }, legL]} />
      <Animated.View style={[limb, { left: 34, top: FIG_H - LEG_H - 2, width: 16, height: LEG_H, borderRadius: 8 }, legR]} />
      <Animated.View style={[limb, { left: 0, top: 38, width: 11, height: 54, borderRadius: 6, backgroundColor: pal.jacket }, armL]} />
      <Animated.View style={[limb, { left: 53, top: 38, width: 11, height: 54, borderRadius: 6, backgroundColor: pal.jacket }, armR]} />
      <View style={{ position: 'absolute', left: 8, top: 33, width: 48, height: 66, borderRadius: 15, backgroundColor: pal.jacket }} />
      <LinearGradient colors={[pal.bag, pal.figure]} style={{ position: 'absolute', left: 16, top: 42, width: 32, height: 40, borderRadius: 10 }} />
      <View style={{ position: 'absolute', left: 19, top: 2, width: 26, height: 28, borderRadius: 13, backgroundColor: pal.figure }} />
      <View style={{ position: 'absolute', left: 55, top: 88, width: 9, height: 13, borderRadius: 2, backgroundColor: pal.badge }} />
    </Animated.View>
  )
}

