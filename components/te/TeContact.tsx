'use client'
// components/te/TeContact.tsx — how the desk reaches the traveller.
//
// A travel desk's day is interruptions: a fare moved, a flight was cancelled,
// an airline wants a date of birth before it will ticket. Every one of those
// needs the traveller on the phone now, and the desk was reading a trip number
// and then going to look the person up somewhere else.
//
// WHAT IT SHOWS IS WHAT THE TRAVELLER WROTE ON THE FORM. This used to read the
// employee record live, which answers "what is on file for this person" and is
// the wrong answer to "how do I reach them about this trip": somebody abroad is
// on a local SIM, somebody whose handset is in for repair is on a colleague's.
// The trip and claim forms ask, prefilled from the ESS record and editable, and
// what the traveller leaves is what arrives here. Nothing is written back to
// ESS, so a hotel number given for one trip has not changed their HR record.
//
// BOTH NUMBERS, NOT ONE AND A FALLBACK. The second number exists for when the
// first cannot be reached, which abroad is most of the time, so hiding it until
// the first is blank defeated the point of asking for it.
//
// A ROW LABELLED "not confirmed" fell back to the ESS record: it is a trip
// saved before the form asked. The number is probably right and is worth
// showing, but the traveller has not said it is the one to use for this trip,
// and the desk should know the difference before it rings.
//
// REAL LINKS, NOT TEXT. tel: and mailto: are what make this useful on the
// phone a desk person actually carries; on a desktop they hand off to whatever
// the machine is set up with. The number is still readable as text either way.
import type { DeskContactDetails } from '@/lib/te/client'
import TeIcon from './TeIcon'

/** Indian mobiles are stored as ten digits; shown grouped, because a human
 *  reads back "98765 43210" and not "9876543210". Anything that is not ten
 *  digits is shown exactly as stored rather than mangled into a shape it is
 *  not — an overseas number has its own grouping and is not ours to invent. */
export function prettyMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : raw.trim()
}

export default function TeContact({ who }: { who: { contact: DeskContactDetails } }) {
  const c = who.contact
  // A row with nothing at all is a gap in the record, not something to
  // apologise for on this screen. The desk still has the name and the trip.
  if (!c || (!c.mobile && !c.altMobile && !c.email)) return null

  return (
    <div className="contactline">
      {c.mobile ? (
        <a className="cx" href={`tel:${c.mobile.replace(/\s/g, '')}`}>
          <TeIcon name="phone" size="sm" />
          <span>{prettyMobile(c.mobile)}</span>
        </a>
      ) : null}
      {c.altMobile ? (
        <a className="cx" href={`tel:${c.altMobile.replace(/\s/g, '')}`}>
          <TeIcon name="phone" size="sm" />
          <span>{prettyMobile(c.altMobile)}</span>
          <span className="small muted">2nd</span>
        </a>
      ) : null}
      {c.email ? (
        <a className="cx" href={`mailto:${c.email}`}>
          <TeIcon name="mail" size="sm" />
          <span>{c.email}</span>
        </a>
      ) : null}
      {c.from === 'record' ? (
        <span className="small muted" title="This trip was planned before the form asked for contact details, so these come from the employee's own record.">
          not confirmed
        </span>
      ) : null}
    </div>
  )
}
