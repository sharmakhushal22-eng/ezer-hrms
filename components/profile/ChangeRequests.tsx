'use client'
// components/profile/ChangeRequests.tsx
//
// Two lists that share one shape: what I have asked for, and what I have been
// asked to decide.
//
// The review queue renders only when the server puts something in it. Whether
// somebody is an approver is 105's profile_change_can_act() to answer, not
// this component's — so there is no role check here and no "Approvals" heading
// sitting empty on 300 employees' screens. An empty queue is simply absent.

import { useCallback, useEffect, useState } from 'react'
import {
  loadMyRequests, loadReviewQueue, decideRequest, cancelRequest,
  type MyRequest, type QueueRequest,
} from '@/lib/profile/client'

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** Terminal states get a settled look; anything still moving stays amber. */
const tone = (status: string) =>
  status === 'approved' ? 'ok' : status === 'rejected' ? 'no'
  : status === 'cancelled' ? 'off' : 'wait'

function Value({ from, to }: { from: string | null; to: string }) {
  return (
    <div className="reqval">
      <span className="was">{from?.trim() ? from : <i>empty</i>}</span>
      <span className="arw" aria-hidden="true">→</span>
      <span className="now">{to}</span>
    </div>
  )
}

export default function ChangeRequests({ canSee = true }: { canSee?: boolean }) {
  const [mine, setMine] = useState<MyRequest[]>([])
  const [queue, setQueue] = useState<QueueRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [remarks, setRemarks] = useState('')

  const refresh = useCallback(async () => {
    const [m, q] = await Promise.all([loadMyRequests(), loadReviewQueue()])
    // A queue error is not worth a banner: most people are not approvers, and
    // the failure that matters to them is on their own list.
    if (m.error) setErr(m.error.message); else setMine(m.data?.requests ?? [])
    if (!q.error) setQueue(q.data?.requests ?? [])
  }, [])

  useEffect(() => { if (canSee) void refresh() }, [canSee, refresh])
  if (!canSee) return null

  async function act(id: string, decision: 'approve' | 'reject', text?: string) {
    setBusy(id); setErr(null); setNote(null)
    const r = await decideRequest(id, decision, text)
    setBusy(null)
    if (r.error) { setErr(r.error.message); return }
    setRejecting(null); setRemarks('')
    setNote(r.data?.applied ? 'Approved. The record has been updated.'
          : r.data?.message ?? (decision === 'reject' ? 'Rejected.' : 'Approved.'))
    await refresh()
  }

  async function withdraw(id: string) {
    setBusy(id); setErr(null); setNote(null)
    const r = await cancelRequest(id)
    setBusy(null)
    if (r.error) { setErr(r.error.message); return }
    setNote('Withdrawn.')
    await refresh()
  }

  return (
    <>
      {err && <div className="reqmsg no">{err}</div>}
      {note && <div className="reqmsg ok">{note}</div>}

      {queue.length > 0 && (
        <section className="card reqs">
          <div className="hd">
            <h3>To review</h3>
            <span className="sub">{queue.length} waiting on you</span>
          </div>
          <ul className="reqlist">
            {queue.map(r => (
              <li key={r.id}>
                <div className="reqtop">
                  <div>
                    <b>{r.employee}</b> <span className="code">{r.emp_code}</span>
                    <div className="fldname">{r.field_label}</div>
                  </div>
                  <span className={`reqage ${r.waiting_days >= 7 ? 'old' : ''}`}>
                    {r.waiting_days === 0 ? 'today'
                      : `${r.waiting_days} day${r.waiting_days === 1 ? '' : 's'}`}
                  </span>
                </div>

                <Value from={r.old_value} to={r.new_value} />
                {r.reason && <p className="why">“{r.reason}”</p>}

                {rejecting === r.id ? (
                  <div className="rejbox">
                    <label htmlFor={`rj-${r.id}`}>
                      Why is this not approved? {r.employee.split(' ')[0]} will see this.
                    </label>
                    <textarea id={`rj-${r.id}`} rows={2} value={remarks}
                              onChange={e => setRemarks(e.target.value)} />
                    <div className="acts">
                      <button className="btn ghost" onClick={() => { setRejecting(null); setRemarks('') }}>
                        Back
                      </button>
                      <button className="btn no" disabled={!remarks.trim() || busy === r.id}
                              onClick={() => act(r.id, 'reject', remarks.trim())}>
                        {busy === r.id ? 'Sending…' : 'Confirm rejection'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="acts">
                    <button className="btn ghost" disabled={busy === r.id}
                            onClick={() => { setRejecting(r.id); setRemarks('') }}>
                      Reject
                    </button>
                    <button className="btn" disabled={busy === r.id}
                            onClick={() => act(r.id, 'approve')}>
                      {busy === r.id ? 'Working…' : 'Approve'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card reqs">
        <div className="hd">
          <h3>My change requests</h3>
          {mine.length > 0 && <span className="sub">{mine.length}</span>}
        </div>
        {mine.length === 0 ? (
          <p className="empty">
            Nothing pending. Fields marked <b>Request</b> go for approval when you change them.
          </p>
        ) : (
          <ul className="reqlist">
            {mine.map(r => (
              <li key={r.id}>
                <div className="reqtop">
                  <div className="fldname">{r.field_label}</div>
                  <span className={`st ${tone(r.status)}`}>{r.stage_label}</span>
                </div>
                <Value from={r.old_value} to={r.new_value} />
                <div className="meta">
                  Asked {when(r.requested_at)}
                  {r.decided_at && ` · answered ${when(r.decided_at)}`}
                </div>
                {r.remarks && <p className="why">{r.remarks}</p>}
                {r.status.startsWith('pending') && (
                  <div className="acts">
                    <button className="btn ghost" disabled={busy === r.id}
                            onClick={() => withdraw(r.id)}>
                      {busy === r.id ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
