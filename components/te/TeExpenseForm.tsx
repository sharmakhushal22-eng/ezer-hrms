'use client'
// components/te/TeExpenseForm.tsx — "Add an expense": a bill with no travel.
//
// Markup and class names: design/html/expense-empty.html, expense-with-bill.html,
// expense-with-flags.html. Screens: screenshots "Other expense" group.
//
// WHERE THE RULES ARE  Nowhere in this file. Every change of the form is sent
// (after a short pause) to POST /api/te/expenses/preview, which runs the rules
// engine on the server and answers the flags and the eligible amount. Saving
// runs the same checks again. The form only shows what comes back.
import { useEffect, useMemo, useState } from 'react'
import { te, TeApiError } from '@/lib/te/client'
import type { ExpenseInput, ExpensePreview, Snapshot, TeExpense, TeUploadedFile, Uuid } from '@/lib/te/types'
import TeSheet from './TeSheet'
import TeIcon from './TeIcon'
import { errorText, flagClass, plural, rs } from '@/lib/te/format'

const PAY_MODES = ['UPI', 'Personal card', 'Cash']
// The engine's own ladders (AIR and RAIL in te-engine.js). The order is the
// entitlement order, so offering anything else would fail a check the employee
// cannot see the rule for.
const AIR_CLASSES = ['Economy', 'Premium Economy', 'Business']
const RAIL_CLASSES = ['SL', '3A', '2A', '1A']

/**
 * A saved line back into the form.
 *
 * EVERY FIELD THE FORM CAN SET HAS TO COME BACK. This dropped checkIn,
 * checkOut, pnr, cls and shared, which the database stores perfectly well
 * (te_expenses.check_in, te_expense_save writes it, te_expense_json returns
 * it). The effect was only visible on reopening a saved line: the dates were
 * blank, so A1 fired "Missing: check-in and check-out" on a line that had
 * them, and the hotel could not be re-saved without typing them again. The
 * same would have lost a ticket's PNR.
 */
function fromLine(x: TeExpense): ExpenseInput {
  return {
    id: x.id, tripId: x.tripId, cat: x.cat, date: x.date, merchant: x.merchant, billNo: x.billNo, gstin: x.gstin,
    bill: x.bill, claimed: x.claimed, payMode: x.payMode || 'UPI', desc: x.desc, reason: x.reason,
    wantException: x.wantException, client: x.client, attendees: x.attendees ?? undefined,
    checkIn: x.checkIn ?? undefined, checkOut: x.checkOut ?? undefined,
    pnr: x.pnr, cls: x.cls, shared: x.shared,
  }
}

