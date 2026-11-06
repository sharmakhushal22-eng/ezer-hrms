// src/features/expenses/claims/ClaimsScreen.tsx — /expenses/claims, "My claims"
// (components/te/TeClaims.tsx TeClaimList, view 'claims').
//
// Rows in snapshot order (server: newest first; the last 400 days plus any still
// open). No grouping, filters, search or paging — as on the website.
import * as React from 'react'
import { View } from 'react-native'
import type { Snapshot } from '@web/te/types'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { open, teHref } from '../nav'
import { ListCard, TeEmpty } from '../ui/kit'
import { SnapScreen } from '../ui/TeScreen'
import { ClaimRow } from './parts'

function ClaimList({ snap, onOpen }: { snap: Snapshot; onOpen: (id: string) => void }) {
  const tripName = React.useMemo(() => new Map(snap.trips.map(t => [t.id, t.name])), [snap])
  return (
    <View>
      <Txt size={F.small} tone="muted" style={{ marginBottom: S.lg }}>
        Every claim you sent, for local travel, outstation trips and other expenses. See who holds it, what was approved and why.
      </Txt>
      <ListCard>
        {snap.claims.length === 0 ? (
          <TeEmpty title="No claims yet">A claim appears here the moment you submit it.</TeEmpty>
        ) : null}
        {snap.claims.map((c, i) => (
          <ClaimRow key={c.id} claim={c} tripName={c.tripId ? tripName.get(c.tripId) : null}
            onPress={() => onOpen(c.id)} last={i === snap.claims.length - 1} />
        ))}
      </ListCard>
    </View>
  )
}

export default function ClaimsScreen() {
  return (
    <SnapScreen title="My claims" tab="claims">
      {snap => <ClaimList snap={snap} onOpen={id => open(teHref.claim(id))} />}
    </SnapScreen>
  )
}
