// src/features/social/wall/ui.tsx — the Wall of Fame's shared pieces
// (components/wall/ui.tsx), rebuilt for the phone with the app palette.
// Pure presentation; the only side effect is the Toast timer.
import * as React from 'react'
import { Animated, Easing, Pressable, ScrollView, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT } from '@/ui/theme'
import { Txt, webNoOutline } from '@/ui/primitives'

export const RAD = { control: 7, tile: 10, panel: 14, hero: 22, pill: 999 } as const

const PATHS = {
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7M10 17h4',
  medal: 'M8 3l2.5 5M16 3l-2.5 5M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 12.5v4',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.5l1.7-2M20 20v-4.5h-4.5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  power: 'M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  alert: 'M12 4l9 16H3zM12 10v4.5M12 17.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  chevronDown: 'M6 9l6 6 6-6',
} as const
export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, stroke = 1.8, color }: { name: IconName; size?: number; stroke?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={PATHS[name]} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '·'
}
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** components/wall/ui.tsx AVATAR_TONES — decorative, a stable pick per name. */
const AVATAR_TONES: [string, string][] = [
  ['#DBEAFE', '#1D4ED8'], ['#D1FAE5', '#047857'], ['#CFFAFE', '#0E7490'],
  ['#EDE9FE', '#6D28D9'], ['#FFE4E6', '#BE123C'], ['#E2E8F0', '#334155'],
]
function toneFor(name: string): [string, string] {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

export function Avatar({ name, size = 40, ring }: { name: string; size?: number; ring?: string }) {
  const [bg, fg] = toneFor(name)
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: ring ? 2 : 0, borderColor: ring }}>
      <Txt size={Math.round(size * 0.38)} w={700} color={fg}>{initialsOf(name)}</Txt>
    </View>
  )
}

export function AvatarStack({ names, size = 28 }: { names: string[]; size?: number }) {
  const { C } = useTheme()
  const shown = names.slice(0, 4)
  const extra = names.length - shown.length
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((n, i) => (
        <View key={`${n}-${i}`} style={{ marginLeft: i ? -8 : 0, borderRadius: size, borderWidth: 2, borderColor: C.surface }}>
          <Avatar name={n} size={size} />
        </View>
      ))}
      {extra > 0 && (
        <View style={{ marginLeft: -8, width: size + 4, height: size + 4, borderRadius: size, backgroundColor: C.sunken, borderWidth: 2, borderColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={F.micro} w={700} tone="muted">+{extra}</Txt>
        </View>
      )}
    </View>
  )
}

export type PillTone = 'brand' | 'neutral' | 'positive' | 'warning' | 'critical'
export function Pill({ children, tone = 'brand', icon }: { children: React.ReactNode; tone?: PillTone; icon?: IconName }) {
  const { C } = useTheme()
  const map = { brand: [C.brandTint, C.brand], neutral: [C.sunken, C.muted], positive: [C.positiveTint, C.positive], warning: [C.warningTint, C.warning], critical: [C.criticalTint, C.critical] } as const
  const [bg, fg] = map[tone]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 10, borderRadius: RAD.pill, backgroundColor: bg, alignSelf: 'flex-start', maxWidth: '100%' }}>
      {icon && <Icon name={icon} size={12} stroke={2} color={fg} />}
      <Txt size={F.micro} w={600} color={fg} numberOfLines={1}>{children}</Txt>
    </View>
  )
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function WButton({ children, onPress, variant = 'secondary', size = 'md', icon, disabled, busy, label, full }: {
  children?: React.ReactNode; onPress?: () => void; variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'
  icon?: IconName; disabled?: boolean; busy?: boolean; label?: string; full?: boolean
}) {
  const { C } = useTheme()
  const off = disabled || busy
  const look = {
    primary: { bg: C.brand, fg: C.onAccent, edge: C.brand },
    secondary: { bg: C.surface, fg: C.inkSoft, edge: C.line },
    ghost: { bg: 'transparent', fg: C.inkSoft, edge: 'transparent' },
    danger: { bg: C.surface, fg: C.critical, edge: C.line },
  }[variant]
  const l = off && variant === 'primary' ? { bg: C.sunken, fg: C.muted, edge: C.line } : look
  const pad = size === 'sm' ? { paddingVertical: 6, paddingHorizontal: 11, minHeight: 36 } : size === 'lg' ? { paddingVertical: 12, paddingHorizontal: 22, minHeight: 48 } : { paddingVertical: 9, paddingHorizontal: 16, minHeight: 44 }
  return (
    <Pressable onPress={off ? undefined : onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, ...pad, borderRadius: RAD.control, borderWidth: 1, borderColor: l.edge, backgroundColor: pressed && variant === 'ghost' ? C.sunken : l.bg, opacity: busy ? 0.75 : 1, alignSelf: full ? 'stretch' : 'flex-start', transform: [{ translateY: pressed && !off ? 1 : 0 }] }]}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} stroke={2} color={l.fg} />}
      {typeof children === 'string' ? <Txt size={size === 'sm' ? F.micro : F.small} w={700} color={l.fg} numberOfLines={1}>{children}</Txt> : children}
    </Pressable>
  )
}

