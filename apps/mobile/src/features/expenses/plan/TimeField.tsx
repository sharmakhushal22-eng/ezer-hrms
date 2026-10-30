// src/features/expenses/plan/TimeField.tsx — the website's <input type="time"> for the
// planner's optional times ('HH:MM', or '' for "not recorded" — never midnight;
// migration 165). A field that opens an hour / minute sheet, with "Clear".
//
// Local to the module: the attendance feature has a similar picker but it is not
// exported from the UI kit (wish: a shared TimeSheet in @/ui/overlays).
import * as React from 'react'
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, FieldLabel, Txt } from '@/ui/primitives'
import { Sheet } from '@/ui/overlays'
import { TeIcon } from '../ui/TeIcon'

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

function Column({ label, items, value, onPick }: { label: string; items: string[]; value: string; onPick: (v: string) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flex: 1 }}>
      <Txt size={F.tiny} w={600} tone="muted" center style={{ marginBottom: 6 }}>{label}</Txt>
      <ScrollView style={{ maxHeight: 260, borderRadius: R.md, borderWidth: 1, borderColor: C.line }} nestedScrollEnabled>
        {items.map(v => {
          const on = v === value
          return (
            <Pressable key={v} onPress={() => onPick(v)} accessibilityRole="button" accessibilityLabel={`${label} ${v}`} accessibilityState={{ selected: on }}
              style={{ height: 44, alignItems: 'center', justifyContent: 'center', marginHorizontal: 6, borderRadius: R.sm, backgroundColor: on ? C.brand : 'transparent' }}>
              <Txt size={F.lead} w={on ? 700 : 500} color={on ? C.onAccent : C.ink}>{v}</Txt>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

function TimeSheet({ visible, onClose, value, onPick, title }: { visible: boolean; onClose: () => void; value: string; onPick: (v: string) => void; title: string }) {
  const [h, setH] = React.useState('09')
  const [m, setM] = React.useState('00')
  const [seen, setSeen] = React.useState<string | null>(null)
  const key = visible ? value || '' : null
  if (key !== seen) {
    setSeen(key)
    if (key !== null) {
      const x = /^(\d{2}):(\d{2})/.exec(key)
      setH(x ? x[1] : '09'); setM(x ? x[2] : '00')
    }
  }
  // A stored minute that is not a multiple of five stays pickable.
  const minutes = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort()
  return (
    <Sheet visible={visible} onClose={onClose} title={title}
      footer={<Button title={`Set ${h}:${m}`} full onPress={() => { onPick(`${h}:${m}`); onClose() }} style={{ marginBottom: S.sm }} />}>
      {visible && (
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Column label="Hour" items={HOURS} value={h} onPick={setH} />
          <Column label="Minute" items={minutes} value={m} onPick={setM} />
        </View>
      )}
    </Sheet>
  )
}

/** An optional HH:MM field. `help` is the website's <small> under it ("Optional"). */
export function TimeField({ label, value, onChange, help, style }: {
  label: string; value: string; onChange: (v: string) => void; help?: string; style?: StyleProp<ViewStyle>
}) {
  const { C } = useTheme()
  const [open, setOpen] = React.useState(false)
  return (
    <View style={[{ marginBottom: S.md }, style]}>
      <FieldLabel label={label} />
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${value || 'not set'}`}
        style={({ pressed }) => ({
          minHeight: 46, borderRadius: R.sm + 1, borderWidth: 1, borderColor: C.lineStrong, paddingHorizontal: S.md,
          backgroundColor: pressed ? C.brandTint : C.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        })}>
        <Txt size={F.body} w={500} color={value ? C.ink : C.faint}>{value || '--:--'}</Txt>
        <TeIcon name="clock" size="sm" color={C.faint} />
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, minHeight: 20 }}>
        {help ? <Txt size={F.tiny} tone="faint">{help}</Txt> : <View />}
        {value ? (
          <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Clear ${label}`}>
            <Txt size={F.tiny} w={600} tone="brand">Clear</Txt>
          </Pressable>
        ) : null}
      </View>
      <TimeSheet visible={open} onClose={() => setOpen(false)} value={value} onPick={onChange} title={label} />
    </View>
  )
}
