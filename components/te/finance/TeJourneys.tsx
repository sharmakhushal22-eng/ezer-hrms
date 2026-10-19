'use client'
// components/te/finance/TeJourneys.tsx — the Finance desk's room for recorded
// journeys, including the GPS sub-trips travellers add while they are away.
//
// WHY FINANCE SEES THESE AT ALL. Before migration 180 no finance view joined
// te_legs in any form — not v_te_claim_summary, not v_te_payable, none of them.
// The only journey evidence that ever reached this team arrived bundled inside
// a claim, weeks after the travel, with the route unavailable because nothing
// in the product had ever drawn one. A team asked to pay for 14 cab rides
// across Mumbai could see 14 amounts and no journeys.
//
// THE THREE FILTERS are the three things a person in this room is actually
// doing: what still needs me, what is stuck on somebody else, and what I have
// already done. "Sent back" is first in the list even though it is not the
// default, because those are the rows holding up a claim.
//
// IT PAYS NOTHING FROM HERE. Confirming records that Finance looked and agreed;
// the money is settled on the claim, in Verification, where it always was.
import { useCallback, useEffect, useState } from 'react'
import { te, type DeskJourney } from '@/lib/te/client'
import { errorText } from '@/lib/te/format'
import type { TeConfig } from '@/lib/te/types'
import TeIcon from '../TeIcon'
import TeJourneyReview from '../desk/TeJourneyReview'

type Filter = 'waiting' | 'back' | 'done'

const FILTERS: { k: Filter; label: string }[] = [
  { k: 'waiting', label: 'Waiting on Finance' },
  { k: 'back', label: 'Sent back' },
  { k: 'done', label: 'Confirmed' },
]

export default function TeJourneys({ onToast }: { onToast: (message: string) => void }) {
  const [filter, setFilter] = useState<Filter>('waiting')
  const [rows, setRows] = useState<DeskJourney[] | null>(null)
  const [modes, setModes] = useState<TeConfig['modes']>([])
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.finance.journeys({ state: filter, limit: 100 })
      .then(r => { if (current) { setRows(r.rows ?? []); setError('') } })
      .catch(e => { if (current) { setRows([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [filter, tick])

  // Only for `basis` — whether a journey with no bill attached is missing one.
  // Read once; the mode table does not change while somebody reviews a list.
  useEffect(() => {
    let current = true
    te.me().then(s => { if (current) setModes(s.cfg?.modes ?? []) }).catch(() => { /* the list still works without it */ })
    return () => { current = false }
  }, [])

  return (
    <div className="page">
      <div className="ph">
        <h1>Journeys</h1>
        <p>
          Journeys travellers have recorded and reported, including the local sub-trips they add while they are away.
          Confirming records that you looked and agreed; the money is settled on the claim, in Verification.
        </p>
      </div>

      <div className="seg scopes" role="group" aria-label="Which journeys">
        {FILTERS.map(f => (
          <button key={f.k} type="button" aria-pressed={filter === f.k} onClick={() => setFilter(f.k)}>{f.label}</button>
        ))}
      </div>

      {error ? <div className="flag crit" role="alert"><TeIcon name="alert" size="sm" /><span>{error}</span></div> : null}

      {rows === null ? (
        <p className="small muted">Loading…</p>
      ) : (
        <TeJourneyReview
          rows={rows}
          desk="finance"
          basisOf={m => modes.find(x => x.id === m)?.basis}
          onDone={reload}
          onToast={message => { onToast(message); reload() }}
        />
      )}
    </div>
  )
}