/** Every section of the page: title, optional icon, sub-line and action. */
export function Panel({ title, sub, icon, action, children, tone = 'plain', onLayout }: {
  title?: string; sub?: string; icon?: IconName; action?: React.ReactNode; children: React.ReactNode
  tone?: 'plain' | 'sunken'; onLayout?: (y: number) => void
}) {
  const { C } = useTheme()
  return (
    <View onLayout={onLayout ? e => onLayout(e.nativeEvent.layout.y) : undefined}
      style={{ backgroundColor: tone === 'sunken' ? C.sunken : C.surface, borderWidth: 1, borderColor: C.line, borderRadius: RAD.panel, padding: 16 }}>
      {(!!title || !!action) && (
        <View style={{ marginBottom: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            {icon && (
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon} size={17} color={C.brand} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              {!!title && <Txt size={F.body} w={700}>{title}</Txt>}
              {!!sub && <Txt size={F.micro} tone="muted" style={{ marginTop: 2, lineHeight: 16 }}>{sub}</Txt>}
            </View>
          </View>
          {action}
        </View>
      )}
      {children}
    </View>
  )
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  const { C } = useTheme()
  if (!children) return null
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 8 }}>
      <View style={{ marginTop: 1 }}><Icon name="alert" size={13} stroke={2} color={C.critical} /></View>
      <Txt size={F.micro} w={600} tone="critical" style={{ flex: 1, lineHeight: 16 }}>{children}</Txt>
    </View>
  )
}

/** A numbered form step (circle + connector, title, hint, body, error). */
export function Step({ n, title, hint, children, error, done }: {
  n: number; title: string; hint?: string; children: React.ReactNode; error?: string | null; done?: boolean
}) {
  const { C } = useTheme()
  const bg = error ? C.criticalTint : done ? C.brand : C.sunken
  const fg = error ? C.critical : done ? C.onAccent : C.muted
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ width: 28, alignItems: 'center' }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: 1, borderColor: error ? C.critical : done ? C.brand : C.line }}>
          {done && !error ? <Icon name="check" size={13} stroke={2.6} color={fg} /> : <Txt size={F.micro} w={700} color={fg}>{n}</Txt>}
        </View>
        <View style={{ flex: 1, width: 1, backgroundColor: C.line, marginTop: 6 }} />
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: 16 }}>
        <View style={{ marginBottom: 10 }}>
          <Txt size={F.small} w={700} style={{ lineHeight: 20 }}>{title}</Txt>
          {!!hint && <Txt size={F.micro} tone="muted" style={{ marginTop: 1 }}>{hint}</Txt>}
        </View>
        {children}
        <FieldError>{error}</FieldError>
      </View>
    </View>
  )
}

/** components/wall/ui.tsx inputStyle, for a TextInput. */
export function useInputStyle(): StyleProp<TextStyle> {
  const { C } = useTheme()
  return [{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: RAD.control, fontFamily: FONT[400], fontSize: F.small, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.ink, minHeight: 44 }, webNoOutline]
}

export function WInput({ ref, ...props }: React.ComponentProps<typeof TextInput> & { focusRing?: boolean; ref?: React.Ref<TextInput> }) {
  const { C } = useTheme()
  const base = useInputStyle()
  const [focus, setFocus] = React.useState(false)
  return (
    <TextInput ref={ref} placeholderTextColor={C.faint} {...props}
      onFocus={e => { setFocus(true); props.onFocus?.(e) }} onBlur={e => { setFocus(false); props.onBlur?.(e) }}
      style={[base, focus && { borderColor: C.brand }, props.style]} />
  )
}

