'use client'
// components/te/TeContactFields.tsx — the three fields the travel desk reaches
// you on, asked on the form rather than looked up.
//
// WHY ASK AT ALL when the employee record already has a number. Because the
// record answers "what is on file for this person" and the desk's question is
// "how do I reach them about THIS trip". A traveller abroad is on a local SIM;
// one whose handset is in for repair is on a colleague's; one travelling over a
// weekend wants the itinerary somewhere other than their work inbox. None of
// that belongs on a permanent HR record, and none of it should change one.
//
// SO IT IS PREFILLED, NOT LOOKED UP. The fields open with whatever ESS has,
// read when the form opened, and the traveller may replace any of them. What
// they leave is stored on the trip and is what the desk sees; ESS is never
// written back to. The note under the block says so, because somebody editing
// their own number here has every right to wonder whether they have just
// changed their HR record.
//
// ALL THREE ARE REQUIRED. The desk's questions are always urgent — a fare
// moved, a flight was cancelled, an airline wants a date of birth before it
// will ticket — and the second number is for when the first cannot be reached,
// which abroad is most of the time. The refusals come from the engine (keyed
// contactMobile / contactAltMobile / contactEmail) and from SQL behind it, so
// this screen only shows them; it does not decide them.
import TeIcon from './TeIcon'

export interface ContactValue {
  contactMobile: string
  contactAltMobile: string
  contactEmail: string
}

export default function TeContactFields({ value, prefilled, onChange, error, heading }: {
  value: ContactValue
  /** What ESS had when the form opened, for the "back to my ESS number" link.
   *  Omitted where there was nothing to prefill from. */
  prefilled?: { mobile: string; altMobile: string; email: string }
  onChange: (patch: Partial<ContactValue>) => void
  /** The message to show under one field, '' for none. The caller decides when
   *  a message may appear at all — nothing is shown while somebody is still
   *  filling the form in. */
  error: (key: keyof ContactValue) => string
  heading?: string
}) {
  // Only offered where it would actually change something: a field already
  // holding the ESS value has nothing to put back.
  const canReset = !!prefilled && (
    (!!prefilled.mobile && value.contactMobile !== prefilled.mobile)
    || (!!prefilled.altMobile && value.contactAltMobile !== prefilled.altMobile)
    || (!!prefilled.email && value.contactEmail !== prefilled.email)
  )

  const field = (key: keyof ContactValue, label: string, hint: string, props: Record<string, unknown>) => (
    <label className="fld">
      <span>{label}</span>
      <input
        value={value[key]}
        onChange={e => onChange({ [key]: e.target.value } as Partial<ContactValue>)}
        {...props}
      />
      <small>{hint}</small>
      {error(key) ? <div className="ferr"><TeIcon name="warn" size="sm" />{error(key)}</div> : null}
    </label>
  )

  return (
    <div className="sec">
      <h4>{heading ?? 'How we reach you'}</h4>
      <div className="form g2">
        {field('contactMobile', 'Mobile', 'The number to ring first.', {
          type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '98765 43210',
        })}
        {field('contactAltMobile', 'Second number', 'For when the first one cannot be reached.', {
          type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: 'A colleague, or your other number',
        })}
        <label className="fld full">
          <span>Email</span>
          <input
            value={value.contactEmail}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@company.com"
            onChange={e => onChange({ contactEmail: e.target.value })}
          />
          <small>Tickets and anything about this are sent here.</small>
          {error('contactEmail') ? <div className="ferr"><TeIcon name="warn" size="sm" />{error('contactEmail')}</div> : null}
        </label>
      </div>
      <p className="small muted">
        Filled in from your EZER profile. Change anything here that is different while you are away — it applies
        to this trip only and does not change your profile.
        {canReset ? (
          <>
            {' '}
            <button
              type="button"
              className="link small"
              onClick={() => onChange({
                contactMobile: prefilled!.mobile,
                contactAltMobile: prefilled!.altMobile,
                contactEmail: prefilled!.email,
              })}
            >
              Use my profile details
            </button>
          </>
        ) : null}
      </p>
    </div>
  )
}
