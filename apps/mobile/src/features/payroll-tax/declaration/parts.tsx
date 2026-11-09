// Building blocks of the Investment Declaration screen — InvestmentDeclaration.tsx
// RegimeCard / AmountRow / HousePropertyRow (lines 42–153), at module level.
import * as React from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Button, Checkbox, Input, Txt, webNoOutline } from '@/ui/primitives'
import { SelectField } from '../ui'

export const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0)

export function RegimeCard({ code, title, blurb, active, disabled, onPick }: {
  code: string; title: string; blurb: string; active: boolean; disabled: boolean; onPick: (c: string) => void
}) {
  const { C } = useTheme()
  return (
    <Pressable onPress={() => !disabled && onPick(code)} accessibilityRole="radio" accessibilityState={{ selected: active, disabled }}
      style={{ flex: 1, minWidth: 220, padding: S.md + 2, borderRadius: 10, borderWidth: 2, borderColor: active ? C.brand : C.line,
        backgroundColor: active ? C.brandTint : C.surface, opacity: disabled && !active ? 0.55 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: 4 }}>
        <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: active ? C.brand : C.brandTint, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
          {active && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand }} />}
        </View>
        <Txt size={14} w={700}>{title}</Txt>
      </View>
      <Txt size={12} tone="muted" style={{ lineHeight: 18 }}>{blurb}</Txt>
    </Pressable>
  )
}

/** A label (with hint) on the left, a right-aligned digits-only amount on the right. */
export function AmountRow({ label, hint, value, onChange, readOnly, hintColor }: {
  label: string; hint?: string; value: any; onChange?: (v: string) => void; readOnly?: boolean; hintColor?: string
}) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ flex: 1 }}>
        <Txt size={13}>{label}</Txt>
        {!!hint && <Txt size={11} color={hintColor || C.muted} style={{ marginTop: 2 }}>{hint}</Txt>}
      </View>
      <TextInput value={String(value ?? '')} editable={!readOnly} keyboardType="number-pad" accessibilityLabel={label}
        onChangeText={t => onChange && onChange(t.replace(/[^0-9]/g, ''))}
        style={[{ width: 132, minHeight: 44, textAlign: 'right', paddingHorizontal: S.md, borderRadius: R.sm, borderWidth: 1, borderColor: C.brandEdge,
          backgroundColor: readOnly ? C.sunken : C.surface, color: readOnly ? C.muted : C.ink, fontFamily: FONT[400], fontSize: F.body }, webNoOutline]} />
    </View>
  )
}

/** A yes/no line ("Parent(s) 60 or above?  ☐ Yes"). */
export function YesRow({ label, sub, checked, onChange, yes = 'Yes' }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; yes?: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ flex: 1 }}>
        <Txt size={12.5}>{label}</Txt>
        {!!sub && <Txt size={11} tone="muted" style={{ marginTop: 2 }}>{sub}</Txt>}
      </View>
      <Checkbox checked={checked} onChange={onChange} label={<Txt size={12} tone="muted">{yes}</Txt>} />
    </View>
  )
}

const OCC = [{ value: 'SELF', label: 'Self-occupied' }, { value: 'LET_OUT', label: 'Let out' }, { value: 'DEEMED_LET_OUT', label: 'Deemed let out' }]
const digits = (v: string) => v.replace(/[^0-9]/g, '')

export function HousePropertyRow({ row, onChange, onSave, onDelete, busy }: {
  row: any; onChange: (patch: any) => void; onSave: () => void; onDelete?: () => void; busy: boolean
}) {
  const { C } = useTheme()
  const isLetOut = row.occupancy_type === 'LET_OUT' || row.occupancy_type === 'DEEMED_LET_OUT'
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 9, padding: S.md, marginTop: 10 }}>
      <SelectField label="Occupancy" value={row.occupancy_type || 'SELF'} options={OCC} onChange={v => onChange({ occupancy_type: v })} />
      <Input label="Address" value={row.address || ''} onChangeText={v => onChange({ address: v })} />
      {isLetOut && <Input label="Annual rent received" keyboardType="number-pad" value={row.annual_rent_received || ''} onChangeText={v => onChange({ annual_rent_received: digits(v) })} />}
      <Input label="Interest on loan (annual)" keyboardType="number-pad" value={row.interest_on_loan || ''} onChangeText={v => onChange({ interest_on_loan: digits(v) })} />
      {isLetOut && (
        <>
          <Input label="Municipal taxes paid" keyboardType="number-pad" value={row.municipal_taxes_paid || ''} onChangeText={v => onChange({ municipal_taxes_paid: digits(v) })} />
          <Input label="Pre-construction interest (this year's 1/5th)" keyboardType="number-pad" value={row.pre_construction_interest || ''} onChangeText={v => onChange({ pre_construction_interest: digits(v) })} />
        </>
      )}
      {num(row.interest_on_loan) > 0 && (
        <>
          <Input label="Lender name" value={row.lender_name || ''} onChangeText={v => onChange({ lender_name: v })} />
          <Input label="Lender PAN" required value={row.lender_pan || ''} maxLength={10} autoCapitalize="characters"
            onChangeText={v => onChange({ lender_pan: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
        </>
      )}
      <View style={{ flexDirection: 'row', gap: S.sm, marginTop: 4 }}>
        <Button title="Save" size="sm" onPress={onSave} disabled={busy} style={{ flex: 1 }} />
        {onDelete && <Button title="Remove" size="sm" variant="danger" onPress={onDelete} disabled={busy} style={{ flex: 1 }} />}
      </View>
    </View>
  )
}
