// src/features/expenses/approve/ClaimParts.tsx — the rows of the claim decision screen
// (components/te/approve/TeClaimApproval.tsx): a line with Reduce / Refuse / Ask to fix,
// a check that fired with Dismiss / Confirm, a stay or ticket, a journey.
import * as React from 'react'
import { View } from 'react-native'
import { isTouched, type LineDecision } from '@web/te/claim-decide'
import { flagResolvedText, flagTone, whyFlagNotReady, type FlagOffer, type FlagVerdict } from '@web/te/flag-review'
import type { TeBooking, TeClaimFlag, TeExpense, TeLeg, Uuid } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { day, rs } from '../api'
import { TeIcon } from '../ui/TeIcon'
import { Chip, Flag, Ico, Li, Note, Seg } from '../ui/kit'
import { FileLink } from '../ui/FilePick'

/** A small toggle button (btn sm, aria-pressed; `dan` = the danger style). */
function Tog({ label, on, dan, onPress }: { label: string; on?: boolean; dan?: boolean; onPress: () => void }) {
  return <Button title={label} size="sm" variant={dan ? 'danger' : on ? 'soft' : 'outline'} onPress={onPress}
    style={on ? { borderWidth: 2 } : undefined} />
}

export function LineRow({ l, d, eligible, flags, claimId, mayAct, sendback, marked, last, onReduce, onRefuse, onFix, onUndo, onPatch }: {
  l: TeExpense; d: LineDecision | undefined; eligible: number; flags: TeClaimFlag[]; claimId: Uuid
  mayAct: boolean; sendback: boolean; marked: boolean; last: boolean
  onReduce: () => void; onRefuse: () => void; onFix: () => void; onUndo: () => void; onPatch: (p: Partial<LineDecision>) => void
}) {
  const { C } = useTheme()
  const touched = isTouched(d)
  const shown = d?.reject ? 0 : d?.amount ?? eligible
  const struck = !!d?.reject || (d?.amount !== undefined && d.amount !== eligible)
  return (
    <Li last={last} left={<Ico name="other" />} style={[{ alignItems: 'flex-start' }, (touched || marked) && { backgroundColor: C.criticalTint }]}
      right={
        <View style={{ alignItems: 'flex-end' }}>
          <Txt size={F.small} w={700}>{rs(shown)}</Txt>
          {struck
            ? <Txt size={F.micro} tone="muted" style={{ textDecorationLine: 'line-through' }}>{rs(eligible)}</Txt>
            : <Txt size={F.micro} tone="muted">eligible</Txt>}
        </View>
      }>
      <Txt size={F.small} w={700}>{l.merchant || l.cat}</Txt>
      <Txt size={F.tiny} tone="muted">{[l.cat, l.desc, l.date].filter(Boolean).join(' · ')}</Txt>
      {l.file?.path ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <FileLink path={l.file.path} name={l.file.name} kind={l.file.kind} claimId={claimId} small />
          {l.files > 1 && <Txt size={F.tiny} tone="muted">+{l.files - 1} more on this line</Txt>}
        </View>
      ) : <Txt size={F.tiny} tone="muted">No bill attached.</Txt>}
      {flags.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {flags.map(fl => <Chip key={fl.id} label={`${fl.code} ${fl.title}`} tone={flagTone(fl.status, fl.block)} />)}
        </View>
      )}
      {mayAct && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>
          <Tog label="Reduce" on={d?.amount !== undefined} onPress={onReduce} />
          <Tog label="Refuse" dan on={!!d?.reject} onPress={onRefuse} />
          {sendback && <Tog label={marked ? 'Marked to fix' : 'Ask to fix'} on={marked} onPress={onFix} />}
          {touched && <Tog label="Undo" onPress={onUndo} />}
        </View>
      )}
      {touched && (
        <View style={{ marginTop: S.sm }}>
          {d?.amount !== undefined && (
            <Input label="Approve this much (₹)" keyboardType="numeric" value={String(d.amount)} help={`Eligible: ${rs(eligible)}`}
              onChangeText={v => onPatch({ amount: v.trim() === '' ? 0 : Number(v) })} />
          )}
          {d?.reject && (
            <View style={{ marginBottom: S.md }}>
              <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>Can it be claimed again?</Txt>
              <Seg value={d.reject} onChange={k => onPatch({ reject: k })}
                items={[{ key: 'refile', label: 'Yes, with a correction' }, { key: 'final', label: 'No, this is final' }]} />
            </View>
          )}
          <Input label="Why" value={d?.reason ?? ''} placeholder="The employee reads this" onChangeText={v => onPatch({ reason: v })} />
        </View>
      )}
    </Li>
  )
}

