// src/features/profile/Editors.tsx — the editors behind "Fix" and "Edit
// profile" (components/profile/editors.tsx), part 1: the shared shell, the
// one-value FieldEditor, Aadhaar / PAN / UAN, and the emergency contact.
// Part 2 (address, nominees, salary account) is Editors2.tsx.
//
// The rules (what saves, what goes for approval, every validation sentence)
// are the website's own lib/profile/self-service.ts, imported, and the API
// checks them again. Each editor is mounted only while open, so every open
// starts fresh; each is a bottom sheet with Cancel / Save in its footer.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import {
  checkAadhaar, checkEmergency, checkFieldValue, checkPan, checkUan, editorFor, EMERGENCY_RELATIONS, goesTo,
  type Approvers,
} from '@web/profile/self-service'
import type { ProfileField, SelfInfo } from '@web/profile/types'
import type { PickedFile } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, Notice, PickerField, Segmented, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet, Sheet, fmtDay, ymd } from '@/ui/overlays'
import { editField, requestChange, selfService } from './api'
import { DOC_SOURCES, PickError, pickDoc, type DocSource } from './files'

export type Done = (message: string) => void

// ── shells ─────────────────────────────────────────────────────────────────

export function EditorSheet({ title, sub, onClose, footer, children }: {
  title: string; sub?: string; onClose: () => void; footer: React.ReactNode; children: React.ReactNode
}) {
  return (
    <Sheet visible onClose={onClose} title={title} footer={footer} full>
      {!!sub && <Txt size={F.small} tone="muted" style={{ marginBottom: S.md }}>{sub}</Txt>}
      {children}
    </Sheet>
  )
}

export function Actions({ busy, disabled, onClose, onSave, label }: {
  busy: boolean; disabled?: boolean; onClose: () => void; onSave: () => void; label: string
}) {
  return (
    <View style={{ flexDirection: 'row', gap: S.sm }}>
      <Button title="Cancel" variant="outline" style={{ flex: 1 }} onPress={onClose} />
      <Button title={busy ? 'Saving…' : label} style={{ flex: 1 }} disabled={busy || disabled} onPress={onSave} />
    </View>
  )
}

/** Where a request goes, said before it is sent. */
export function GoesTo({ fieldKey, approvers }: { fieldKey: string; approvers?: Approvers | null }) {
  const { C } = useTheme()
  const g = goesTo(fieldKey, approvers)
  return (
    <View style={{ marginTop: S.md, padding: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.warningEdge, backgroundColor: C.warningTint }}>
      <Txt size={F.micro} w={700} tone="warning" upper>Goes to</Txt>
      {g.stages.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: 6 }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: C.warning, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={F.micro} w={700} color={C.onAccent}>{i + 1}</Txt>
          </View>
          <Txt size={F.small} w={600} style={{ flex: 1 }}>{s}</Txt>
        </View>
      ))}
      <Txt size={F.tiny} tone="soft" style={{ marginTop: S.sm }}>Nothing changes until it is approved. You can follow it, or withdraw it, in Change history.</Txt>
    </View>
  )
}

export function Err({ text }: { text: string | null }) {
  return text ? <Notice tone="critical" style={{ marginTop: S.md }}>{text}</Notice> : null
}

export function FErr({ text }: { text?: string | null }) {
  return text ? <Txt size={F.tiny} tone="critical" style={{ marginTop: -S.sm, marginBottom: S.md }}>{text}</Txt> : null
}

/** The current value, read-only, above the input (`.cur`). */
export function Current({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: S.sm, padding: S.md, borderRadius: R.md, backgroundColor: C.sunken, marginBottom: S.md }}>
      <Txt size={F.tiny} w={700} tone="muted" upper>{k}</Txt>
      <Txt size={F.small} w={600} style={[{ flex: 1 }, mono ? { fontFamily: 'monospace' } : null]}>{v}</Txt>
    </View>
  )
}

/** A file picker that says what was picked, and checks type and size first. */
export function FileField({ label, file, onChange, attach = 'Attach a copy' }: {
  label: string; file: PickedFile | null; onChange: (f: PickedFile | null, err: string | null) => void; attach?: string
}) {
  const [choose, setChoose] = React.useState(false)
  const pick = async (src: DocSource) => {
    setChoose(false)
    try { const f = await pickDoc(src); if (f) onChange(f, null) }
    catch (e) { onChange(null, e instanceof PickError ? e.message : 'That file could not be opened.') }
  }
  return (
    <View style={{ marginBottom: S.md }}>
      <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>{label}<Txt size={F.micro} tone="faint"> · optional</Txt></Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
        <Button title={file ? 'Choose another' : attach} variant="outline" size="sm" onPress={() => setChoose(c => !c)} />
        <Txt size={F.tiny} tone="muted" style={{ flex: 1, minWidth: 120 }} numberOfLines={1}>{file ? file.name : 'PDF, JPG or PNG, up to 5 MB'}</Txt>
        {file && <Pressable onPress={() => onChange(null, null)} hitSlop={8}><Txt size={F.small} w={600} tone="brand">Remove</Txt></Pressable>}
      </View>
      {choose && (
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap', marginTop: S.sm }}>
          {DOC_SOURCES.map(o => <Button key={o.value} title={o.label} variant="soft" size="sm" onPress={() => void pick(o.value)} />)}
        </View>
      )}
    </View>
  )
}

