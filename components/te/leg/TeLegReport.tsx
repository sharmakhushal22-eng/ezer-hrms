'use client'
// components/te/leg/TeLegReport.tsx — what the leg cost, once it has ended.
// Screens 59, 60, 62.
//
// The leg is already recorded; this is the money side of it. What the form
// asks for depends on how the leg was travelled, and that is the mode's
// `basis`, which an admin set:
//   km      own vehicle — nothing to type, the rate and the distance decide it
//   bill    a cab or a rental — the fare, and a bill
//   nobill  an auto or a bus — the fare, no bill needed
//   ticket  a flight or a train — the fare, the reference and the class
//   none    a company vehicle — nothing is paid, the leg is only logged
//
// Nothing here works out what is owed. te.legPreview answers that on every
// change (debounced), and te.legFile commits it. The flags and the refusal
// wording are the server's.
import { useEffect, useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { LegPreview, LegReportInput, Snapshot, TeLeg, TeUploadedFile } from '@/lib/te/types'
import { errorText, flagClass, rs, when } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const PAY_MODES = ['UPI', 'Personal card', 'Cash', 'Company card']

export default function TeLegReport({ snap, leg, placeName, onBack, onFiled }: {
  snap: Snapshot
  leg: TeLeg
  placeName: (id: string) => string
  onBack: () => void
  onFiled: (message: string) => void
}) {
  const mode = snap.cfg.modes.find(m => m.id === leg.mode) ?? null
  const basis = mode?.basis ?? 'bill'
  const needsFare = basis !== 'km' && basis !== 'none'
  const needsBill = basis === 'bill' || basis === 'ticket'
  const isTicket = basis === 'ticket'

  const [f, setF] = useState<LegReportInput>({ payMode: 'UPI' })
  const [file, setFile] = useState<TeUploadedFile | null>(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<LegPreview | null>(null)
  const [busy, setBusy] = useState<'' | 'upload' | 'file'>('')
  const [error, setError] = useState('')

  const set = <K extends keyof LegReportInput>(k: K, v: LegReportInput[K]) => { setF(p => ({ ...p, [k]: v })); setError('') }
  const input = useMemo<LegReportInput>(() => (file ? { ...f, files: [file] } : f), [f, file])

  // The live check, debounced, with a late answer to an older question dropped.
  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      te.legPreview(leg.id, input)
        .then(p => { if (current) setPreview(p) })
        .catch(() => { if (current) setPreview(null) })
    }, 350)
    return () => { current = false; clearTimeout(timer) }
  }, [input, leg.id])

  async function attach(picked: File | undefined) {
    if (!picked) return
    setBusy('upload'); setError('')
    try {
      const stored = await te.upload(picked, isTicket ? 'TICKET' : 'BILL')
      setFile(stored); setFileName(stored.file_name)
      // What the scanner read fills an empty field; it never overwrites typing.
      if (stored.ocr?.amount && !Number(f.fare)) set('fare', stored.ocr.amount)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  async function save() {
    setBusy('file'); setError('')
    try {
      const r = await te.legFile(leg.id, input)
      onFiled(r.eligible ? `Leg ${leg.n} saved. ${rs(r.eligible)} is eligible.` : `Leg ${leg.n} saved.`)
    } catch (e) {
      setError(errorText(e)); setBusy('')
    }
  }

  const priced = preview && !('none' in preview) ? preview : null
  const stats = preview?.stats ?? leg.stats
  const blocked = !!priced?.blocked

  return (
    <div className="page">
      <div className="row">
        <button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Trip</button>
        <span className="mono muted">Leg {leg.n}</span>
      </div>

      <div className="card">
        <div className="row sp top">
          <div>
            <div className="eyebrow">Leg {leg.n} ended</div>
            <h1 className="tname">{placeName(leg.from)} → {placeName(leg.to)}</h1>
            <p className="muted">{mode?.name ?? leg.mode}{leg.endedAt ? ` · ended ${when(leg.endedAt)}` : ''}</p>
          </div>
        </div>
      </div>

      {/* What the phone recorded. The server's numbers, not the screen's. */}
      {stats ? (
        <div className="g6 five">
          <Tile label="GPS distance" value={`${round(stats.gpsKm)} km`} note="measured by the phone" />
          <Tile label="Paid on" value={`${round(stats.payBase)} km`} note="after the checks" />
          <Tile label="Time on the road" value={`${stats.dur} min`} note="start to end" />
          <Tile label="Stops" value={String(stats.stops)} note={stats.stopMin ? `${stats.stopMin} min stopped` : 'none'} />
          <Tile label="Points" value={String(stats.pings)} note={stats.gaps ? `${stats.gaps} gap${stats.gaps === 1 ? '' : 's'}` : 'no gaps'} />
        </div>
      ) : null}

      <div className="card">
        <div className="ch"><h3>What it cost</h3>{mode ? <span className="chip plain">{PAY_WORD[basis] ?? ''}</span> : null}</div>

        {basis === 'km' ? (
          <p className="small muted">
            Nothing to enter. An own-vehicle leg is paid on the distance above at your vehicle&rsquo;s rate a kilometre.
          </p>
        ) : basis === 'none' ? (
          <p className="small muted">
            Nothing to enter. A company vehicle is not paid to you; the leg is recorded so the trip is complete.
          </p>
        ) : (
          <div className="form">
            <label className="fld">
              <span>{isTicket ? 'Ticket fare (₹)' : 'Fare (₹)'}</span>
              <input
                type="number" min={0} inputMode="decimal"
                value={f.fare ?? ''}
                onChange={e => set('fare', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </label>
            <label className="fld">
              <span>Paid by</span>
              <select value={f.payMode ?? 'UPI'} onChange={e => set('payMode', e.target.value)}>
                {PAY_MODES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            {isTicket ? (
              <>
                <label className="fld">
                  <span>PNR or ticket number</span>
                  <input value={f.ref ?? ''} onChange={e => set('ref', e.target.value)} />
                </label>
                <label className="fld">
                  <span>Class</span>
                  <input value={f.cls ?? ''} placeholder="Economy, 3A" onChange={e => set('cls', e.target.value)} />
                </label>
              </>
            ) : (
              <label className="fld">
                <span>Who you paid</span>
                <input value={f.merchant ?? ''} placeholder="Driver, operator or app" onChange={e => set('merchant', e.target.value)} />
              </label>
            )}
          </div>
        )}

        {needsBill ? (
          <label className={file ? 'vphoto on' : 'vphoto'}>
            <TeIcon name={file ? 'check' : 'file'} size="sm" />
            {busy === 'upload' ? 'Attaching…' : file ? `${fileName} attached · choose another to replace` : `Attach the ${isTicket ? 'ticket' : 'bill'}`}
            <input type="file" accept="image/*,application/pdf" hidden onChange={e => attach(e.target.files?.[0])} />
          </label>
        ) : needsFare ? (
          <p className="small muted">No bill is needed for this one; the fare is enough.</p>
        ) : null}

        {/* A refusal that asks for a reason gets a box to give one. */}
        {priced?.needsReason ? (
          <label className="fld">
            <span>Why</span>
            <textarea value={f.reason ?? ''} onChange={e => set('reason', e.target.value)} placeholder="Your approver reads this" />
          </label>
        ) : null}
      </div>

      {priced ? (
        <div className="card">
          <div className="ch"><h3>What you will be paid</h3></div>
          <dl className="kv">
            <dt>You paid</dt><dd>{rs(priced.claimed)}</dd>
            {priced.claimed !== priced.eligible ? <><dt>Over the limit</dt><dd>{rs(priced.eligible - priced.claimed)}</dd></> : null}
            <dt className="tot">Eligible</dt><dd className="tot">{rs(priced.eligible)}</dd>
          </dl>
          {priced.mileage ? (
            <p className="small muted">
              {priced.mileage.payKm} km at {rs(priced.mileage.rate)} a km
              {priced.mileage.vehicle ? `, ${priced.mileage.vehicle.reg}` : ''}.
              {priced.mileage.mapKm && priced.mileage.payKm !== priced.mileage.mapKm
                ? ` The shortest route is ${priced.mileage.mapKm} km.` : ''}
            </p>
          ) : null}
          {priced.flags.length ? (
            <div className="stack sm">
              {priced.flags.map(x => (
                <div key={x.code + x.title} className={flagClass(x)}>
                  <TeIcon name="warn" />
                  <div className="tx"><b><span className="code">{x.code}</span> {x.title}</b><p>{x.evidence}</p></div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <button type="button" className="btn pri lg wide" disabled={blocked || busy === 'file'} onClick={save}>
        {busy === 'file' ? 'Saving…' : 'Save the leg report'}
      </button>
      {blocked ? <p className="small muted">Fix what is marked above before this can be saved.</p> : null}
    </div>
  )
}

const PAY_WORD: Record<string, string> = {
  km: 'Paid per km', bill: 'Paid on your bill', nobill: 'Fare, no bill needed',
  ticket: 'Paid on the ticket', none: 'Not paid, only logged',
}

const round = (n: number) => Math.round((n ?? 0) * 10) / 10

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="tile"><div className="l">{label}</div><div className="v num">{value}</div><div className="s">{note}</div></div>
}
