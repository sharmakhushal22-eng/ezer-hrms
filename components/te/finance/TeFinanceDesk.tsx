'use client'
// components/te/finance/TeFinanceDesk.tsx — tab 3 of three: the Finance desk.
//
// WHAT IT IS. Everything the Travel Desk has passed on, and every money
// question that follows it: checking a claim line by line, the advances that
// are out with people, the payouts that settle them, the corrections when the
// settlement was wrong either way, and which months still accept claims.
//
// WHY ONE TAB AND NOT FIVE. These were five tabs across the top of the
// console, sitting beside Approvals, the Travel Desk and ten setup screens.
// Finance was a third of the row and read as five unrelated jobs. It is one
// job with five rooms, and one room at a time is what somebody actually does:
// check, then pay, then fix what was wrong. The five are now a segmented
// control inside this one tab, in the order the money moves.
//
// IT GRANTS NOTHING. The tab appears because te_finance_summary answered,
// which is the Finance permission proving itself. Each screen inside it still
// makes its own calls, and each of those is re-checked in SQL — opening the
// Payouts section is not the same as being allowed to pay anybody.
import { useState } from 'react'
import TeVerification from './TeVerification'
import TeAdvanceDesk from './TeAdvanceDesk'
import TePayouts from './TePayouts'
import TeAdjustments from './TeAdjustments'
import TePeriods from './TePeriods'
import TeIcon from '../TeIcon'

type Room = 'verify' | 'advances' | 'payouts' | 'corrections' | 'periods'

/** In the order the money moves, not alphabetically: a claim is checked,
 *  advances against it are known, it is paid, a mistake is corrected, and the
 *  month it belongs to is eventually closed. */
const ROOMS: { k: Room; label: string; icon: string }[] = [
  { k: 'verify', label: 'Verification', icon: 'verify' },
  { k: 'advances', label: 'Advances', icon: 'advances' },
  { k: 'payouts', label: 'Payouts', icon: 'claims' },
  { k: 'corrections', label: 'Corrections', icon: 'swap' },
  { k: 'periods', label: 'Months', icon: 'cal' },
]

export default function TeFinanceDesk({ onToast }: { onToast: (message: string) => void }) {
  const [room, setRoom] = useState<Room>('verify')

  // No header of its own, deliberately. Each of the five screens below already
  // opens with its own <h1> and its own sentence; adding a "Finance desk" one
  // above them would put two h1s on the page and say nothing the tab in the
  // row above has not already said.
  return (
    <>
      <div className="seg scopes" role="group" aria-label="Finance">
        {ROOMS.map(r => (
          <button key={r.k} type="button" aria-pressed={room === r.k} onClick={() => setRoom(r.k)}>
            <TeIcon name={r.icon} size="sm" />{r.label}
          </button>
        ))}
      </div>

      {room === 'verify' ? <TeVerification onToast={onToast} /> : null}
      {room === 'advances' ? <TeAdvanceDesk onToast={onToast} /> : null}
      {room === 'payouts' ? <TePayouts onToast={onToast} /> : null}
      {room === 'corrections' ? <TeAdjustments onToast={onToast} /> : null}
      {room === 'periods' ? <TePeriods onToast={onToast} /> : null}
    </>
  )
}
