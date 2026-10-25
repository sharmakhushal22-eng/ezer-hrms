// src/features/home/PunchDial.tsx — components/ess/today/PunchDial.tsx.
//
// The shift-progress ring with the day's state in its face, and two separate
// actions under it — PUNCH IN and PUNCH OUT — each POST /api/ess/punch { kind }.
// Nothing else goes in the body: the website sends no location, selfie or device
// info, and neither does the app.
//
// WHICH BUTTON IS LIVE IS THE SERVER'S ANSWER. State is derived from
// data.today on every render; a refusal (409) carries the real PunchState and
// that replaces the stale one, exactly as on the website.
import * as React from 'react'
import { Animated, Easing, Platform, Pressable, View } from 'react-native'
import Svg, { Circle, Defs, G, Line, LinearGradient as SvgLinear, RadialGradient, Stop } from 'react-native-svg'
import { LinearGradient } from 'expo-linear-gradient'
import { api, ApiError } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import { R as RAD } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { fmtClock, two } from '@web/today/format'
import type { Prefs, PunchStateLite, TodayPayload } from './data'
import { SUN, useMounted, useNow, useReducedMotion, useTween } from './kit'
import { GFlame, GPunchIn, GPunchOut } from './glyphs'
import type { HeroTheme } from './HeroPanel'

const NATIVE = Platform.OS !== 'web'
const RR = 101, CC = 112, CIRC = 2 * Math.PI * RR
const DIAL = 156, FACE = 112 // today.css v3 block: .dial 156px, .face 112px
/** PunchDial.tsx confetti colours. */
const CONFETTI = ['#2563EB', '#60A5FA', '#7DD3FC', '#34D399', '#FCD34D', '#FFFFFF']

/** today.css ring / face / punch-button colours, light and dark. */
function dialTheme(isDark: boolean) {
  return isDark ? {
    track: 'rgba(255,255,255,0.13)', ringA: '#FFFFFF', ringB: '#7DD3FC', tick: 'rgba(255,255,255,0.35)', cap: '#FFFFFF', halo: 'rgba(255,255,255,0.22)',
    face: ['#FFFFFF', '#DBEAFE', '#BFDBFE'],
    pbBg: 'rgba(255,255,255,0.10)', pbEdge: 'rgba(255,255,255,0.22)', pbFg: '#FFFFFF', pbIc: 'rgba(255,255,255,0.16)',
    pinBg: ['#FFFFFF', '#DBEAFE'] as const, pinFg: '#070F2B', pinIcBg: '#2563EB', pinIcFg: '#FFFFFF', pinSub: '#1E3A8A',
    streakBg: 'rgba(255,255,255,0.12)', streakEdge: 'rgba(255,255,255,0.2)', streakFg: '#FFFFFF',
  } : {
    track: 'rgba(37,99,235,0.10)', ringA: '#2563EB', ringB: '#38BDF8', tick: 'rgba(37,99,235,0.30)', cap: '#2563EB', halo: 'rgba(37,99,235,0.10)',
    face: ['#FFFFFF', '#F3F7FF', '#E4EEFF'],
    pbBg: null as string | null, pbEdge: null as string | null, pbFg: null as string | null, pbIc: null as string | null,
    pinBg: ['#3B82F6', '#1D4ED8'] as const, pinFg: '#FFFFFF', pinIcBg: 'rgba(255,255,255,0.2)', pinIcFg: '#FFFFFF', pinSub: 'rgba(255,255,255,0.9)',
    streakBg: null as string | null, streakEdge: 'rgba(180,83,9,0.18)', streakFg: null as string | null,
  }
}
const FACE_IN = ['#6EE7B7', '#059669', '#047857']
const FACE_DONE = ['#FFFFFF', '#E0E7FF', '#C7D2FE']
const OUT_BG = ['#FB7185', '#E11D48'] as const

export interface PunchDialProps {
  data: TodayPayload; prefs: Prefs; hero: HeroTheme
  onToast: (m: string, kind?: 'success' | 'error') => void
  /** A successful punch — Home rewrites `today` as the website does, then refetches. */
  onPunched: (kind: 'in' | 'out', at: Date) => void
  /** The server's punch state after any attempt — success or refusal. */
  onState: (s: PunchStateLite) => void
}

