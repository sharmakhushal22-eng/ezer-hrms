// src/features/expenses/claims/AdvancesScreen.tsx — /expenses/advances
// (components/te/claim/TeAdvances.tsx, view 'advances'). Read-only, from the snapshot.
//
// One deliberate change (spec Part 5 "Advances", parity note for the lead): the
// chip's colour follows `display` when it has a tone of its own, so an overdue
// PAID advance (display RECOVERY_DUE) is red, not green. The chip TEXT is the
// website's (`display`, else the status in lower case); no new words invented.
import * as React from 'react'
import { View } from 'react-native'
import type { Snapshot, Uuid } from '@web/te/types'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { day, rs } from '../api'
import { open, teHref } from '../nav'
import type { TeTone } from '../tones'
import { Chip, Flag, Ico, Li, ListCard, Mono, Note, TeEmpty } from '../ui/kit'
import { SnapScreen } from '../ui/TeScreen'
import { Tile } from './parts'

/** The tone each state is drawn in (TeAdvances TONE). */
export const ADVANCE_TONE: Record<string, TeTone> = {
  REQUESTED: 't-warn',
  APPROVED: 't-brand',
  PAID: 't-pos',
  PART_SETTLED: 't-info',
  SETTLED: 't-pos',
  RECOVERY_DUE: 't-crit',
  REJECTED: 't-crit',
  CANCELLED: 'plain',
}

function Advances({ snap, onOpenTrip }: { snap: Snapshot; onOpenTrip: (tripId: Uuid) => void }) {
  const mine = snap.advances.filter(a => a.emp === snap.me)
  const outstanding = mine.reduce((a, x) => a + (x.outstanding || 0), 0)
  const withYou = mine.filter(a => a.outstanding > 0).length
  const waiting = mine.filter(a => a.status === 'REQUESTED' || a.status === 'APPROVED')
  const tripName = (id: Uuid) => snap.trips.find(t => t.id === id)?.name ?? ''
  const overdue = mine.filter(a => a.outstanding > 0 && a.due && a.due < snap.today)

  return (
    <View>
      <Txt size={F.small} tone="muted" style={{ marginBottom: S.lg }}>
        Money the company paid you before a trip. It is set against that trip’s claim; anything left over is returned.
      </Txt>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>
        <Tile label="Still with you" value={rs(outstanding)} note={`across ${withYou} advance${withYou === 1 ? '' : 's'}`} />
        <Tile label="Waiting on Finance" value={rs(waiting.reduce((a, x) => a + (x.approved ?? x.requested), 0))}
          note={waiting.length ? `${waiting.length} not paid out yet` : 'nothing pending'} />
        <Tile label="You can ask for" value={`up to ${snap.cfg.advanceMaxPct}%`} note="of what you will pay yourself" />
      </View>

      {overdue.length ? (
        <Flag tone="crit" icon="alert" style={{ marginBottom: S.md }}
          title={overdue.length === 1 ? 'An advance is past its date' : `${overdue.length} advances are past their date`}>
          Submit the trip’s claim to set it off, or return the balance. Finance can also recover it from payroll.
        </Flag>
      ) : null}

      <ListCard head="Every advance" headRight={String(mine.length)}>
        {mine.length ? mine.map((a, i) => {
          const name = tripName(a.tripId)
          const tone = ADVANCE_TONE[a.display] ?? ADVANCE_TONE[a.status] ?? 'plain'
          return (
            <Li key={a.id} last={i === mine.length - 1} left={<Ico name="advances" />}
              onPress={a.tripId ? () => onOpenTrip(a.tripId) : undefined}
              right={(
                <View style={{ alignItems: 'flex-end', gap: 2, maxWidth: '45%' }}>
                  <Txt size={F.small} w={700} style={{ fontVariant: ['tabular-nums'] }}>{rs(a.outstanding)}</Txt>
                  <Txt size={F.tiny} tone="muted">still with you</Txt>
                  <Chip label={a.display || a.status.replace(/_/g, ' ').toLowerCase()} tone={tone} />
                </View>
              )}>
              <Txt size={F.small} w={700}>{name || a.no}</Txt>
              <Txt size={F.tiny} tone="muted">
                <Mono size={F.tiny}>{a.no}</Mono>
                {a.paidOn ? ` · paid ${day(a.paidOn)}` : ''}
                {a.due ? ` · due ${day(a.due)}` : ''}
                {a.ref ? ` · ${a.ref}` : ''}
              </Txt>
            </Li>
          )
        }) : (
          <TeEmpty title="No advances">Ask for one while planning a trip, on the last step.</TeEmpty>
        )}
      </ListCard>

      <Note>An advance is set against the claim for its own trip. If the claim is smaller than the advance, the difference is recovered.</Note>
    </View>
  )
}

export default function AdvancesScreen() {
  return (
    <SnapScreen title="Advances" tab="advances">
      {snap => <Advances snap={snap} onOpenTrip={id => open(teHref.trip(id))} />}
    </SnapScreen>
  )
}
