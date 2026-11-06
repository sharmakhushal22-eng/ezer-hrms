// src/features/expenses/dashboard/rows.tsx — the rows of Reports and dashboard
// (components/te/report/TeDashboard.tsx). Nothing here is a button except opening
// one of your own trips: the dashboard tracks, it never decides.
import * as React from 'react'
import { View } from 'react-native'
import type { TeDashboard, TeDashboardRow } from '@web/te/types'
import { claimAmount, decisionOf, holder, teamNote } from '@web/te/dashboard'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { day, rs, when } from '../api'
import { Chip, Ico, Li, ListCard, TeEmpty } from '../ui/kit'

const SCOPE_ICON: Record<string, string> = { local: 'local', domestic: 'domestic', international: 'international' }

function Right({ amount, chip, tone }: { amount?: number; chip: string; tone?: string }) {
  return (
    <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: 130 }}>
      {amount !== undefined ? <Txt size={F.small} w={700} style={{ fontVariant: ['tabular-nums'] }}>{rs(amount)}</Txt> : null}
      <Chip plain={!tone} tone={tone ?? 'plain'} label={chip} />
    </View>
  )
}

function Row({ icon, title, sub, right, onPress, last }: { icon: string; title: string; sub: string; right: React.ReactNode; onPress?: () => void; last?: boolean }) {
  return (
    <Li left={<Ico name={icon} size={32} />} right={right} onPress={onPress} last={last}>
      <Txt size={F.small} w={700}>{title}</Txt>
      {sub ? <Txt size={F.tiny} tone="muted">{sub}</Txt> : null}
    </Li>
  )
}

export function Acted({ rows }: { rows: TeDashboardRow[] }) {
  return (
    <ListCard head="What you decided" headRight={String(rows.length)}>
      {rows.map((a, i) => {
        const dec = decisionOf(a.status)
        const sub = [a.no, a.where, a.role ? `as ${a.role}` : '', a.actedAt ? when(a.actedAt) : '', a.comment ? `“${a.comment}”` : '']
          .filter(Boolean).join(' · ')
        return (
          <Row key={`${a.kind}-${a.id}-${a.actedAt ?? ''}`} icon={a.kind === 'trip' ? 'route' : 'claims'}
            title={`${a.what} · ${a.who}`} sub={sub} last={i === rows.length - 1}
            right={<Right amount={a.amount} chip={dec.label} tone={dec.tone} />} />
        )
      })}
    </ListCard>
  )
}

export function MyTrips({ trips, onOpenTrip }: { trips: TeDashboard['mine']['trips']; onOpenTrip: (id: string) => void }) {
  return (
    <ListCard head="Your trips" headRight={String(trips.length)}>
      {trips.map((t, i) => (
        <Row key={t.id} icon={SCOPE_ICON[t.scope] ?? 'route'} title={t.name || t.no} last={i === trips.length - 1}
          // "with whom" only while a step is actually open.
          sub={[t.no, t.to, t.start ? day(t.start) : '', t.withWhom ? holder(t.withWhom) : ''].filter(Boolean).join(' · ')}
          onPress={() => onOpenTrip(t.id)} right={<Right amount={t.estimate} chip={t.display} />} />
      ))}
    </ListCard>
  )
}

export function MyClaims({ claims }: { claims: TeDashboard['mine']['claims'] }) {
  return (
    <ListCard head="Your claims" headRight={String(claims.length)}>
      {claims.map((c, i) => {
        const m = claimAmount(c)
        const sub = `${m.label} ${rs(m.amount)}${c.submitted ? ` · sent ${when(c.submitted)}` : ' · not sent yet'}${c.net !== null ? ` · paid ${rs(c.net)}` : ` · ${holder(c.withWhom)}`}`
        return <Row key={c.id} icon="claims" title={c.no} sub={sub} last={i === claims.length - 1} right={<Right chip={c.stage} />} />
      })}
    </ListCard>
  )
}

/** Only drawn for somebody who has reports (team.people > 0). Read only. */
export function Team({ team }: { team: TeDashboard['team'] }) {
  const empty = !team.trips.length && !team.claims.length
  return (
    <ListCard head="Your team" headRight={String(team.trips.length + team.claims.length)}>
      <Li><Txt size={F.tiny} tone="muted">{teamNote(team)}</Txt></Li>
      {team.trips.map(t => (
        <Row key={t.id} icon={SCOPE_ICON[t.scope] ?? 'route'} title={`${t.who} · ${t.name || t.no}`}
          sub={[t.no, t.to, t.start ? day(t.start) : '', holder(t.withWhom)].filter(Boolean).join(' · ')}
          right={<Right amount={t.estimate} chip={t.display} />} />
      ))}
      {team.claims.map(c => {
        const m = claimAmount(c)
        return (
          <Row key={c.id} icon="claims" title={`${c.who} · ${c.no}`}
            sub={`${m.label} ${rs(m.amount)}${c.submitted ? ` · sent ${when(c.submitted)}` : ''} · ${holder(c.withWhom)}`}
            right={<Right chip={c.stage} />} />
        )
      })}
      {empty ? <TeEmpty title="Nothing in this window">Your team raised nothing between these dates.</TeEmpty> : null}
    </ListCard>
  )
}
