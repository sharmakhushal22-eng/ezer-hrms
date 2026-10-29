// src/features/expenses/claims/MoveToTrip.tsx — "Move to a trip" under a loose bill
// (components/te/TeOtherExpenses.tsx, the `moving` block). Separate from editing on
// purpose: te_expense_save ignores any trip a form sends, so moving money between
// trips is its own call (PATCH /api/te/expenses/:id { trip_id }).
import * as React from 'react'
import { View } from 'react-native'
import type { TeTrip } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { errorText, te } from '../api'
import { FieldErr, Ico, Li, Mono } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'

export function MoveToTrip({ lineId, label, trips, onMoved }: {
  lineId: string
  /** merchant || category name || 'this bill' */
  label: string
  trips: TeTrip[]
  onMoved: (message: string) => void
}) {
  const { C } = useTheme()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  async function moveTo(t: TeTrip) {
    setBusy(true); setError('')
    try {
      const r = await te.expenseMoveTrip(lineId, t.id)
      onMoved(r.moved ? `${r.expense_no} moved into ${r.trip_no ?? t.no}.` : `${r.expense_no} was already there.`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: S.sm, paddingHorizontal: S.md, paddingBottom: S.md, backgroundColor: C.sunken }}>
      <Txt size={F.tiny} tone="muted" style={{ paddingTop: S.sm }}>
        {`Which trip does ${label} belong to? It will be claimed with that trip instead of this month’s other expenses.`}
      </Txt>
      {error ? <FieldErr>{error}</FieldErr> : null}
      <View style={{ borderRadius: 10, overflow: 'hidden', backgroundColor: C.surface }}>
        {trips.map((t, i) => (
          <Li key={t.id} last={i === trips.length - 1} left={<Ico name="route" />}
            onPress={busy ? undefined : () => void moveTo(t)}
            right={<TeIcon name="go" size="sm" color={C.brand} />}>
            <Txt size={F.small} w={700}>{t.name}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Mono>{t.no}</Mono>
              {t.start ? <Txt size={F.tiny} tone="muted">{` · ${t.start}`}</Txt> : null}
            </View>
          </Li>
        ))}
      </View>
    </View>
  )
}
