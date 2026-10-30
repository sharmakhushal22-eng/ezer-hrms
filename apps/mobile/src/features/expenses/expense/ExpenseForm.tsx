// src/features/expenses/expense/ExpenseForm.tsx — "Add an expense" / "Change this expense"
// (components/te/TeExpenseForm.tsx), inside the module's TeSheet.
//
// WHERE THE RULES ARE  Nowhere in this file, as on the website. Every change is
// sent 350 ms after the last keystroke to POST /api/te/expenses/preview (a late
// answer to an older question is dropped); Save runs the same checks again.
//
// Phone adaptations (no behaviour change): category buttons are a wrap row of
// toggles; dates open DateSheet (Date: no later than today; Check out: not before
// Check in); Class and Paid by open SelectSheet; the bill is picked from the
// camera, the gallery or a PDF; the footer is sticky. A save / upload / discard
// error also shows above the footer buttons (it is in the Check section too,
// as on the website, which may be scrolled out of view).
//
// One addition the module lead asked for: Remove asks first (confirm). The
// website removes on the first tap.
//
// Since 4a92155 (as on the website): unfinished work is kept as a draft
// (useDraftAutosave, kind 'expense', body {f, file, fileName}); a resumed draft
// wins over everything; "Save as draft" once touched; the draft is discarded
// when the line saves; Save is dead while anything blocks, with the reason
// beside the buttons.
import * as React from 'react'
import { View } from 'react-native'
import type { ExpenseDraftBody, ExpenseInput, ExpensePreview, Snapshot, TeDraft, TeExpense, TeUploadedFile, Uuid } from '@web/te/types'
import { draftTitle, worthSaving } from '@web/te/autosave'
import type { PickedFile } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Checkbox, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet, fmtDay, useOverlay } from '@/ui/overlays'
import { errorText, plural, rs, te, TeApiError } from '../api'
import { useSignedIn } from '../data'
import { Chip, FieldErr, H4, Opt } from '../ui/kit'
import { FilePickButton } from '../ui/FilePick'
import { TeSheet } from '../ui/TeSheet'
import { ErrorFlag, FlagBlock } from '../claims/parts'
import { useDraftAutosave } from '../drafts/useDraftAutosave'
import { SavedLine } from '../drafts/SavedLine'

const PAY_MODES = ['UPI', 'Personal card', 'Cash']
// The engine's own ladders (AIR and RAIL in te-engine.js), in entitlement order.
const AIR_CLASSES = ['Economy', 'Premium Economy', 'Business']
const RAIL_CLASSES = ['SL', '3A', '2A', '1A']

/** A saved line back into the form. Every field the form can set has to come back. */
function fromLine(x: TeExpense): ExpenseInput {
  return {
    id: x.id, tripId: x.tripId, cat: x.cat, date: x.date, merchant: x.merchant, billNo: x.billNo, gstin: x.gstin,
    bill: x.bill, claimed: x.claimed, payMode: x.payMode || 'UPI', desc: x.desc, reason: x.reason,
    wantException: x.wantException, client: x.client, attendees: x.attendees ?? undefined,
    checkIn: x.checkIn ?? undefined, checkOut: x.checkOut ?? undefined,
    pnr: x.pnr, cls: x.cls, shared: x.shared,
  }
}

/** type=number on the website: keep digits and one decimal point. */
const decimal = (v: string) => {
  const s = v.replace(/[^0-9.]/g, '')
  const i = s.indexOf('.')
  return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '')
}
const digits = (v: string) => v.replace(/[^0-9]/g, '')
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))

type Busy = '' | 'upload' | 'save' | 'delete'
type DateField = 'date' | 'checkIn' | 'checkOut'
type Picker = 'cls' | 'payMode' | null

/** Section "Bill": the website's label.drop. */
function BillDrop({ fileName, file, busy, onPicked }: { fileName: string; file: TeUploadedFile | null; busy: Busy; onPicked: (f: PickedFile) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md, borderRadius: R.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.brandEdge, backgroundColor: C.sunken }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700} numberOfLines={2}>{fileName || 'Attach the bill'}</Txt>
        <Txt size={F.tiny} tone="muted">
          {busy === 'upload' ? 'Uploading…' : file ? `Stored. Fingerprint ${file.sha256.slice(0, 10)}` : 'A photo or a PDF, up to 10 MB.'}
        </Txt>
      </View>
      <FilePickButton title={fileName ? 'Replace' : 'Choose file'} size="sm" full={false} loading={busy === 'upload'}
        disabled={!!busy} onPicked={onPicked} />
    </View>
  )
}