export function PunchDial({ data, prefs, hero, onToast, onPunched, onState }: PunchDialProps) {
  const { C, isDark } = useTheme()
  const T = dialTheme(isDark)
  const reduce = useReducedMotion()
  const mounted = useMounted(350)
  const now = useNow(15000)
  const t0 = data.today
  const isOpen = t0?.open ?? !!(t0?.punch_in && !t0?.punch_out)
  const inAt = isOpen && t0?.punch_in ? new Date(t0.punch_in) : null
  const outAt = !isOpen && t0?.punch_out ? new Date(t0.punch_out) : null
  const [elapsed, setElapsed] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [burst, setBurst] = React.useState(0)

  // shift progress ring
  const [sh, sm] = data.shift.start.split(':').map(Number), [eh, em] = data.shift.end.split(':').map(Number)
  const start = sh + sm / 60, end = eh + em / 60, t = now.getHours() + now.getMinutes() / 60
  const target = mounted ? Math.min(1, Math.max(0, (t - start) / (end - start))) : 0
  const p = useTween(target, 1500)
  const ang = p * Math.PI * 2

  // running timer while punched in
  const inMs = inAt ? inAt.getTime() : null
  React.useEffect(() => {
    if (inMs == null) return
    const tick = () => setElapsed(Date.now() - inMs)
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [inMs])

  async function punch(kind: 'in' | 'out') {
    if (busy) return
    if (kind === 'in' && inAt) { onToast('You are already punched in'); return }
    if (kind === 'out' && !inAt) { onToast('Punch in first'); return }
    setBusy(true)
    try {
      const j = await api<{ ok: boolean; at: string; state?: PunchStateLite }>('/api/ess/punch', { method: 'POST', body: { kind } })
      if (j?.state) onState(j.state)
      const at = new Date(j.at)
      if (kind === 'in') { if (!reduce) setBurst(b => b + 1); onToast(`Punched in at ${fmtClock(at, prefs.time_format)}`) }
      else { const ms = at.getTime() - inAt!.getTime(); onToast(`Punched out · ${Math.floor(ms / 3.6e6)}h ${two(Math.floor(ms / 6e4) % 60)}m logged`) }
      onPunched(kind, at)
    } catch (err) {
      // A refusal (already in / nothing to close) carries the real state: adopt it.
      if (err instanceof ApiError && err.body && typeof err.body === 'object' && err.body.state) onState(err.body.state as PunchStateLite)
      const msg = err instanceof ApiError
        ? (err.body && typeof err.body === 'object' && err.body.error) || (err.status === 0 ? err.message : 'Punch failed')
        : (err as Error).message
      onToast(String(msg), 'error')
    } finally { setBusy(false) }
  }

  const h = Math.floor(elapsed / 3.6e6), m = Math.floor(elapsed / 6e4) % 60, s = Math.floor(elapsed / 1e3) % 60
  const faceStops = inAt ? FACE_IN : outAt ? FACE_DONE : T.face
  const faceInk = inAt ? '#FFFFFF' : hero.heroA
  const faceSoft = inAt ? 'rgba(255,255,255,0.88)' : 'rgba(30,58,138,0.78)'
  const ink = hero.onHero || C.ink, soft = hero.onHeroSoft || C.muted

  let dayDone = '-'
  if (outAt && t0?.punch_in) { const ms = outAt.getTime() - new Date(t0.punch_in).getTime(); dayDone = `${Math.floor(ms / 3.6e6)}h ${two(Math.floor(ms / 6e4) % 60)}m` }

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View style={{ width: DIAL, height: DIAL, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={DIAL} height={DIAL} viewBox="0 0 224 224" style={{ position: 'absolute', left: 0, top: 0 }}>
          <Defs>
            <SvgLinear id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={T.ringA} /><Stop offset="1" stopColor={T.ringB} />
            </SvgLinear>
            <RadialGradient id="haloGrad" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={T.halo} /><Stop offset="0.7" stopColor={T.halo} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={CC} cy={CC} r={CC - 18 * (224 / DIAL)} fill="url(#haloGrad)" />
          <G transform={`rotate(-90 ${CC} ${CC})`}>
            <Circle cx={CC} cy={CC} r={RR} fill="none" stroke={T.track} strokeWidth={11} />
            {p > 0.0005 && (
              <Circle cx={CC} cy={CC} r={RR} fill="none" stroke="url(#ringGrad)" strokeWidth={11} strokeLinecap="round"
                strokeDasharray={`${CIRC} ${CIRC}`} strokeDashoffset={CIRC * (1 - p)} />
            )}
            {Array.from({ length: 9 }, (_, i) => {
              const a = (i / 9) * Math.PI * 2
              return <Line key={i} x1={CC + Math.cos(a) * (RR - 12)} y1={CC + Math.sin(a) * (RR - 12)} x2={CC + Math.cos(a) * (RR - 16)} y2={CC + Math.sin(a) * (RR - 16)} stroke={T.tick} strokeWidth={2} />
            })}
            <Circle r={6} cx={CC + Math.cos(ang) * RR} cy={CC + Math.sin(ang) * RR} fill={T.cap} />
          </G>
        </Svg>
        <Pulse k={burst} />
        {/* The face of the dial: the day's state, never a button. */}
        <View accessibilityLiveRegion="polite" style={{ width: FACE, height: FACE, borderRadius: FACE / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
          shadowColor: inAt ? '#059669' : '#1D4ED8', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 6 }}>
          <Svg width={FACE} height={FACE} style={{ position: 'absolute' }}>
            <Defs>
              <RadialGradient id="faceGrad" cx="35%" cy="28%" r="80%">
                <Stop offset="0" stopColor={faceStops[0]} /><Stop offset="0.58" stopColor={faceStops[1]} /><Stop offset="1" stopColor={faceStops[2]} />
              </RadialGradient>
            </Defs>
            <Circle cx={FACE / 2} cy={FACE / 2} r={FACE / 2} fill="url(#faceGrad)" />
          </Svg>
          {inAt ? <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF' }} />
              <Txt size={8.5} w={700} color={faceSoft} upper>Working</Txt>
            </View>
            <Txt size={18} w={700} color={faceInk} style={{ fontVariant: ['tabular-nums'] }}>{two(h)}:{two(m)}:{two(s)}</Txt>
            <Txt size={9.5} w={600} color={faceSoft}>since {fmtClock(inAt, prefs.time_format)}</Txt>
          </> : outAt ? <>
            <Txt size={8.5} w={700} color={faceSoft} upper>Day done</Txt>
            <Txt size={18} w={700} color={faceInk} style={{ fontVariant: ['tabular-nums'] }}>{dayDone}</Txt>
            <Txt size={9.5} w={600} color={faceSoft}>out at {fmtClock(outAt, prefs.time_format)}</Txt>
          </> : <>
            <Txt size={8.5} w={700} color={faceSoft} upper>Not punched in</Txt>
            <Txt size={17} w={700} color={faceInk} style={{ fontVariant: ['tabular-nums'] }}>{fmtClock(now, prefs.time_format)}</Txt>
            <Txt size={9.5} w={600} color={faceSoft}>shift {data.shift.start}–{data.shift.end}</Txt>
          </>}
        </View>
      </View>

      {/* Two actions, each its own button. Only the one that applies is live. */}
      <View accessibilityRole="none" accessibilityLabel="Punch" style={{ flexDirection: 'row', gap: 8, width: '100%', maxWidth: 360 }}>
        <View style={{ flex: 1 }}>
          <PunchButton kind="in" T={T} live={!busy && !inAt} busy={busy} onPress={() => punch('in')}
            label={inAt ? `Already punched in at ${fmtClock(inAt, prefs.time_format)}` : outAt ? 'Punch in again' : 'Start your day'}
            sub={inAt ? `in since ${fmtClock(inAt, prefs.time_format)}` : outAt ? 'start again' : 'start your day'} />
          <Confetti k={burst} />
        </View>
        <View style={{ flex: 1 }}>
          <PunchButton kind="out" T={T} live={!busy && !!inAt} busy={busy} onPress={() => punch('out')}
            label={inAt ? 'End your day' : 'Punch in first'}
            sub={inAt ? 'end your day' : outAt ? `out at ${fmtClock(outAt, prefs.time_format)}` : 'punch in first'} />
        </View>
      </View>

      <Txt size={11.5} color={soft} center>
        {inAt ? <>Punched in at <Txt size={11.5} w={600} color={ink}>{fmtClock(inAt, prefs.time_format)}</Txt>{data.employee.location ? ` · ${data.employee.location}` : ''}</>
          : outAt ? <>Punched out at <Txt size={11.5} w={600} color={ink}>{fmtClock(outAt, prefs.time_format)}</Txt></>
          : 'Not punched in yet'}
      </Txt>
      {data.streak > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingLeft: 8, paddingRight: 11, borderRadius: RAD.pill, backgroundColor: T.streakBg || C.warningTint, borderWidth: 1, borderColor: T.streakEdge }}>
          <GFlame size={16} color={SUN} />
          <Txt size={12} w={600} color={T.streakFg || C.warning}>{data.streak}-day on-time streak</Txt>
        </View>
      )}
    </View>
  )
}

