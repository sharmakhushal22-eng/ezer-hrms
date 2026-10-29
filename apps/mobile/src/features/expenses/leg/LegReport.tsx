// src/features/expenses/leg/LegReport.tsx — the journey report after it ended
// (components/te/leg/TeLegReport.tsx, screen 59/60): what the phone recorded (the
// server's stats), what it cost by the mode's pay basis, the live preview of what
// is eligible with its flags, and "Save the journey report".
import * as React from 'react'
import { View } from 'react-native'
import type { LegPreview, LegReportInput, Snapshot, TeLeg, TeUploadedFile } from '@web/te/types'
import type { PickedFile } from '@/core/api'
import { S, F } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { errorText, rs, te, when } from '../api'
import { FilePickButton } from '../ui/FilePick'
import { Chip, Flag, KvRow, TeCard } from '../ui/kit'
import { FlagBlock } from '../claims/parts'
import { SelectField } from '../plan/parts'
import { CardHead, Tile, Tiles } from '../trip/parts'
import { LegHead } from './LegHead'

const PAY_MODES = ['UPI', 'Personal card', 'Cash', 'Company card']
const PAY_WORD: Record<string, string> = {
  km: 'Paid per km', bill: 'Paid on your bill', nobill: 'Fare, no bill needed',
  ticket: 'Paid on the ticket', none: 'Not paid, only logged',
}
const round = (n: number) => Math.round((n ?? 0) * 10) / 10

