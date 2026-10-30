// src/features/expenses/trip/TripLedger.tsx — "Everything on this trip"
// (components/te/trip/TeTripLedger.tsx): the tickets the desk booked, the hotel,
// food and every journey's fare, grouped, with "yours to claim" and "paid by the
// company" kept apart and the advance netted only where it is the reader's own.
// The rows and totals are lib/te/trip-ledger.ts (shared, tested on the website).
import * as React from 'react'
import { View } from 'react-native'
import { ledgerRows, ledgerTotals, type LedgerRow } from '@web/te/trip-ledger'
import type { TeCategory, TeTripDetail } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { plural, rs } from '../api'
import { FileLink } from '../ui/FilePick'
import { TeIcon } from '../ui/TeIcon'
import { Chip, Flag, KvRow, TeCard } from '../ui/kit'
import { CardHead } from './parts'

const LEG_STATE: Record<string, string> = {
  PLANNED: 'Not started', ACTIVE: 'On the road', PAUSED: 'Stopped',
  ENDED: 'Ended, report to save', SUBMITTED: 'Recorded', SKIPPED: 'Skipped',
}
const legKm = (l: { gpsKm?: number | null; routeKm?: number | null; plannedKm?: number | null }): string => {
  const km = Number(l.gpsKm ?? 0) || Number(l.routeKm ?? 0) || Number(l.plannedKm ?? 0)
  return km ? `${km} km` : ''
}
const STATUS_WORD: Record<string, string> = {
  UNCLAIMED: 'not claimed yet', IN_CLAIM: 'in a claim', APPROVED: 'approved', PAID: 'paid',
  REJECTED_FINAL: 'rejected', REJECTED_REFILE: 'sent back', EXPIRED: 'expired',
}

const rowKey = (r: LedgerRow) => r.kind === 'expense' ? r.line.id
  : r.kind === 'booking' ? `bk-${r.booking.id}`
    : r.kind === 'journey' ? `jn-${r.leg.id}`
      : `stay-${r.name}`

const rowIcon = (r: LedgerRow) => r.kind === 'journey' ? (r.subTrip ? 'route' : 'car')
  : r.subTrip ? 'route'
    : r.group === 'Stay' ? 'home'
      : r.group === 'Travel' ? 'plane' : 'receipt'

function LedgerLine({ r, ends }: { r: LedgerRow; ends: (r: { leg: { from: string; to: string } }) => string }) {
  const { C } = useTheme()
  const title = r.kind === 'expense' ? (r.line.merchant || r.catName)
    : r.kind === 'booking' ? (r.booking.vendor || r.catName)
      : r.kind === 'journey' ? `${r.catName}: ${ends(r)}`
        : r.name
  const sub: string[] = []
  if (r.kind === 'expense') {
    if (r.line.no) sub.push(r.line.no)
    if (r.line.date) sub.push(r.line.date)
  } else if (r.kind === 'booking') {
    sub.push(r.booking.no)
    if (r.booking.pnr) sub.push(r.booking.pnr)
    sub.push('booked by the travel desk')
  } else if (r.kind === 'journey') {
    sub.push(LEG_STATE[r.leg.status] ?? r.leg.status)
    if (legKm(r.leg)) sub.push(legKm(r.leg))
    if (r.leg.mode) sub.push(r.leg.mode)
    if (r.lines.length) sub.push(plural(r.lines.length, 'bill'))
  } else {
    sub.push('the travel desk chose it', 'the bill comes later')
  }
  if (r.kind !== 'journey' && r.leg) sub.push(`journey ${r.leg.n}`)
  if (r.who && !r.mine) sub.push(r.who)
  if (r.company > 0 && r.self === 0) sub.push('paid by the company')
  if (r.kind === 'expense' && STATUS_WORD[r.line.status]) sub.push(STATUS_WORD[r.line.status])
  const amount = r.amount || r.pendingAmt
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 10, paddingHorizontal: S.lg, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: C.sunken, alignItems: 'center', justifyContent: 'center' }}>
        <TeIcon name={rowIcon(r)} size="sm" color={C.inkSoft} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Txt size={F.small} w={600} style={{ flexShrink: 1 }}>{title}</Txt>
          {r.subTrip ? <Chip plain tone="t-brand" label="Sub-trip" /> : null}
          {r.kind === 'journey' && r.lines.length === 0 && r.leg.status === 'SUBMITTED' ? <Chip plain label="No bill" /> : null}
          {r.pending && r.kind !== 'journey' ? <Chip tone="t-warn" label={r.kind === 'stay' ? 'No bill yet' : 'Not booked yet'} /> : null}
        </View>
        <Txt size={F.tiny} tone="muted">{sub.join(' · ')}</Txt>
        {r.kind === 'expense' && r.line.file ? <View style={{ marginTop: 4 }}><FileLink path={r.line.file.path} name={r.line.file.name} small /></View> : null}
        {r.kind === 'booking' && r.booking.ticket ? <View style={{ marginTop: 4 }}><FileLink path={r.booking.ticket} name={`${r.booking.no}-ticket`} small /></View> : null}
      </View>
      <Txt size={F.small} w={600} tone={amount ? 'ink' : 'muted'} style={{ fontVariant: ['tabular-nums'] }}>{amount ? rs(amount) : '—'}</Txt>
    </View>
  )
}