function PunchButton({ kind, T, live, busy, onPress, label, sub }: {
  kind: 'in' | 'out'; T: ReturnType<typeof dialTheme>; live: boolean; busy: boolean; onPress: () => void; label: string; sub: string
}) {
  const { C } = useTheme()
  const fg = live ? (kind === 'in' ? T.pinFg : '#FFFFFF') : (T.pbFg || C.ink)
  const icBg = live ? (kind === 'in' ? T.pinIcBg : 'rgba(255,255,255,0.22)') : (T.pbIc || C.sunken)
  const icFg = live ? (kind === 'in' ? T.pinIcFg : '#FFFFFF') : (T.pbFg || C.ink)
  const subFg = live && kind === 'in' ? T.pinSub : fg
  const Icon = kind === 'in' ? GPunchIn : GPunchOut
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 8, paddingRight: 10, minHeight: 50 }}>
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: icBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={18} color={icFg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={13.5} w={700} color={fg} numberOfLines={1} style={{ lineHeight: 16 }}>{kind === 'in' ? 'Punch in' : 'Punch out'}</Txt>
        <Txt size={10.5} w={600} color={subFg} numberOfLines={1} style={{ opacity: live && kind === 'in' ? 1 : 0.78 }}>{sub}</Txt>
      </View>
    </View>
  )
  return (
    <Pressable onPress={live ? onPress : undefined} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !live, busy }}
      style={({ pressed }) => ({
        borderRadius: 16, overflow: 'hidden', borderWidth: 1, opacity: live ? 1 : 0.5, transform: [{ scale: pressed && live ? 0.97 : 1 }],
        borderColor: live ? (kind === 'in' ? 'rgba(29,78,216,0.6)' : 'rgba(255,255,255,0.35)') : (T.pbEdge || C.line),
        backgroundColor: live ? undefined : (T.pbBg || C.surface),
      })}>
      {live
        ? <LinearGradient colors={kind === 'in' ? T.pinBg : OUT_BG} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>{inner}</LinearGradient>
        : inner}
    </Pressable>
  )
}

