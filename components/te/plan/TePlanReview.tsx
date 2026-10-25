'use client'
// components/te/plan/TePlanReview.tsx — step 3: the legs, the money, who approves.
// Screens 17, 23, 28, 36, 38.
//
// NOTHING ON THIS SCREEN IS CALCULATED HERE. The legs, the per-leg estimate, the
// grade limits, every line of the money breakdown, the approval chain and
// whether approval is needed at all come back from te.tripPreview. This file
// chooses the words and the order.
import type { Snapshot, TripIssue, TripPreview } from '@/lib/te/types'
import { blockingOn, errorFor, LAST_STEP, visibleSteps, type PlanStep, type PlannerDraft } from '@/lib/te/trip-draft'
import { day, dayAt, plural, rs } from '@/lib/te/format'
import type { MapPlace } from '@/lib/te/trip-map'
import { nightsBetween, STAY_OPTIONS_WANTED, usableStayOptions } from '@/lib/te/trip-stay'
import { needsExplanation, whyLabel, whyProblem } from '@/lib/te/other-reason'
import TeIcon from '../TeIcon'
import TeTripMap from './TeTripMap'
import TeMapLinks from './TeMapLinks'

const MODE_ICON: Record<string, string> = {
  own: 'car', company: 'car', cab: 'car', auto: 'car', rental: 'car',
  public: 'bus', bus: 'bus', train: 'train', flight: 'plane',
}
const LEG_KIND: Record<string, string> = {
  first: 'to the airport or station',
  last: 'from the airport or station',
  extra: 'added during the trip',
}
/** Why GPS was not used, for a local trip recorded afterwards. */
const NO_GPS = ['Forgot to start the travel', 'Phone battery was low', 'No network or GPS signal', 'The app did not work', 'Other']
/** Why there was no approval before a longer trip. */
const NO_APPROVAL = ['Urgent client call', 'Verbal approval by my manager', 'Same-day travel', 'Other']

const STEP_NAME = ['Trip', 'Route', 'Commute', 'Stay', 'Review']

