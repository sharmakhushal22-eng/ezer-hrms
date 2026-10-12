// lib/today/__tests__/punch.test.ts — the punch session's arithmetic.
//
// What is worth pinning here is not the formatting but the three things that
// decide whether somebody is paid correctly: which button is live, how a night
// shift's target is computed, and when overtime is claimed.
import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  CHIP_CLEAR_DEG, DEG_PER_MINUTE, canPunch, dayFromToday, degFromDate,
  degFromMinutes, dialSeparation, formatDuration, gradeIn, gradeOut,
  gradeWorked, hhmmToMinutes, outChipOffsetDeg, punchState, shiftLengthMs,
  shiftProgress, toDate,
} from '../punch.ts'

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 12, h, m, s)
const iso = (h: number, m: number) => at(h, m).toISOString()

describe('the session a day holds', () => {
  it('is idle before anything, open after an in, closed after an out', () => {
    assert.equal(punchState(null), 'IDLE')
    assert.equal(punchState({ inAt: null, outAt: null }), 'IDLE')
    assert.equal(punchState({ inAt: iso(9, 30), outAt: null }), 'IN')
    assert.equal(punchState({ inAt: iso(9, 30), outAt: iso(18, 30) }), 'DONE')
  })

  it('treats an out with no in as idle rather than closed', () => {
    // Only reachable from bad data. Calling it DONE would lock both buttons and
    // leave the employee unable to punch in at all.
    assert.equal(punchState({ inAt: null, outAt: iso(18, 30) }), 'IDLE')
  })
})

describe('which button is live', () => {
  it('offers only in when idle', () => {
    assert.equal(canPunch('IN', null), true)
    assert.equal(canPunch('OUT', null), false)
  })

  it('offers only out while a session is open', () => {
    const open = { inAt: iso(9, 30), outAt: null }
    assert.equal(canPunch('IN', open), false)
    assert.equal(canPunch('OUT', open), true)
  })

  it('offers neither once the day is closed', () => {
    // One session a day. A second in would silently start a second one.
    const done = { inAt: iso(9, 30), outAt: iso(18, 30) }
    assert.equal(canPunch('IN', done), false)
    assert.equal(canPunch('OUT', done), false)
  })
})

describe('the shift target', () => {
  it('measures a normal day', () => {
    assert.equal(shiftLengthMs('09:30', '18:30'), 9 * 3600_000)
  })

  it('wraps a night shift instead of going negative', () => {
    // A negative target would make the first minute worked look like overtime.
    assert.equal(shiftLengthMs('22:00', '06:00'), 8 * 3600_000)
  })

  it('reads HH:MM, and treats rubbish as midnight rather than NaN', () => {
    assert.equal(hhmmToMinutes('09:30'), 570)
    assert.equal(hhmmToMinutes('00:00'), 0)
    assert.equal(hhmmToMinutes(''), 0)
  })
})

describe('where things sit on a 12-hour dial', () => {
  it('puts an hour at 30 degrees and a minute of elapsed time at half of one', () => {
    assert.equal(degFromMinutes(60), 30)
    assert.equal(degFromMinutes(570), 285)        // 09:30
    assert.equal(DEG_PER_MINUTE, 0.5)
  })

  it('folds the afternoon onto the same face', () => {
    // 21:00 and 09:00 are the same place on a 12-hour dial.
    assert.equal(degFromMinutes(hhmmToMinutes('21:00')), degFromMinutes(hhmmToMinutes('09:00')))
    assert.equal(degFromDate(at(21, 0)), degFromDate(at(9, 0)))
  })

  it('moves the hand within the hour', () => {
    assert.equal(degFromDate(at(9, 30)), 285)
  })
})

describe('grading the in time', () => {
  it('calls the grace window on time', () => {
    assert.equal(gradeIn(at(9, 30), '09:30')?.text, 'On time')
    assert.equal(gradeIn(at(9, 40), '09:30')?.text, 'On time', '10 minutes is the default grace')
    assert.equal(gradeIn(at(9, 40), '09:30')?.tone, 'ok')
  })

  it('calls anything past the grace late, and says by how much', () => {
    assert.deepEqual(gradeIn(at(9, 42), '09:30'), { text: '12m late', tone: 'warn' })
    assert.deepEqual(gradeIn(at(11, 0), '09:30'), { text: '1h 30m late', tone: 'warn' })
  })

  it('honours a shorter grace', () => {
    assert.equal(gradeIn(at(9, 35), '09:30', 2)?.tone, 'warn')
  })

  it('reports arriving early as early, not as on time', () => {
    // Two different facts; flattening them loses the one worth knowing.
    assert.deepEqual(gradeIn(at(9, 0), '09:30'), { text: '30m early', tone: 'ok' })
  })

  it('says nothing when there is no in time', () => {
    assert.equal(gradeIn(null, '09:30'), null)
  })
})

describe('grading the out time', () => {
  it('treats the first few minutes past the end as on schedule', () => {
    assert.deepEqual(gradeOut(at(18, 30), '18:30'), { text: 'On schedule', tone: 'ok' })
    assert.equal(gradeOut(at(18, 34), '18:30')?.text, 'On schedule')
  })

  it('states staying late without calling it a problem', () => {
    const late = gradeOut(at(20, 0), '18:30')
    assert.equal(late?.text, '1h 30m after')
    assert.equal(late?.tone, 'ok', 'staying late is not a warning')
  })

  it('warns on leaving early', () => {
    assert.deepEqual(gradeOut(at(17, 30), '18:30'), { text: '1h 00m early', tone: 'warn' })
  })
})

