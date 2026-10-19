'use client'
// components/te/admin/TeMailTemplate.tsx — what the travel desk writes when it
// sends a traveller their ticket.
//
// WHY THIS IS A SETTING AT ALL. What a desk says to a traveller is house
// style: one company signs off "Safe travels", another has to carry a 24-hour
// number, a third says nothing but the facts. Hard-coding one of those makes
// the other two write it out by hand every time, and each of the three
// companies here can word it differently.
//
// WHAT IT IS NOT. Not a template language. {{name}} and its friends are
// substituted literally and nothing else happens — no conditions, no loops.
// Anything resembling logic in a box like this is a second program that nobody
// can test and an administrator can break at four in the afternoon.
//
// AN UNKNOWN PLACEHOLDER IS LEFT VISIBLE on purpose, so a typo shows up in the
// preview below as itself rather than delivering a sentence with a hole in it.
// See fill() in lib/te/booking-mail.ts, which is tested.
import { useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeConfig } from '@/lib/te/types'
import { DEFAULT_TEMPLATE, PLACEHOLDERS, renderBookingMail, type BookingMailFacts } from '@/lib/te/booking-mail'
import { errorText } from '@/lib/te/format'
import TeIcon from '../TeIcon'

/** What the placeholders stand for, in the words an administrator thinks in. */
const MEANS: Record<string, string> = {
  name: 'who is travelling',
  tripNo: 'the trip number, like SRS-TRP-2026-0004',
  tripName: 'what they called the trip',
  route: 'where this booking goes, like Delhi T3 → Pune',
  on: 'the date of this booking',
  vendor: 'the airline, hotel or agent',
  reference: 'the PNR or booking reference',
  amount: 'what it cost',
  kind: 'flight, train or Stay',
  company: 'the company name',
  from: 'whoever on the desk pressed send',
}

/** A worked example, so the preview shows a real-looking mail rather than
 *  braces. Deliberately not a live booking: the preview must work on a company
 *  that has never booked anything. */
const EXAMPLE: BookingMailFacts = {
  name: 'Vikram Bose',
  tripNo: 'SRS-TRP-2026-0004',
  tripName: 'Pune Branch client meeting',
  route: 'Delhi airport T3 → Pune airport',
  on: 'Mon 15 Dec 2026',
  vendor: 'Vistara',
  reference: 'UK945-PNR-3BN7Q',
  amount: '₹6,480',
  kind: 'flight',
  company: 'your company',
  from: 'the travel desk',
}

export default function TeMailTemplate({ cfg, onSaved, onToast }: {
  cfg: TeConfig | null
  onSaved: () => void
  onToast: (message: string) => void
}) {
  // te_settings.extra is where a setting added after the table was built lives.
  const saved = useMemo(() => {
    const extra = cfg?.extra ?? {}
    const m = (extra.bookingMail ?? {}) as { subject?: string; body?: string }
    return { subject: m.subject ?? '', body: m.body ?? '' }
  }, [cfg])

  const [subject, setSubject] = useState(saved.subject)
  const [body, setBody] = useState(saved.body)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const dirty = subject !== saved.subject || body !== saved.body
  // Blank means "use the default", which is a real choice and not an empty
  // form: a company that never touches this still sends a sensible mail.
  const preview = useMemo(() => renderBookingMail({ subject, body }, EXAMPLE), [subject, body])
  const usingDefault = !subject.trim() || !body.trim()

  async function save() {
    setBusy(true); setError('')
    try {
      await te.admin.settingsSave({ extra: { bookingMail: { subject: subject.trim(), body: body.trim() } } })
      onToast('The traveller email was saved.')
      onSaved()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="ph">
        <h1>Traveller email</h1>
        <p>What the travel desk sends when it emails somebody their ticket. The ticket itself is attached automatically.</p>
      </div>

      {error ? <div className="flag crit"><TeIcon name="alert" size="sm" /><span>{error}</span></div> : null}

      <div className="card">
        <div className="ch"><h3>The message</h3>
          {usingDefault ? <span className="chip plain">Using the default</span> : null}
        </div>
        <div className="form">
          <label className="fld">
            <span>Subject</span>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={DEFAULT_TEMPLATE.subject} />
            <small>Leave it empty to use the default shown in grey.</small>
          </label>
          <label className="fld">
            <span>Message</span>
            <textarea rows={12} value={body} onChange={e => setBody(e.target.value)} placeholder={DEFAULT_TEMPLATE.body} />
            <small>Plain text. Line breaks are kept exactly as you type them.</small>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="ch"><h3>What you can put in it</h3></div>
        {/* Listed from the same constant the substitution uses, so this screen
            can never advertise a placeholder that does not resolve — there is
            a test for exactly that. */}
        <dl className="kv">
          {PLACEHOLDERS.map(k => (
            <span key={k} style={{ display: 'contents' }}>
              <dt><span className="mono">{`{{${k}}}`}</span></dt>
              <dd>{MEANS[k] ?? k}</dd>
            </span>
          ))}
        </dl>
        <p className="small muted">
          Anything else in double braces is left exactly as you typed it, so a misspelling shows up in the preview below
          instead of leaving a gap in the message.
        </p>
      </div>

      <div className="card">
        <div className="ch"><h3>Preview</h3><span className="small muted">With an example booking</span></div>
        <div className="mailprev">
          <div className="mp-subject">{preview.subject}</div>
          <div className="mp-body">{preview.body}</div>
          <div className="mp-attach"><TeIcon name="file" size="sm" />ticket.pdf</div>
        </div>
      </div>

      <div className="row tight">
        <button type="button" className="btn pri" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {dirty ? <button type="button" className="btn" disabled={busy} onClick={() => { setSubject(saved.subject); setBody(saved.body) }}>Undo changes</button> : null}
        {!subject.trim() && !body.trim() ? null : (
          <button type="button" className="btn" disabled={busy} onClick={() => { setSubject(''); setBody('') }}>Back to the default</button>
        )}
      </div>
    </div>
  )
}
