// The MRF form's field kit on a phone — MrfForm.tsx Field / Sel / MasterSel /
// Locked / ChannelPicker / SkillsMultiSelect / QuestionsList / LaneMeter, and the
// redesign's SectionLine. Selects become bottom sheets; everything lives at module
// level so typing never remounts a field.
import * as React from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Button, FieldLabel, Input, PickerField, Txt, webNoOutline } from '@/ui/primitives'
import { DateSheet, fmtDay, Sheet, SelectSheet } from '@/ui/overlays'
import { IconCheck, IconClose } from '@/ui/icons'
import type { Master } from './model'

export function SectionLine({ n, title }: { n: string; title: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 6, marginBottom: 12 }}>
      <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' }}>
        <Txt size={11} w={700} tone="brand">{n}</Txt>
      </View>
      <Txt size={13.5} w={700}>{title}</Txt>
      <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
    </View>
  )
}

export function TextField({ label, value, onChange, placeholder, hint, required, numeric, multiline, minHeight, disabled, error }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; required?: boolean; numeric?: boolean; multiline?: boolean; minHeight?: number; disabled?: boolean; error?: boolean
}) {
  return (
    <Input label={label} required={required} value={value ?? ''} onChangeText={onChange} placeholder={placeholder} help={hint}
      keyboardType={numeric ? 'numeric' : 'default'} multiline={multiline} editable={!disabled} error={error ? ' ' : undefined}
      inputStyle={minHeight ? { minHeight } : undefined} />
  )
}

export interface Opt { value: string; label: string }
export function SelectField({ label, value, onChange, options, hint, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; options: Opt[]; hint?: string; placeholder?: string
}) {
  const [open, setOpen] = React.useState(false)
  const cur = options.find(o => o.value === (value ?? ''))
  return (
    <>
      <PickerField label={label} value={cur?.label || ''} placeholder={placeholder || options[0]?.label || 'Select…'} onPress={() => setOpen(true)} help={hint} />
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={label} value={value ?? ''} options={options} onPick={v => onChange(String(v))} />
    </>
  )
}
export const optsOf = (list: string[]): Opt[] => list.map(t => ({ value: t, label: t }))
/** MasterSel: placeholder option first, then master values by label (or code). */
export const masterOpts = (opts: Master[], placeholder: string, useCode?: boolean): Opt[] =>
  [{ value: '', label: placeholder }, ...opts.map(o => ({ value: useCode ? o.code : o.label, label: o.label }))]

export function DateField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <PickerField label={label} value={value ? fmtDay(value) : ''} placeholder="dd-mm-yyyy" onPress={() => setOpen(true)} help={hint} />
      <DateSheet visible={open} onClose={() => setOpen(false)} value={value || null} onPick={onChange} title={label} />
      {!!value && <Pressable onPress={() => onChange('')} style={{ alignSelf: 'flex-start', marginTop: -8, marginBottom: S.md }} hitSlop={6}><Txt size={11} tone="brand" w={600}>Clear date</Txt></Pressable>}
    </>
  )
}

/** A field filled in from the raiser's own record (MrfForm.tsx Locked). */
export function Locked({ label, value, hint }: { label: string; value?: string; hint?: string }) {
  const { C } = useTheme()
  return (
    <View style={{ marginBottom: S.md }}>
      <FieldLabel label={label} />
      <View style={{ minHeight: 46, borderRadius: R.sm + 1, borderWidth: 1, borderColor: C.positiveEdge, backgroundColor: C.positiveTint, paddingHorizontal: S.md, paddingVertical: 10, justifyContent: 'center' }}>
        <Txt size={F.body} w={500}>{value || '—'}</Txt>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
        <IconCheck size={12} color={C.positive} /><Txt size={11} w={600} tone="positive">{hint || 'From profile'}</Txt>
      </View>
    </View>
  )
}

