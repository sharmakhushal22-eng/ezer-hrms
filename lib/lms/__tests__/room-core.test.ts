// The webinar room. Each test names what would go wrong for a host or an attendee.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROOM_CLOSES_AFTER_MIN, ROOM_OPENS_MIN, attendNeedS, cleanPoll, cleanText, creditBeat, creditOpen, hlsUrl, mayPost, roomPhase, stageFor, tally, vimeoPlayer, youtubeId,
} from '../room-core.ts'
import { JOIN_CLOSES_AFTER_MIN, JOIN_OPENS_MIN } from '../live-core.ts'

const at = (iso: string) => new Date(iso).getTime()
const s = { starts_at: '2026-11-10T10:30:00.000Z', duration_min: 60, status: 'SCHEDULED' }

describe('the stream address', () => {
  it('finds the YouTube id in every address people paste', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=4', 'https://www.youtube.com/live/dQw4w9WgXcQ?si=x',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ'])
      assert.equal(youtubeId(u), 'dQw4w9WgXcQ', u)
  })

  it('refuses what is not a YouTube video: another site, plain http, a channel, a broken id', () => {
    for (const u of ['https://evil.example/watch?v=dQw4w9WgXcQ', 'http://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/@channel', 'https://youtu.be/short', 'not a url'])
      assert.equal(youtubeId(u), null, u)
  })

  it('embeds YouTube from the no-cookie domain, muted so the browser lets it start', () => {
    const r = stageFor('YOUTUBE', 'https://youtu.be/dQw4w9WgXcQ')
    assert.equal(r.problem, null)
    assert.match(r.stage!.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1&mute=1/)
  })

  it('turns Vimeo videos, unlisted videos and live events into player addresses', () => {
    assert.equal(vimeoPlayer('https://vimeo.com/76979871'), 'https://player.vimeo.com/video/76979871')
    assert.equal(vimeoPlayer('https://vimeo.com/76979871/abc123def0'), 'https://player.vimeo.com/video/76979871?h=abc123def0')
    assert.equal(vimeoPlayer('https://vimeo.com/event/4567890'), 'https://vimeo.com/event/4567890/embed')
    assert.equal(vimeoPlayer('https://player.vimeo.com/video/76979871?h=ff00ff'), 'https://player.vimeo.com/video/76979871?h=ff00ff')
    assert.equal(vimeoPlayer('https://vimeo.com/channels/staffpicks'), null)
  })

  it('takes an HLS stream only as an https .m3u8 address', () => {
    assert.equal(hlsUrl('https://cdn.example.com/live/index.m3u8?token=1'), 'https://cdn.example.com/live/index.m3u8?token=1')
    assert.equal(hlsUrl('http://cdn.example.com/live/index.m3u8'), null)
    assert.equal(hlsUrl('https://cdn.example.com/live/video.mp4'), null)
  })

  it('a meeting has no stage; a stream without an address says what is missing', () => {
    assert.deepEqual(stageFor('MEETING', null), { stage: null, problem: null })
    assert.deepEqual(stageFor(null, null), { stage: null, problem: null })
    assert.match(stageFor('HLS', '').problem!, /address/)
    assert.match(stageFor('YOUTUBE', 'https://vimeo.com/1').problem!, /YouTube/)
  })
})

describe('where the room is', () => {
  it('opens and closes on the same clock as the Join button', () => {
    assert.equal(ROOM_OPENS_MIN, JOIN_OPENS_MIN)
    assert.equal(ROOM_CLOSES_AFTER_MIN, JOIN_CLOSES_AFTER_MIN)
  })

  it('goes live at the start time, or earlier when the host presses Go live', () => {
    assert.equal(roomPhase(s, at('2026-11-10T10:20:00Z')), 'before')
    assert.equal(roomPhase({ ...s, live_started_at: '2026-11-10T10:18:00Z' }, at('2026-11-10T10:20:00Z')), 'live')
    assert.equal(roomPhase(s, at('2026-11-10T10:31:00Z')), 'live')
  })

  it('ends when the host presses End, even before the planned end', () => {
    assert.equal(roomPhase({ ...s, live_started_at: '2026-11-10T10:30:00Z', live_ended_at: '2026-11-10T11:05:00Z' }, at('2026-11-10T11:10:00Z')), 'ended')
  })

  it('stays live while the host keeps it going past the overrun', () => {
    assert.equal(roomPhase({ ...s, live_started_at: '2026-11-10T10:30:00Z' }, at('2026-11-10T13:00:00Z')), 'live')
    assert.equal(roomPhase(s, at('2026-11-10T13:00:00Z')), 'ended')
  })

  it('a cancelled session never goes live', () => {
    assert.equal(roomPhase({ ...s, status: 'CANCELLED', live_started_at: '2026-11-10T10:30:00Z' }, at('2026-11-10T10:40:00Z')), 'cancelled')
  })
})

