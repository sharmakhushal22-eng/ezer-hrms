'use client'
// components/te/trip/TeTripPlan.tsx — the trip exactly as the traveller built it.
//
// WHY THIS EXISTS. Everything on this screen was already in the te.trip(id)
// payload and none of it reached a screen. The trip detail rendered the route
// as place names joined by arrows and never referenced t.segs at all, so the
// preferences added in migrations 171 and 172 — the time of day they want to
// fly, the flight they already found, the remark for the desk, the note on a
// particular stop — were written by the traveller, stored, carried to the desk
// in v_te_to_book, and then shown nowhere a person could read them in context.
// The per-point dates and times from 165, and the stop marks from 170, were in
// the same position.
//
// WHO IT IS FOR. The travel desk, deciding which flight to buy, and Finance,
// checking a bill against what was planned. Neither of them can work from
// "Delhi T3 → Pune, 15 Dec": the question is always "what did they actually
// ask for". So nothing here is gated on being the trip's owner — it is the
// plan, and anybody who can open the trip can read it.
//
// IT RENDERS WHAT IS THERE AND SAYS NOTHING ABOUT WHAT IS NOT. A trip planned
// before these fields existed has no times and no preferences; the point of
// this screen is the detail, so an empty row would be noise. Each piece
// appears only when the traveller filled it in, and the legend at the top
// tells the reader that absence means "not asked for", not "not shown".
import type { TeMasters, TePlaceBrief, TeTrip, TeTripPoint, TeTripSegment } from '@/lib/te/types'
import { hubForCity } from '@/lib/te/commute'
import TeIcon from '../TeIcon'
import TeFileLink from '../TeFileLink'

/** 'HH:MM' as a person reads a clock. Returns '' for a time nobody recorded,
 *  which is not the same as midnight. */
