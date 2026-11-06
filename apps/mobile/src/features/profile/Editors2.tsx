// src/features/profile/Editors2.tsx — components/profile/editors.tsx, part 2:
// the address, the PF / gratuity nominees and the salary account.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import {
  checkAccount, checkAddress, checkBank, checkIfsc, checkNominees, emptyAddress, INDIAN_STATES, isMinor,
  NOMINEE_RELATIONS, nomineeTotal, SCHEME_LABEL, type Address, type NomineeRow, type Scheme,
} from '@web/profile/self-service'
import type { Row, SelfInfo } from '@web/profile/types'
import type { PickedFile } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Checkbox, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet, fmtDay, ymd } from '@/ui/overlays'
import { selfService } from './api'
import { Actions, Current, EditorSheet, Err, FErr, FileField, GoesTo, type Done } from './Editors'

const MONO = { fontFamily: 'monospace' } as const

// ── address ────────────────────────────────────────────────────────────────

export function AddressEditor({ which, self, onFile, onClose, onDone }: {
  which: 'present' | 'permanent'; self?: SelfInfo | null
  /** Whether an address is on file at all — the server decides the same way. */
  onFile: boolean; onClose: () => void; onDone: Done
}) {
  const current = self?.addresses?.[which] ?? null
  const present = self?.addresses?.present ?? null
  const asRequest = onFile || !!current
  const [a, setA] = React.useState<Address>(current ? { ...current } : emptyAddress())
  const [same, setSame] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [pick, setPick] = React.useState(false)

  const value = same && present ? present : a
  const check = checkAddress(value)
  const set = (k: keyof Address) => (t: string) => setA(x => ({ ...x, [k]: k === 'pin' ? t.replace(/\D/g, '').slice(0, 6) : t }))
  const label = which === 'present' ? 'present address' : 'permanent address'

  const save = async () => {
    setTouched(true)
    if (check || (asRequest && !reason.trim())) return
    setBusy(true); setErr(null)
    try { const r = await selfService({ action: 'address', which, address: value, reason }); onDone(r.message ?? 'Saved.') }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.') }
    finally { setBusy(false) }
  }

  return (
    <EditorSheet title={asRequest ? `Change your ${label}` : `Add your ${label}`}
      sub={asRequest ? 'An address on file decides your Professional Tax state and HRA exemption, so a change goes to HR.' : 'Saves straight away.'}
      onClose={onClose}
      footer={<Actions busy={busy} onClose={onClose} onSave={() => void save()} label={asRequest ? 'Send request' : 'Save address'} />}>
      {which === 'permanent' && !!present && (
        <View style={{ marginBottom: S.md }}><Checkbox checked={same} onChange={setSame} label="Same as my present address" /></View>
      )}
      <Input label="Address line 1" value={value.line1} onChangeText={set('line1')} placeholder="House / flat no., building, street" maxLength={120} editable={!same} />
      <Input label="Address line 2 · optional" value={value.line2} onChangeText={set('line2')} placeholder="Area, locality, landmark" maxLength={120} editable={!same} />
      <Input label="City" value={value.city} onChangeText={set('city')} maxLength={60} editable={!same} />
      <PickerField label="State" value={value.state} placeholder="Choose…" disabled={same} onPress={() => setPick(true)} />
      <Input label="PIN code" value={value.pin} onChangeText={set('pin')} keyboardType="number-pad" placeholder="560038" editable={!same} inputStyle={MONO} />
      {touched && <FErr text={check} />}
      {asRequest && (
        <>
          <Input label="Reason" value={reason} onChangeText={setReason} multiline placeholder="e.g. Moved to a new flat from 1 November"
            error={touched && !reason.trim() ? 'A reason is required.' : null} />
          <GoesTo fieldKey={`${which}_address`} approvers={self?.approvers} />
        </>
      )}
      <Err text={err} />
      <SelectSheet visible={pick} onClose={() => setPick(false)} title="State" searchable
        options={INDIAN_STATES.map(s => ({ value: s, label: s }))} value={a.state} onPick={set('state')} />
    </EditorSheet>
  )
}

// ── nominees ───────────────────────────────────────────────────────────────

const blankRow = (): NomineeRow => ({ name: '', relation: '', dob: '', share: '' })

