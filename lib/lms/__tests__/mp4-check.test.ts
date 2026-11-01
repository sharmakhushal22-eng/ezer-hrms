// A file that cannot play on an employee's PC must be stopped at upload, with what to do next.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { inspectMp4 } from '../mp4-check.ts'

const box = (type: string, body: number[] = []): number[] => {
  const n = body.length + 8
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...[...type].map(c => c.charCodeAt(0)), ...body]
}
const tag = (t: string) => [...t].map(c => c.charCodeAt(0))
const file = (...parts: number[][]) => Uint8Array.from(parts.flat())
const check = (b: Uint8Array) => inspectMp4(b.length, async (s, e) => b.slice(s, e))

const ftyp = box('ftyp', tag('isom'))
const moov = (...codecs: string[]) => box('moov', [0, 0, 0, 0, ...codecs.flatMap(tag)])
const mdat = box('mdat', [1, 2, 3, 4])

describe('video upload check', () => {
  it('accepts H.264 and AAC with the index first', async () => {
    const r = await check(file(ftyp, moov('avc1', 'mp4a'), mdat))
    assert.deepEqual([r.ok, r.video, r.audio, r.faststart], [true, 'H.264', 'AAC', true])
  })
  it('accepts a silent video', async () => {
    assert.equal((await check(file(ftyp, moov('avc1'), mdat))).ok, true)
  })
  it('refuses the HEVC an iPhone records, and says what to do', async () => {
    const r = await check(file(ftyp, moov('hvc1', 'mp4a'), mdat))
    assert.equal(r.ok, false)
    assert.match(r.problem!, /HEVC/)
    assert.match(r.problem!, /Most Compatible/)
  })
  it('refuses an MP4 that cannot start until fully downloaded', async () => {
    const r = await check(file(ftyp, mdat, moov('avc1', 'mp4a')))
    assert.equal(r.ok, false)
    assert.match(r.problem!, /Web Optimized/)
  })
  it('refuses audio browsers cannot play', async () => {
    assert.match((await check(file(ftyp, moov('avc1', 'ac-3'), mdat))).problem!, /AC-3/)
  })
  it('refuses something that is not an MP4 at all', async () => {
    assert.equal((await check(Uint8Array.from(Array(64).fill(7)))).ok, false)
  })
  it('refuses a truncated file with no index', async () => {
    assert.match((await check(file(ftyp, mdat))).problem!, /no index/)
  })
  it('does not spin on a corrupt box length', async () => {
    assert.equal((await check(file([0, 0, 0, 2, ...tag('ftyp')]))).ok, false)
  })
  it('reads the structure, not the whole file', async () => {
    const big = 2 * 1024 ** 3
    let read = 0
    const b = file(ftyp, moov('avc1', 'mp4a'))
    const hdr = [(0 >>> 24), 0, 0, 1, ...tag('mdat'), 0, 0, 0, 0, 0x7f, 0xff, 0xff, 0xff]
    const r = await inspectMp4(big, async (s, e) => {
      read += e - s
      return s < b.length ? b.slice(s, e) : Uint8Array.from(hdr)
    })
    assert.equal(r.ok, true)
    assert.ok(read < 4096, `read ${read} bytes of a 2 GB file`)
  })
})
