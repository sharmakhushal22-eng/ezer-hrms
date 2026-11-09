'use client'
// components/te/report/TeDashboard.tsx — tab 1 of three: Reports and Dashboard.
//
// WHO SEES IT: everybody. There is no role on this screen and no permission
// guarding the route behind it. What a person sees is decided by the data —
// somebody who has never approved anything gets an empty scorecard, somebody
// with no reports gets no team block — which is why it can be offered to the
// whole company without a single `if (isManager)`.
//
// FOUR QUESTIONS, ONE READ. te_dashboard answers all of them in one call
// because they are drawn on one screen and share one date window:
//     where have my own requests reached, and who is sitting on them
//     how many decisions came to me, and what did I do with them
//     which ones, for whom, and to where
//     what are my team asking for  (READ ONLY — tracking, never authority)
//
// NOTHING HERE IS A BUTTON. There is not one action on this screen. A manager
// who wants to decide something opens Approvals, where the server re-checks
// that it is theirs to decide. A tracking screen that also approved things
// would be two screens wearing one coat, and the quieter half would be the
// one people mistook for authority.
//
// WHAT IS DELIBERATELY ABSENT: a colleague's net payout. The team rows carry
// what was asked and how far it got — claimed, approved, status, where, when.
// What somebody was finally paid, once their own advance was settled against
// it, is between them and Finance. te_dashboard does not even select it, so
// it cannot leak through this file by accident.
import { type KeyboardEvent, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeDashboard as TeDashboardData } from '@/lib/te/types'
import {
  claimAmount, dashboardEmpty, decisionOf, holder, monthAround, rangeLabel, scoreTiles, teamNote,
} from '@/lib/te/dashboard'
import { day, errorText, rs, when } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const SCOPE_ICON: Record<string, string> = { local: 'local', domestic: 'domestic', international: 'international' }