function DayHead({ left, right }: { left: string; right: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: S.lg, backgroundColor: C.sunken }}>
      <Txt size={F.tiny} w={700} tone="soft" upper>{left}</Txt>
      <Txt size={F.tiny} w={700} tone="soft">{right}</Txt>
    </View>
  )
}

export function TripLedger({ detail, me, everyone, cats }: { detail: TeTripDetail; me: string; everyone: boolean; cats?: TeCategory[] }) {
  const t = detail.trip
  const nameOf = React.useMemo(() => {
    const m = new Map<string, string>()
    if (detail.employee?.id) m.set(detail.employee.id, detail.employee.name)
    for (const p of t.people ?? []) if (p.emp) m.set(p.emp, p.name || p.id || '')
    return (id: string) => m.get(id) || 'Another traveller'
  }, [detail.employee, t.people])
  const owner = detail.employee?.id
  const ends = React.useCallback(
    (r: { leg: { from: string; to: string } }) => `${detail.places[r.leg.from]?.s ?? '…'} → ${detail.places[r.leg.to]?.s ?? '…'}`,
    [detail.places],
  )
  const rows = React.useMemo(() => ledgerRows({
    expenses: detail.expenses ?? [], legs: detail.legs ?? [], bookings: detail.bookings ?? [],
    me, everyone, nameOf, cats, tripOwner: owner, stay: t.stay ?? null,
  }), [detail.expenses, detail.legs, detail.bookings, me, everyone, nameOf, cats, owner, t.stay])
  const totals = React.useMemo(
    () => ledgerTotals(rows, { advance: detail.advance, advanceMine: !!owner && owner === me }),
    [rows, detail.advance, owner, me],
  )

  if (!rows.length) {
    return (
      <TeCard>
        <CardHead title="Everything on this trip" />
        <Txt size={F.tiny} tone="muted">
          {`Nothing has been spent on ${t.no} yet. Tickets the desk books, the hotel, food and every journey’s fare appear here as they are recorded.`}
        </Txt>
      </TeCard>
    )
  }

  return (
    <TeCard style={{ paddingHorizontal: 0, paddingBottom: 0, overflow: 'hidden' }}>
      <View style={{ paddingHorizontal: S.lg }}>
        <CardHead title="Everything on this trip" right={<Txt size={F.tiny} tone="muted">{everyone ? 'Every traveller on it' : 'Yours, and what the company paid for'}</Txt>} />
      </View>
      {totals.byGroup.map(g => (
        <View key={g.group}>
          <DayHead left={g.group} right={g.self + g.company ? rs(g.self + g.company) : plural(g.n, 'item')} />
          {rows.filter(r => r.group === g.group).map(r => <LedgerLine key={rowKey(r)} r={r} ends={ends} />)}
        </View>
      ))}
      <DayHead left={`Total on ${t.no}`} right={rs(totals.total)} />
      <View style={{ paddingHorizontal: S.lg, paddingBottom: S.md }}>
        {totals.self ? <KvRow label={everyone ? 'Claimed by travellers' : 'Yours to claim'} value={rs(totals.self)} /> : null}
        {totals.company ? <KvRow label="Paid by the company directly" value={rs(totals.company)} /> : null}
        {totals.pending ? <KvRow label="Asked for, not booked yet" value={rs(totals.pending)} /> : null}
        {totals.advance ? <KvRow label="Advance already paid" value={rs(totals.advance)} /> : null}
        {totals.advance && totals.outstanding !== totals.advance ? <KvRow label="Advance still outstanding" value={rs(totals.outstanding)} /> : null}
        {totals.net !== null && (totals.mine || totals.outstanding) ? (
          <Flag tone={totals.net < 0 ? 'warn' : 'ok'} icon={totals.net < 0 ? 'alert' : 'check'} style={{ marginTop: S.sm }}>
            {totals.net > 0
              ? `You are owed ${rs(totals.net)} on this trip, after the advance of ${rs(totals.outstanding)} you are holding.`
              : totals.net < 0
                ? `You are holding ${rs(-totals.net)} more than you have claimed. That much of the advance comes back.`
                : 'Your claim and the advance you are holding cancel out. Nothing moves either way.'}
          </Flag>
        ) : null}
      </View>
    </TeCard>
  )
}