function clock(t?: string): string {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return ''
  const [h, m] = t.split(':')
  const hour = Number(h)
  if (!Number.isFinite(hour)) return ''
  const am = hour < 12 ? 'am' : 'pm'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${m.slice(0, 2)}${am}`
}

/** A date as "15 Dec", or '' when there is none. */
function shortDate(d?: string): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  const dt = new Date(`${d}T00:00:00Z`)
  return `${dt.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()]}`
}

/** "15 Dec, 8:15am", or just whichever half exists. */
const stamp = (d?: string, t?: string): string => [shortDate(d), clock(t)].filter(Boolean).join(', ')

const MILE: Record<string, string> = {
  cab: 'by cab', own: 'in their own vehicle', company: 'in a company vehicle',
  public: 'by public transport', bike: 'by bike', none: 'nothing to claim',
}

export default function TeTripPlan({ trip, places, masters, claimId }: {
  trip: TeTrip
  /** te.trip(id).places — the place objects the ids point at. */
  places: Record<string, TePlaceBrief>
  /** Only to name the hub the company configured, when the traveller did not
   *  choose one. Without it a hub row says "the company's airport" and not
   *  which airport, which is the one thing the desk needs. */
  masters?: TeMasters
  /** Passed to TeFileLink so a stored file on somebody else's trip can be
   *  opened as part of the claim that carries it. */
  claimId?: string
}) {
  const points: TeTripPoint[] = trip.points ?? []
  const segs: TeTripSegment[] = trip.segs ?? []
  if (!points.length) return null

  const name = (id?: string | null): string => (id && places[id]?.s) || ''
  const city = (id?: string | null) => (id ? places[id] : undefined)

  /** The hub for one end of a flight or train: what the traveller chose, else
   *  what the company has configured for that city. Mirrors the engine, which
   *  now prefers the traveller's pick (see hubPick in te-engine.js). */
  function hubOf(chosen: string | undefined, at: string | undefined, mode: string): { label: string; chosen: boolean } | null {
    const kind = mode === 'flight' ? 'air' : mode === 'train' ? 'rail' : null
    if (!kind) return null
    if (chosen) return { label: name(chosen) || 'a place that has since gone', chosen: true }
    if (!masters) return null
    const auto = hubForCity(city(at), kind, masters)
    return auto ? { label: name(auto), chosen: false } : null
  }

  /** Anything the traveller said about this place or this journey. */
  const saidAboutPoint = (p: TeTripPoint) => !!(p.prefNote || p.prefUrl)
  const saidAboutSeg = (s: TeTripSegment) => !!(s.prefTime || s.prefUrl || s.prefNote)
  const anyPreference = points.some(saidAboutPoint) || segs.some(saidAboutSeg)

  return (
    <div className="card">
      <div className="ch">
        <h3><TeIcon name="route" size="sm" />The plan, as they filled it in</h3>
        <span className="small muted">
          {anyPreference ? 'Times and notes are what they asked for' : 'Nothing was asked of the desk'}
        </span>
      </div>

      <ol className="planlist">
        {points.map((p, i) => {
          const seg = segs[i]
          const arrive = stamp(p.arrive, p.arriveAt)
          const leave = stamp(p.leave, p.leaveAt)
          const hubA = seg ? hubOf(seg.xfer?.hubA, p.place, seg.mode) : null
          const hubB = seg ? hubOf(seg.xfer?.hubB, points[i + 1]?.place, seg.mode) : null
          return (
            <li key={`${p.place}-${i}`} className="planstep">
              {/* ── the place ─────────────────────────────────────────── */}
              <div className={`planpt${p.stop ? ' stop' : ''}${p.ret ? ' ret' : ''}`}>
                <span className="pn">{i + 1}</span>
                <div className="grow">
                  <div className="b">
                    {name(p.place) || 'A place that has since been removed'}
                    {p.stop ? <span className="chip plain">Stop on the way</span> : null}
                    {p.ret ? <span className="chip plain">Back to the start</span> : null}
                  </div>
                  {p.what ? <div className="small">{p.what}</div> : null}
                  {/* The itinerary the traveller stated. These are the times
                      the desk books around, so they are shown as given — and
                      left out entirely when nobody gave them. */}
                  {arrive || leave ? (
                    <div className="small muted">
                      {arrive ? <>Arrives {arrive}</> : null}
                      {arrive && leave ? ' · ' : null}
                      {leave ? <>Leaves {leave}</> : null}
                    </div>
                  ) : null}
                  {saidAboutPoint(p) ? (
                    <div className="askrow">
                      <TeIcon name="info" size="sm" />
                      <span>
                        {p.prefNote}
                        {p.prefNote && p.prefUrl ? ' · ' : null}
                        {p.prefUrl ? <TeFileLink path={p.prefUrl} claimId={claimId} name="What they linked" small /> : null}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* ── the journey from here to the next place ────────────── */}
              {seg && points[i + 1] ? (
                <div className="planseg">
                  <span className="pl" aria-hidden="true" />
                  <div className="grow">
                    <div className="small">
                      <b>{seg.mode}</b>
                      {' to '}{name(points[i + 1].place) || 'the next place'}
                      {' · '}
                      {seg.bookedBy === 'desk' ? 'the Travel Desk books it' : 'they book it themselves'}
                    </div>
                    {/* Which airport or station, and whose choice it was. The
                        desk buys a ticket between two specific terminals. */}
                    {hubA || hubB ? (
                      <div className="small muted">
                        {hubA ? <>From {hubA.label}{hubA.chosen ? ' (their choice)' : ''}</> : null}
                        {hubA && hubB ? ' → ' : null}
                        {hubB ? <>{hubB.label}{hubB.chosen ? ' (their choice)' : ''}</> : null}
                      </div>
                    ) : null}
                    {/* How they get to and from the hub: claimable legs, so
                        Finance sees them here beside the bill. */}
                    {seg.xfer?.first || seg.xfer?.last ? (
                      <div className="small muted">
                        {seg.xfer.first ? <>To the {seg.mode === 'flight' ? 'airport' : 'station'} {MILE[seg.xfer.first] ?? seg.xfer.first}</> : null}
                        {seg.xfer.first && seg.xfer.last ? ' · ' : null}
                        {seg.xfer.last ? <>Onward {MILE[seg.xfer.last] ?? seg.xfer.last}</> : null}
                      </div>
                    ) : null}
                    {saidAboutSeg(seg) ? (
                      <div className="askrow">
                        <TeIcon name="clock" size="sm" />
                        <span>
                          <b>Asked for:</b>
                          {seg.prefTime ? ` around ${clock(seg.prefTime) || seg.prefTime}` : ''}
                          {seg.prefNote ? `${seg.prefTime ? '. ' : ' '}${seg.prefNote}` : ''}
                          {seg.prefUrl ? (
                            <>
                              {seg.prefTime || seg.prefNote ? ' · ' : ' '}
                              {/* The traveller typed this. Opened in a new tab,
                                  never prefetched; rel stops the opened page
                                  reaching back through window.opener. */}
                              <a href={seg.prefUrl} target="_blank" rel="noopener noreferrer nofollow">the option they found</a>
                            </>
                          ) : null}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
