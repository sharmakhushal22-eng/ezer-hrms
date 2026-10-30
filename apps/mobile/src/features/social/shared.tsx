// src/features/social/shared.tsx — the pieces every Social card shares
// (components/ess/social/PostCard.tsx helpers, icons.tsx, mock.ts constants and
// types.ts). Copied, not imported: those website files are .tsx with DOM/CSS
// and live outside lib/, so the app cannot share them.
import * as React from 'react'
import { View } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'

// ── types (components/ess/social/types.ts) ──────────────────────────────────
export type SocialKind = 'birthday' | 'anniversary' | 'joiner' | 'shoutout'
export type SocialTab = 'wall' | 'birthdays' | 'anniversaries' | 'joiners'
export interface SocialPerson { id: string; name: string; initials: string; designation: string | null; department: string | null; company: string | null; photo?: string | null }
export interface Reaction { emoji: string; count: number; mine: boolean }
export interface Removal { remark: string; at: string }
export interface SocialMedia { kind: 'gif' | 'sticker'; ref: string; label: string }
export interface SocialComment { id: string; author: SocialPerson; body: string; media?: SocialMedia | null; at: string; reactions: Reaction[]; removed?: Removal | null; mine?: boolean }
export interface SocialPost {
  id: string; source?: 'social' | 'wall'; kind: SocialKind; subject: SocialPerson; author?: SocialPerson | null
  at: string; body?: string | null; media?: SocialMedia | null; years?: number; on?: string; joined_on?: string
  intro?: string | null; hobbies?: string[]; skills?: string[]; category?: { label: string; glyph: string | null } | null
  reactions: Reaction[]; comments: SocialComment[]; acted?: boolean; removed?: Removal | null; mine?: boolean
}
export interface SocialPayload {
  group: { name: string; companies: number }; me: SocialPerson
  today: SocialPost[]; upcoming_birthdays: SocialPost[]; week_anniversaries: SocialPost[]; joiners: SocialPost[]; wall: SocialPost[]
  notices: { id: string; kind: SocialKind; removed: Removal; excerpt: string }[]
}

// ── constants (components/ess/social/mock.ts) ───────────────────────────────
export const REACTIONS = ['👏', '❤️', '🎉', '🙌', '😄', '🔥'] as const
export const GIF_PACK: { ref: string; label: string; hue: number }[] = [
  { ref: 'confetti', label: 'Confetti', hue: 268 }, { ref: 'cake', label: 'Cake', hue: 338 },
  { ref: 'balloons', label: 'Balloons', hue: 16 }, { ref: 'clap', label: 'Applause', hue: 42 },
  { ref: 'popper', label: 'Party popper', hue: 158 }, { ref: 'highfive', label: 'High five', hue: 205 },
]
/** The pack is emoji drawn on a tint — no files, no third-party GIF search. */
export const GIF_GLYPH: Record<string, string> = { confetti: '🎊', cake: '🎂', balloons: '🎈', clap: '👏', popper: '🎉', highfive: '🙌' }
export const WISH_SUGGESTIONS: Record<string, string[]> = {
  birthday: ['Happy birthday! Hope you get the day you want.', 'Many happy returns 🎂', 'Have a brilliant one, enjoy every bit of it.'],
  anniversary: ['Congratulations on the milestone!', 'Thanks for everything you have built here.', 'Here is to the next one 🎉'],
  joiner: ['Welcome to the team!', 'Great to have you with us. Shout if you need anything.', 'Welcome aboard 👋'],
}

// ── kind accents (social.css --soc-*; light / dark) ─────────────────────────
const KIND = {
  shoutout: { l: ['#1D4ED8', '#60A5FA', '#DBEAFE'], d: ['#60A5FA', '#93C5FD', '#152A4A'] },
  birthday: { l: ['#BE123C', '#FB7185', '#FFE4E6'], d: ['#FDA4AF', '#FB7185', '#3A0D1A'] },
  anniversary: { l: ['#B45309', '#F59E0B', '#FEF3C7'], d: ['#FCD34D', '#F59E0B', '#3A2A08'] },
  joiner: { l: ['#0E7490', '#22D3EE', '#CFFAFE'], d: ['#67E8F9', '#22D3EE', '#062B33'] },
} as const
export interface KindInk { ink: string; ink2: string; tint: string }
export function useKind(kind: SocialKind): KindInk {
  const { isDark } = useTheme()
  const v = KIND[kind][isDark ? 'd' : 'l']
  return { ink: v[0], ink2: v[1], tint: v[2] }
}

