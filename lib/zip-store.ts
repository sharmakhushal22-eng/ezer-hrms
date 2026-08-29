// lib/zip-store.ts — a ZIP container with no compression, in ~60 lines.
//
// Used to hand HR one archive of per-employee payslip PDFs (A2 option ii). PDFs are
// already deflated internally, so a real compressor would gain nothing and would
// cost a dependency; STORE entries with a CRC-32 are a complete, standard ZIP that
// every unzipper opens. Runs in the browser — plain Uint8Array in, Uint8Array out.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export interface ZipEntry { name: string; data: Uint8Array }

export function zipStore(entries: ZipEntry[], when = new Date()): Uint8Array {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(when)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff]
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]

  for (const e of entries) {
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(name.length), ...u16(0),
      ...name,
    ])
    locals.push(local, e.data)
    centrals.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ...name,
    ]))
    offset += local.length + e.data.length
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0)
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ])
  const total = offset + cdSize + end.length
  const out = new Uint8Array(total)
  let p = 0
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length }
  return out
}