export default function TePlanReview({ snap, draft, issues, preview, edit, onGoStep }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  preview: TripPreview | null
  edit: (patch: Partial<PlannerDraft>) => void
  onGoStep: (n: PlanStep) => void
}) {
  const local = draft.scope === 'local'
  const planning = draft.origin !== 'POST_FACTO'
  const err = (k: string) => errorFor(issues, k, draft.tried)
  const legs = preview?.legs ?? []
  const ent = preview?.entitlements ?? null

  const places = new Map<string, MapPlace>(
    snap.masters.places.map(p => [p.id, { id: p.id, s: p.s, lat: p.lat, lng: p.lng }]),
  )
  const start = draft.points[0]?.leave ? draft.points[0] : null
  const back = draft.points.find(p => p.ret && p.arrive) ?? null
  const usable = usableStayOptions(draft.stayOptions)
  const nights = nightsBetween(preview?.start ?? null, preview?.end ?? null)
  const blocking = issues.filter(i => i.block)
  const warnings = issues.filter(i => !i.block)

  return (
    <>
      {/* WHEN, said once at the top. The times are collected on step 2 and
          nothing computes on them, so Review is where they have to be visible
          — otherwise an approver would never see the 6am they were told. */}
      {start ? (
        <div className="card flat tint">
          <div className="ch">
            <h3>When</h3>
            <button type="button" className="link small" onClick={() => onGoStep(2)}>Change</button>
          </div>
          <dl className="kv">
            <dt>Leaving</dt><dd>{dayAt(start.leave, start.leaveAt)}</dd>
            {back ? <><dt>Back at the start</dt><dd>{dayAt(back.arrive, back.arriveAt)}</dd></> : null}
          </dl>
          {!start.leaveAt || (back && !back.arriveAt) ? (
            <p className="small muted">No time was given for part of this, which is fine — the dates are what the plan is approved on.</p>
          ) : null}
        </div>
      ) : null}

      <div className="sec">
        <h4>Journeys</h4>
        <p className="small muted">Each journey is tracked and paid on its own: GPS on the road, check-ins at airports and abroad.</p>
        {legs.length ? (
          <>
            <TeTripMap
              legs={legs.map(l => ({ from: l.from, to: l.to, mode: l.mode }))}
              points={draft.points.map(p => p.place).filter(Boolean)}
              places={places}
              label={`Map of ${draft.name || 'the trip'}`}
            />
            <TeMapLinks
              points={draft.points.map(p => places.get(p.place))}
              scope={draft.scope}
              label={draft.name || 'the trip'}
            />
            <div className="tw-legs">
              {legs.map(l => (
                <div key={l.n} className="row tight tw-leg">
                  <span className="ln">{l.n}</span>
                  <span className="ico-b sm"><TeIcon name={MODE_ICON[l.mode] ?? 'route'} size="sm" /></span>
                  <div className="grow">
                    <b className="small">{l.fromPlace?.s ?? '—'} → {l.toPlace?.s ?? '—'}</b>
                    <div className="small muted">
                      {local ? '' : `${day(l.date)} · `}
                      {snap.cfg.modes.find(m => m.id === l.mode)?.name ?? l.mode}
                      {l.bookedBy === 'desk' ? ', Travel Desk' : ''}
                      {` · ${l.km} km`}
                      {l.mode === 'flight' ? ' by air' : ''}
                      {` · ${l.gps === 'checkin' ? 'check-ins' : 'GPS'}`}
                      {LEG_KIND[l.kind] ? ` · ${LEG_KIND[l.kind]}` : ''}
                    </div>
                  </div>
                  <span className="small num">{l.estimate ? rs(l.estimate) : '—'}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty"><b>Choose the places</b>The journeys appear here, with how each one is tracked.</div>
        )}
      </div>

      <div className="sec">
        {/* The heading names what is actually under it. On a trip with no stay
            there is no stay block, and a heading promising one reads as a
            section that failed to load. */}
        <h4>{!planning ? 'Why it was not tracked' : draft.stayWanted === true ? 'Stay, money and approval' : 'Money and approval'}</h4>

        {!planning ? (
          <>
            <div className="form">
              <label className="fld">
                <span>{local ? 'Why was GPS not used?' : 'Why was there no prior approval?'}</span>
                <select value={draft.pfReason} onChange={e => edit({ pfReason: e.target.value })}>
                  <option value="">Choose a reason</option>
                  {(local ? NO_GPS : NO_APPROVAL).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              {/* REQUIRED WHEN THE REASON IS OTHER, and a textarea rather than
                  a one-line input then, because a reason that was not on the
                  list takes a sentence. Otherwise it stays the optional
                  evidence field it has always been.

                  This used to be a permanently visible optional input whose
                  placeholder read "Needed for Other" — which nobody who had
                  already picked a listed reason ever read, and which did not
                  stop an unexplained Other being submitted. */}
              {needsExplanation(draft.pfReason) ? (
                <label className="fld full">
                  <span>{whyLabel(local ? 'gps' : 'approval').label}</span>
                  <textarea
                    autoFocus
                    value={draft.pfNote}
                    placeholder={local ? 'The tracking screen would not open on my phone' : 'The client moved the meeting to the next morning'}
                    onChange={e => edit({ pfNote: e.target.value })}
                  />
                  <small>{whyLabel(local ? 'gps' : 'approval').hint}</small>
                </label>
              ) : (
                <label className="fld">
                  <span>{local ? 'What happened' : 'Evidence, if any'}</span>
                  <input
                    value={draft.pfNote}
                    placeholder={local ? 'Optional' : 'Meeting invite, e-mail from the client'}
                    onChange={e => edit({ pfNote: e.target.value })}
                  />
                </label>
              )}
            </div>
            {err('pf') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('pf')}</div> : null}
            {draft.tried && whyProblem(draft.pfReason, draft.pfNote)
              ? <div className="ferr"><TeIcon name="warn" size="sm" />{whyProblem(draft.pfReason, draft.pfNote)}</div>
              : null}
          </>
        ) : null}

        {/* THE STAY IS ASKED FOR ON STEP 4 NOW, not here. It used to be a
            block in the middle of Review, which is the one screen somebody
            arrives at expecting to read rather than to answer — so the hotel
            question was the easiest thing in the planner to miss. What is
            left here is what was decided, read-only, with a way back. */}
        {/* GONE, not answered with "Not needed". Saying no on step 1 took the
            Stay step away; leaving its summary here to report two blanks puts
            the question back in front of somebody who has already closed it,
            and the Change button would point at a step that is not there. */}
        {planning && draft.stayWanted === true ? (
          <div className="card flat tint">
            <div className="ch">
              <h3>Stay and food</h3>
              <button type="button" className="link small" onClick={() => onGoStep(4)}>Change</button>
            </div>
            <dl className="kv">
              <dt>Hotel</dt>
              <dd>
                {draft.stayWanted
                  ? `${usable.length} of ${STAY_OPTIONS_WANTED} hotels named${nights ? `, ${plural(nights, 'night')}` : ''}`
                  : 'Not needed on this trip'}
              </dd>
              {draft.stayWanted ? (
                <>
                  <dt>Booked by</dt>
                  <dd>{draft.stayBy === 'desk' ? 'The Travel Desk, company pays' : 'Me, I claim it later'}</dd>
                </>
              ) : null}
              <dt>Food</dt>
              <dd>
                {draft.foodWanted
                  ? `Yes — budget ${rs(preview?.estimate.meals ?? 0)}, claimed against bills on the trip`
                  : 'Not needed on this trip'}
              </dd>
            </dl>
            {draft.stayWanted && usable.length < STAY_OPTIONS_WANTED ? (
              <p className="small muted">
                The Travel Desk picks from the hotels you named. Fewer than {STAY_OPTIONS_WANTED} gives them less to choose from.
              </p>
            ) : null}
          </div>
        ) : null}

        {planning ? (
          <>
            <div className="form">
              {/* Who books it only matters once there is something to book. */}
              {draft.stayWanted ? (
                <label className="fld">
                  <span>Hotel booked by</span>
                  <select value={draft.stayBy} onChange={e => edit({ stayBy: e.target.value === 'desk' ? 'desk' : 'self' })}>
                    <option value="self">Me, I claim it later</option>
                    <option value="desk">Travel Desk, company pays</option>
                  </select>
                </label>
              ) : null}
              {!local ? (
                <label className="fld">
                  <span>Advance needed (₹)</span>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={draft.advance}
                    onChange={e => edit({ advance: e.target.value === '' ? '' : Number(e.target.value) })}
                  />
                  <small>Leave empty if you do not need one.</small>
                </label>
              ) : null}
            </div>
            {err('adv') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('adv')}</div> : null}
          </>
        ) : null}

        <div className="stack">
          {ent && !local ? (
            <div className="card flat tint">
              <div className="ch">
                <h3>Your limits on this trip</h3>
                <span className="chip plain t-brand">Grade {ent.grade}</span>
              </div>
              <div className="tw">
                <table className="tbl sm">
                  <thead>
                    <tr><th>City</th><th className="r">Hotel a night</th><th className="r">Food a day</th><th className="r">Local a day</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><b>{preview?.to || '—'}</b> <span className="small muted">{ent.tier}</span></td>
                      <td className="r">{rs(ent.hotel)}</td>
                      <td className="r">{rs(ent.meals)}</td>
                      <td className="r">{rs(ent.conv)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {preview && planning ? (
            <dl className="kv">
              <Money label="Travel you pay" value={preview.estimate.travel} />
              <Money label="Tickets the Travel Desk books" value={preview.estimate.desk} />
              <Money label="Hotel" value={preview.estimate.hotel} />
              <Money label="Food" value={preview.estimate.meals} />
              <Money label="Local rides at the destination" value={preview.estimate.conv} />
              <dt className="tot">Total estimate, your share</dt><dd className="tot">{rs(preview.estimateTotal)}</dd>
              {!local ? (
                <>
                  <dt>Paid by you, reimbursed later</dt><dd>{rs(preview.selfEstimate)}</dd>
                  <dt>Advance you can ask</dt><dd>up to {rs(preview.advanceCap)}</dd>
                </>
              ) : null}
            </dl>
          ) : null}

          {draft.pax > 1 ? (
            <p className="small muted">{draft.pax} people travel. Each person claims their own expenses against their own limits.</p>
          ) : null}

          {blocking.length ? (
            <div className={draft.tried ? 'flag crit' : 'flag info'}>
              <TeIcon name="claims" />
              <div className="tx">
                <b>{draft.tried ? `${plural(blocking.length, 'thing')} to fix` : 'Still to fill'}</b>
                {/* The steps this plan actually has. Nothing routes a blocker
                    to step 4 today, so this changes nothing yet — but a list
                    that offers "Stay" on a plan with no Stay step is a trap
                    waiting for the first issue that does. */}
                {visibleSteps(draft).filter(n => n !== LAST_STEP).map(n => {
                  const on = blockingOn(issues, n)
                  if (!on.length) return null
                  return (
                    <p key={n}>
                      <button type="button" className="link small" onClick={() => onGoStep(n)}>{STEP_NAME[n - 1]}</button>
                      {`: ${on.map(i => i.t).join(' ')}`}
                    </p>
                  )
                })}
              </div>
            </div>
          ) : null}

          {warnings.map((w, i) => (
            <div key={i} className="flag warn"><TeIcon name="alert" /><div className="tx"><b>{w.t}</b></div></div>
          ))}

          {preview && !blocking.length ? (
            <div className="sunk">
              <div className="small muted">
                {!planning ? 'The trip and its claim go to'
                  : preview.needsApproval ? 'This plan goes to'
                    : 'No approval is needed before you leave'}
              </div>
              {preview.needsApproval || !planning ? (
                <>
                  <div className="row tight">
                    {preview.chain.map((s, i) => (
                      <span key={`${s.role}-${i}`} className="row tight">
                        {i ? <TeIcon name="go" size="sm" /> : null}
                        <span className="av sm">{initials(s.name || s.role)}</span>
                        <span><b>{s.name || s.team || s.role}</b> <span className="muted small">{s.role}</span></span>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="small">
                  Local, {Math.round(legs.reduce((a, l) => a + l.km, 0))} km in all. Start leg 1 on the day.
                  The claim goes to your manager after the last leg.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {draft.answerNeeded ? (
        <div className="sec">
          <h4>For your approver</h4>
          <label className="fld">
            <span>What did you change?</span>
            <textarea value={draft.answer ?? ''} onChange={e => edit({ answer: e.target.value })} />
          </label>
        </div>
      ) : null}
    </>
  )
}

/** A money line, left out entirely when it is nothing. */
function Money({ label, value }: { label: string; value: number }) {
  if (!value) return null
  return <><dt>{label}</dt><dd>{rs(value)}</dd></>
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
