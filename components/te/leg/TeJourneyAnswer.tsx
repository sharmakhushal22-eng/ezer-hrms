'use client'
// components/te/leg/TeJourneyAnswer.tsx — the traveller answers a question a
// desk asked about one of their journeys.
//
// WHY IT IS HERE AND NOT ON A SCREEN OF ITS OWN. A sent-back journey is already
// reported and closed, so it has no recorder screen and no report screen to
// come back to; the only place the traveller naturally looks is the trip. This
// sits on the journey row, where the question can be read beside the journey it
// is about.
//
// IT IS WHY THEIR CLAIM IS WAITING, and that is the one thing it has to say
// plainly. te_claim_submit refuses the claim while any of the traveller's own
// journeys on the trip is sent back; somebody who cannot send a claim and is
// not told which journey is holding it will go looking in the wrong place.
//
// ANSWERING LIFTS THE HOLD, it does not restore the confirmation that was
// withdrawn. The desk asked and has been answered; whether the answer satisfies
// them is theirs to say, by confirming or by asking again. That asymmetry is
// deliberate and the wording below does not pretend otherwise.
import { useState } from 'react'
import { te } from '@/lib/te/client'
import { errorText } from '@/lib/te/format'
import type { TeLegReview } from '@/lib/te/types'
import TeIcon from '../TeIcon'

export default function TeJourneyAnswer({ legId, n, review, onDone }: {
  legId: string
  /** The journey's number on the trip, so the question names what it is about. */
  n: number
  review: TeLegReview
  onDone: (message: string) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!review?.backAt) return null
  const who = review.backDesk === 'finance_team' ? 'Finance' : 'The travel desk'

  async function send() {
    setBusy(true); setError('')
    try {
      await te.legAnswer(legId, text.trim())
      onDone(`Your answer about journey ${n} was sent.`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="jrev-ask">
      <div className="flag crit">
        <TeIcon name="warn" />
        <div className="tx">
          <b>{who} asked about journey {n}</b>
          <p>{review.backWhy}</p>
          <p className="small">Your claim for this trip waits until you answer.</p>
        </div>
      </div>
      <label className="fld full">
        <span>Your answer</span>
        <textarea
          value={text}
          placeholder="The signal dropped in the basement car park, so the route starts at the exit."
          onChange={e => setText(e.target.value)}
        />
        <small>
          {/* Said out loud, because it is the part people get wrong: answering
              unblocks the claim, it does not mean the desk has agreed. */}
          This unblocks your claim. {who.toLowerCase() === 'finance' ? 'Finance' : 'The desk'} will look again and either
          confirm the journey or come back to you.
        </small>
      </label>
      {error ? <div className="flag crit" role="alert"><TeIcon name="warn" size="sm" /><span>{error}</span></div> : null}
      <div className="row tight">
        <button type="button" className="btn pri" disabled={busy || !text.trim()} onClick={send}>
          {busy ? 'Sending…' : 'Send my answer'}
        </button>
      </div>
    </div>
  )
}
