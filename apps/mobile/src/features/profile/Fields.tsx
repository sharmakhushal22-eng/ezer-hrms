// src/features/profile/Fields.tsx — Profile360's field card, field groups and
// record tables, for a phone.
//
// Field rules (Profile360.tsx Field):
//   · "Restricted" when maySee() says no OR the key is missing from the payload;
//   · money() for ctc/gross keys, pretty() otherwise;
//   · masked fields show dots + Reveal / Hide;
//   · actionable = maySee && key present && it is your own profile && not locked.
//     The website tests viewer_role === 'self' here, so an HR-role employee
//     (viewer_role 'hr' on their own record) cannot edit their own fields there.
//     Profile360 already switched the photo and ID card to isSelf for exactly
//     that reason; the app uses isSelf for fields too. The server enforces the
//     field states either way. A phone has no hover title, so an actionable card
//     also shows a chevron.
import * as React from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { maySee, type FieldGroup, type ProfileField, type ProfilePayload, type Row } from '@web/profile/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import { IconChevron } from '@/ui/icons'
import { money, pretty, titleise } from './format'
import { EmptyText, Section } from './bits'

const MONO = 'monospace'

export function StateText({ state }: { state: ProfileField['state'] }) {
  const tone = state === 'direct' ? 'positive' : state === 'request' ? 'warning' : state === 'event' ? 'info' : 'muted'
  return <Txt size={F.micro} w={700} tone={tone}>{state.charAt(0).toUpperCase() + state.slice(1)}</Txt>
}

/** Two columns on a wide screen, one on a phone — the web's g3 grid, with `wide` spanning. */
export function useCols() {
  const { width } = useWindowDimensions()
  return width >= 640 ? 2 : 1
}

export function FieldCard({ f, payload, self, onAct, cols }: { f: ProfileField; payload: ProfilePayload; self: boolean; onAct: (f: ProfileField) => void; cols: number }) {
  const { C } = useTheme()
  const [shown, setShown] = React.useState(false)
  const emp = payload.employee
  const allowed = maySee(payload.viewer_role, f.min)
  const present = Object.prototype.hasOwnProperty.call(emp, f.key)
  const actionable = allowed && present && self && f.state !== 'locked'

  let body: React.ReactNode
  if (!allowed || !present) {
    body = <Txt size={F.body} tone="faint" style={{ fontStyle: 'italic' }}>Restricted</Txt>
  } else {
    const raw = emp[f.key]
    const text = /ctc|gross/.test(f.key) ? money(raw) : pretty(raw)
    const valueStyle = f.mono ? { fontFamily: MONO } : undefined
    if (f.mask && !shown && text !== '-') {
      body = (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Txt size={F.body} w={600} style={{ letterSpacing: 2 }}>{'•'.repeat(Math.min(12, Math.max(4, text.length)))}</Txt>
          <EyeBtn label="Reveal" onPress={() => setShown(true)} />
        </View>
      )
    } else {
      body = (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
          <Txt size={F.body} w={600} style={valueStyle} selectable>{text}</Txt>
          {f.mask && shown && <EyeBtn label="Hide" onPress={() => setShown(false)} />}
        </View>
      )
    }
  }

  const width = cols === 1 || f.wide ? '100%' : '48.9%'
  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Txt size={F.micro} w={700} tone="muted" upper style={{ flex: 1 }} numberOfLines={2}>{f.label}</Txt>
        <StateText state={f.state} />
        {actionable && <IconChevron size={14} color={C.faint} />}
      </View>
      <View style={{ marginTop: 4 }}>{body}</View>
      {!!f.hint && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>{f.hint}</Txt>}
    </>
  )
  const box = { width, padding: S.md, borderRadius: R.md, borderWidth: 1, borderColor: actionable ? C.brandEdge : C.line, backgroundColor: C.surface } as const
  if (!actionable) return <View style={box}>{content}</View>
  return (
    <Pressable onPress={() => onAct(f)} accessibilityRole="button"
      accessibilityHint={f.state === 'direct' ? 'Edit' : 'Request a change'}
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

export function FieldGroups({ groups, payload, self, onAct }: { groups: FieldGroup[]; payload: ProfilePayload; self: boolean; onAct: (f: ProfileField) => void }) {
  const cols = useCols()
  return (
    <>
      {groups.map(g => (
        <Section title={g.title} key={g.title}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
            {g.fields.map(f => <FieldCard key={f.key} f={f} payload={payload} self={self} onAct={onAct} cols={cols} />)}
          </View>
        </Section>
      ))}
    </>
  )
}

/** A label/value cell used by the Overview "Employment" card and Growth "Performance". */
export function PlainField({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ width: '48.9%', paddingVertical: 6 }}>
      <Txt size={F.micro} w={700} tone="muted" upper>{k}</Txt>
      <Txt size={F.body} w={600} style={{ marginTop: 2 }}>{v}</Txt>
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
