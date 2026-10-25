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
//
// The data lives in useChangeRequests() so the profile can show a short
// summary in its side column and the full history in a drawer without loading
// it twice. Every pending request says WHO it is with, by name — "Waiting on
// HR — Asha Rao" — which is the question people actually ask.

import { useCallback, useEffect, useState } from 'react'
import {
  loadMyRequests, loadReviewQueue, decideRequest, cancelRequest,
  type MyRequest, type QueueRequest,
} from '@/lib/profile/client'

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Terminal states get a settled look; anything still moving stays amber. */
const tone = (status: string) =>
  status === 'approved' ? 'ok' : status === 'rejected' ? 'no'
  : status === 'cancelled' ? 'off' : 'wait'

export interface RequestsState {
  mine: MyRequest[]; queue: QueueRequest[]; err: string | null; loaded: boolean
  refresh: () => Promise<void>
}

export function useChangeRequests(enabled: boolean, refreshKey = 0): RequestsState {
  const [mine, setMine] = useState<MyRequest[]>([])
  const [queue, setQueue] = useState<QueueRequest[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const [m, q] = await Promise.all([loadMyRequests(), loadReviewQueue()])
    // A queue error is not worth a banner: most people are not approvers, and
    // the failure that matters to them is on their own list.
    if (m.error) setErr(m.error.message); else { setErr(null); setMine(m.data?.requests ?? []) }
    if (!q.error) setQueue(q.data?.requests ?? [])
    setLoaded(true)
  }, [])

  useEffect(() => { if (enabled) void refresh() }, [enabled, refresh, refreshKey])
  return { mine, queue, err, loaded, refresh }
}

function Value({ from, to }: { from: string | null; to: string }) {
  return (
    <div className="reqval">
      <span className="was">{from?.trim() ? from : <i>empty</i>}</span>
      <span className="arw" aria-hidden="true">→</span>
      <span className="now">{to}</span>
    </div>
  )
}

const isPending = (s: string) => s.startsWith('pending')

/** The side-column card: what is open, and with whom. */
export function RequestsSummary({ req, onOpen }: { req: RequestsState; onOpen: () => void }) {
  const open = req.mine.filter(r => isPending(r.status))
  if (!req.loaded) return null
  return (
    <section className="card">
      <div className="hd">
        <h3>Requests</h3>
        <button type="button" className="lnk" onClick={onOpen}>Change history</button>
      </div>
      {req.queue.length > 0 && (
        <button type="button" className="reqcall" onClick={onOpen}>
          <b>{req.queue.length}</b> {req.queue.length === 1 ? 'request is' : 'requests are'} waiting on you
          <span aria-hidden="true">→</span>
        </button>
      )}
      {open.length === 0 ? (
        <p className="empty">Nothing waiting for approval.</p>
      ) : (
        <ul className="reqmini">
          {open.slice(0, 3).map(r => (
            <li key={r.id}>
              <div className="rn">{r.field_label}</div>
              <div className="rw">Waiting on {r.waiting_on ?? r.stage_label}</div>
            </li>
          ))}
          {open.length > 3 && <li className="more"><button type="button" className="lnk" onClick={onOpen}>+{open.length - 3} more</button></li>}
        </ul>
      )}
    </section>
  )
}

export default function ChangeRequests({ req }: { req: RequestsState }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [remarks, setRemarks] = useState('')

  async function act(id: string, decision: 'approve' | 'reject', text?: string) {
    setBusy(id); setErr(null); setNote(null)
    const r = await decideRequest(id, decision, text)
    setBusy(null)
    if (r.error) { setErr(r.error.message); return }
    setRejecting(null); setRemarks('')
    setNote(r.data?.applied ? 'Approved. The record has been updated.'
          : r.data?.message ?? (decision === 'reject' ? 'Rejected.' : 'Approved.'))
    await req.refresh()
  }

  async function withdraw(id: string) {
    setBusy(id); setErr(null); setNote(null)
    const r = await cancelRequest(id)
    setBusy(null)
    if (r.error) { setErr(r.error.message); return }
    setNote('Withdrawn.')
    await req.refresh()
  }

  const shownErr = err ?? req.err

  return (
    <div className="reqs">
      {shownErr && <div className="reqmsg no">{shownErr}</div>}
      {note && <div className="reqmsg ok">{note}</div>}

      {req.queue.length > 0 && (
        <section className="reqsec">
          <div className="hd">
            <h4>To review</h4>
            <span className="sub">{req.queue.length} waiting on you</span>
          </div>
          <ul className="reqlist">
            {req.queue.map(r => (
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

      <section className="reqsec">
        <div className="hd">
          <h4>My change requests</h4>
          {req.mine.length > 0 && <span className="sub">{req.mine.length}</span>}
        </div>
        {req.mine.length === 0 ? (
          <p className="empty">
            Nothing yet. Changes marked <b>Needs approval</b> appear here, with who has them.
          </p>
        ) : (
          <ul className="reqlist">
            {req.mine.map(r => (
              <li key={r.id}>
                <div className="reqtop">
                  <div className="fldname">{r.field_label}</div>
                  <span className={`st ${tone(r.status)}`}>{r.stage_label}</span>
                </div>
                <Value from={r.old_value} to={r.new_value} />
                {isPending(r.status) && r.waiting_on && (
                  <div className="with">Waiting on <b>{r.waiting_on}</b></div>
                )}
                <div className="meta">
                  Asked {when(r.requested_at)}
                  {r.decided_at && ` · answered ${when(r.decided_at)}`}
                  {r.decided_by && ` by ${r.decided_by}`}
                </div>
                {r.remarks && <p className="why">{r.remarks}</p>}
                {isPending(r.status) && (
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
    </div>
  )
}