/** Status banner. */
export function WNotice({ tone = 'info', title, children }: { tone?: 'info' | 'positive' | 'warning' | 'critical'; title?: React.ReactNode; children?: React.ReactNode }) {
  const { C } = useTheme()
  const map = {
    info: { bg: C.brandTint, edge: C.brandEdge, fg: C.brand, icon: 'info' as IconName },
    positive: { bg: C.positiveTint, edge: C.positiveEdge, fg: C.positive, icon: 'check' as IconName },
    warning: { bg: C.warningTint, edge: C.warningEdge, fg: C.warning, icon: 'alert' as IconName },
    critical: { bg: C.criticalTint, edge: C.criticalEdge, fg: C.critical, icon: 'alert' as IconName },
  }[tone]
  return (
    <View accessibilityRole={tone === 'critical' ? 'alert' : undefined} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: map.bg, borderWidth: 1, borderColor: map.edge, borderRadius: RAD.tile, paddingVertical: 11, paddingHorizontal: 14 }}>
      <View style={{ marginTop: 1 }}><Icon name={map.icon} size={16} stroke={2} color={map.fg} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {!!title && (typeof title === 'string' ? <Txt size={F.small} w={700}>{title}</Txt> : title)}
        {children != null && (typeof children === 'string'
          ? <Txt size={F.small} tone="soft" style={{ marginTop: title ? 3 : 0, lineHeight: 20 }}>{children}</Txt>
          : <View style={{ marginTop: title ? 3 : 0 }}>{children}</View>)}
      </View>
    </View>
  )
}

/** An empty state: a quiet icon disc, a title and a line. */
export function WEmpty({ icon = 'sparkle', title, children, compact, bare }: { icon?: IconName; title?: string; children: React.ReactNode; compact?: boolean; bare?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: compact ? 'row' : 'column', alignItems: compact ? 'flex-start' : 'center', gap: 12, paddingVertical: compact ? 4 : 16, paddingHorizontal: compact ? 0 : 12, borderWidth: compact || bare ? 0 : 1, borderStyle: 'dashed', borderColor: C.line, borderRadius: RAD.tile }}>
      <View style={{ width: compact ? 30 : 44, height: compact ? 30 : 44, borderRadius: 22, backgroundColor: C.sunken, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={compact ? 15 : 20} color={C.faint} />
      </View>
      <View style={{ flex: compact ? 1 : undefined, maxWidth: 360 }}>
        {!!title && <Txt size={F.small} w={700} center={!compact} style={{ marginBottom: 3 }}>{title}</Txt>}
        {typeof children === 'string' ? <Txt size={F.micro} tone="muted" center={!compact} style={{ lineHeight: 18 }}>{children}</Txt> : children}
      </View>
    </View>
  )
}

/** Segmented control; labels are the raw values capitalised (CSS text-transform). */
export function WSegmented<T extends string>({ options, value, onPick, label }: { options: readonly T[]; value: T; onPick: (v: T) => void; label: string }) {
  const { C } = useTheme()
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, padding: 3, backgroundColor: C.sunken, borderRadius: RAD.control, borderWidth: 1, borderColor: C.line, alignSelf: 'flex-start' }}>
      {options.map(o => {
        const on = o === value
        return (
          <Pressable key={o} onPress={() => onPick(o)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ minHeight: 36, justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 13, borderRadius: RAD.control - 2, backgroundColor: on ? C.surface : 'transparent' }}>
            <Txt size={F.micro} w={on ? 700 : 600} color={on ? C.ink : C.muted}>{o.charAt(0).toUpperCase() + o.slice(1)}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Selectable tile — categories and send modes. */
export function ChoiceTile({ on, onPick, glyph, title, text, disabled }: { on: boolean; onPick: () => void; glyph?: string | null; title: string; text?: string | null; disabled?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={() => !disabled && onPick()} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !!disabled }}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 11, paddingHorizontal: 12, paddingRight: 30, borderRadius: RAD.tile, borderWidth: 1.5, borderColor: on ? C.brand : pressed ? C.brandEdge : C.line, backgroundColor: on || pressed ? C.brandTint : C.surface, opacity: disabled ? 0.55 : 1, minHeight: 48 })}>
      {!!glyph && (
        <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.surface : C.sunken }}>
          <Txt size={18} style={{ lineHeight: 24 }}>{glyph}</Txt>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700} color={on ? C.brand : C.ink}>{title}</Txt>
        {!!text && <Txt size={F.micro} tone="muted" style={{ marginTop: 2, lineHeight: 16 }}>{text}</Txt>}
      </View>
      {on && (
        <View style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={11} stroke={3} color={C.onAccent} />
        </View>
      )}
    </Pressable>
  )
}

