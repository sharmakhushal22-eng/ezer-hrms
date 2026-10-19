'use client'
// components/te/TeContact.tsx — how the desk reaches the traveller.
//
// A travel desk's day is interruptions: a fare moved, a flight was cancelled,
// an airline wants a date of birth before it will ticket. Every one of those
// needs the traveller on the phone now, and the desk was reading a trip number
// and then going to look the person up somewhere else.
//
// THE NUMBERS ARE NOT COPIED ANYWHERE. They are joined onto each desk row from
// the employee record on every request — the same record ESS edits — so a
// number changed in the portal this morning is the number dialled this
// afternoon. Nothing in the travel tables stores a phone number, which means
// there is no second copy to go stale and nothing to keep in step.
//
// REAL LINKS, NOT TEXT. tel: and mailto: are what make this useful on the
// phone a desk person actually carries; on a desktop they hand off to whatever
// the machine is set up with. The number is still readable as text either way.
import type { DeskContact } from '@/lib/te/client'
import TeIcon from './TeIcon'

/** Indian mobiles are stored as ten digits; shown grouped, because a human
 *  reads back "98765 43210" and not "9876543210". Anything that is not ten
 *  digits is shown exactly as stored rather than mangled into a shape it is
 *  not — an overseas number has its own grouping and is not ours to invent. */
export function prettyMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : raw.trim()
}

export default function TeContact({ who }: { who: DeskContact }) {
  // The work address first: this is company travel, and a personal inbox is
  // the fallback for somebody whose work one has not been set up.
  const email = who.office_email || who.personal_email || ''
  const mobile = who.mobile || who.alternate_mobile || ''
  // A record with neither is a gap in ESS, not something to apologise for on
  // this screen. The desk still has the name and the trip.
  if (!email && !mobile) return null

  return (
    <div className="contactline">
      {mobile ? (
        <a className="cx" href={`tel:${mobile.replace(/\s/g, '')}`}>
          <TeIcon name="phone" size="sm" />
          <span>{prettyMobile(mobile)}</span>
          {!who.mobile && who.alternate_mobile ? <span className="small muted">alternate</span> : null}
        </a>
      ) : null}
      {email ? (
        <a className="cx" href={`mailto:${email}`}>
          <TeIcon name="mail" size="sm" />
          <span>{email}</span>
          {!who.office_email && who.personal_email ? <span className="small muted">personal</span> : null}
        </a>
      ) : null}
    </div>
  )
}
