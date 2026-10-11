'use client'
// components/te/TeClaims.tsx — "My claims" and one claim with its timeline.
//
// Markup and class names: design/html/my-claims.html and claim-detail.html.
// The list renders from the snapshot (GET /api/te/me). The detail is one call,
// GET /api/te/claims/[id], which also says what the person looking at it may do
// (`can`). The owner can take a claim back or answer a send-back; an approver
// or a Finance member gets the plain decision buttons. Reducing or rejecting
// single lines is part of the full approval screen, which is NOT built here
// (see app-code/UI-BUILD-GUIDE.md, "Approvals").
import { useEffect, useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { Snapshot, TeClaim, TeClaimDetail } from '@/lib/te/types'
import TeIcon from './TeIcon'
import { claimChip, claimHolder, day, errorText, flagClass, rs, when } from '@/lib/te/format'

export function TeClaimList({ snap, onOpen }: { snap: Snapshot; onOpen: (claimId: string) => void }) {
  const tripName = useMemo(() => new Map(snap.trips.map(t => [t.id, t.name])), [snap])
  return (
    <>
      <div className="ph">
        <div>
          <h1>My claims</h1>
          <p>Every claim you sent, for local travel, outstation trips and other expenses. See who holds it, what was approved and why.</p>
        </div>
      </div>
      <div className="card pad0">
        {snap.claims.length === 0 ? <div className="empty"><b>No claims yet</b>A claim appears here the moment you submit it.</div> : null}
        {snap.claims.map(c => {
          const chip = claimChip(c)
          return (
            <div key={c.id} className="li click" role="button" tabIndex={0} onClick={() => onOpen(c.id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(c.id) }}>
              <span className="ico"><TeIcon name="other" /></span>
              <div className="grow">
                <div className="b">{(c.tripId && tripName.get(c.tripId)) || 'Other expenses'} <span className="mono muted">{c.no}</span></div>
                <div className="small muted">{claimHolder(c)}</div>
              </div>
              <div className="amt">
                <b>{rs(c.net ?? c.approved ?? c.claimed)}</b>
                <div><span className={`chip ${chip.tone}`}>{chip.label}</span></div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** The tracker under the title: submitted, each approval level, each finance level, payout, settled. */
function Tracker({ c }: { c: TeClaim }) {
  const steps = [...c.chain, ...c.fin]
  const firstPending = steps.findIndex(s => s.status === 'pending')
  const stopped = c.status === 'REJECTED' || c.status === 'CANCELLED' || c.status === 'SENT_BACK'
  const paidOut = c.status === 'SETTLED'
  return (
    <div className="trk">
      <div className="st done"><b>Submitted</b><span>{when(c.submittedAt)}</span></div>
      {steps.map((s, i) => {
        const state = s.status === 'approved' ? 'done' : s.status === 'pending' ? (i === firstPending && !stopped ? 'now' : 'todo') : s.status === 'skipped' ? 'todo' : 'bad'
        return <div key={s.id} className={`st ${state}`}><b>{s.role}</b><span>{s.byName || s.whoName || ''}{s.at ? ` · ${when(s.at)}` : ''}</span></div>
      })}
      <div className={`st ${paidOut ? 'done' : c.status === 'VERIFIED' ? 'now' : 'todo'}`}><b>Payout</b><span>{c.paidRef || ' '}</span></div>
      <div className={`st ${paidOut ? 'done' : 'todo'}`}><b>Settled</b><span>{paidOut ? when(c.settledAt) : ' '}</span></div>
    </div>
  )
}

export function TeClaimDetail({ claimId, catName, onBack, onChanged }: {
  claimId: string
  catName: Map<string, string>
  onBack: () => void
  /** Called after an action changed the claim, so the caller reloads its own data. */
  onChanged: (message: string) => void
}) {
  const [d, setD] = useState<TeClaimDetail | null>(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    te.claim(claimId).then(r => { if (current) { setD(r); setError('') } }).catch(e => { if (current) setError(errorText(e)) })
    return () => { current = false }
  }, [claimId, tick])

  async function run(label: string, act: () => Promise<unknown>) {
    setBusy(true); setError('')
    try {
      await act()
      setText(''); setTick(n => n + 1); onChanged(label)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!d) return <div className="card"><p className="muted">{error || 'Loading the claim…'}</p><button type="button" className="btn sm" onClick={onBack}>My claims</button></div>
  const c = d.claim
  const chip = claimChip(c)
  const finance = d.can.stage === 'finance'

  return (
    <>
      <div className="row"><button type="button" className="btn sm" onClick={onBack}>My claims</button><span className="mono muted">{c.no}</span></div>
      <div className="card">
        <div className="row sp top">
          <div>
            <h1>{d.trip?.name || 'Other expenses'}</h1>
            <p className="muted">{[d.employee.name, claimHolder(c), c.period ? `${c.period} period` : ''].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="row tight"><span className={`chip ${chip.tone}`}>{chip.label}</span></div>
        </div>
        <Tracker c={c} />
      </div>

      <div className="cols">
        <div className="stack">
          <div className="card pad0">
            <div className="tw">
              <table className="tbl">
                <tbody>
                  <tr><th>Date</th><th>Expense</th><th className="r">Claimed</th><th className="r">Approved</th><th>Why</th></tr>
                  {d.lines.map(x => (
                    <tr key={x.id}>
                      <td className="nowrap">{day(x.date)}</td>
                      <td><b>{x.merchant || catName.get(x.cat) || x.cat}</b><div className="small muted">{catName.get(x.cat) || x.cat}{x.pay === 'company' ? ' · paid by company' : ''}</div></td>
                      <td className="r">{x.pay === 'company' ? '—' : rs(x.claimed)}</td>
                      <td className="r b">{x.pay === 'company' ? '—' : x.approved === null ? '…' : rs(x.approved)}</td>
                      <td className="small">{x.dreason || (x.fix ? 'Needs your correction' : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {c.flags.filter(f => f.status === 'open').map(f => (
            <div key={f.id} className={flagClass(f)}>
              <TeIcon name="warn" />
              <div className="tx"><b><span className="code">{f.code}</span> {f.title}</b><p>{f.evidence}</p></div>
            </div>
          ))}
        </div>

        <div className="aside">
          <div className="card">
            <dl className="kv">
              <dt>Claimed</dt><dd>{rs(c.claimed)}</dd>
              <dt>Approved</dt><dd>{rs(c.approved)}</dd>
              {c.advanceAdjusted > 0 ? <><dt>Advance adjusted</dt><dd>{rs(-c.advanceAdjusted)}</dd></> : null}
              <dt className="tot">{c.status === 'SETTLED' ? 'Paid' : 'To be paid'}</dt><dd className="tot">{rs(c.net ?? c.approved)}</dd>
            </dl>
          </div>

          {(d.can.own && (c.status === 'SENT_BACK' || c.status === 'IN_APPROVAL')) || d.can.act ? (
            <div className="card">
              {d.can.own && c.status === 'SENT_BACK' ? (
                <div className="stack sm">
                  <label className="fld"><span>Your answer</span><textarea value={text} onChange={e => setText(e.target.value)} /></label>
                  <button type="button" className="btn pri wide" disabled={busy || !text.trim()} onClick={() => run('Answer sent.', () => te.claimRespond(c.id, text))}>Send answer</button>
                </div>
              ) : null}
              {d.can.own ? <button type="button" className="btn wide" disabled={busy} onClick={() => run('Claim taken back.', () => te.claimRecall(c.id))}>Take this claim back</button> : null}
              {d.can.act ? (
                <div className="stack sm">
                  <p className="small muted">You are deciding as {d.can.role}. To reduce or reject single lines, use the full approval screen (not part of this starter).</p>
                  <label className="fld"><span>Comment</span><textarea value={text} onChange={e => setText(e.target.value)} /></label>
                  <button type="button" className="btn pri wide" disabled={busy} onClick={() => run(finance ? 'Verified.' : 'Approved.', () => te.claimDecide(c.id, finance ? 'verify' : 'approve', { comment: text }))}>{finance ? 'Verify' : 'Approve'}</button>
                  <div className="row">
                    <button type="button" className="btn sm" disabled={busy || !text.trim()} onClick={() => run('Sent back.', () => te.claimDecide(c.id, 'sendback', { comment: text, stage: finance ? 'finance' : 'manager' }))}>Send back</button>
                    <button type="button" className="btn sm dan" disabled={busy || !text.trim()} onClick={() => run('Rejected.', () => te.claimDecide(c.id, 'reject', { comment: text, stage: finance ? 'finance' : 'manager' }))}>Reject</button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {!d.can.act && d.can.why && !d.can.own ? <div className="note"><TeIcon name="info" size="sm" /><span>{d.can.why}</span></div> : null}
          {error ? <div className="flag crit" role="alert"><TeIcon name="warn" /><div className="tx"><b>{error}</b></div></div> : null}

          <div className="card pad0">
            <div className="day"><span>History</span><span>{d.timeline.length}</span></div>
            {d.timeline.map((h, i) => (
              <div key={`${h.at}-${i}`} className="li">
                <div className="grow">
                  <div className="small muted">{when(h.at)}{h.name ? ` · ${h.name}` : ''}{h.internal ? ' · internal' : ''}</div>
                  <div>{h.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