// ── pure helpers (PostCard.tsx) ─────────────────────────────────────────────
export function hue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}
export function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`
  if (mins < 7 * 24 * 60) return `${Math.round(mins / 1440)}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
/** "today", "tomorrow", "on Friday, 3 Oct" — never the year. */
export function when(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const diff = Math.round((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 864e5)
  const dm = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff < 7) return `on ${d.toLocaleDateString('en-IN', { weekday: 'long' })}, ${dm}`
  return `on ${dm}`
}
export function toggle(list: Reaction[], emoji: string): Reaction[] {
  const at = list.findIndex(r => r.emoji === emoji)
  if (at < 0) return [...list, { emoji, count: 1, mine: true }]
  const r = list[at]
  const next = { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine }
  if (next.count <= 0) return list.filter((_, i) => i !== at)
  return list.map((x, i) => (i === at ? next : x))
}

/** hsl → hex, so the name-hash colours work on every RN platform. */
export function hsl(h: number, s: number, l: number) {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0')
  return `#${f(0)}${f(8)}${f(4)}`
}

// ── icons (components/ess/social/icons.tsx: 24×24, stroke 2, round) ────────
type IP = { size?: number; color: string }
const S = ({ size = 16, color, children }: IP & { children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</Svg>
)
export const Cake = (p: IP) => <S {...p}><Path d="M3 21h18M4 21v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5" /><Path d="M4 17.5c1.6 0 1.6-1.2 3.2-1.2s1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2" /><Path d="M12 14V9" /><Path d="M12 6.5c0-1 1.2-1.6 1.2-2.8A1.2 1.2 0 0 0 12 2.5a1.2 1.2 0 0 0-1.2 1.2c0 1.2 1.2 1.8 1.2 2.8Z" /></S>
export const Medal = (p: IP) => <S {...p}><Circle cx={12} cy={14.5} r={5.5} /><Path d="M12 12.4l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3Z" /><Path d="M8.5 9.2 6 2.5h12l-2.5 6.7" /></S>
export const Door = (p: IP) => <S {...p}><Path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8" /><Path d="M14 3v18M10.5 12h.01" /><Path d="M17 8l4 4-4 4M21 12h-7" /></S>
export const Trophy = (p: IP) => <S {...p}><Path d="M7 4h10v5a5 5 0 0 1-10 0Z" /><Path d="M7 5.5H4.5A2.5 2.5 0 0 0 7 10M17 5.5h2.5A2.5 2.5 0 0 1 17 10" /><Path d="M12 14v3M9 20h6M10 17h4" /></S>
export const Bubble = (p: IP) => <S {...p}><Path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8Z" /></S>
export const AddReaction = (p: IP) => <S {...p}><Path d="M20.9 13a9 9 0 1 1-8.2-9.9" /><Path d="M9 10h.01M15 10h.01" /><Path d="M8.5 14.5a4.5 4.5 0 0 0 6.3.7" /><Path d="M18 2.5v5M15.5 5h5" /></S>
export const Send = (p: IP) => <S {...p}><Path d="M21 3 2.5 10.2l7.6 2.7 2.7 7.6Z" /><Path d="M21 3 10.1 12.9" /></S>
export const Gif = (p: IP) => <S {...p}><Rect x={2.5} y={5} width={19} height={14} rx={2.5} /><Path d="M10 10.2a2.2 2.2 0 1 0 0 3.6h.6V12M13.5 10v4M16.2 14v-4h3.1M16.2 12.2h2.4" /></S>
export const ShieldOff = (p: IP) => <S {...p}><Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><Path d="m4 4 16 16" /></S>
export const Wave = (p: IP) => <S {...p}><Path d="M11 11V4.6a1.6 1.6 0 1 1 3.2 0V11" /><Path d="M14.2 10.4V6.2a1.6 1.6 0 1 1 3.2 0V13" /><Path d="M7.8 12.6V8.4a1.6 1.6 0 1 1 3.2 0V11" /><Path d="M7.8 11.2a1.6 1.6 0 1 0-3.2 0v3.6a7 7 0 0 0 7 7h1.2a6.6 6.6 0 0 0 6.6-6.6V13" /></S>

export function KindIcon({ kind, size, color }: { kind: SocialKind; size?: number; color: string }) {
  const I = { birthday: Cake, anniversary: Medal, joiner: Door, shoutout: Trophy }[kind]
  return <I size={size} color={color} />
}

// ── avatar, chips, removed ──────────────────────────────────────────────────
export function SocAvatar({ person, size = 44, mark }: { person: SocialPerson; size?: number; mark?: SocialKind }) {
  const { C, isDark } = useTheme()
  const h = hue(person.name)
  const k = useKind(mark ?? 'shoutout')
  // Dark: the web mixes the tint toward the surface and lifts the ink.
  const bg = isDark ? hsl(h, 30, 20) : hsl(h, 58, 93)
  const fg = isDark ? hsl(h, 62, 78) : hsl(h, 62, 28)
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line }}>
      <Txt size={Math.round(size * 0.33)} w={700} color={fg}>{person.initials}</Txt>
      {mark && (
        <View style={{ position: 'absolute', right: -4, bottom: -4, width: 21, height: 21, borderRadius: 11, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
          <KindIcon kind={mark} size={11} color={k.ink} />
        </View>
      )}
    </View>
  )
}

