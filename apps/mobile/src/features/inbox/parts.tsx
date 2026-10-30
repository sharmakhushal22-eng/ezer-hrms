// src/features/inbox/parts.tsx — pieces several inbox screens share: the
// conversation avatar, a list row, the "absent"/"empty" panels and chips.
// Sources: components/ess/inbox/ConversationList.tsx (Row), CatchUp.tsx,
// InboxShell.tsx (Absent / ErrorState) and inbox.css.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S, SERIF } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { initials, relTime, type ConversationVM, type FolderVM } from './model'
import { alpha, FolderGlyph, gold, GBellOff, GDesk, GStar, inkOf, onInk } from './glyphs'

/** `.av` — initials for a person, the house glyph for a desk, the folder glyph for SYSTEM. Tinted with the folder ink. */
export function ConvAvatar({ c, ink, size = 38 }: { c: Pick<ConversationVM, 'kind' | 'title' | 'folder'>; ink: string; size?: number }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: c.kind === 'DIRECT' ? 11 : size / 2, alignItems: 'center', justifyContent: 'center',
      backgroundColor: alpha(ink, 0.14), borderWidth: 1, borderColor: alpha(ink, 0.22),
    }}>
      {c.kind === 'DIRECT' ? <Txt size={12.5} w={700} color={ink}>{initials(c.title)}</Txt>
        : c.kind === 'DESK' ? <GDesk size={17} color={ink} />
        : <FolderGlyph code={c.folder} size={17} color={ink} />}
    </View>
  )
}

/** The unread pill on a folder ink. */
export function InkPill({ n, ink, size = 18 }: { n: number; ink: string; size?: number }) {
  const { isDark } = useTheme()
  if (!n) return null
  return (
    <View style={{ minWidth: size, height: size, paddingHorizontal: 5, borderRadius: 999, backgroundColor: ink, alignItems: 'center', justifyContent: 'center' }}>
      <Txt size={10.5} w={700} color={onInk(isDark)}>{n}</Txt>
    </View>
  )
}

/** A small tinted chip — `.kind` (folder ink) or `.kind.staff` (gold). */
export function KindChip({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: alpha(color, 0.13) }}>
      <Txt size={10.5} w={700} color={color} numberOfLines={1}>{label}</Txt>
    </View>
  )
}

/** ConversationList.tsx Row. */
export function ConversationRow({ c, folder, onOpen }: { c: ConversationVM; folder?: FolderVM; onOpen: (id: string) => void }) {
  const { C, isDark } = useTheme()
  const ink = inkOf(folder, isDark, C.brand)
  const kind = c.kind === 'SYSTEM' ? 'Updates' : c.kind === 'DESK' ? 'Desk' : 'Direct'
  const un = c.unread > 0
  return (
    <Pressable onPress={() => onOpen(c.id)} accessibilityRole="button" accessibilityLabel={`${c.title}${un ? `, ${c.unread} unread` : ''}`}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 11, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: pressed ? alpha(ink, 0.13) : 'transparent' })}>
      <ConvAvatar c={c} ink={ink} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Txt size={F.small + 0.5} w={un ? 700 : 600} numberOfLines={1} style={{ flex: 1 }}>{c.title}</Txt>
          <Txt size={11.5} w={un ? 600 : 400} color={un ? ink : C.faint}>{relTime(c.updatedAt)}</Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <KindChip label={kind} color={ink} />
          {c.staffed && <KindChip label="You staff this" color={gold(isDark)} />}
          <Txt size={12.5} color={un ? C.inkSoft : C.muted} numberOfLines={1} style={{ flex: 1 }}>{c.preview}</Txt>
          {c.starred && <GStar size={13} color={gold(isDark)} fill={gold(isDark)} />}
          {c.muted && <GBellOff size={13} color={C.faint} />}
          <InkPill n={c.unread} ink={ink} />
        </View>
      </View>
    </Pressable>
  )
}

/** `.empty` — a glyph tile, a serif heading, a line, and an optional action. */
export function EmptyBlock({ glyph, title, text, action }: { glyph?: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <View style={{ paddingVertical: S.xxl, paddingHorizontal: S.xl, alignItems: 'center' }}>
      {glyph && (
        <View style={{ width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, marginBottom: S.md }}>
          {glyph}
        </View>
      )}
      <Txt size={20} w={600} center style={{ fontFamily: SERIF, marginBottom: 4 }}>{title}</Txt>
      <Txt size={F.small} tone="muted" center>{text}</Txt>
      {action && <View style={{ marginTop: 14 }}>{action}</View>}
    </View>
  )
}

/** `.absent` — "Not switched on yet" and friends (warning-tinted glyph tile). */
export function AbsentBlock({ glyph, title, children }: { glyph: React.ReactNode; title: string; children: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <View style={{ paddingVertical: 40, paddingHorizontal: S.xl, alignItems: 'center' }}>
      <View style={{ width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warningEdge, marginBottom: 14 }}>
        {glyph}
      </View>
      <Txt size={24} w={600} center style={{ fontFamily: SERIF, marginBottom: 6 }}>{title}</Txt>
      {typeof children === 'string' ? <Txt size={13.5} tone="muted" center>{children}</Txt> : children}
    </View>
  )
}

/** `.chip` — the filter chips (pressed = ink fill). */
export function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} hitSlop={4}
      style={{ minHeight: 34, paddingHorizontal: 12, borderRadius: R.pill, justifyContent: 'center', borderWidth: 1, borderColor: on ? C.ink : C.line, backgroundColor: on ? C.ink : C.surface }}>
      <Txt size={F.tiny} w={600} color={on ? C.surface : C.inkSoft}>{label}</Txt>
    </Pressable>
  )
}
