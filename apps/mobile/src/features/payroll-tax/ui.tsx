// src/features/payroll-tax/ui.tsx — small building blocks shared by the four
// payroll-tax screens. All at module level (the website's no-remount rule).
import * as React from 'react'
import { Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R as RAD, S } from '@/ui/theme'
import { Input, PickerField, Txt, type InputProps } from '@/ui/primitives'
import { DateSheet, SelectSheet, fmtDay, type Option } from '@/ui/overlays'

/** A <select>: a field that opens a bottom sheet of the same options. */
export function SelectField<V extends string | number>({ label, value, options, onChange, disabled, style }: {
  label?: string; value: V; options: Option<V>[]; onChange: (v: V) => void; disabled?: boolean; style?: StyleProp<ViewStyle>
}) {
  const [open, setOpen] = React.useState(false)
  const cur = options.find(o => o.value === value)
  return (
    <>
      <PickerField label={label} value={cur?.label ?? ''} placeholder={options[0]?.label} disabled={disabled} onPress={() => setOpen(true)} style={style} />
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={label || 'Select'} options={options} value={value} onPick={onChange} />
    </>
  )
}

/** <input type="date"> — 'YYYY-MM-DD' in, 'YYYY-MM-DD' out. */
export function DateField({ label, value, onChange, max, disabled, placeholder = 'Pick a date', style }: {
  label?: string; value: string; onChange: (v: string) => void; max?: string; disabled?: boolean; placeholder?: string; style?: StyleProp<ViewStyle>
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <PickerField label={label} value={value ? fmtDay(value) : ''} placeholder={placeholder} disabled={disabled} onPress={() => setOpen(true)} style={style} />
      <DateSheet visible={open} onClose={() => setOpen(false)} value={value || null} max={max} onPick={onChange} title={label} />
    </>
  )
}

/** <input type="number">. */
export function NumField({ value, onValue, disabled, ...rest }: Omit<InputProps, 'onChangeText' | 'onChange' | 'value'> & { value: string; onValue: (v: string) => void; disabled?: boolean }) {
  return <Input {...rest} value={value} onChangeText={onValue} editable={!disabled} keyboardType="numeric" placeholder={rest.placeholder ?? '0'} />
}

/** The calculator's `s.sec` section heading. */
export function SecHead({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return <View style={[{ marginTop: S.md, marginBottom: S.sm }, style]}><Txt size={F.micro} w={700} color={C.brandDeep} upper>{children}</Txt></View>
}

/** A coloured box (banners, notes) with explicit fill / edge. */
export function Box({ bg, edge, children, style }: { bg: string; edge?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: bg, borderWidth: 1, borderColor: edge || bg, borderRadius: RAD.md, paddingVertical: 9, paddingHorizontal: S.md }, style]}>{children}</View>
}

/** A figure tile. */
export function Tile({ label, value, color, bg, note, style, center }: {
  label: string; value: string; color?: string; bg?: string; note?: string; style?: StyleProp<ViewStyle>; center?: boolean
}) {
  const { C } = useTheme()
  return (
    <View style={[{ flexGrow: 1, flexBasis: '45%', minWidth: 130, backgroundColor: bg || C.sunken, borderWidth: 1, borderColor: C.line, borderRadius: RAD.md, padding: S.md }, center && { alignItems: 'center' }, style]}>
      <Txt size={10} w={600} tone="muted" upper>{label}</Txt>
      <Txt size={17} w={700} color={color || C.ink} style={{ marginTop: 2 }}>{value}</Txt>
      {!!note && <Txt size={10} tone="muted">{note}</Txt>}
    </View>
  )
}

/** A pill with explicit colours. */
export function Pill({ label, bg, fg, style }: { label: string; bg: string; fg: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 99, backgroundColor: bg }, style]}>
      <Txt size={11} w={700} color={fg}>{label}</Txt>
    </View>
  )
}

/** Inline bold run inside a Txt. */
export function B({ children, color }: { children: React.ReactNode; color?: string }) {
  return <Text style={[{ fontFamily: FONT[700] }, color ? { color } : null]}>{children}</Text>
}

/** A label + value line (key on the left, figure on the right). */
export function Line({ label, value, bold, color, style }: { label: string; value: string; bold?: boolean; color?: string; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme()
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line }, style]}>
      <Txt size={F.tiny} tone="muted" style={{ flex: 1 }}>{label}</Txt>
      <Txt size={F.tiny} w={bold ? 700 : 600} color={color}>{value}</Txt>
    </View>
  )
}
