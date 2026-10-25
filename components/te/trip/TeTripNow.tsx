'use client'
// components/te/trip/TeTripNow.tsx — the two things you do while travelling.
//
// THE MOMENT THIS IS DESIGNED FOR. One hand, outdoors, in a hurry: you have
// just paid a cab driver who is waiting, or you are about to cross the city for
// a meeting that moved. Both are seconds-long intentions, and before this they
// were a scroll past the approval chain, the estimate, the ledger and the claim
// card to reach a `btn sm` in a card header.
//
// So the two actions are the first thing on a live trip, at hero size, in the
// module's OWN tile language — the same .kind tiles Home uses to start a trip.
// That is deliberate rather than lazy: somebody who has started a trip has
// already tapped one of those tiles, so the shape already means "this is the
// big choice on this screen". A new bespoke button would have to earn that
// recognition from scratch.
//
// WHY TILES AND NOT A ROW OF BUTTONS. A button is sized for a page you are
// reading. These are the page's purpose while the trip is under way, and they
// are competing with nothing — so they get the 52px icon chip, the 18px title,
// the sentence that says what happens, and a target a thumb cannot miss.
//
// THREE STATES, in order of urgency:
//
//   recording   A journey is being recorded. That strip comes FIRST and takes
//               the primary colour, because a journey that is never ended
//               cannot be claimed — ending it outranks starting anything else.
//   live        The two tiles.
//   scrolled    Once the tiles leave the viewport, a slim bar fades in with the
//               same actions, fixed under the header. You keep access forever
//               without two copies of the same thing on screen at once, which
//               is what a permanently sticky bar would have meant.
//
// The scrolled bar is an IntersectionObserver on a sentinel, and it degrades to
// "always show the bar" where there is no observer, because losing the actions
// entirely is the one outcome worth avoiding.
import { useEffect, useRef, useState } from 'react'
import type { TeLeg, Uuid } from '@/lib/te/types'
import TeIcon from '../TeIcon'

export default function TeTripNow({ runningLeg, canBill, mine, nameOf, onAddBill, onAddLeg, onOpenLeg, tripId }: {
  /** A journey being recorded right now, or null. */
  runningLeg: TeLeg | null
  /** May this reader put a bill on this trip — the owner, or somebody taken
   *  along, whose own bills are their own. */
  canBill: boolean
  /** Is this their trip: only the planner adds journeys to it. */
  mine: boolean
  /** place id → short name, for naming the running journey. */
  nameOf: (id: string) => string
  onAddBill: (tripId: Uuid) => void
  onAddLeg: () => void
  onOpenLeg: (leg: TeLeg) => void
  tripId: Uuid
}) {
  /** Have the tiles scrolled out of view? Starts false so the first paint is
   *  the tiles alone, with no bar flashing over them. */
  const [away, setAway] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      // No observer: show the bar always rather than risk showing it never.
      setAway(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => setAway(!entry.isIntersecting),
      // A little before they are fully gone, so the bar is already there when
      // the tiles leave rather than arriving a beat late.
      { rootMargin: '-72px 0px 0px 0px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (!canBill && !mine) return null

  const bill = canBill ? (
    <button type="button" className="kind k-bill" onClick={() => onAddBill(tripId)}>
      <span className="ki"><TeIcon name="receipt" size="lg" /></span>
      <span className="kt">
        <b>Add a bill</b>
        <small>The hotel, a meal, a cab — anything you paid for on this trip.</small>
      </span>
      <span className="kf"><span className="kg">Paid with this trip</span><TeIcon name="go" size="sm" /></span>
    </button>
  ) : null

  const hop = mine ? (
    <button type="button" className="kind k-hop" onClick={onAddLeg}>
      <span className="ki"><TeIcon name="route" size="lg" /></span>
      <span className="kt">
        <b>Add a journey</b>
        <small>Travelling across the city? GPS records the route and the distance.</small>
      </span>
      <span className="kf"><span className="kg">Starts in two taps</span><TeIcon name="go" size="sm" /></span>
    </button>
  ) : null

  return (
    <>
      {/* ── a journey is being recorded ──
          Sticky on its own, because this one IS urgent enough to follow you
          down the page: an unfinished journey blocks the whole claim. */}
      {runningLeg ? (
        <div className="recnow">
          <span className="rdot" aria-hidden="true"><i /></span>
          <div className="grow">
            <span className="eyebrow">Recording now</span>
            <b>Journey {runningLeg.n}: {nameOf(runningLeg.from)} → {nameOf(runningLeg.to)}</b>
          </div>
          <button type="button" className="btn pri" onClick={() => onOpenLeg(runningLeg)}>
            <TeIcon name="play" size="sm" />Open it
          </button>
        </div>
      ) : null}

      <div className="kinds compact triphero">
        {bill}
        {hop}
      </div>
      {/* The thing the observer watches. Zero height, so it changes nothing. */}
      <div ref={sentinel} className="hero-end" aria-hidden="true" />

      {/* ── the same actions, once the tiles are gone ──
          Fixed rather than sticky so it cannot shift the page as it appears,
          and under the header rather than over the tab bar, which already owns
          the bottom of a phone screen. */}
      {away ? (
        <div className="nowbar" role="toolbar" aria-label="On this trip">
          <span className="nb-what">
            <TeIcon name="pin" size="sm" />
            <b>On this trip</b>
          </span>
          <span className="nb-do">
            {runningLeg ? (
              <button type="button" className="btn pri sm" onClick={() => onOpenLeg(runningLeg)}>
                <TeIcon name="play" size="sm" />Journey {runningLeg.n}
              </button>
            ) : null}
            {canBill ? (
              <button type="button" className={`btn sm${runningLeg ? '' : ' pri'}`} onClick={() => onAddBill(tripId)}>
                <TeIcon name="receipt" size="sm" />Bill
              </button>
            ) : null}
            {mine ? (
              <button type="button" className="btn sm" onClick={onAddLeg}>
                <TeIcon name="route" size="sm" />Journey
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
    </>
  )
}