describe('grading the hours worked', () => {
  const target = 9 * 3600_000

  it('claims overtime while the session is still open', () => {
    // The number somebody staying late actually wants to see.
    const t = gradeWorked(10 * 3600_000, target, false)
    assert.deepEqual(t, { text: '+1h 00m OT', tone: 'ot' })
  })

  it('stays silent about being short while the session is open', () => {
    // At 10am every day is short of a full day. True, and useless.
    assert.equal(gradeWorked(30 * 60_000, target, false), null)
  })

  it('reports short only once the day is closed', () => {
    assert.deepEqual(gradeWorked(8 * 3600_000, target, true), { text: '1h 00m short', tone: 'warn' })
  })

  it('calls an exact day full', () => {
    assert.deepEqual(gradeWorked(target, target, true), { text: 'Full day', tone: 'ok' })
  })
})

describe('shift progress', () => {
  it('is a percentage of the target, clamped at both ends', () => {
    assert.equal(shiftProgress(0, 9 * 3600_000), 0)
    assert.equal(shiftProgress(4.5 * 3600_000, 9 * 3600_000), 50)
    assert.equal(shiftProgress(99 * 3600_000, 9 * 3600_000), 100, 'the bar cannot overflow')
    assert.equal(shiftProgress(-5, 9 * 3600_000), 0)
  })

  it('returns zero rather than dividing by zero', () => {
    assert.equal(shiftProgress(3600_000, 0), 0)
  })
})

describe('reading what the server sent', () => {
  it('translates the payload once, so no screen reads snake_case', () => {
    assert.deepEqual(dayFromToday({ punch_in: 'x', punch_out: 'y' }), { inAt: 'x', outAt: 'y' })
    assert.deepEqual(dayFromToday(null), { inAt: null, outAt: null })
    assert.deepEqual(dayFromToday(undefined), { inAt: null, outAt: null })
  })

  it('refuses an unparseable timestamp instead of yielding an invalid date', () => {
    // A dial drawn from NaN is worse than a dial drawn from nothing.
    assert.equal(toDate('not a date'), null)
    assert.equal(toDate(null), null)
    assert.equal(toDate(''), null)
    assert.ok(toDate(iso(9, 30)) instanceof Date)
  })
})

describe('elapsed time on screen', () => {
  it('pads to HH:MM:SS', () => {
    assert.equal(formatDuration(0), '00:00:00')
    assert.equal(formatDuration(61_000), '00:01:01')
    assert.equal(formatDuration(9 * 3600_000 + 5 * 60_000 + 7_000), '09:05:07')
  })

  it('does not count backwards when the clocks disagree', () => {
    assert.equal(formatDuration(-60_000), '00:00:00')
  })

  it('keeps counting past 24 hours rather than wrapping to zero', () => {
    assert.equal(formatDuration(25 * 3600_000), '25:00:00')
  })
})

describe('keeping the two punch capsules apart', () => {
  it('measures separation the short way round', () => {
    assert.equal(dialSeparation(10, 40), 30)
    assert.equal(dialSeparation(350, 20), 30, 'across the top of the dial')
    assert.equal(dialSeparation(0, 180), 180)
    assert.equal(dialSeparation(90, 90), 0)
  })

  it('slides the out capsule aside for a short session', () => {
    // The case that overlapped on screen: in 19:42, out 19:50.
    assert.equal(Math.abs(outChipOffsetDeg(at(19, 42), at(19, 50))), CHIP_CLEAR_DEG)
  })

  it('slides it for a session exactly twelve hours long', () => {
    // 09:30 and 21:30 are the same place on a 12-hour face.
    assert.equal(Math.abs(outChipOffsetDeg(at(9, 30), at(21, 30))), CHIP_CLEAR_DEG)
  })

  it('leaves it alone when the two are already clear', () => {
    assert.equal(outChipOffsetDeg(at(9, 30), at(18, 30)), 0)
    assert.equal(outChipOffsetDeg(at(9, 0), at(12, 0)), 0, '3h is 90 degrees apart')
    assert.equal(outChipOffsetDeg(at(9, 0), at(15, 0)), 0, '6h apart needs no help')
  })

  it('slides AWAY from the in capsule, never through it', () => {
    // Out after in leans one way, out before in the other. Pushing the label
    // through its neighbour would swap which one reads first.
    assert.ok(outChipOffsetDeg(at(9, 0), at(9, 20)) > 0)
    assert.ok(outChipOffsetDeg(at(9, 20), at(9, 0)) < 0)
  })

  it('does not move it when there is only one punch', () => {
    assert.equal(outChipOffsetDeg(at(9, 30), null), 0)
    assert.equal(outChipOffsetDeg(null, at(18, 30)), 0)
  })

  it('does not go back to pulling it inward', () => {
    // The inward version cleared the other capsule and then sat on the digital
    // readout in the centre of the face. This returns an ANGLE, not a radius.
    assert.ok(Math.abs(outChipOffsetDeg(at(9, 0), at(9, 1))) <= 180)
  })
})