// ── the one-value editor ───────────────────────────────────────────────────

const today = () => ymd(new Date())

export function FieldEditor({ field, current, approvers, onClose, onDone }: {
  field: ProfileField; current: unknown; approvers?: Approvers | null; onClose: () => void; onDone: Done
}) {
  const spec = editorFor(field.key)
  const direct = field.state === 'direct'
  const initial = current === null || current === undefined ? '' : String(current)
  // A direct field starts from what is there; a request starts empty, so
  // "what it becomes" is never mistaken for "what it was".
  const [value, setValue] = React.useState(direct ? initial : '')
  const [reason, setReason] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [picker, setPicker] = React.useState(false)

  const check = value.trim() ? checkFieldValue(field.key, value).error : 'Enter a value.'
  const unchanged = direct && value.trim() === initial.trim()

  const save = async () => {
    setTouched(true)
    if (check || (!direct && !reason.trim())) return
    setBusy(true); setErr(null)
    try {
      if (direct) { await editField(field.key, value); onDone(`${field.label} saved.`) }
      else {
        const r = await requestChange(field.key, value, reason)
        onDone(`Request sent${r.waiting_on ? `. Waiting on ${r.waiting_on}` : ''}.`)
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.') }
    finally { setBusy(false) }
  }

  const label = direct ? field.label : 'New value'
  let input: React.ReactNode
  if (spec.kind === 'select') {
    input = (
      <>
        <PickerField label={label} value={value} placeholder="Choose…" onPress={() => setPicker(true)} />
        <SelectSheet visible={picker} onClose={() => setPicker(false)} title={field.label}
          options={(spec.options ?? []).map(o => ({ value: o, label: o }))} value={value} onPick={v => { setValue(v); setTouched(true) }} searchable={false} />
      </>
    )
  } else if (spec.kind === 'date') {
    input = (
      <>
        <PickerField label={label} value={value ? fmtDay(value) : ''} placeholder="Pick a date" onPress={() => setPicker(true)} />
        <DateSheet visible={picker} onClose={() => setPicker(false)} value={value || null} max={today()} title={field.label}
          onPick={d => { setValue(d); setTouched(true) }} />
      </>
    )
  } else if (spec.kind === 'bool') {
    input = (
      <View style={{ marginBottom: S.md }}>
        <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>{label}</Txt>
        <Segmented items={[{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }]} value={value as 'true' | 'false'} onChange={setValue} />
      </View>
    )
  } else {
    input = (
      <Input label={label} value={value} onChangeText={setValue} autoFocus onBlur={() => setTouched(true)}
        multiline={spec.kind === 'textarea'} maxLength={spec.maxLength} placeholder={spec.placeholder}
        keyboardType={spec.kind === 'tel' ? 'phone-pad' : spec.kind === 'number' ? 'decimal-pad' : spec.kind === 'email' ? 'email-address' : 'default'}
        autoCapitalize={spec.kind === 'email' ? 'none' : undefined}
        onSubmitEditing={() => void save()} />
    )
  }
  const shown = initial === 'true' ? 'Yes' : initial === 'false' ? 'No' : initial

  return (
    <EditorSheet title={direct ? `Edit ${field.label.toLowerCase()}` : `Request a change to ${field.label.toLowerCase()}`}
      sub={direct ? 'Saves straight away.' : 'Goes for approval. Nothing changes until it is approved.'}
      onClose={onClose}
      footer={<Actions busy={busy} onClose={onClose} onSave={() => void save()} disabled={unchanged} label={direct ? 'Save' : 'Send request'} />}>
      <Current k="Current" v={shown || 'Not set'} />
      {input}
      {touched && <FErr text={check} />}
      {!!field.hint && <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>{field.hint}</Txt>}
      {!direct && (
        <>
          <Input label="Reason" value={reason} onChangeText={setReason} multiline placeholder="Why is this changing? The approver reads this."
            error={touched && !reason.trim() ? 'A reason is required.' : null} />
          <GoesTo fieldKey={field.key} approvers={approvers} />
        </>
      )}
      <Err text={err} />
    </EditorSheet>
  )
}

// ── Aadhaar / PAN / UAN ────────────────────────────────────────────────────

const ID_META = {
  aadhaar: { title: 'Add your Aadhaar', label: 'Aadhaar number', ph: '1234 5678 9012', check: checkAadhaar,
    note: 'Only the last four digits are kept on your record. The full number never is.' },
  pan: { title: 'Add your PAN', label: 'PAN', ph: 'ABCDE1234F', check: checkPan,
    note: 'Used for TDS on your salary. Without it, tax is deducted at a higher rate.' },
  uan: { title: 'Add your UAN', label: 'Universal Account Number (UAN)', ph: '100123456789', check: checkUan,
    note: 'From your previous employer’s payslip or the EPFO portal. New to PF? Leave it blank and payroll generates one.' },
} as const

export function IdentityEditor({ which, onFile, masked, onClose, onDone }: {
  which: 'aadhaar' | 'pan' | 'uan'; onFile: boolean; masked?: string | null; onClose: () => void; onDone: Done
}) {
  const m = ID_META[which]
  const [num, setNum] = React.useState('')
  const [file, setFile] = React.useState<PickedFile | null>(null)
  const [touched, setTouched] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const check = m.check(num)

  if (onFile) {
    return (
      <EditorSheet title={m.label} onClose={onClose} footer={<Button title="Close" full onPress={onClose} />}>
        <Current k="On file" v={masked || 'Recorded'} mono />
        <Txt size={F.small} tone="soft">HR maintains this once it is on file, because payroll and statutory returns already use it. If it is wrong, contact HR to correct it.</Txt>
      </EditorSheet>
    )
  }

  const save = async () => {
    setTouched(true)
    if (check) return
    setBusy(true); setErr(null)
    try { const r = await selfService({ action: 'identity', kind: which, number: num }, file); onDone(r.message ?? 'Saved.') }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.') }
    finally { setBusy(false) }
  }

  return (
    <EditorSheet title={m.title} sub="Saves straight away. HR verifies the card if you attach one." onClose={onClose}
      footer={<Actions busy={busy} onClose={onClose} onSave={() => void save()} label="Save" />}>
      <Input label={m.label} value={num} placeholder={m.ph} autoFocus autoComplete="off" autoCorrect={false}
        autoCapitalize={which === 'pan' ? 'characters' : 'none'} keyboardType={which === 'pan' ? 'default' : 'number-pad'}
        maxLength={which === 'pan' ? 10 : 14} inputStyle={{ fontFamily: 'monospace' }}
        onChangeText={t => setNum(which === 'pan' ? t.toUpperCase() : t.replace(/[^\d ]/g, ''))}
        onBlur={() => setTouched(true)}
        error={touched ? check : null} help={m.note} />
      <FileField label="Copy of the card" file={file} onChange={(f, e) => { setFile(f); setErr(e) }} />
      <Err text={err} />
    </EditorSheet>
  )
}

// ── emergency contact ──────────────────────────────────────────────────────

export function EmergencyEditor({ slot, self, onClose, onDone }: {
  slot: 1 | 2; self?: SelfInfo | null; onClose: () => void; onDone: Done
}) {
  const cur = self?.emergency?.[slot] ?? null
  const [e, setE] = React.useState({ name: cur?.name ?? '', relation: cur?.relation ?? '', mobile: cur?.mobile ?? '' })
  const [touched, setTouched] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [pick, setPick] = React.useState(false)
  const check = checkEmergency(e)

  const save = async () => {
    setTouched(true)
    if (check) return
    setBusy(true); setErr(null)
    try { const r = await selfService({ action: 'emergency', slot, ...e }); onDone(r.message ?? 'Saved.') }
    catch (x) { setErr(x instanceof Error ? x.message : 'Could not reach the server.') }
    finally { setBusy(false) }
  }

  return (
    <EditorSheet title={`${cur ? 'Edit' : 'Add'} emergency contact${slot === 2 ? ' 2' : ''}`}
      sub="Saves straight away. Printed on your ID card and used only in an emergency." onClose={onClose}
      footer={<Actions busy={busy} onClose={onClose} onSave={() => void save()} label="Save" />}>
      <Input label="Name" value={e.name} maxLength={80} autoFocus onChangeText={t => setE({ ...e, name: t })} />
      <PickerField label="Relation" value={e.relation} placeholder="Choose…" onPress={() => setPick(true)} />
      <Input label="Mobile" value={e.mobile} keyboardType="phone-pad" placeholder="10-digit mobile" onChangeText={t => setE({ ...e, mobile: t })} />
      {touched && <FErr text={check} />}
      <Err text={err} />
      <SelectSheet visible={pick} onClose={() => setPick(false)} title="Relation" searchable={false}
        options={EMERGENCY_RELATIONS.map(r => ({ value: r, label: r }))} value={e.relation} onPick={v => setE({ ...e, relation: v })} />
    </EditorSheet>
  )
}