/** today.css .pulse.go — a green ripple off the dial after a punch in. Decorative. */
function Pulse({ k }: { k: number }) {
  const v = React.useRef(new Animated.Value(0)).current
  React.useEffect(() => {
    if (!k) return
    v.setValue(0)
    Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start()
  }, [k, v])
  if (!k) return null
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: 30, top: 30, right: 30, bottom: 30, borderRadius: DIAL, borderWidth: 2, borderColor: '#34D399',
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.5] }) }],
    }} />
  )
}

/** A light stand-in for the website's canvas confetti: a burst from the Punch in button, 1.3 s. Decorative. */
function Confetti({ k }: { k: number }) {
  const v = React.useRef(new Animated.Value(0)).current
  const parts = React.useMemo(() => Array.from({ length: 36 }, () => {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 110
    return { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70, s: 4 + Math.random() * 5, c: CONFETTI[(Math.random() * CONFETTI.length) | 0], r: (Math.random() - 0.5) * 720 }
  }), [k]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!k) return
    v.setValue(0)
    Animated.timing(v, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: NATIVE }).start()
  }, [k, v])
  if (!k) return null
  const steps = [0, 0.25, 0.5, 0.75, 1]
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, overflow: 'visible', zIndex: 20 }}>
      {parts.map((q, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', width: q.s, height: q.s * 0.6, backgroundColor: q.c, borderRadius: 1,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [
            { translateX: v.interpolate({ inputRange: steps, outputRange: steps.map(s => q.vx * s * 1.6) }) },
            { translateY: v.interpolate({ inputRange: steps, outputRange: steps.map(s => q.vy * s * 1.6 + 260 * s * s) }) },
            { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${q.r}deg`] }) },
          ],
        }} />
      ))}
    </View>
  )
}
