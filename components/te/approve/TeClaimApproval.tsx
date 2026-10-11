'use client'
// components/te/approve/TeClaimApproval.tsx — deciding a claim, line by line.
// Screens 92, 93, 95, 96.
//
// The only screen in the module that changes what somebody is paid. So it is
// built to make the consequence visible BEFORE the click: every change
// restates the total, and the button area says in words what is about to
// happen to the employee.
//
// Three outcomes, and they are not interchangeable:
//   approve   pays what is left after any cuts and refusals
//   send back the employee fixes it and sends it again; needs a comment and
//             at least one thing to look at
//   reject    nothing is paid, and that is the end of it
//
// The arithmetic and the gates are lib/te/claim-decide.ts, which is tested.
// The flags, the risk band and the eligible amounts are the server's.
import { useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeClaimDetail as ClaimDetail, TePlaceBrief, Uuid } from '@/lib/te/types'
import {
  decidedTotal, describe as describeDecision, emptyDecision, isTouched,
  toDecideInput, whyNotReady, type DecideAction, type DecisionDraft,
} from '@/lib/te/claim-decide'
import { claimChip, errorText, rs, when } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeLegEvidence from './TeLegEvidence'

export default function TeClaimApproval({ claimId, onBack, onDecided }: {
  claimId: Uuid
  onBack: () => void
  onDecided: (message: string) => void
}) {
  // The evidence for one leg opens over this screen rather than beside it:
  // it is a map and a column of numbers, and squeezing it in would shrink
  // both. Held here so going back returns to the decision half-made.
  const [evidence, setEvidence] = useState<Uuid | null>(null)
  const [detail, setDetail] = useState<ClaimDetail | null>(null)
  const [draft, setDraft] = useState<DecisionDraft>(emptyDecision)
  const [action, setAction] = useState<DecideAction>('approve')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])
  // A claim carries its legs but not a place book, so leg evidence would show
  // raw ids. The trip has the names; it is fetched alongside when there is one.
  const [places, setPlaces] = useState<Record<Uuid, TePlaceBrief>>({})

  useEffect(() => {
    let current = true
    te.claim(claimId)
      .then(d => {
        if (!current) return
        setDetail(d); setError('')
        if (d.trip) {
          te.trip(d.trip.id)
            .then(t => { if (current) setPlaces(t.places) })
            // Names are a nicety; the numbers still stand without them.
            .catch(() => { if (current) setPlaces({}) })
        }
      })
      .catch(e => { if (current) setError(errorText(e)) })
    return () => { current = false }
  }, [claimId, tick])

  if (!detail) {
    return (
      <div className="page">
        <div className="row"><button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Approvals</button></div>
        <div className="card"><p className="muted">{error || 'Loading the claim…'}</p>
          {error ? <button type="button" className="btn sm" onClick={reload}>Try again</button> : null}</div>
      </div>
    )
  }

  const c = detail.claim
  // `eligible` is null until the server has priced a line; nothing is
  // approvable until then, so an unpriced line is worth zero here.
  const lines = detail.lines.map(l => ({ id: l.id, eligible: l.eligible ?? 0 }))
  const eligibleOf = (id: Uuid) => lines.find(l => l.id === id)?.eligible ?? 0
  // Flags hang off the claim, each naming the line it is about.
  const flagsFor = (id: Uuid) => detail.claim.flags.filter(f => f.lineId === id)
  const chip = claimChip(c)
  const sums = decidedTotal(lines, draft.lines)
  const blocked = whyNotReady(action, draft, lines)
  const mayAct = detail.can.act

  const setLine = (id: Uuid, patch: Partial<DecisionDraft['lines'][string]>) =>
    setDraft(d => ({ ...d, lines: { ...d.lines, [id]: { ...d.lines[id], ...patch } } }))
  const clearLine = (id: Uuid) =>
    setDraft(d => { const lines2 = { ...d.lines }; delete lines2[id]; return { ...d, lines: lines2 } })
  const toggleFix = (id: Uuid) =>
    setDraft(d => ({ ...d, fix: d.fix.includes(id) ? d.fix.filter(x => x !== id) : [...d.fix, id] }))

  const who = detail.employee.name

  async function send() {
    if (blocked) { setTried(true); setError(blocked); return }
    setBusy(true); setError('')
    try {
      await te.claimDecide(c.id, action, toDecideInput(action, draft))
      onDecided(
        action === 'approve' ? `${c.no} approved.`
          : action === 'sendback' ? `${c.no} sent back to ${who}.`
            : `${c.no} rejected.`,
      )
    } catch (e) {
      setError(errorText(e)); setBusy(false)
    }
  }

  const openLeg = evidence ? detail.legs.find(l => l.id === evidence) ?? null : null
  if (openLeg) {
    return <TeLegEvidence leg={openLeg} places={places} onBack={() => setEvidence(null)} />
  }

  return (
    <div className="page">
      <div className="row">
        <button type="button" className="btn sm" onClick={onBack}><TeIcon name="back" size="sm" />Approvals</button>
        <span className="mono muted">{c.no}</span>
      </div>

      <div className="card">
        <div className="row sp top">
          <div>
            <h1 className="tname">{detail.employee.name}</h1>
            <p className="muted">{detail.trip ? detail.trip.name : 'Other expenses'} · {detail.lines.length} line{detail.lines.length === 1 ? '' : 's'}</p>
            <p className="small muted">{detail.employee.code} · {detail.employee.title || detail.employee.dept}</p>
          </div>
          <div className="row tight">
            {c.band ? <span className={`chip ${c.band === 'High' ? 't-crit' : c.band === 'Medium' ? 't-warn' : 't-pos'}`}>{c.band} risk</span> : null}
            <span className={`chip ${chip.tone}`}>{chip.label}</span>
          </div>
        </div>
      </div>

      {!mayAct ? (
        <div className="flag info">
          <TeIcon name="info" />
          <div className="tx"><b>This is not yours to decide</b><p>{detail.can.why || 'It is with somebody else at the moment.'}</p></div>
        </div>
      ) : null}

      <div className="card pad0">
        <div className="day"><span>Lines</span><span>{detail.lines.length}</span></div>
        {detail.lines.map(l => {
          const d = draft.lines[l.id]
          const touched = isTouched(d)
          const marked = draft.fix.includes(l.id)
          return (
            <div key={l.id} className={touched || marked ? 'li bad' : 'li'}>
              <span className="ico"><TeIcon name="other" /></span>
              <div className="grow">
                <div className="b">{l.merchant || l.cat}</div>
                <div className="small muted">{[l.cat, l.desc, l.date].filter(Boolean).join(' · ')}</div>
                {flagsFor(l.id).length ? (
                  <div className="row tight">
                    {flagsFor(l.id).map(fl => (
                      <span key={fl.code} className={fl.block ? 'chip t-crit' : 'chip t-warn'}>{fl.code} {fl.title}</span>
                    ))}
                  </div>
                ) : null}

                {mayAct ? (
                  <div className="row tight">
                    <button type="button" className="btn sm" aria-pressed={d?.amount !== undefined} onClick={() => setLine(l.id, { amount: d?.amount ?? eligibleOf(l.id), reject: undefined })}>Reduce</button>
                    <button type="button" className="btn sm dan" aria-pressed={!!d?.reject} onClick={() => setLine(l.id, { reject: d?.reject ? undefined : 'refile', amount: undefined })}>Refuse</button>
                    {action === 'sendback' ? (
                      <button type="button" className="btn sm" aria-pressed={marked} onClick={() => toggleFix(l.id)}>{marked ? 'Marked to fix' : 'Ask to fix'}</button>
                    ) : null}
                    {touched ? <button type="button" className="btn sm" onClick={() => clearLine(l.id)}>Undo</button> : null}
                  </div>
                ) : null}

                {touched ? (
                  <div className="form">
                    {d?.amount !== undefined ? (
                      <label className="fld sm">
                        <span>Approve this much (₹)</span>
                        <input
                          type="number" min={0} max={eligibleOf(l.id)}
                          value={d.amount}
                          onChange={e => setLine(l.id, { amount: e.target.value === '' ? 0 : Number(e.target.value) })}
                        />
                        <small>Eligible: {rs(eligibleOf(l.id))}</small>
                      </label>
                    ) : null}
                    {d?.reject ? (
                      <label className="fld sm">
                        <span>Can it be claimed again?</span>
                        <select value={d.reject} onChange={e => setLine(l.id, { reject: e.target.value as 'final' | 'refile' })}>
                          <option value="refile">Yes, with a correction</option>
                          <option value="final">No, this is final</option>
                        </select>
                      </label>
                    ) : null}
                    <label className="fld sm">
                      <span>Why</span>
                      <input value={d?.reason ?? ''} placeholder="The employee reads this" onChange={e => setLine(l.id, { reason: e.target.value })} />
                    </label>
                  </div>
                ) : null}
              </div>
              <div className="amt">
                <b>{rs(d?.reject ? 0 : d?.amount ?? eligibleOf(l.id))}</b>
                {d?.reject || (d?.amount !== undefined && d.amount !== eligibleOf(l.id))
                  ? <s>{rs(eligibleOf(l.id))}</s>
                  : <span className="small muted">eligible</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* The legs behind the claim, each with its evidence a tap away. */}
      {detail.legs?.length ? (
        <div className="card pad0">
          <div className="day"><span>Legs on this trip</span><span>{detail.legs.length}</span></div>
          {detail.legs.map(l => (
            <button key={l.id} type="button" className="li click" onClick={() => setEvidence(l.id)}>
              <span className="ico"><TeIcon name="route" /></span>
              <div className="grow">
                <div className="b">Leg {l.n}</div>
                <div className="small muted">
                  {l.mode} · {l.payKm ?? l.plannedKm} km{l.gps === 'checkin' ? ' · check-ins' : ''}
                  {l.stats?.gaps ? ` · ${l.stats.gaps} gap${l.stats.gaps === 1 ? '' : 's'}` : ''}
                  {l.manual ? ' · added without GPS' : ''}
                </div>
              </div>
              <span className="nr-go">Evidence<TeIcon name="go" size="sm" /></span>
            </button>
          ))}
        </div>
      ) : null}

      {mayAct ? (
        <div className="card">
          <div className="ch"><h3>Your decision</h3></div>
          <div className="seg" role="group" aria-label="Decision">
            <button type="button" aria-pressed={action === 'approve'} onClick={() => { setAction('approve'); setTried(false) }}>Approve</button>
            <button type="button" aria-pressed={action === 'sendback'} onClick={() => { setAction('sendback'); setTried(false) }}>Send back</button>
            <button type="button" aria-pressed={action === 'reject'} onClick={() => { setAction('reject'); setTried(false) }}>Reject</button>
          </div>

          <label className="fld">
            <span>{action === 'approve' ? 'Comment, if any' : 'What the employee needs to know'}</span>
            <textarea value={draft.comment} onChange={e => setDraft(d => ({ ...d, comment: e.target.value }))} />
          </label>

          <dl className="kv">
            <dt>Claimed</dt><dd>{rs(c.claimed)}</dd>
            <dt>Eligible under policy</dt><dd>{rs(lines.reduce((a, l) => a + l.eligible, 0))}</dd>
            {sums.cut ? <><dt>Cut by you</dt><dd>{rs(-sums.cut)}</dd></> : null}
            {sums.rejected ? <><dt>Refused by you</dt><dd>{rs(-sums.rejected)}</dd></> : null}
            <dt className="tot">{action === 'approve' ? 'Will be approved' : 'Would be approved'}</dt>
            <dd className="tot">{rs(action === 'reject' ? 0 : sums.total)}</dd>
          </dl>

          {/* Said before the click, not after. */}
          <div className="note"><TeIcon name="info" size="sm" /><span>{describeDecision(action, draft, lines)}</span></div>

          {tried && blocked ? <div className="ferr"><TeIcon name="alert" size="sm" />{blocked}</div> : null}
          {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

          <button
            type="button"
            className={action === 'reject' ? 'btn dan lg wide' : 'btn pri lg wide'}
            disabled={busy}
            onClick={send}
          >
            {busy ? 'Sending…' : action === 'approve' ? 'Approve the claim' : action === 'sendback' ? 'Send it back' : 'Reject the claim'}
          </button>
        </div>
      ) : null}

      {detail.timeline?.length ? (
        <div className="card">
          <div className="ch"><h3>History</h3></div>
          <div className="stack sm">
            {detail.timeline.filter(e => !e.internal).map((e, i) => (
              <div key={i} className="row tight">
                <span className="grow"><b className="small">{e.text}</b><div className="small muted">{e.name ?? 'System'}</div></span>
                <span className="small muted">{when(e.at)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