function NomineeRowCard({ r, i, only, onChange, onRemove, onPickRelation, onPickDob }: {
  r: NomineeRow; i: number; only: boolean
  onChange: (k: keyof NomineeRow, v: string) => void; onRemove: () => void; onPickRelation: () => void; onPickDob: () => void
}) {
  const { C } = useTheme()
  return (
    <Card style={{ marginBottom: S.sm, padding: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: S.sm }}>
        <Txt size={F.small} w={700} style={{ flex: 1 }}>Nominee {i + 1}</Txt>
        <Pressable onPress={only ? undefined : onRemove} disabled={only} hitSlop={10} accessibilityLabel={`Remove nominee ${i + 1}`}
          style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, opacity: only ? 0.35 : 1 }}>
          <Txt size={F.lead} tone="muted">×</Txt>
        </Pressable>
      </View>
      <Input label="Name" value={r.name} maxLength={80} onChangeText={t => onChange('name', t)} />
      <PickerField label="Relation" value={r.relation} placeholder="Choose…" onPress={onPickRelation} />
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <PickerField label="Date of birth · optional" value={r.dob ? fmtDay(r.dob) : ''} placeholder="Pick a date" onPress={onPickDob} style={{ flex: 1.4 }} />
        <Input label="Share %" value={r.share} keyboardType="decimal-pad" onChangeText={t => onChange('share', t.replace(/[^\d.]/g, ''))} style={{ flex: 1 }} />
      </View>
      {isMinor(r.dob) && <Txt size={F.tiny} tone="warning">Under 18. HR will ask for a guardian when filing the form.</Txt>}
    </Card>
  )
}

export function NomineeEditor({ scheme, nominations, family, onClose, onDone }: {
  scheme: Scheme; nominations: Row[]; family: Row[]; onClose: () => void; onDone: Done
}) {
  const { C } = useTheme()
  const [rows, setRows] = React.useState<NomineeRow[]>(() => {
    const famById = new Map(family.map(f => [String(f.id), f]))
    const mine = nominations.filter(n => String(n.scheme) === scheme)
    if (!mine.length) return [blankRow()]
    return mine.map(n => ({
      name: String(n.nominee_name ?? ''), relation: String(n.relation ?? ''),
      dob: String(famById.get(String(n.member_id))?.date_of_birth ?? '').slice(0, 10),
      share: String(Number(n.share_percent) || ''),
    }))
  })
  const [touched, setTouched] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [relFor, setRelFor] = React.useState<number | null>(null)
  const [dobFor, setDobFor] = React.useState<number | null>(null)

  const total = nomineeTotal(rows)
  const check = checkNominees(rows)
  const upd = (i: number, k: keyof NomineeRow, v: string) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const picked = new Set(rows.map(r => r.name.trim().toLowerCase()))
  const suggestions = family.filter(f => !picked.has(String(f.member_name ?? '').trim().toLowerCase()))

  const addFrom = (f: Row) => setRows(rs => {
    const r = { name: String(f.member_name ?? ''), relation: NOMINEE_RELATIONS.includes(String(f.relation)) ? String(f.relation) : 'Other',
      dob: String(f.date_of_birth ?? '').slice(0, 10), share: '' }
    return rs.length === 1 && !rs[0].name ? [r] : [...rs, r]
  })
  const split = () => setRows(rs => {
    const n = rs.length, base = Math.floor(10000 / n) / 100
    return rs.map((r, i) => ({ ...r, share: String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base) }))
  })

  const save = async () => {
    setTouched(true)
    if (check) return
    setBusy(true); setErr(null)
    try { const r = await selfService({ action: 'nominees', scheme, rows }); onDone(r.message ?? 'Saved.') }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.') }
    finally { setBusy(false) }
  }

  const left = Math.round((100 - total) * 100) / 100
  const ok = total === 100
  return (
    <EditorSheet title={`${SCHEME_LABEL[scheme]} nominees`} onClose={onClose}
      sub="Saves straight away. HR files the statutory form from it. Shares must total exactly 100%."
      footer={<Actions busy={busy} onClose={onClose} onSave={() => void save()} label="Save nominees" disabled={!ok} />}>
      {suggestions.length > 0 && (
        <View style={{ marginBottom: S.md }}>
          <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>From your family</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map(f => (
              <Pressable key={String(f.id)} onPress={() => addFrom(f)} accessibilityRole="button"
                style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: S.md, borderRadius: R.pill, justifyContent: 'center', borderWidth: 1, borderColor: C.brandEdge, backgroundColor: pressed ? C.brandEdge : C.brandTint })}>
                <Txt size={F.small} w={600} color={C.brandDeep}>+ {String(f.member_name)} <Txt size={F.small} tone="muted">· {String(f.relation)}</Txt></Txt>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      {rows.map((r, i) => (
        <NomineeRowCard key={i} r={r} i={i} only={rows.length === 1} onChange={(k, v) => upd(i, k, v)}
          onRemove={() => setRows(rs => rs.filter((_, j) => j !== i))} onPickRelation={() => setRelFor(i)} onPickDob={() => setDobFor(i)} />
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginTop: S.xs }}>
        <Button title="Add a nominee" variant="outline" size="sm" onPress={() => setRows(rs => [...rs, blankRow()])} />
        {rows.length > 1 && <Button title="Split equally" variant="ghost" size="sm" onPress={split} />}
      </View>
      <Txt size={F.small} w={700} tone={ok ? 'positive' : 'warning'} style={{ marginTop: S.md }}>
        Total {total}%{!ok && (left > 0 ? ` · ${left}% left to assign` : ` · ${-left}% over`)}
      </Txt>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.sunken, overflow: 'hidden', marginTop: 6, marginBottom: S.md }}>
        <View style={{ width: `${Math.min(100, total)}%`, height: '100%', backgroundColor: ok ? C.positive : total > 100 ? C.critical : C.warning }} />
      </View>
      {touched && <FErr text={check} />}
      <Err text={err} />
      <SelectSheet visible={relFor !== null} onClose={() => setRelFor(null)} title="Relation" searchable={false}
        options={NOMINEE_RELATIONS.map(x => ({ value: x, label: x }))} value={relFor !== null ? rows[relFor]?.relation : null}
        onPick={v => { if (relFor !== null) upd(relFor, 'relation', v) }} />
      <DateSheet visible={dobFor !== null} onClose={() => setDobFor(null)} title="Date of birth" max={ymd(new Date())}
        value={dobFor !== null ? rows[dobFor]?.dob || null : null} onPick={d => { if (dobFor !== null) upd(dobFor, 'dob', d) }} />
    </EditorSheet>
  )
}

