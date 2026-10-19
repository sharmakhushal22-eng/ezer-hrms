// The mail a traveller is sent with their ticket.
//
// The wording is the whole output and an administrator writes it from a text
// box, so the substitution has to behave predictably when they get it wrong —
// a typo must be visible, not swallowed. And the address rules decide where
// company travel documents land, which is the half worth being strict about.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addressFor, DEFAULT_TEMPLATE, fill, PLACEHOLDERS, renderBookingMail, type BookingMailFacts,
} from '../booking-mail.ts'

const facts: BookingMailFacts = {
  name: 'Vikram Bose',
  tripNo: 'TRP-2026-0005',
  tripName: 'Pune dealer review',
  route: 'Delhi airport T3 → Mumbai airport T2',
  on: 'Wed 25 Nov',
  vendor: 'Vistara',
  reference: 'UK945-PNR-3BN7Q',
  amount: '₹7,420',
  kind: 'Flight',
  company: 'Sharma Retail Solutions Pvt Ltd',
  from: 'Shreya Reddy',
}

// ── substitution ────────────────────────────────────────────────────────────

test('placeholders are replaced with the facts', () => {
  assert.equal(fill('Hello {{name}}, your {{kind}} is booked.', facts), 'Hello Vikram Bose, your Flight is booked.')
  assert.equal(fill('{{vendor}} · {{reference}}', facts), 'Vistara · UK945-PNR-3BN7Q')
})

test('spacing inside the braces is tolerated', () => {
  // Somebody typing into a text box will put spaces in. Refusing to match
  // would look like the placeholder is broken.
  assert.equal(fill('{{ name }}', facts), 'Vikram Bose')
  assert.equal(fill('{{name }}', facts), 'Vikram Bose')
})

test('a typo is left visible rather than silently blanked', () => {
  // THE POINT: a test send has to show the administrator what they got wrong.
  // Blanking it would deliver a sentence with a hole and no clue why.
  assert.equal(fill('Hello {{nme}},', facts), 'Hello {{nme}},')
})

test('a known placeholder with nothing behind it becomes empty', () => {
  // A trip may genuinely have no amount. "{{amount}}" in a traveller's inbox
  // is worse than a gap.
  const blank = { ...facts, amount: '' }
  assert.equal(fill('Cost: {{amount}}', blank), 'Cost: ')
})

test('every placeholder the admin screen advertises actually resolves', () => {
  // If the screen lists one that fill() does not know, an administrator will
  // use it and the mail will go out with braces in it.
  for (const key of PLACEHOLDERS) {
    assert.notEqual(fill(`{{${key}}}`, facts), `{{${key}}}`, `${key} is listed but does not resolve`)
  }
})

// ── the default, which has to be sendable as it stands ──────────────────────

test('the default template leaves no placeholder behind', () => {
  const mail = renderBookingMail(null, facts)
  assert.doesNotMatch(mail.subject, /\{\{/, mail.subject)
  assert.doesNotMatch(mail.body, /\{\{/, mail.body)
})

test('the default says what was booked, when, and what to quote', () => {
  const { subject, body } = renderBookingMail(null, facts)
  assert.match(subject, /Flight/)
  assert.match(subject, /Pune dealer review/)
  for (const must of [facts.name, facts.route, facts.on, facts.vendor, facts.reference, facts.company]) {
    assert.ok(body.includes(must), `the body should carry ${must}`)
  }
})

test('a company that clears one field still gets a usable mail', () => {
  // Half-edited is the normal state of a settings screen.
  const onlySubject = renderBookingMail({ subject: 'Your ticket for {{tripName}}', body: '  ' }, facts)
  assert.equal(onlySubject.subject, 'Your ticket for Pune dealer review')
  assert.equal(onlySubject.body, fill(DEFAULT_TEMPLATE.body, facts), 'the body falls back')

  const onlyBody = renderBookingMail({ subject: '', body: 'Short and sweet, {{name}}.' }, facts)
  assert.equal(onlyBody.body, 'Short and sweet, Vikram Bose.')
  assert.ok(onlyBody.subject.length > 0, 'the subject falls back')
})

// ── where it goes ───────────────────────────────────────────────────────────

test('the work address wins, and is named as such', () => {
  const a = addressFor({ office_email: 'vikram@sharma.example', personal_email: 'v@gmail.example' })
  assert.deepEqual(a, { to: 'vikram@sharma.example', kind: 'work' })
})

test('a personal address is a fallback, not a failure', () => {
  // On this data most employees have only a personal address, so refusing
  // would mean the feature does not work for anybody.
  const a = addressFor({ office_email: '', personal_email: 'v@gmail.example' })
  assert.deepEqual(a, { to: 'v@gmail.example', kind: 'personal' })
  // Named, so the screen can warn before a company document leaves for a
  // personal inbox.
  assert.equal(a?.kind, 'personal')
})

test('no address at all is null, not an empty string', () => {
  // An empty "to" would be handed to the provider and fail somewhere less
  // obvious. The caller has to refuse on this.
  assert.equal(addressFor({ office_email: '', personal_email: '' }), null)
  assert.equal(addressFor({}), null)
  assert.equal(addressFor({ office_email: '   ' }), null, 'whitespace is not an address')
})
