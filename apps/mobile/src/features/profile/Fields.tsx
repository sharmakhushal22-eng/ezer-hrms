// src/features/profile/Fields.tsx — Profile360's field card, field groups,
// key/value list and record tables, for a phone.
//
// Field card (Profile360.tsx FieldCard): each field says what pressing it does
// — "Edit", "Add", "Request change" — from fieldMode(); a locked field on your
// own profile shows a lock (HR maintains it). "Restricted" when the key is not
// yours to see, "Not added" when nobody filled it in, masked values behind
// Reveal / Hide.
import * as React from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import type { FieldGroup, ProfileField, ProfilePayload, Row } from '@web/profile/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import { money, pretty, titleise } from './format'
import { EmptyText, Section } from './bits'
import { fieldMode, NIL, shownValue, type Mode } from './rules'

const MONO = 'monospace'

export function LockGlyph({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <Svg viewBox="0 0 16 16" width={size} height={size} fill="none">
      <Rect x={3.5} y={7} width={9} height={6.5} rx={1.5} stroke={color} strokeWidth={1.6} />
      <Path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  )
}

/** The `.fa` chip: what pressing the card does. */
function ModeChip({ mode }: { mode: Mode }) {
  const { C } = useTheme()
  const req = mode.kind === 'request'
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, borderWidth: 1,
      borderColor: req ? C.warningEdge : C.brandEdge, backgroundColor: req ? C.warningTint : C.brandTint }}>
      <Txt size={F.micro} w={700} color={req ? C.warning : C.brandDeep}>{mode.label}</Txt>
    </View>
  )
}

/** Two columns on a wide screen, one on a phone — the web's g3 grid, with `wide` spanning. */
export function useCols() {
  const { width } = useWindowDimensions()
  return width >= 640 ? 2 : 1
}

export function FieldCard({ f, payload, self, onAct, cols }: { f: ProfileField; payload: ProfilePayload; self: boolean; onAct: (f: ProfileField) => void; cols: number }) {
  const { C } = useTheme()
  const [shown, setShown] = React.useState(false)
  const { text, restricted } = shownValue(f, payload)
  const mode = fieldMode(f, payload, self)
  const act = mode.kind !== 'none'
  // Reveal only applies to the real value (HR's view); a masked PAN from self.ids is already safe.
  const masked = f.mask && !shown && text !== NIL && !restricted && !text.includes('•')
  const valueStyle = f.mono ? { fontFamily: MONO } : undefined

  let body: React.ReactNode
  if (restricted) body = <Txt size={F.body} tone="faint" style={{ fontStyle: 'italic' }}>Restricted</Txt>
  else if (masked) {
    body = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Txt size={F.body} w={600} style={{ letterSpacing: 2 }}>{'•'.repeat(Math.min(12, Math.max(4, text.length)))}</Txt>
        <EyeBtn label="Reveal" onPress={() => setShown(true)} />
      </View>
    )
  } else {
    body = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
        {text === NIL
          ? <Txt size={F.body} tone="faint" style={{ fontStyle: 'italic' }}>Not added</Txt>
          : <Txt size={F.body} w={600} style={valueStyle} selectable>{text}</Txt>}
        {f.mask && shown && <EyeBtn label="Hide" onPress={() => setShown(false)} />}
      </View>
    )
  }

  const width = cols === 1 || f.wide ? '100%' : '48.9%'
  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Txt size={F.micro} w={700} tone="muted" upper style={{ flex: 1 }} numberOfLines={2}>{f.label}</Txt>
        {act ? <ModeChip mode={mode} />
          : self && f.state === 'locked' && !restricted
            ? <View accessibilityLabel="Maintained by HR. Ask HR to correct it."><LockGlyph color={C.faint} /></View> : null}
      </View>
      <View style={{ marginTop: 4 }}>{body}</View>
      {!!f.hint && <Txt size={F.tiny} tone="muted" style={{ marginTop: 4 }}>{f.hint}</Txt>}
    </>
  )
  const box = { width, padding: S.md, borderRadius: R.md, borderWidth: 1, borderColor: act ? C.brandEdge : C.line, backgroundColor: C.surface } as const
  if (!act) return <View style={box}>{content}</View>
  return (
    <Pressable onPress={() => onAct(f)} accessibilityRole="button" accessibilityHint={mode.label}
      style={({ pressed }) => [box, pressed && { backgroundColor: C.brandTint }]}>
      {content}
    </Pressable>
  )
}

function EyeBtn({ label, onPress }: { label: string; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button"
      style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill, borderWidth: 1, borderColor: C.brandEdge, backgroundColor: C.brandTint }}>
      <Txt size={F.micro} w={600} color={C.brandDeep}>{label}</Txt>
    </Pressable>
  )
}

export function FieldGroups({ groups, payload, self, onAct, rightOf }: {
  groups: FieldGroup[]; payload: ProfilePayload; self: boolean; onAct: (f: ProfileField) => void
  /** Something on a group's heading row (the Salary account's button). */
  rightOf?: (g: FieldGroup) => React.ReactNode
}) {
  const cols = useCols()
  return (
    <>
      {groups.map(g => (
        <Section title={g.title} key={g.title} right={rightOf?.(g)}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
            {g.fields.map(f => <FieldCard key={f.key} f={f} payload={payload} self={self} onAct={onAct} cols={cols} />)}
          </View>
        </Section>
      ))}
    </>
  )
}

/** Profile360 KV: a definition list — label left, value right. */
export function KVList({ rows }: { rows: [string, React.ReactNode][] }) {
  const { C } = useTheme()
  return (
    <View>
      {rows.map(([k, v], i) => (
        <View key={k} style={{ flexDirection: 'row', gap: S.md, paddingVertical: 7, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, alignItems: 'center' }}>
          <Txt size={F.small} tone="muted" style={{ width: 118 }}>{k}</Txt>
          <View style={{ flex: 1, minWidth: 0 }}>
            {typeof v === 'string' || typeof v === 'number' ? <Txt size={F.small} w={600}>{v}</Txt> : v}
          </View>
        </View>
      ))}
    </View>
  )
}

/** Profile360 RecordTable — a table on the web, one card per row on a phone. */
export function RecordTable({ title, rows, columns, empty }: { title: string; rows: Row[]; columns: string[]; empty: string }) {
  const { C } = useTheme()
  return (
    <Section title={title}>
      <Card>
        {!rows.length ? <EmptyText>{empty}</EmptyText> : rows.map((r, i) => (
          <View key={String(r.id ?? i)} style={{ paddingVertical: S.sm, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
            {columns.map(c => (
              <View key={c} style={{ flexDirection: 'row', gap: S.md, paddingVertical: 2 }}>
                <Txt size={F.tiny} tone="muted" style={{ width: 120 }}>{titleise(c)}</Txt>
                <Txt size={F.small} w={500} style={{ flex: 1, fontFamily: FONT[500] }}>{/sum_insured|amount/.test(c) ? money(r[c]) : pretty(r[c])}</Txt>
              </View>
            ))}
          </View>
        ))}
      </Card>
    </Section>
  )
}