export default function TeExpenseForm({ snap, line, tripId, onClose, onSaved }: {
  snap: Snapshot
  /** A saved line to change; left out = a new line. */
  line?: TeExpense
  /** The trip this bill belongs to. Changes which categories are offered:
   *  hotel and food only exist on a trip, and the form must not pretend
   *  otherwise on a loose monthly bill. */
  tripId?: Uuid
  onClose: () => void
  onSaved: (message: string) => void
}) {
  // On a trip, every category applies except mileage, which comes from the
  // leg's own recorded distance rather than from a bill. Off a trip, only the
  // categories that do not need one.
  const cats = useMemo(
    () => snap.cfg.cats.filter(c => c.on && c.id !== 'mileage' && (tripId ? true : !c.needsTrip)),
    [snap, tripId],
  )
  // Which trip this bill belongs to, for the heading. A trip not in the
  // snapshot still gets a form; it just loses the name.
  const tripName = useMemo(
    () => (tripId ? snap.trips.find(t => t.id === tripId)?.name ?? 'This trip' : ''),
    [snap, tripId],
  )
  const [f, setF] = useState<ExpenseInput>(() => (
    line ? fromLine(line) : { cat: '', date: snap.today, bill: '', claimed: '', payMode: 'UPI', ...(tripId ? { tripId } : {}) }
  ))
  const [file, setFile] = useState<TeUploadedFile | null>(null)
  const [fileName, setFileName] = useState(line?.file?.name ?? '')
  const [preview, setPreview] = useState<ExpensePreview | null>(null)
  const [busy, setBusy] = useState<'' | 'upload' | 'save' | 'delete'>('')
  const [error, setError] = useState<{ text: string; field: string | null } | null>(null)

  const set = <K extends keyof ExpenseInput>(k: K, v: ExpenseInput[K]) => { setF(p => ({ ...p, [k]: v })); setError(null) }
  // `files` is sent only when a new bill was attached: leaving it out keeps the bill a saved line already has.
  const input = useMemo<ExpenseInput>(() => (file ? { ...f, files: [file] } : f), [f, file])
  const ready = !!f.cat && !!f.date && Number(f.bill) > 0
  // Nights between check-in and check-out, for the hint under check-out. The
  // engine counts the same way when it works out the limit, so the number
  // shown here is the number the money is measured against.
  const nights = useMemo(() => {
    if (!f.checkIn || !f.checkOut) return 0
    const n = Math.round((new Date(f.checkOut).getTime() - new Date(f.checkIn).getTime()) / 864e5)
    return n > 0 ? n : 0
  }, [f.checkIn, f.checkOut])

  // The live check. State is set only when the answer arrives, and a late answer to an older question is dropped.
  useEffect(() => {
    if (!ready) return
    let current = true
    const timer = setTimeout(() => {
      te.expensePreview(input).then(p => { if (current) setPreview(p) }).catch(() => { if (current) setPreview(null) })
    }, 350)
    return () => { current = false; clearTimeout(timer) }
  }, [input, ready])

  async function attach(picked: File | undefined) {
    if (!picked) return
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
  const askReason = !!shown && (shown.needsReason || shown.flags.length > 0 || !!f.reason)
  const canAskException = !!shown && shown.flags.some(x => x.action === 'cap')

  return (
    <TeSheet
      title={line ? 'Change this expense' : 'Add an expense'}
      // The same form serves a bill on a trip and a bill with no travel, and
      // it used to say "No travel" either way — which read as a contradiction
      // on the trip screen, where the hotel and meal categories only exist.
      crumb={tripName ? `${tripName} › Add a bill` : 'Other expense › Add a bill'}
      lead={tripName
        ? `Saved against ${tripName} and claimed with that trip, not with your monthly expenses.`
        : 'No travel. It is saved under Other expenses until you submit your claim.'}
      onClose={onClose}
      footer={<>
        {line ? <button type="button" className="btn dan" disabled={!!busy} onClick={discard}>Remove</button> : null}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn pri" disabled={!ready || !!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save expense'}</button>
      </>}
    >
      <div className="sec">
        <h4>What did you spend on?</h4>
        <div className="opts">
          {cats.map(c => (
            <button key={c.id} type="button" className="opt" aria-pressed={f.cat === c.id} disabled={!!line} onClick={() => set('cat', c.id)}>{c.name}</button>
          ))}
        </div>
      </div>

      <div className="sec">
        <h4>Bill</h4>
        <label className="drop">
          <div className="grow">
            <b>{fileName || 'Attach the bill'}</b>
            <div className="small muted">
              {busy === 'upload' ? 'Uploading…' : file ? `Stored. Fingerprint ${file.sha256.slice(0, 10)}` : 'A photo or a PDF, up to 10 MB.'}
            </div>
          </div>
          <input type="file" className="vh" accept="image/*,.pdf" onChange={e => attach(e.target.files?.[0])} />
          <span className="btn sm">{fileName ? 'Replace' : 'Choose file'}</span>
        </label>
      </div>

      <div className="sec">
        <h4>Details</h4>
        <div className="form">
          <label className="fld"><span>Date</span><input type="date" value={f.date} max={snap.today} onChange={e => set('date', e.target.value)} /></label>
          <label className="fld"><span>Merchant</span><input type="text" value={f.merchant ?? ''} onChange={e => set('merchant', e.target.value)} /></label>
          <label className="fld"><span>Bill or invoice number</span><input type="text" value={f.billNo ?? ''} onChange={e => set('billNo', e.target.value)} /></label>
          <label className="fld"><span>Amount on the bill (₹)</span><input type="number" min={0} inputMode="decimal" value={f.bill ?? ''} onChange={e => set('bill', e.target.value)} /></label>
          <label className="fld"><span>Amount you claim (₹)</span><input type="number" min={0} inputMode="decimal" value={f.claimed ?? ''} placeholder="Same as the bill" onChange={e => set('claimed', e.target.value)} /></label>
          <label className="fld"><span>Merchant GSTIN</span><input type="text" maxLength={15} autoCapitalize="characters" value={f.gstin ?? ''} onChange={e => set('gstin', e.target.value.toUpperCase())} /><small>Optional. Checked for format and state.</small></label>
          {f.cat === 'client' ? <>
            <label className="fld"><span>Client company</span><input type="text" value={f.client ?? ''} onChange={e => set('client', e.target.value)} /></label>
            <label className="fld"><span>Number of people</span><input type="number" min={1} value={f.attendees ?? ''} onChange={e => set('attendees', e.target.value)} /></label>
          </> : null}
          {/* A HOTEL BILL CANNOT BE SAVED WITHOUT THESE. The engine's A1 check
              is `cat === 'hotel' && (!checkIn || !checkOut)` and it blocks, so
              with no fields here the category was impossible to use: the form
              said "Missing: check-in and check-out" and offered nowhere to put
              them. The dates are not decoration either — the limit is per
              NIGHT (limit × nights × pax when the room is shared) and C6 uses
              them to spot two overlapping stays. */}
          {f.cat === 'hotel' ? <>
            <label className="fld"><span>Check in</span>
              <input type="date" value={f.checkIn ?? ''} onChange={e => set('checkIn', e.target.value)} />
            </label>
            <label className="fld"><span>Check out</span>
              <input type="date" value={f.checkOut ?? ''} min={f.checkIn || undefined} onChange={e => set('checkOut', e.target.value)} />
              <small>{nights > 0 ? `${plural(nights, 'night')}. The limit is per night.` : 'The limit is counted per night.'}</small>
            </label>
            <label className="check small">
              <input type="checkbox" checked={!!f.shared} onChange={e => set('shared', e.target.checked)} />
              <span>A shared room. More than one of you stayed in it, so the limit covers all of you rather than one person.</span>
            </label>
          </> : null}
          {/* Same story for a ticket: A1 wants a PNR and there was no field. */}
          {f.cat === 'air' || f.cat === 'train' ? <>
            <label className="fld"><span>PNR</span>
              <input type="text" autoCapitalize="characters" value={f.pnr ?? ''} onChange={e => set('pnr', e.target.value.toUpperCase())} />
            </label>
            <label className="fld"><span>Class</span>
              <select value={f.cls ?? ''} onChange={e => set('cls', e.target.value)}>
                <option value="">Not stated</option>
                {(f.cat === 'air' ? AIR_CLASSES : RAIL_CLASSES).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <small>Checked against what your grade allows.</small>
            </label>
          </> : null}
          <label className="fld"><span>Paid by</span>
            <select value={f.payMode ?? 'UPI'} onChange={e => set('payMode', e.target.value)}>{PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}</select>
          </label>
          <label className="fld full"><span>Note</span><input type="text" value={f.desc ?? ''} onChange={e => set('desc', e.target.value)} /></label>
        </div>
      </div>

      {askReason ? (
        <div className="sec">
          <h4>Reason</h4>
          <label className="fld"><span>Explain this line to your approver</span><textarea value={f.reason ?? ''} onChange={e => set('reason', e.target.value)} /></label>
          {canAskException ? (
            <label className="check small">
              <input type="checkbox" checked={!!f.wantException} onChange={e => set('wantException', e.target.checked)} />
              <span>Ask for an exception instead of accepting the cap. The workflow adds Head of department as an approver.</span>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="sec">
        <h4>Check</h4>
        {!ready ? <p className="small muted">Choose what you spent on, the date and the amount. The checks run as you type.</p> : null}
        {shown ? (
          <div className="stack">
            <div className="row sp">
              <div>
                <div className="small muted">Eligible for reimbursement</div>
                <div className="num"><b>{rs(shown.eligible)}</b></div>
              </div>
              <span className={shown.blocked ? 'chip t-crit' : shown.flags.length ? 'chip t-warn' : 'chip t-pos'}>
                {shown.blocked ? 'Cannot be saved yet' : shown.flags.length ? 'Saved with notes' : 'No issues'}
              </span>
            </div>
            <div className="stack sm">
              {shown.flags.map(x => (
                <div key={x.code + x.title} className={flagClass(x)}>
                  <TeIcon name="warn" />
                  <div className="tx">
                    <b><span className="code">{x.code}</span> {x.title}</b>
                    <p>{x.evidence}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {error ? <div className="flag crit" role="alert"><TeIcon name="warn" /><div className="tx"><b>{error.text}</b></div></div> : null}
      </div>
    </TeSheet>
  )
}