export function CoChip({ name }: { name: string }) {
  const { C } = useTheme()
  return (
    <View style={{ height: 19, maxWidth: '100%', flexShrink: 1, paddingHorizontal: 8, borderRadius: 999, justifyContent: 'center', backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
      <Txt size={10.5} w={700} tone="muted" numberOfLines={1} style={{ letterSpacing: 0.2 }}>{name}</Txt>
    </View>
  )
}

/** Where a removed post or comment was. Never says who removed it. */
export function RemovedBlock({ remark, mine }: { remark: string; mine?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, backgroundColor: C.criticalTint, borderWidth: 1, borderColor: C.criticalEdge }}>
      <ShieldOff size={18} color={C.critical} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700} tone="critical">Removed by the authorities</Txt>
        <Txt size={F.tiny} tone="soft" style={{ marginTop: 2 }}>{mine ? 'This was removed for violating company policy. You can post again, within the policy.' : 'This was removed for violating company policy.'}</Txt>
        <Txt size={F.tiny} tone="soft" style={{ marginTop: 4, fontStyle: 'italic' }}>“{remark}”</Txt>
      </View>
    </View>
  )
}

/** A section card (.soc .card): a kind-tinted icon, a title, a hint, the body. */
export function SocCard({ kind, icon, title, hint, today, children }: { kind: SocialKind; icon: React.ReactNode; title: string; hint: string; today?: boolean; children: React.ReactNode }) {
  const { C } = useTheme()
  const k = useKind(kind)
  return (
    <View style={{ backgroundColor: today ? k.tint : C.surface, borderWidth: 1, borderColor: today ? k.ink2 : C.line, borderRadius: 14, padding: 16, marginBottom: 14, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: today ? 3 : 2, backgroundColor: k.ink }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 5 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: today ? C.surface : k.tint, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
        <Txt size={17} w={600} style={{ flex: 1 }}>{title}</Txt>
      </View>
      <Txt size={12.5} tone="muted" style={{ marginLeft: 42, marginBottom: 15, lineHeight: 18 }}>{hint}</Txt>
      {children}
    </View>
  )
}

export function SocEmpty({ title, hint }: { title: string; hint: string }) {
  const { C } = useTheme()
  return (
    <View style={{ padding: 16, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, alignItems: 'center', gap: 4 }}>
      <Txt size={F.small} w={700} center>{title}</Txt>
      <Txt size={F.tiny} tone="muted" center>{hint}</Txt>
    </View>
  )
}
