// lib/lms/mp4-check.ts — can every employee's browser play this file? Pure.
//
// Nothing here transcodes, so what is uploaded is exactly what plays. A browser saying it can
// play the file on an author's machine proves little: Safari happily plays the HEVC an iPhone
// records, and a Windows PC then cannot. So this reads the file's own structure, and only as
// many bytes as that takes, through a reader the caller supplies.
//
//   · H.264 video (avc1). HEVC and AV1 are refused, with what to do about it.
//   · `moov` ahead of `mdat`, or the browser has to fetch the end of the file before it can
//     start playing, which on a slow connection looks like a broken video.

export type ByteReader = (start: number, end: number) => Promise<Uint8Array>

export interface Mp4Report { ok: boolean; problem: string | null; video: string | null; audio: string | null; faststart: boolean }

const text = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0

function has(b: Uint8Array, tag: string): boolean {
  const c = [...tag].map(x => x.charCodeAt(0))
  for (let i = 0; i + 4 <= b.length; i++) if (b[i] === c[0] && b[i + 1] === c[1] && b[i + 2] === c[2] && b[i + 3] === c[3]) return true
  return false
}

const FIX = 'Export it again as MP4 with H.264 video and AAC audio (HandBrake\'s "Fast 720p" preset does this). On an iPhone, set Settings → Camera → Formats → Most Compatible.'
/** Largest moov worth reading. A two-hour film's index is a few MB. */
const MAX_MOOV = 32 * 1024 * 1024

export async function inspectMp4(size: number, read: ByteReader): Promise<Mp4Report> {
  const fail = (problem: string, extra: Partial<Mp4Report> = {}): Mp4Report => ({ ok: false, problem, video: null, audio: null, faststart: false, ...extra })
  let at = 0, sawFtyp = false, sawMdat = false
  while (at + 8 <= size) {
    const head = await read(at, Math.min(at + 16, size))
    if (head.length < 8) break
    const type = text(head, 4)
    let len = u32(head, 0), hdr = 8
    if (len === 1) { len = u32(head, 8) * 2 ** 32 + u32(head, 12); hdr = 16 }
    else if (len === 0) len = size - at
    if (len < hdr) return fail('This does not look like a valid MP4 file.')
    if (at === 0 && type !== 'ftyp') return fail(`This is not an MP4 file. ${FIX}`)
    if (type === 'ftyp') sawFtyp = true
    if (type === 'mdat') sawMdat = true
    if (type === 'moov') {
      if (len > MAX_MOOV) return fail('The file\'s index is unusually large. Export it again.')
      const moov = await read(at, at + len)
      const video = has(moov, 'avc1') || has(moov, 'avc3') ? 'H.264' : has(moov, 'hvc1') || has(moov, 'hev1') ? 'HEVC' : has(moov, 'av01') ? 'AV1' : has(moov, 'vp09') ? 'VP9' : null
      const audio = has(moov, 'mp4a') ? 'AAC' : has(moov, 'ac-3') ? 'AC-3' : has(moov, 'ec-3') ? 'E-AC-3' : null
      const faststart = !sawMdat
      if (video !== 'H.264') return fail(`This video is ${video || 'in an unknown format'}, which not every browser can play. ${FIX}`, { video, audio, faststart })
      if (audio && audio !== 'AAC') return fail(`The audio is ${audio}, which browsers cannot play. ${FIX}`, { video, audio, faststart })
      if (!faststart) return fail('This MP4 is not optimised for streaming, so it would not start until the whole file had loaded. In HandBrake, tick "Web Optimized" and export again.', { video, audio, faststart })
      return { ok: true, problem: null, video, audio, faststart }
    }
    at += len
  }
  return fail(sawFtyp ? 'This MP4 has no index, so it may be incomplete. Export it again.' : `This is not an MP4 file. ${FIX}`)
}