describe('time in the room', () => {
  it('counts from the warm-up quarter hour to half an hour after the end', () => {
    assert.equal(creditOpen(s, at('2026-11-10T10:10:00Z')), false)
    assert.equal(creditOpen(s, at('2026-11-10T10:16:00Z')), true)
    assert.equal(creditOpen(s, at('2026-11-10T11:59:00Z')), true)
    assert.equal(creditOpen(s, at('2026-11-10T12:01:00Z')), false)
  })

  it('stops counting once the host ends it', () => {
    assert.equal(creditOpen({ ...s, live_ended_at: '2026-11-10T11:00:00Z' }, at('2026-11-10T11:01:00Z')), false)
  })

  it('the first beat only starts the clock', () => {
    assert.equal(creditBeat({ lastBeatAt: null, now: at('2026-11-10T10:40:00Z'), open: true }), 0)
  })

  it('a beat adds the time since the last one, by the server clock', () => {
    assert.equal(creditBeat({ lastBeatAt: '2026-11-10T10:40:00Z', now: at('2026-11-10T10:40:45Z'), open: true }), 45)
  })

  it('a laptop that slept for an hour earns one minute, not an hour', () => {
    assert.equal(creditBeat({ lastBeatAt: '2026-11-10T10:40:00Z', now: at('2026-11-10T11:40:00Z'), open: true }), 60)
  })

  it('nothing is added while the room is closed, or for a clock that runs backwards', () => {
    assert.equal(creditBeat({ lastBeatAt: '2026-11-10T10:40:00Z', now: at('2026-11-10T10:40:45Z'), open: false }), 0)
    assert.equal(creditBeat({ lastBeatAt: '2026-11-10T10:41:00Z', now: at('2026-11-10T10:40:45Z'), open: true }), 0)
  })

  it('attending means staying for the session’s share of its length', () => {
    assert.equal(attendNeedS(60, 50), 1800)
    assert.equal(attendNeedS(60, 100), 3600)
    assert.equal(attendNeedS(60, null), 1800)
    assert.equal(attendNeedS(60, 3), 360)   // never below 10%
  })
})

describe('what people may post', () => {
  it('trims a message and refuses an empty or overlong one', () => {
    assert.equal(cleanText('  hello \r\n\r\n\r\n there ', 500), 'hello \n\n there')
    assert.equal(cleanText('   ', 500), null)
    assert.equal(cleanText('x'.repeat(501), 500), null)
  })

  it('a poll needs a question and two to six different answers', () => {
    assert.deepEqual(cleanPoll('Ready?', ['Yes', ' No ', 'Yes', '']), { question: 'Ready?', options: ['Yes', 'No'] })
    assert.ok('problem' in cleanPoll('Ready?', ['Yes']))
    assert.ok('problem' in cleanPoll('', ['Yes', 'No']))
    assert.ok('problem' in cleanPoll('Pick', ['a', 'b', 'c', 'd', 'e', 'f', 'g']))
  })

  it('one line every two seconds per person', () => {
    assert.equal(mayPost(null, at('2026-11-10T10:40:00Z'), 2000), true)
    assert.equal(mayPost('2026-11-10T10:39:59Z', at('2026-11-10T10:40:00Z'), 2000), false)
    assert.equal(mayPost('2026-11-10T10:39:58Z', at('2026-11-10T10:40:00Z'), 2000), true)
  })

  it('counts poll answers per option and ignores an option that does not exist', () => {
    assert.deepEqual(tally(3, [{ option_idx: 0 }, { option_idx: 2 }, { option_idx: 2 }, { option_idx: 7 }]), [1, 0, 2])
  })
})