export interface CategoryLike { id: string; code: string; label: string; glyph?: string | null; helper_text?: string | null }
/** One tile per row on a phone (spec 6.4.15). */
export function CategoryGrid<Ct extends CategoryLike>({ cats, value, onPick }: { cats: Ct[]; value: string | null; onPick: (code: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      {cats.map(c => <ChoiceTile key={c.id} on={value === c.code} onPick={() => onPick(c.code)} glyph={c.glyph} title={c.label} text={c.helper_text} />)}
    </View>
  )
}

export function PersonChip({ name, meta, onRemove }: { name: string; meta?: string | null; onRemove: () => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 4, borderRadius: RAD.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.brandEdge, maxWidth: '100%' }}>
      <Avatar name={name} size={24} />
      <View style={{ flexShrink: 1 }}>
        <Txt size={F.micro} w={700} numberOfLines={1}>{name}</Txt>
        {!!meta && <Txt size={11} tone="faint" numberOfLines={1}>{meta}</Txt>}
      </View>
      <Pressable onPress={onRemove} accessibilityLabel={`Remove ${name}`} hitSlop={10}
        style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="close" size={12} stroke={2.4} color={C.muted} />
      </Pressable>
    </View>
  )
}

/** A pulsing bar set while a panel loads. */
export function Pulse({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = React.useState(() => new Animated.Value(0.55))[0]
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [v])
  return <Animated.View style={[{ opacity: v }, style]}>{children}</Animated.View>
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  const { C } = useTheme()
  return (
    <Pulse style={{ gap: 10 }}>
      {Array.from({ length: lines }, (_, i) => <View key={i} style={{ height: i === 0 ? 16 : 11, borderRadius: 6, backgroundColor: C.sunken, width: `${92 - i * 17}%` }} />)}
    </Pulse>
  )
}

/** Filter chips with counts. */
export function FilterChips<T extends string>({ options, value, onPick, label }: { options: { k: T; label: string; count: number }[]; value: T; onPick: (k: T) => void; label: string }) {
  const { C } = useTheme()
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = o.k === value
        return (
          <Pressable key={o.k} onPress={() => onPick(o.k)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 36, paddingVertical: 5, paddingLeft: 12, paddingRight: 6, borderRadius: RAD.pill, borderWidth: 1, borderColor: on ? C.ink : C.line, backgroundColor: on ? C.ink : C.surface }}>
            <Txt size={F.micro} w={600} color={on ? C.surface : C.inkSoft}>{o.label}</Txt>
            <View style={{ minWidth: 20, paddingVertical: 1, paddingHorizontal: 6, borderRadius: RAD.pill, backgroundColor: on ? 'rgba(255,255,255,0.22)' : C.sunken }}>
              <Txt size={11} w={700} center color={on ? C.surface : C.muted}>{o.count}</Txt>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

export function GroupLabel({ children }: { children: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 2 }}>
      <Txt size={F.micro} w={700} tone="muted">{children}</Txt>
      <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
    </View>
  )
}

/** Jump links to the page's sections — horizontal pills that scroll the page. */
export function JumpBar({ items, onJump }: { items: { k: string; label: string; icon: IconName }[]; onJump: (k: string) => void }) {
  const { C } = useTheme()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, padding: 5 }}
      style={{ borderRadius: RAD.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, flexGrow: 0 }}>
      {items.map(i => (
        <Pressable key={i.k} onPress={() => onJump(i.k)} accessibilityRole="link"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingVertical: 7, paddingHorizontal: 12, borderRadius: RAD.pill, backgroundColor: pressed ? C.sunken : 'transparent' })}>
          <Icon name={i.icon} size={13} color={C.inkSoft} />
          <Txt size={F.micro} w={600} tone="soft">{i.label}</Txt>
        </Pressable>
      ))}
    </ScrollView>
  )
}