export function ChannelPicker({ value, onChange, opts }: { value: string[]; onChange: (v: string[]) => void; opts: Master[] }) {
  const { C } = useTheme()
  const on = (l: string) => value.includes(l)
  const toggle = (l: string) => onChange(on(l) ? value.filter(x => x !== l) : [...value, l])
  if (!opts.length) return <Txt size={F.tiny} tone="faint">No sourcing channels configured.</Txt>
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {opts.map(o => (
        <Pressable key={o.code} onPress={() => toggle(o.label)} accessibilityRole="checkbox" accessibilityState={{ checked: on(o.label) }}
          style={{ minHeight: 38, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center', borderWidth: 1, borderColor: on(o.label) ? C.brandDeep : C.line, backgroundColor: on(o.label) ? C.brand : C.sunken }}>
          <Txt size={12.5} w={500} color={on(o.label) ? C.onAccent : C.inkSoft}>{o.label}</Txt>
        </Pressable>
      ))}
    </View>
  )
}

/** SkillsMultiSelect — chips + a searchable list over the skills master, plus "add custom". Comma-joined. */
export function SkillsPicker({ value, onChange, allSkills, onAddSkill, placeholder }: { value: string; onChange: (v: string) => void; allSkills: string[]; onAddSkill: (n: string) => void; placeholder?: string }) {
  const { C } = useTheme()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const selected = value ? value.split(',').map(s => s.trim()).filter(Boolean) : []
  const lowerSel = selected.map(s => s.toLowerCase())
  const matches = allSkills.filter(s => !lowerSel.includes(s.toLowerCase()) && (!q.trim() || s.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 10)
  const exact = allSkills.some(s => s.toLowerCase() === q.trim().toLowerCase()) || lowerSel.includes(q.trim().toLowerCase())
  const add = (skill: string) => { if (!lowerSel.includes(skill.toLowerCase())) onChange([...selected, skill].join(', ')); setQ(''); setOpen(false) }
  const remove = (skill: string) => onChange(selected.filter(s => s !== skill).join(', '))
  const addCustom = () => { const n = q.trim(); if (!n) return; onAddSkill(n); add(n) }
  return (
    <View>
      {selected.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {selected.map(s => (
            <Pressable key={s} onPress={() => remove(s)} accessibilityLabel={`Remove ${s}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 30, paddingHorizontal: 9, borderRadius: 8, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge }}>
              <Txt size={11.5} w={500} tone="brand">{s}</Txt><IconClose size={11} color={C.brand} />
            </Pressable>
          ))}
        </View>
      )}
      <PickerField value="" placeholder={placeholder || 'Click to pick a skill, or type to search / add custom'} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => { setQ(''); setOpen(false) }} title="Skills">
        <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Type to search or add a skill…" placeholderTextColor={C.faint}
          onSubmitEditing={() => { if (matches[0]) add(matches[0]); else if (q.trim() && !exact) addCustom() }}
          style={[{ height: 46, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.sm + 1, paddingHorizontal: S.md, fontFamily: FONT[400], fontSize: F.body, color: C.ink, marginBottom: S.sm }, webNoOutline]} />
        {matches.map(s => (
          <Pressable key={s} onPress={() => add(s)} style={({ pressed }) => ({ paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
            <Txt size={13.5}>{s}</Txt>
          </Pressable>
        ))}
        {!!q.trim() && !exact && (
          <Pressable onPress={addCustom} style={{ paddingVertical: 13, paddingHorizontal: 4 }}>
            <Txt size={13.5} w={600} tone="brand">+ Add custom: “{q.trim()}”</Txt>
          </Pressable>
        )}
        {matches.length === 0 && !q.trim() && <Txt size={12.5} tone="faint" style={{ padding: 4 }}>Type to search or add a skill…</Txt>}
      </Sheet>
    </View>
  )
}

export function QuestionsList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { C } = useTheme()
  const set = (i: number, q: string) => onChange(value.map((x, idx) => idx === i ? q : x))
  const del = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  return (
    <View style={{ gap: 6 }}>
      {value.length === 0 && <Txt size={11} tone="faint">No questions added — click “+ Add question” to add one.</Txt>}
      {value.map((q, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Txt size={11} w={700} tone="faint" style={{ width: 18, textAlign: 'right' }}>{i + 1}.</Txt>
          <TextInput value={q} onChangeText={t => set(i, t)} multiline placeholder="e.g. Walk me through a project where you owned the outcome end-to-end" placeholderTextColor={C.faint}
            style={[{ flex: 1, minHeight: 44, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.sm + 1, paddingHorizontal: 10, paddingVertical: 8, fontFamily: FONT[400], fontSize: F.small, color: C.ink, backgroundColor: C.surface }, webNoOutline]} />
          <Button title="Remove" size="sm" variant="danger" onPress={() => del(i)} />
        </View>
      ))}
      <Button title="+ Add question" size="sm" variant="soft" onPress={() => onChange([...value, ''])} style={{ alignSelf: 'flex-start' }} />
    </View>
  )
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
const lakh = (n: number, digits = 2) => '₹' + (n / 100000).toFixed(digits).replace(/\.?0+$/, '') + 'L'

/** rx/form.tsx LaneMeter — draws where the annualised band sits against the ₹6L cap. Display only. */
export function LaneMeter({ minRupees, maxRupees, cap, lane }: { minRupees: number | null; maxRupees: number | null; cap: number; lane: 'Quick Hire' | 'Full MRF' | null }) {
  const { C } = useTheme()
  const top = Math.max(cap * 2, (maxRupees ?? 0) * 1.1)
  const pos = (v: number) => Math.max(0, Math.min(100, (v / top) * 100))
  const lo = minRupees ?? maxRupees; const hi = maxRupees ?? minRupees
  return (
    <View style={{ padding: S.lg, borderRadius: 16, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
        <Txt size={12.5} w={600} tone="soft">Where your band sits</Txt>
        {lane && <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, backgroundColor: lane === 'Quick Hire' ? C.positiveTint : C.brandTint }}><Txt size={11} w={700} color={lane === 'Quick Hire' ? C.positive : C.brandDeep}>{lane}</Txt></View>}
      </View>
      <View style={{ height: 16, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, overflow: 'visible' }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pos(cap)}%`, backgroundColor: C.positiveTint, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 }} />
        <View style={{ position: 'absolute', left: `${pos(cap)}%`, right: 0, top: 0, bottom: 0, backgroundColor: C.brandTint, borderTopRightRadius: 16, borderBottomRightRadius: 16 }} />
        {lo != null && hi != null && <View style={{ position: 'absolute', top: 2, bottom: 2, left: `${pos(lo)}%`, width: `${Math.max(1, pos(hi) - pos(lo))}%`, borderRadius: 10, backgroundColor: C.brand }} />}
        <View style={{ position: 'absolute', left: `${pos(cap)}%`, top: -8, bottom: -8, width: 2, backgroundColor: C.ink }} />
        <View style={{ position: 'absolute', left: `${pos(cap)}%`, top: -24, transform: [{ translateX: -24 }] }}><Txt size={10.5} w={700}>{lakh(cap, 1)} cap</Txt></View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 4 }}>
        <Txt size={11} tone="muted">₹0</Txt>
        <Txt size={11} tone="muted">Quick Hire up to {inr(cap)}</Txt>
        <Txt size={11} tone="muted">Full MRF above</Txt>
        <Txt size={11} tone="muted">{lakh(top, 0)}</Txt>
      </View>
    </View>
  )
}