// ── salary account ─────────────────────────────────────────────────────────

export function BankEditor({ self, current, onClose, onDone }: {
  self?: SelfInfo | null; current: { bank_name?: unknown; ifsc?: unknown }; onClose: () => void; onDone: Done
}) {
  const [b, setB] = React.useState({ bank_name: '', account: '', confirm: '', ifsc: '', holder: '' })
  const [reason, setReason] = React.useState('')
  const [file, setFile] = React.useState<PickedFile | null>(null)
  const [touched, setTouched] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const mismatch = !!b.confirm && b.confirm.replace(/\s/g, '') !== b.account.replace(/\s/g, '')
  const check = checkBank(b) ?? (!b.confirm ? 'Type the account number again to confirm it.' : mismatch ? 'The two account numbers do not match.' : null)
  const onFile = self?.ids?.has_bank
  const digits = (t: string) => t.replace(/[^\d]/g, '').slice(0, 18)

  const save = async () => {
    setTouched(true)
    if (check) return
    setBusy(true); setErr(null)
    try {
      const r = await selfService({ action: 'bank', bank_name: b.bank_name, account: b.account, ifsc: b.ifsc, holder: b.holder, reason }, file)
      onDone(r.message ?? 'Sent to Payroll.')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.') }
    finally { setBusy(false) }
  }

  return (
    <EditorSheet title={onFile ? 'Change your salary account' : 'Add your salary account'} onClose={onClose}
      sub="Your salary is paid into this account, so Payroll checks every change before it applies, including the first."
      footer={<Actions busy={busy} onClose={onClose} onSave={() => void save()} label="Send to Payroll" />}>
      {onFile && <Current k="On file" v={`${String(current.bank_name ?? '-')} · ${self?.ids?.bank_masked ?? '-'} · ${String(current.ifsc ?? '-')}`} />}
      <Input label="Bank name" value={b.bank_name} maxLength={80} placeholder="e.g. HDFC Bank" onChangeText={t => setB({ ...b, bank_name: t })} />
      <Input label="Account holder name" value={b.holder} maxLength={80} placeholder="As printed on the passbook" onChangeText={t => setB({ ...b, holder: t })} />
      <Input label="Account number" value={b.account} keyboardType="number-pad" autoComplete="off" inputStyle={MONO}
        onChangeText={t => setB({ ...b, account: digits(t) })} error={touched && b.account ? checkAccount(b.account) : null} />
      <Input label="Confirm account number" value={b.confirm} keyboardType="number-pad" autoComplete="off" inputStyle={MONO} contextMenuHidden
        onChangeText={t => setB({ ...b, confirm: digits(t) })} error={mismatch ? 'Does not match.' : null} />
      <Input label="IFSC" value={b.ifsc} maxLength={11} placeholder="HDFC0001234" autoCapitalize="characters" inputStyle={MONO}
        onChangeText={t => setB({ ...b, ifsc: t.toUpperCase().replace(/[^A-Z0-9]/g, '') })} error={touched && b.ifsc ? checkIfsc(b.ifsc) : null} />
      <Input label="Reason · optional" value={reason} maxLength={200} placeholder="e.g. Moved my salary to a new bank" onChangeText={setReason} />
      <FileField label="Cancelled cheque or passbook page" file={file} onChange={(f, e) => { setFile(f); setErr(e) }} attach="Attach proof" />
      {touched && <FErr text={check} />}
      <GoesTo fieldKey="salary_account" approvers={self?.approvers} />
      <Err text={err} />
    </EditorSheet>
  )
}