export function FlagRow({ fl, line, offers, resolving, note, busy, last, onPick, onNote, onCancel, onSubmit }: {
  fl: TeClaimFlag; line: TeExpense | null; offers: FlagOffer[]; resolving: FlagVerdict | null; note: string; busy: boolean; last: boolean
  onPick: (v: FlagVerdict) => void; onNote: (v: string) => void; onCancel: () => void; onSubmit: () => void
}) {
  const { C } = useTheme()
  const chosen = resolving ? offers.find(o => o.verdict === resolving) ?? null : null
  return (
    <Li last={last} left={<Ico name={fl.block ? 'alert' : 'verify'} />} style={{ alignItems: 'flex-start' }}
      right={<Chip label={fl.status === 'open' ? (fl.block ? 'blocking' : 'open') : fl.status} tone={flagTone(fl.status, fl.block)} />}>
      <Txt size={F.small} w={700}>
        <Txt size={11} color={C.muted} style={{ fontFamily: 'monospace' }}>{fl.code} </Txt>{fl.title}
      </Txt>
      <Txt size={F.tiny} tone="muted">
        {[fl.evidence, line ? `on ${line.merchant || line.cat}` : fl.claimLevel ? 'about the whole claim' : null].filter(Boolean).join(' · ')}
      </Txt>
      {!offers.length && fl.status !== 'open' && <Txt size={F.tiny} tone="muted">{flagResolvedText(fl.status, fl.note)}</Txt>}
      {offers.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: S.sm }}>
          {offers.map(o => <Tog key={o.verdict} label={o.label} dan={o.grave} on={resolving === o.verdict} onPress={() => onPick(o.verdict)} />)}
        </View>
      )}
      {chosen && (
        <View style={{ marginTop: S.sm, gap: S.sm }}>
          {chosen.grave ? <Flag tone="crit" icon="alert">{chosen.effect}</Flag> : <Note>{chosen.effect}</Note>}
          <Input label={chosen.verdict === 'dismissed' ? 'Why the check was wrong' : 'Anything to add'} value={note}
            placeholder={chosen.verdict === 'dismissed' ? 'Kept on the flag and counted in the flag report' : 'Optional'} onChangeText={onNote} />
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Button title="Never mind" size="sm" variant="outline" onPress={onCancel} />
            <Button title={busy ? 'Saving…' : chosen.label} size="sm" variant={chosen.grave ? 'danger' : 'primary'}
              disabled={busy || !!whyFlagNotReady(chosen.verdict, note)} onPress={onSubmit} />
          </View>
        </View>
      )}
    </Li>
  )
}

export function BookingRow({ b, claimId, last }: { b: TeBooking; claimId: Uuid; last: boolean }) {
  const asked = b.status === 'REQUESTED'
  const off = b.status === 'CANCELLED'
  const d = b.details ?? {}
  const first = asked ? 'Asked for by the employee' : off ? 'Cancelled' : b.pnr ? `${b.kind === 'hotel' ? 'Booking' : 'PNR'} ${b.pnr}` : 'Booked'
  return (
    <Li last={last} left={<Ico name={b.kind === 'hotel' ? 'pin' : 'plane'} />} style={{ alignItems: 'flex-start' }}
      right={
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Txt size={F.small} w={700}>{rs(b.amount)}</Txt>
          <Txt size={F.micro} tone="muted">{asked ? 'expected' : b.paidBy === 'company' ? 'company paid' : ''}</Txt>
          <Chip label={b.status.toLowerCase()} tone={off ? 'plain' : asked ? 't-warn' : 't-pos'} plain={off} />
        </View>
      }>
      <Txt size={F.small} w={700}>{b.vendor}</Txt>
      <Txt size={F.tiny} tone="muted">
        {[first, d.check_in ? `${day(d.check_in)}${d.check_out ? ` to ${day(d.check_out)}` : ''}` : '', d.address, d.room, d.note].filter(Boolean).join(' · ')}
      </Txt>
      {!!b.ticket && (
        <View style={{ marginTop: 4 }}>
          <FileLink path={b.ticket} name={asked ? `Open on ${d.platform || 'the booking site'}` : 'Open the ticket'} claimId={claimId} small />
        </View>
      )}
    </Li>
  )
}

export function JourneyRow({ l, last, onPress }: { l: TeLeg; last: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Li last={last} onPress={onPress} left={<Ico name="route" />}
      right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Txt size={F.tiny} w={600} tone="brand">Evidence</Txt><TeIcon name="go" size="sm" color={C.brand} /></View>}>
      <Txt size={F.small} w={700}>Journey {l.n}</Txt>
      <Txt size={F.tiny} tone="muted">
        {l.mode} · {l.payKm ?? l.plannedKm} km{l.gps === 'checkin' ? ' · check-ins' : ''}
        {l.stats?.gaps ? ` · ${l.stats.gaps} gap${l.stats.gaps === 1 ? '' : 's'}` : ''}{l.manual ? ' · added without GPS' : ''}
      </Txt>
    </Li>
  )
}
