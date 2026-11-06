// Live sessions. Each test names what would go wrong for a host or an attendee.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildIcs, canCheckIn, canJoin, creditRecording, newCheckinCode, phaseOf, sameCode } from '../live-core.ts'

const at = (iso: string) => new Date(iso).getTime()
const s = { starts_at: '2026-11-10T10:30:00.000Z', duration_min: 60, status: 'SCHEDULED' }

describe('when a session can be joined', () => {
  it('Join opens 15 minutes early and stays open 30 minutes after the end', () => {
    assert.equal(canJoin(s, at('2026-11-10T10:10:00Z')), false)
    assert.equal(phaseOf(s, at('2026-11-10T10:20:00Z')), 'joinable')
    assert.equal(phaseOf(s, at('2026-11-10T11:00:00Z')), 'live')
    assert.equal(canJoin(s, at('2026-11-10T11:55:00Z')), true)
    assert.equal(phaseOf(s, at('2026-11-10T12:05:00Z')), 'ended')
  })

  it('a cancelled session is never joinable, and checking in to it is refused', () => {
    const c = { ...s, status: 'CANCELLED' }
    assert.equal(canJoin(c, at('2026-11-10T10:40:00Z')), false)
    assert.equal(canCheckIn(c, at('2026-11-10T10:40:00Z')), false)
  })

  it('the attendance code works until an hour after the end, not the next day', () => {
    assert.equal(canCheckIn(s, at('2026-11-10T12:25:00Z')), true)
    assert.equal(canCheckIn(s, at('2026-11-11T09:00:00Z')), false)
  })

  it('codes are easy to read out, and typing them loosely still matches', () => {
    const code = newCheckinCode(() => 0.5)
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/)
    assert.equal(sameCode('ab3-k9q', 'AB3K9Q'), true)
    assert.equal(sameCode('AB3K9Q', null), false)
  })
})

describe('watching the recording', () => {
  it('cannot claim more than double speed allows in the time since the last report', () => {
    const c = creditRecording({ watchedS: 0, claimedS: 600, elapsedS: 60, durationS: 3600 })
    assert.equal(c.watchedS, 123)
    assert.equal(c.refusedS, 477)
  })

  it('counts once 90% has been watched', () => {
    assert.equal(creditRecording({ watchedS: 3220, claimedS: 30, elapsedS: 30, durationS: 3600 }).done, true)
    assert.equal(creditRecording({ watchedS: 3000, claimedS: 30, elapsedS: 30, durationS: 3600 }).done, false)
  })
})

describe('the calendar invitation', () => {
  const ics = buildIcs({
    id: 'abc', sequence: 2, title: 'Q&A; privacy, consent', description: 'Line one\nLine two', starts_at: s.starts_at, duration_min: 90,
    join_url: 'https://meet.google.com/abc-defg-hij', location: null, organizer: { name: 'EZER Learn', email: 'hr@example.com' },
    attendee: { name: 'Riya Jain', email: 'riya@example.com' }, page: 'https://app.example/learning/live/abc',
  }, at('2026-11-01T00:00:00Z'))

  it('is one event in UTC that the same UID and a higher SEQUENCE can update', () => {
    assert.match(ics, /UID:abc@ezer-learn/)
    assert.match(ics, /SEQUENCE:2/)
    assert.match(ics, /DTSTART:20261110T103000Z/)
    assert.match(ics, /DTEND:20261110T120000Z/)
    assert.match(ics, /METHOD:REQUEST/)
    assert.match(ics, /TRIGGER:-PT15M/)
  })

  it('escapes the characters calendars treat as separators', () => {
    assert.match(ics, /SUMMARY:Q&A\\; privacy\\, consent/)
    assert.match(ics, /Line one\\nLine two/)
  })

  it('folds long lines and ends every line with CRLF', () => {
    for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line)
    assert.ok(ics.endsWith('\r\n'))
  })

  it('a cancellation removes the event instead of adding it', () => {
    const c = buildIcs({ id: 'abc', sequence: 3, title: 'T', description: null, starts_at: s.starts_at, duration_min: 30, join_url: null, location: 'Room 4', organizer: null, attendee: null, cancelled: true })
    assert.match(c, /METHOD:CANCEL/)
    assert.match(c, /STATUS:CANCELLED/)
    assert.doesNotMatch(c, /VALARM/)
  })
})