export function LegReport({ snap, leg, placeName, onFiled }: {
  snap: Snapshot
  leg: TeLeg
  placeName: (id: string) => string
  onFiled: (message: string) => void
}) {
  const mode = snap.cfg.modes.find(m => m.id === leg.mode) ?? null
  const basis = mode?.basis ?? 'bill'
  const needsFare = basis !== 'km' && basis !== 'none'
  const needsBill = basis === 'bill' || basis === 'ticket'
  const isTicket = basis === 'ticket'

  const [f, setF] = React.useState<LegReportInput>({ payMode: 'UPI' })
  const [file, setFile] = React.useState<TeUploadedFile | null>(null)
  const [fileName, setFileName] = React.useState('')
  const [preview, setPreview] = React.useState<LegPreview | null>(null)
  const [busy, setBusy] = React.useState<'' | 'upload' | 'file'>('')
  const [error, setError] = React.useState('')
  const [fareText, setFareText] = React.useState('')

  const set = <K extends keyof LegReportInput>(k: K, v: LegReportInput[K]) => { setF(p => ({ ...p, [k]: v })); setError('') }
  const input = React.useMemo<LegReportInput>(() => (file ? { ...f, files: [file] } : f), [f, file])

  // The live preview, 350 ms after the last change (the server prices it).
  React.useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      te.legPreview(leg.id, input)
        .then(p => { if (current) setPreview(p) })
        .catch(() => { if (current) setPreview(null) })
    }, 350)
    return () => { current = false; clearTimeout(timer) }
  }, [input, leg.id])

  async function attach(picked: PickedFile) {
    setBusy('upload'); setError('')
    try {
      const stored = await te.upload(picked, isTicket ? 'TICKET' : 'BILL')
      setFile(stored); setFileName(stored.file_name)
      if (stored.ocr?.amount && !Number(f.fare)) { set('fare', stored.ocr.amount); setFareText(String(stored.ocr.amount)) }
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
      onFiled(r.eligible ? `Journey ${leg.n} saved. ${rs(r.eligible)} is eligible.` : `Journey ${leg.n} saved.`)
    } catch (e) {
      setError(errorText(e)); setBusy('')
    }
  }

  const priced = preview && !('none' in preview) ? preview : null
  const stats = preview?.stats ?? leg.stats
  const blocked = !!priced?.blocked

  return (
    <View>
      <LegHead eyebrow={`Journey ${leg.n} ended`} title={`${placeName(leg.from)} → ${placeName(leg.to)}`}
        sub={`${mode?.name ?? leg.mode}${leg.endedAt ? ` · ended ${when(leg.endedAt)}` : ''}`} />

      {stats ? (
        <Tiles>
          <Tile label="GPS distance" value={`${round(stats.gpsKm)} km`} note="measured by the phone" />
          <Tile label="Paid on" value={`${round(stats.payBase)} km`} note="after the checks" />
          <Tile label="Time on the road" value={`${stats.dur} min`} note="start to end" />
          <Tile label="Stops" value={String(stats.stops)} note={stats.stopMin ? `${stats.stopMin} min stopped` : 'none'} />
          <Tile label="Points" value={String(stats.pings)} note={stats.gaps ? `${stats.gaps} gap${stats.gaps === 1 ? '' : 's'}` : 'no gaps'} />
        </Tiles>
      ) : null}

      <TeCard>
        <CardHead title="What it cost" right={mode ? <Chip plain label={PAY_WORD[basis] ?? ''} /> : undefined} />
        {basis === 'km' ? (
          <Txt size={F.tiny} tone="muted">Nothing to enter. An own-vehicle leg is paid on the distance above at your vehicle’s rate a kilometre.</Txt>
        ) : basis === 'none' ? (
          <Txt size={F.tiny} tone="muted">Nothing to enter. A company vehicle is not paid to you; the leg is recorded so the trip is complete.</Txt>
        ) : (
          <View>
            <Input label={isTicket ? 'Ticket fare (₹)' : 'Fare (₹)'} keyboardType="decimal-pad" value={fareText}
              onChangeText={t => { setFareText(t); set('fare', t === '' || !Number.isFinite(Number(t)) ? undefined : Number(t)) }} />
            <SelectField label="Paid by" value={f.payMode ?? 'UPI'} onPick={v => set('payMode', v)}
              options={PAY_MODES.map(p => ({ value: p, label: p }))} />
            {isTicket ? (
              <>
                <Input label="PNR or ticket number" value={f.ref ?? ''} onChangeText={t => set('ref', t)} />
                <Input label="Class" value={f.cls ?? ''} placeholder="Economy, 3A" onChangeText={t => set('cls', t)} />
              </>
            ) : (
              <Input label="Who you paid" value={f.merchant ?? ''} placeholder="Driver, operator or app" onChangeText={t => set('merchant', t)} />
            )}
          </View>
        )}

        {needsBill ? (
          <FilePickButton sheetTitle={isTicket ? 'Attach the ticket' : 'Attach the bill'} loading={busy === 'upload'} disabled={busy === 'upload'}
            title={busy === 'upload' ? 'Attaching…' : file ? `${fileName} attached · choose another to replace` : `Attach the ${isTicket ? 'ticket' : 'bill'}`}
            onPicked={attach} />
        ) : needsFare ? (
          <Txt size={F.tiny} tone="muted">No bill is needed for this one; the fare is enough.</Txt>
        ) : null}

        {priced?.needsReason ? (
          <Input label="Why" multiline value={f.reason ?? ''} onChangeText={t => set('reason', t)} placeholder="Your approver reads this" style={{ marginTop: S.md }} />
        ) : null}
      </TeCard>

      {priced ? (
        <TeCard>
          <CardHead title="What you will be paid" />
          <KvRow label="You paid" value={rs(priced.claimed)} />
          {priced.claimed !== priced.eligible ? <KvRow label="Over the limit" value={rs(priced.eligible - priced.claimed)} /> : null}
          <KvRow tot last label="Eligible" value={rs(priced.eligible)} />
          {priced.mileage ? (
            <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>
              {`${priced.mileage.payKm} km at ${rs(priced.mileage.rate)} a km${priced.mileage.vehicle ? `, ${priced.mileage.vehicle.reg}` : ''}.`}
              {priced.mileage.mapKm && priced.mileage.payKm !== priced.mileage.mapKm ? ` The shortest route is ${priced.mileage.mapKm} km.` : ''}
            </Txt>
          ) : null}
          {priced.flags.length ? (
            <View style={{ gap: S.sm, marginTop: S.sm }}>
              {priced.flags.map(x => <FlagBlock key={x.code + x.title} code={x.code} title={x.title} text={x.evidence} block={!!x.block} />)}
            </View>
          ) : null}
        </TeCard>
      ) : null}

      {error ? <Flag tone="crit" style={{ marginBottom: S.md }}>{error}</Flag> : null}

      <Button full size="lg" title={busy === 'file' ? 'Saving…' : 'Save the journey report'} disabled={blocked || busy === 'file'} onPress={() => void save()} />
      {blocked ? <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>Fix what is marked above before this can be saved.</Txt> : null}
    </View>
  )
}
