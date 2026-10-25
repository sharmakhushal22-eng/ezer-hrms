// src/features/expenses/claims/OtherExpensesScreen.tsx — /expenses/other, "Other expenses"
// (TeOtherExpenses with no trip, view 'expenses'). TeHome's callbacks:
//   onAdd → the expense sheet · onEdit(line) → the sheet on that line
//   onSubmitted(id, msg) → toast, reload, the new claim (swap: the website
//     replaces the view, so Back from the claim returns to where Other expenses
//     was opened from) · onOpenTrip(id) → the trip.
import * as React from 'react'
import { useOverlay } from '@/ui/overlays'
import { reloadTe } from '../data'
import { open, swap, teHref } from '../nav'
import { SnapScreen } from '../ui/TeScreen'
import { OtherExpensesView } from './OtherExpensesView'

export default function OtherExpensesScreen() {
  const { notify } = useOverlay()
  return (
    <SnapScreen title="Other expenses" tab="expenses">
      {snap => (
        <OtherExpensesView snap={snap}
          onAdd={() => open(teHref.expense())}
          onEdit={line => open(teHref.expense({ line: line.id }))}
          onSubmitted={(id, msg) => { notify(msg, 'success'); void reloadTe(); swap(teHref.claim(id)) }}
          onOpenTrip={id => open(teHref.trip(id))} />
      )}
    </SnapScreen>
  )
}
