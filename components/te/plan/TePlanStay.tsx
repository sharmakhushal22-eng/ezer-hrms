'use client'
// components/te/plan/TePlanStay.tsx — "do you need a stay?" and "will you spend
// on food?", asked while planning.
//
// THE TWO QUESTIONS ARE SHAPED DIFFERENTLY ON PURPOSE.
//
// A STAY can be planned, so it is asked properly. Yes opens three rows and the
// employee names hotels they would be happy with — a name, where it is, and
// the page they found it on. Three, because one suggestion is really a demand
// and the desk needs room to find a rate. Fewer than three is allowed: a trip
// should not be held up because somebody could only find two they liked, and
// the approver is told how many were given.
//
// FOOD cannot be planned, so it is not asked for. Nobody knows on Monday where
// they will eat on Thursday, and a number typed now would be invented. Saying
// yes shows the budget the company has ALREADY set for this trip — the per-day
// food limit for the employee's grade and the city they are in, summed over
// the days, which an admin edits under Policy as "Food a day". Then the real
// bills arrive during the trip and come off it. There is nothing here for the
// employee to fill in, and that is the point.
//
// NOTHING HERE DECIDES MONEY. The trip's hotel estimate stays what the engine
// computed from the grade and city limits; the prices typed against the three
// hotels are there for the desk and the approver to read, not to re-price the
// trip. Saying no to a stay does remove the hotel line, because then there is
// no stay to pay for.
import type { PlannerDraft } from '@/lib/te/trip-draft'
import { badUrl, platformOf, stayOptionsNote, STAY_OPTIONS_WANTED } from '@/lib/te/trip-stay'
import { rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'

export default function TePlanStay({ draft, foodBudget, nights, edit }: {
  draft: PlannerDraft
  /** The trip's meals estimate: the budget, already computed. */
  foodBudget: number
  /** Nights away, for the hint under the stay question. */
  nights: number
  edit: (patch: Partial<PlannerDraft>) => void
}) {
  const note = draft.stayWanted ? stayOptionsNote(draft.stayOptions) : null

  const setOption = (i: number, patch: Partial<PlannerDraft['stayOptions'][number]>) =>
    edit({ stayOptions: draft.stayOptions.map((o, j) => (j === i ? { ...o, ...patch } : o)) })

  /** Both questions answered, so the step can confirm it is finished rather
   *  than leaving somebody wondering whether they missed something. */
  const answered = draft.stayWanted !== undefined && draft.foodWanted !== undefined

  return (
    <div className="stack">
      {/* THIS IS A WHOLE STEP NOW, not the block it used to be in the middle of
          Review. So it opens by saying what the step is for — a step that
          starts straight in on a Yes/No reads like a question with no
          subject. */}
      <div className="sec">
        <h4>Stay and food</h4>
        <p className="small muted">
          Two questions, and neither commits you to anything: the hotel is picked and booked
          by the Travel Desk, and the food budget is only spent against bills you add while
          the trip is on.
        </p>
      </div>

      {/* ── the stay ── */}
      <div className="card flat tint">
        <div className="ch">
          <h3>Do you need a place to stay?</h3>
          {nights > 0 ? <span className="chip plain">{nights === 1 ? '1 night away' : `${nights} nights away`}</span> : null}
        </div>

        {/* CHOICE CARDS, NOT A YES/NO TOGGLE. A bare Yes/No makes the reader
            carry what each answer means; saying it on the card is the whole
            difference between a form and a question somebody can answer. */}
        <div className="qcards" role="group" aria-label="Do you need a stay">
          <button type="button" className="qcard" aria-pressed={draft.stayWanted === true} onClick={() => edit({ stayWanted: true })}>
            <TeIcon name="home" />
            <span><b>Yes, I need a hotel</b><small>Name a few and the desk books one</small></span>
          </button>
          <button type="button" className="qcard" aria-pressed={draft.stayWanted === false} onClick={() => edit({ stayWanted: false })}>
            <TeIcon name="close" />
            <span><b>No stay needed</b><small>Back the same day, or staying privately</small></span>
          </button>
        </div>

        {draft.stayWanted === false ? (
          <p className="small muted">No hotel on this trip, so none is estimated for it.</p>
        ) : null}

        {draft.stayWanted ? (
          <>
            <p className="small muted">
              Name {STAY_OPTIONS_WANTED} hotels you would be happy with and paste the page you found each on.
              The Travel Desk picks one and books it.
            </p>

            {/* Three abreast where there is room. They are alternatives to each
                other, and stacking them made the reader scroll to compare two
                things that differ by one line. */}
            <div className="hgrid">
              {draft.stayOptions.map((o, i) => {
                const site = platformOf(o.url)
                return (
                  <div key={i} className={`hcard ${i === 0 ? 'first' : ''}`}>
                    <div className="hc-h">
                      <span className="hc-n">{i + 1}</span>
                      <b>{i === 0 ? 'Your first choice' : `Hotel ${i + 1}`}</b>
                      {site ? <span className="chip plain">{site}</span> : null}
                    </div>
                    <div className="form">
                      <label className="fld"><span>Hotel</span>
                        <input value={o.name} placeholder="The name of the hotel"
                          onChange={e => setOption(i, { name: e.target.value })} />
                      </label>
                      <label className="fld"><span>Where it is</span>
                        <input value={o.location} placeholder="Area, or near what"
                          onChange={e => setOption(i, { location: e.target.value })} />
                      </label>
                      <label className="fld full"><span>Link</span>
                        <input value={o.url} placeholder="https://www.makemytrip.com/hotels/…"
                          onChange={e => setOption(i, { url: e.target.value })} />
                        {badUrl(o.url)
                          ? <small className="bad">That does not look like a web address. Paste the whole link, starting with https://</small>
                          : <small>Any booking site. The desk and your approver can open it.</small>}
                      </label>
                      <label className="fld"><span>A night, roughly (₹)</span>
                        <input type="number" min={0} value={o.price ?? ''}
                          onChange={e => setOption(i, { price: e.target.value === '' ? '' : Number(e.target.value) })} />
                        <small>Optional. For the desk to compare; it does not change the trip estimate.</small>
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>

            {note ? (
              <div className={note.warn ? 'note warn' : 'note'}>
                <TeIcon name={note.warn ? 'warn' : 'check'} size="sm" />
                <span>{note.text}</span>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {answered ? (
        <div className="flag ok">
          <TeIcon name="check" />
          <div className="tx">
            <b>Both answered</b>
            <p>
              {draft.stayWanted
                ? 'The Travel Desk sees your hotels once the plan is approved, picks one and books it.'
                : 'No hotel on this trip.'}
              {draft.foodWanted ? ' Food is claimed against bills you add while the trip is on.' : ' No food budget on this trip.'}
            </p>
          </div>
        </div>
      ) : null}

      {/* ── food ── */}
      <div className="card flat tint">
        <div className="ch"><h3>Will you spend on food?</h3></div>

        <div className="qcards" role="group" aria-label="Will you spend on food">
          <button type="button" className="qcard" aria-pressed={draft.foodWanted === true} onClick={() => edit({ foodWanted: true })}>
            <TeIcon name="receipt" />
            <span><b>Yes, I will</b><small>Add each bill while the trip is on</small></span>
          </button>
          <button type="button" className="qcard" aria-pressed={draft.foodWanted === false} onClick={() => edit({ foodWanted: false })}>
            <TeIcon name="close" />
            <span><b>No food bills</b><small>Meals are covered, or none expected</small></span>
          </button>
        </div>

        {draft.foodWanted ? (
          foodBudget > 0 ? (
            // The budget is the answer to the question, so it is shown as a
            // figure rather than buried mid-sentence in a note.
            <div className="card flat">
              <div className="bigmoney">
                <b>{rs(foodBudget)}</b>
                <span>set aside for food on this trip</span>
              </div>
              <p className="small muted">
                Your company&rsquo;s daily food limit for your grade, for each day you are away. There is nothing to
                fill in now — add each food and drink bill while you are travelling, with a remark, and it comes off
                this budget as you go.
              </p>
            </div>
          ) : (
            <div className="note">
              <TeIcon name="info" size="sm" />
              <span>
                No food budget applies to this trip yet. It is worked out from your company&rsquo;s daily food limit
                once the dates and places are set.
              </span>
            </div>
          )
        ) : null}

        {draft.foodWanted === false ? (
          <p className="small muted">No food bills expected. You can still add one later if that changes.</p>
        ) : null}
      </div>
    </div>
  )
}