export default function TeDashboard({ onOpenTrip }: {
  /** Open the trip behind a row. Every row here already carried the trip id and
   *  none of them was clickable, so the dashboard could show somebody their
   *  trips and not let them look at one. */
  onOpenTrip?: (tripId: string) => void
} = {}) {
  const [data, setData] = useState<TeDashboardData | null>(null)
  const [error, setError] = useState('')
  /** null = "whatever month the company is in", which is what the function
   *  picks when it is asked for nothing. Only once somebody touches the filter
   *  does the screen start naming dates, and the server stops choosing. */
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [custom, setCustom] = useState(false)

  // The previous month stays on screen while the next one loads, rather than
  // being blanked. Two reasons, and the second is the one that matters: a
  // month stepper that empties the page on every click is unusable, and
  // clearing it here would mean calling setState in an effect body — the one
  // lint rule every screen in this module is held to. Staleness is derived
  // below instead, from the dates the answer came back with.
  useEffect(() => {
    let current = true
    te.dashboard(range ? { from: range.from, to: range.to } : undefined)
      .then(d => { if (current) { setData(d); setError('') } })
      .catch(e => { if (current) { setData(null); setError(errorText(e)) } })
    return () => { current = false }
  }, [range])

  // The server decides the window when the filter has not been touched, so the
  // dates to step from are the ones it answered with, not ones invented here.
  const from = range?.from ?? data?.from ?? ''
  const to = range?.to ?? data?.to ?? ''
  const label = rangeLabel(from, to)
  /** The answer on screen is for a different window than the one asked for,
   *  so the numbers under it belong to the month before this click. Said out
   *  loud for the second it lasts; silently showing April's figures under a
   *  heading that says May would be the worse failure. */
  const stale = !!range && !!data && (data.from !== range.from || data.to !== range.to)
  const step = (delta: -1 | 1) => {
    const m = monthAround(from, delta)
    if (m) setRange(m)
  }

  return (
    <>
      <div className="ph">
        <div>
          <h1>Reports and dashboard</h1>
          <p>Where your requests have reached, what came to you to decide, and what your team is asking for.</p>
        </div>
        <div className="row tight">
          <div className="datechip">
            <button type="button" className="iconbtn" onClick={() => step(-1)} aria-label="The month before" disabled={!from}>
              <TeIcon name="back" size="sm" />
            </button>
            <span>{label.text}</span>
            <button type="button" className="iconbtn" onClick={() => step(1)} aria-label="The month after" disabled={!from}>
              <TeIcon name="go" size="sm" />
            </button>
          </div>
          <button type="button" className="btn sm" aria-pressed={custom} onClick={() => setCustom(c => !c)}>
            <TeIcon name="cal" size="sm" />Pick dates
          </button>
        </div>
      </div>

      {custom ? (
        <div className="card flat">
          <div className="form">
            <label className="fld">
              <span>From</span>
              <input type="date" value={from} onChange={e => e.target.value && setRange({ from: e.target.value, to })} />
            </label>
            <label className="fld">
              <span>To</span>
              <input type="date" value={to} onChange={e => e.target.value && setRange({ from, to: e.target.value })} />
            </label>
          </div>
          <p className="small muted">
            The dates apply to two things: when you decided something, and when your team asked for it.
            Your own trips and claims are always listed whatever the dates say, and so is what is still
            waiting on you — those are true now, not in a month you have scrolled to.
          </p>
        </div>
      ) : null}

      {error ? <div className="flag crit" role="alert"><TeIcon name="warn" /><div className="tx"><b>{error}</b></div></div> : null}
      {!data && !error ? <div className="empty"><b>Loading</b>Reading your trips, your decisions and your team.</div> : null}
      {stale ? <p className="small muted" aria-live="polite">Loading {label.text} — the figures below are still the window before it.</p> : null}

      {data ? (
        <>
          {dashboardEmpty(data) ? (
            <div className="empty">
              <b>Nothing in {label.text.toLowerCase()}</b>
              You have raised nothing and decided nothing in this window. Step back a month, or pick dates.
            </div>
          ) : null}

          {/* ── the scorecard ── */}
          {data.score.cameToMe || data.score.waiting ? (
            <div className="g6 five">
              {scoreTiles(data.score).map(t => (
                <div key={t.k} className="tile">
                  <div className="l">{t.l}</div>
                  <div className="v num">{t.v}</div>
                  <div className="s">{t.sub}</div>
                </div>
              ))}
            </div>
          ) : null}

          {/* ── what I decided, for whom, to where ── */}
          {data.acted.length ? (
            <div className="card pad0">
              <div className="day"><span>What you decided</span><span>{data.acted.length}</span></div>
              {data.acted.map(a => {
                const dec = decisionOf(a.status)
                return (
                  <div key={`${a.kind}-${a.id}-${a.actedAt ?? ''}`} className="li">
                    <span className="ico-b sm"><TeIcon name={a.kind === 'trip' ? 'route' : 'claims'} size="sm" /></span>
                    <div className="grow">
                      <div className="b">{a.what} · {a.who}</div>
                      <div className="small muted">
                        {a.no}
                        {a.where ? ` · ${a.where}` : ''}
                        {a.role ? ` · as ${a.role}` : ''}
                        {a.actedAt ? ` · ${when(a.actedAt)}` : ''}
                        {a.comment ? ` · “${a.comment}”` : ''}
                      </div>
                    </div>
                    <span className="amt"><b>{rs(a.amount)}</b></span>
                    <span className={`chip ${dec.tone}`}>{dec.label}</span>
                  </div>
                )
              })}
            </div>
          ) : null}

          {/* ── my own requests ── */}
          {data.mine.trips.length ? (
            <div className="card pad0">
              <div className="day"><span>Your trips</span><span>{data.mine.trips.length}</span></div>
              {data.mine.trips.map(t => (
                <div key={t.id} className={`li${onOpenTrip ? ' click' : ''}`}
                  {...(onOpenTrip ? {
                    role: 'button', tabIndex: 0,
                    onClick: () => onOpenTrip(t.id),
                    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenTrip(t.id) } },
                  } : {})}>
                  <span className="ico-b sm"><TeIcon name={SCOPE_ICON[t.scope] ?? 'route'} size="sm" /></span>
                  <div className="grow">
                    <div className="b">{t.name || t.no}</div>
                    <div className="small muted">
                      {t.no}
                      {t.to ? ` · ${t.to}` : ''}
                      {t.start ? ` · ${day(t.start)}` : ''}
                      {/* Only while a step is actually open. A closed trip
                          sitting "with nobody" reads like something went wrong. */}
                      {t.withWhom ? ` · ${holder(t.withWhom)}` : ''}
                    </div>
                  </div>
                  <span className="amt"><b>{rs(t.estimate)}</b></span>
                  <span className="chip plain">{t.display}</span>
                </div>
              ))}
            </div>
          ) : null}

          {data.mine.claims.length ? (
            <div className="card pad0">
              <div className="day"><span>Your claims</span><span>{data.mine.claims.length}</span></div>
              {data.mine.claims.map(c => {
                const m = claimAmount(c)
                return (
                  <div key={c.id} className="li">
                    <span className="ico-b sm"><TeIcon name="claims" size="sm" /></span>
                    <div className="grow">
                      <div className="b">{c.no}</div>
                      <div className="small muted">
                        {m.label} {rs(m.amount)}
                        {c.submitted ? ` · sent ${when(c.submitted)}` : ' · not sent yet'}
                        {c.net !== null ? ` · paid ${rs(c.net)}` : ` · ${holder(c.withWhom)}`}
                      </div>
                    </div>
                    <span className="chip plain">{c.stage}</span>
                  </div>
                )
              })}
            </div>
          ) : null}

          {/* ── my team, read only ──
              Only drawn for somebody who actually has reports. For everyone
              else the block does not exist, rather than existing and being
              empty: an empty "Your team" card on a junior's screen is a
              promise about the product that is not true for them. */}
          {data.team.people ? (
            <div className="card pad0">
              <div className="day">
                <span>Your team</span>
                <span>{data.team.trips.length + data.team.claims.length}</span>
              </div>
              <div className="li">
                <div className="grow"><div className="small muted">{teamNote(data.team)}</div></div>
              </div>
              {data.team.trips.map(t => (
                <div key={t.id} className="li">
                  <span className="ico-b sm"><TeIcon name={SCOPE_ICON[t.scope] ?? 'route'} size="sm" /></span>
                  <div className="grow">
                    <div className="b">{t.who} · {t.name || t.no}</div>
                    <div className="small muted">
                      {t.no}
                      {t.to ? ` · ${t.to}` : ''}
                      {t.start ? ` · ${day(t.start)}` : ''}
                      {` · ${holder(t.withWhom)}`}
                    </div>
                  </div>
                  <span className="amt"><b>{rs(t.estimate)}</b></span>
                  <span className="chip plain">{t.display}</span>
                </div>
              ))}
              {data.team.claims.map(c => {
                const m = claimAmount(c)
                return (
                  <div key={c.id} className="li">
                    <span className="ico-b sm"><TeIcon name="claims" size="sm" /></span>
                    <div className="grow">
                      <div className="b">{c.who} · {c.no}</div>
                      <div className="small muted">
                        {m.label} {rs(m.amount)}
                        {c.submitted ? ` · sent ${when(c.submitted)}` : ''}
                        {` · ${holder(c.withWhom)}`}
                      </div>
                    </div>
                    <span className="chip plain">{c.stage}</span>
                  </div>
                )
              })}
              {!data.team.trips.length && !data.team.claims.length ? (
                <div className="empty"><b>Nothing in this window</b>Your team raised nothing between these dates.</div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )
}
