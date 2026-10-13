'use client'
// components/te/approve/TeApprovals.tsx — what is waiting for you to decide.
// Screens 90, 97, 98.
//
// An approver's queue is a working list, not a dashboard. The useful thing it
// can do is keep them moving: deciding one item opens the next rather than
// dropping them back on a list to find their place again (screen 98). An
// empty queue says so plainly and does not pretend there is work (97).
//
// Everything here is te.queue(), which is the server's answer to "whose turn
// is it" — this screen never works out who may act on what.
import { useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeQueueRow } from '@/lib/te/types'
import { rs, when } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeTripApproval from './TeTripApproval'
import TeClaimApproval from './TeClaimApproval'

export default function TeApprovals({ onToast }: { onToast: (message: string) => void }) {
  const [queue, setQueue] = useState<TeQueueRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.queue()
      .then(q => { if (current) { setQueue(q); setError('') } })
      .catch(e => { if (current) { setQueue([]); setError(String(e)) } })
    return () => { current = false }
  }, [tick])

  const rows = queue ?? []
  const open = rows.find(r => r.entity_id === openId) ?? null

  /** Decided: take it off the list and open whatever is next, so the person
   *  keeps working instead of hunting for their place. */
  const afterDecision = (message: string) => {
    onToast(message)
    const at = rows.findIndex(r => r.entity_id === openId)
    const next = rows[at + 1] ?? rows.find((r, i) => i !== at) ?? null
    setOpenId(next && next.entity_id !== openId ? next.entity_id : null)
    reload()
  }

  if (open) {
    return open.entity_type === 'trip'
      ? <TeTripApproval tripId={open.entity_id} onBack={() => setOpenId(null)} onDecided={afterDecision} />
      : <TeClaimApproval claimId={open.entity_id} onBack={() => setOpenId(null)} onDecided={afterDecision} />
  }

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Approvals</h1>
          <p>Trips and claims waiting on you. Deciding one opens the next.</p>
        </div>
      </div>

      {error ? (
        <div className="card"><p className="muted">Could not load your queue.</p>
          <button type="button" className="btn sm" onClick={reload}>Try again</button></div>
      ) : null}

      <div className="card pad0">
        <div className="day"><span>Waiting on you</span><span>{rows.length}</span></div>
        {queue === null ? (
          <div className="empty"><b>Loading…</b></div>
        ) : rows.length ? rows.map(r => (
          <button key={r.step_id} type="button" className="li click" onClick={() => setOpenId(r.entity_id)}>
            <span className={r.entity_type === 'trip' ? 'ico sc-local' : 'ico'}>
              <TeIcon name={r.entity_type === 'trip' ? 'local' : 'other'} />
            </span>
            <div className="grow">
              <div className="b">{r.entity_type === 'trip' ? 'Trip plan' : 'Claim'} {r.ref_no} from {r.employee_name}</div>
              <div className="small muted">
                {r.role_label}
                {r.waiting_since ? ` · waiting since ${when(r.waiting_since)}` : ''}
              </div>
            </div>
            <div className="amt">
              <b>{rs(r.amount)}</b>
              <span className="small muted">{r.entity_type === 'trip' ? 'estimate' : 'claimed'}</span>
            </div>
          </button>
        )) : (
          // Screen 97. An empty queue is good news and should read like it.
          <div className="empty">
            <b>Nothing waiting</b>
            Trips and claims appear here when it is your turn to decide.
          </div>
        )}
      </div>
    </div>
  )
}