/** Section "Check": eligible amount, the chip and every flag. */
function CheckSection({ ready, shown, error }: { ready: boolean; shown: ExpensePreview | null; error: { text: string } | null }) {
  return (
    <View>
      <H4>Check</H4>
      {!ready ? <Txt size={F.tiny} tone="muted">Choose what you spent on, the date and the amount. The checks run as you type.</Txt> : null}
      {shown ? (
        <View style={{ gap: S.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm }}>
            <View>
              <Txt size={F.tiny} tone="muted">Eligible for reimbursement</Txt>
              <Txt size={F.title} w={700} style={{ fontVariant: ['tabular-nums'] }}>{rs(shown.eligible)}</Txt>
            </View>
            <Chip tone={shown.blocked ? 't-crit' : shown.flags.length ? 't-warn' : 't-pos'}
              label={shown.blocked ? 'Cannot be saved yet' : shown.flags.length ? 'Saved with notes' : 'No issues'} />
          </View>
          {shown.flags.map(x => <FlagBlock key={x.code + x.title} code={x.code} title={x.title} text={x.evidence} block={x.block} />)}
        </View>
      ) : null}
      {error ? <ErrorFlag text={error.text} style={{ marginTop: S.sm }} /> : null}
    </View>
  )
}

export function ExpenseForm({ snap, line, tripId, resuming, onClose, onSaved }: {
  snap: Snapshot
  line?: TeExpense
  tripId?: Uuid
  /** A half-typed line being picked up again (its body is the whole form). */
  resuming?: TeDraft
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { confirm } = useOverlay()
  const signedIn = useSignedIn()
  const cats = React.useMemo(
    () => snap.cfg.cats.filter(c => c.on && c.id !== 'mileage' && (tripId ? true : !c.needsTrip)),
    [snap, tripId],
  )
  const tripName = React.useMemo(() => (tripId ? snap.trips.find(t => t.id === tripId)?.name ?? 'This trip' : ''), [snap, tripId])
  const draftBody = resuming?.body as ExpenseDraftBody | undefined
  const [f, setF] = React.useState<ExpenseInput>(() => (
    draftBody?.f ? draftBody.f
      : line ? fromLine(line)
      : { cat: '', date: snap.today, bill: '', claimed: '', payMode: 'UPI', ...(tripId ? { tripId } : {}) }
  ))
  const [file, setFile] = React.useState<TeUploadedFile | null>(draftBody?.file ?? null)
  const [fileName, setFileName] = React.useState(draftBody?.fileName ?? line?.file?.name ?? '')
  const [preview, setPreview] = React.useState<ExpensePreview | null>(null)
  const [busy, setBusy] = React.useState<Busy>('')
  const [error, setError] = React.useState<{ text: string; field: string | null } | null>(null)
  const [dateFor, setDateFor] = React.useState<DateField | null>(null)
  const [picker, setPicker] = React.useState<Picker>(null)

  const set = <K extends keyof ExpenseInput>(k: K, v: ExpenseInput[K]) => { setF(p => ({ ...p, [k]: v })); setError(null) }
  // `files` is sent only when a new bill was attached: leaving it out keeps the bill a saved line already has.
  const input = React.useMemo<ExpenseInput>(() => (file ? { ...f, files: [file] } : f), [f, file])
  const ready = !!f.cat && !!f.date && Number(f.bill) > 0
  const nights = React.useMemo(() => {
    if (!f.checkIn || !f.checkOut) return 0
    const n = Math.round((new Date(f.checkOut).getTime() - new Date(f.checkIn).getTime()) / 864e5)
    return n > 0 ? n : 0
  }, [f.checkIn, f.checkOut])

  // Unfinished work is kept: the form plus the attached bill (a storage path by then).
  const body = React.useMemo<Record<string, unknown>>(
    () => ({ f, file, fileName }) as unknown as Record<string, unknown>,
    [f, file, fileName],
  )
  const [pristineBody] = React.useState<Record<string, unknown>>(body)
  const catLabel = React.useCallback((code: string) => cats.find(c => c.id === code)?.name ?? code, [cats])
  const autosave = useDraftAutosave({
    kind: 'expense',
    body,
    pristine: pristineBody,
    title: draftTitle('expense', body, catLabel),
    scope: f.cat || null,
    tripId: tripId ?? null,
    resumingId: resuming?.id ?? null,
    enabled: busy !== 'save' && busy !== 'delete',
  })
  const touched = React.useMemo(() => worthSaving(body, pristineBody), [body, pristineBody])

  // The live check: 350 ms after the last change, late answers dropped.
  React.useEffect(() => {
    if (!ready || !signedIn) return
    let current = true
    const timer = setTimeout(() => {
      te.expensePreview(input).then(p => { if (current) setPreview(p) }).catch(() => { if (current) setPreview(null) })
    }, 350)
    return () => { current = false; clearTimeout(timer) }
  }, [input, ready, signedIn])

  async function attach(picked: PickedFile) {
    setBusy('upload'); setError(null)
    try {
      const stored = await te.upload(picked, 'BILL')
      setFile(stored); setFileName(stored.file_name)
      // What the scanner read (when one is configured) fills empty fields; it never overwrites typing.
      if (stored.ocr?.amount && !Number(f.bill)) set('bill', stored.ocr.amount)
    } catch (e) {
      setError({ text: errorText(e), field: null })
    } finally {
      setBusy('')
    }
  }

  async function save() {
    setBusy('save'); setError(null)
    try {
      const r = await te.expenseSave(input)
      // The line exists now, so the half-typed copy of it has no reason to stay.
      await autosave.discard()
      onSaved(`Saved ${r.expense_no}. ${rs(r.eligible)} is eligible.`)
    } catch (e) {
      if (e instanceof TeApiError && e.flags.length) setPreview(p => ({ ...(p ?? { eligible: 0, claimed: 0, mileage: null, needsReason: false }), flags: e.flags, blocked: true }))
      setError({ text: errorText(e), field: e instanceof TeApiError ? e.field : null })
    } finally {
      setBusy('')
    }
  }

  async function discard() {
    if (!line) return
    const ok = await confirm({ title: `Remove ${line.no}?`, confirm: 'Remove', cancel: 'Cancel', destructive: true })
    if (!ok) return
    setBusy('delete'); setError(null)
    try {
      await te.expenseDiscard(line.id)
      onSaved(`Removed ${line.no}.`)
    } catch (e) {
      setError({ text: errorText(e), field: null })
    } finally {
      setBusy('')
    }
  }

  const shown = ready ? preview : null
  // Save is dead while anything blocks; the reason sits next to the button.
  const blocked = !!shown?.blocked
  const blockedCount = shown ? shown.flags.filter(x => x.block).length : 0
  const blockedNote = !blocked ? ''
    : blockedCount ? `${plural(blockedCount, 'thing')} to fix below before this can be saved.` : 'Fix what is marked below before this can be saved.'
  const askReason = !!shown && (shown.needsReason || shown.flags.length > 0 || !!f.reason)
  const canAskException = !!shown && shown.flags.some(x => x.action === 'cap')
  const classes = f.cat === 'air' ? AIR_CLASSES : RAIL_CLASSES
  const dateValue = dateFor ? (f[dateFor] ?? '') : ''

  return (
    <TeSheet
      title={line ? 'Change this expense' : 'Add an expense'}
      crumb={<Txt size={F.tiny} tone="muted" numberOfLines={1}>{tripName ? `${tripName} › Add a bill` : 'Other expense › Add a bill'}</Txt>}
      lead={tripName
        ? `Saved against ${tripName} and claimed with that trip, not with your monthly expenses.`
        : 'No travel. It is saved under Other expenses until you submit your claim.'}
      onClose={onClose}
      footer={<>
        {error ? <FieldErr>{error.text}</FieldErr> : null}
        {blockedNote ? <Txt size={F.tiny} tone="muted">{blockedNote}</Txt> : null}
        <SavedLine autosave={autosave} />
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          {line ? <View style={{ flex: 1 }}><Button title="Remove" variant="danger" full disabled={!!busy} onPress={() => void discard()} /></View> : null}
          <View style={{ flex: 1 }}><Button title="Cancel" variant="outline" full onPress={onClose} /></View>
          <View style={{ flex: 1.4 }}><Button title={busy === 'save' ? 'Saving…' : 'Save expense'} full disabled={!ready || !!busy || blocked} onPress={() => void save()} /></View>
        </View>
        {touched && !busy ? (
          <Button title="Save as draft" variant="outline" full onPress={() => void autosave.saveNow().then(onClose)} />
        ) : null}
      </>}
    >
      <H4 style={{ marginTop: 0 }}>What did you spend on?</H4>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
        {cats.map(c => <Opt key={c.id} label={c.name} on={f.cat === c.id} disabled={!!line} onPress={() => set('cat', c.id)} />)}
      </View>

      <H4>Bill</H4>
      <BillDrop fileName={fileName} file={file} busy={busy} onPicked={p => void attach(p)} />

      <H4>Details</H4>
      <PickerField label="Date" value={f.date ? fmtDay(f.date) : ''} placeholder="Pick a date" onPress={() => setDateFor('date')} />
      <Input label="Merchant" accessibilityLabel="Merchant" value={str(f.merchant)} onChangeText={v => set('merchant', v)} />
      <Input label="Bill or invoice number" accessibilityLabel="Bill or invoice number" value={str(f.billNo)} onChangeText={v => set('billNo', v)} />
      <Input label="Amount on the bill (₹)" accessibilityLabel="Amount on the bill (₹)" keyboardType="decimal-pad" value={str(f.bill)} onChangeText={v => set('bill', decimal(v))} />
      <Input label="Amount you claim (₹)" accessibilityLabel="Amount you claim (₹)" keyboardType="decimal-pad" placeholder="Same as the bill" value={str(f.claimed)} onChangeText={v => set('claimed', decimal(v))} />
      <Input label="Merchant GSTIN" accessibilityLabel="Merchant GSTIN" maxLength={15} autoCapitalize="characters" autoCorrect={false} value={str(f.gstin)}
        onChangeText={v => set('gstin', v.toUpperCase())} help="Optional. Checked for format and state." />
      {f.cat === 'client' ? <>
        <Input label="Client company" accessibilityLabel="Client company" value={str(f.client)} onChangeText={v => set('client', v)} />
        <Input label="Number of people" accessibilityLabel="Number of people" keyboardType="number-pad" value={str(f.attendees)} onChangeText={v => set('attendees', digits(v))} />
      </> : null}
      {f.cat === 'hotel' ? <>
        <PickerField label="Check in" value={f.checkIn ? fmtDay(f.checkIn) : ''} placeholder="Pick a date" onPress={() => setDateFor('checkIn')} />
        <PickerField label="Check out" value={f.checkOut ? fmtDay(f.checkOut) : ''} placeholder="Pick a date" onPress={() => setDateFor('checkOut')}
          help={nights > 0 ? `${plural(nights, 'night')}. The limit is per night.` : 'The limit is counted per night.'} />
        <Checkbox checked={!!f.shared} onChange={v => set('shared', v)}
          label="A shared room. More than one of you stayed in it, so the limit covers all of you rather than one person." />
      </> : null}
      {f.cat === 'air' || f.cat === 'train' ? <>
        <Input label="PNR" accessibilityLabel="PNR" autoCapitalize="characters" autoCorrect={false} value={str(f.pnr)} onChangeText={v => set('pnr', v.toUpperCase())} />
        <PickerField label="Class" value={f.cls || 'Not stated'} onPress={() => setPicker('cls')} help="Checked against what your grade allows." />
      </> : null}
      <PickerField label="Paid by" value={f.payMode ?? 'UPI'} onPress={() => setPicker('payMode')} />
      <Input label="Note" accessibilityLabel="Note" value={str(f.desc)} onChangeText={v => set('desc', v)} />

      {askReason ? <>
        <H4>Reason</H4>
        <Input label="Explain this line to your approver" accessibilityLabel="Explain this line to your approver" multiline value={str(f.reason)} onChangeText={v => set('reason', v)} />
        {canAskException ? (
          <Checkbox checked={!!f.wantException} onChange={v => set('wantException', v)}
            label="Ask for an exception instead of accepting the cap. The workflow adds Head of department as an approver." />
        ) : null}
      </> : null}

      <CheckSection ready={ready} shown={shown} error={error} />

      <DateSheet visible={!!dateFor} onClose={() => setDateFor(null)} value={dateValue || (dateFor === 'checkOut' ? f.checkIn : null) || snap.today}
        title={dateFor === 'checkIn' ? 'Check in' : dateFor === 'checkOut' ? 'Check out' : 'Date'}
        max={dateFor === 'date' ? snap.today : null} min={dateFor === 'checkOut' ? f.checkIn || null : null}
        onPick={v => { if (dateFor) set(dateFor, v); setDateFor(null) }} />
      <SelectSheet visible={picker === 'cls'} onClose={() => setPicker(null)} title="Class" searchable={false}
        value={f.cls ?? ''} options={[{ value: '', label: 'Not stated' }, ...classes.map(c => ({ value: c, label: c }))]}
        onPick={v => { set('cls', v); setPicker(null) }} />
      <SelectSheet visible={picker === 'payMode'} onClose={() => setPicker(null)} title="Paid by" searchable={false}
        value={f.payMode ?? 'UPI'} options={PAY_MODES.map(m => ({ value: m, label: m }))}
        onPick={v => { set('payMode', v); setPicker(null) }} />
    </TeSheet>
  )
}
