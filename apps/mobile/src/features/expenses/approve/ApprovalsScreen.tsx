// src/features/expenses/approve/ApprovalsScreen.tsx — TeHome view `approvals`
// (components/te/approve/TeApprovals.tsx): the approver's working list.
// Opening a row opens its decision screen; deciding one opens the next.
import * as React from 'react'
import { View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { rs, te, when } from '../api'
import { useSignedIn } from '../data'
import { open } from '../nav'
import { useQuery } from '@tanstack/react-query'
import { Ico, Li, ListCard, PageHead, TeCard, TeEmpty } from '../ui/kit'
import { TeScreen } from '../ui/TeScreen'
import { APPROVALS_KEY, approvalHref } from './shared'

export default function ApprovalsScreen() {
  const { C } = useTheme()
  // TeApprovals reads the queue itself and, unlike TeHome, says when it failed
  // ("Could not load your queue."; the list then reads as empty).
  const q = useQuery({ queryKey: APPROVALS_KEY, queryFn: te.queue, enabled: useSignedIn() })
  const failed = !!q.error
  const rows = q.data ?? []
  return (
    <TeScreen title="Approvals" tab="approvals">
      <PageHead title="Approvals" lead="Trips and claims waiting on you. Deciding one opens the next." />
      {failed && (
        <TeCard>
          <Txt size={F.small} tone="muted">Could not load your queue.</Txt>
          <Button title="Try again" size="sm" variant="outline" style={{ alignSelf: 'flex-start', marginTop: S.md }} onPress={() => void q.refetch()} />
        </TeCard>
      )}
      <ListCard head="Waiting on you" headRight={String(rows.length)}>
        {q.isPending ? (
          <TeEmpty title="Loading…" />
        ) : rows.length ? rows.map((r, i) => (
          <Li key={r.step_id} last={i === rows.length - 1} onPress={() => open(approvalHref(r))}
            left={<Ico name={r.entity_type === 'trip' ? 'local' : 'other'} kind={r.entity_type === 'trip' ? 'local' : undefined} />}
            right={
              <View style={{ alignItems: 'flex-end' }}>
                <Txt size={F.small} w={700}>{rs(r.amount)}</Txt>
                <Txt size={F.micro} tone="muted">{r.entity_type === 'trip' ? 'estimate' : 'claimed'}</Txt>
              </View>
            }>
            <Txt size={F.small} w={700}>{`${r.entity_type === 'trip' ? 'Trip plan' : 'Claim'} ${r.ref_no} from ${r.employee_name}`}</Txt>
            <Txt size={F.tiny} color={C.muted}>{r.role_label}{r.waiting_since ? ` · waiting since ${when(r.waiting_since)}` : ''}</Txt>
          </Li>
        )) : (
          <TeEmpty title="Nothing waiting">Trips and claims appear here when it is your turn to decide.</TeEmpty>
        )}
      </ListCard>
    </TeScreen>
  )
}
