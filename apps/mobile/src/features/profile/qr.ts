// src/features/profile/qr.ts — a small, dependency-free QR Code encoder.
//
// The website draws the gate code with the npm `qrcode` package
// (components/profile/IdCard.tsx → QRCode.toDataURL(url, { margin: 1,
// errorCorrectionLevel: 'M' })). That package renders through a canvas or a
// PNG encoder, neither of which exists in React Native. All the phone needs
// is the module matrix, which is pure arithmetic, so this file computes it and
// QrSvg.tsx draws it with react-native-svg.
//
// Same standard as the website (ISO/IEC 18004): byte mode, error correction
// level M (no boosting — `qrcode` does not boost either), the smallest version
// that fits, and the mask with the lowest penalty score. The algorithm follows
// Project Nayuki's reference QR generator (MIT). It was checked module-for-
// module against `qrcode` 1.5.4 (same text, same mask forced) across versions
// 1–40, and picks the same mask as `qrcode` for a typical gate-code URL.

// Error correction level M only — the only level the website uses.
// Index = version (0 is padding).
const ECC_CODEWORDS_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const NUM_ERROR_CORRECTION_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
/** Format-info bits for level M. */
const FORMAT_BITS_M = 0

const getBit = (x: number, i: number) => ((x >>> i) & 1) !== 0

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    r -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) r -= 36
  }
  return r
}
const dataCodewords = (ver: number) =>
  Math.floor(rawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK_M[ver] * NUM_ERROR_CORRECTION_BLOCKS_M[ver]

function utf8(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++ }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

// ── Reed–Solomon over GF(2^8), polynomial 0x11D ─────────────────────────────
function rsMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}
function rsDivisor(degree: number): number[] {
  const r: number[] = []
  for (let i = 0; i < degree - 1; i++) r.push(0)
  r.push(1)
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = rsMul(r[j], root)
      if (j + 1 < r.length) r[j] ^= r[j + 1]
    }
    root = rsMul(root, 0x02)
  }
  return r
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (r.shift() as number)
    r.push(0)
    divisor.forEach((coef, i) => { r[i] ^= rsMul(coef, factor) })
  }
  return r
}

/** The module matrix: `modules[y][x]` is true for a dark module. No quiet zone. */
export interface QrMatrix { size: number; version: number; mask: number; modules: boolean[][] }

/** Encode text (UTF-8, byte mode) at level M. `forceMask` exists for the verifier. */
export function encodeQr(text: string, forceMask = -1): QrMatrix {
  const bytes = utf8(text)
  // Smallest version that fits.
  let ver = 1
  let usedBits = 0
  for (; ; ver++) {
    if (ver > 40) throw new Error('Data too long for a QR code')
    const ccBits = ver <= 9 ? 8 : 16
    usedBits = 4 + ccBits + bytes.length * 8
    if (bytes.length < (1 << ccBits) && usedBits <= dataCodewords(ver) * 8) break
  }
  const ccBits = ver <= 9 ? 8 : 16

  // Bit stream: mode 0100, count, data, terminator, padding.
  const bb: number[] = []
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1) }
  push(0x4, 4)
  push(bytes.length, ccBits)
  for (const b of bytes) push(b, 8)
  const capBits = dataCodewords(ver) * 8
  push(0, Math.min(4, capBits - bb.length))
  push(0, (8 - (bb.length % 8)) % 8)
  for (let pad = 0xec; bb.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bb.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bb[i + j]
    data.push(v)
  }

  // Split into blocks, add ECC, interleave.
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS_M[ver]
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK_M[ver]
  const rawCodewords = Math.floor(rawDataModules(ver) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const div = rsDivisor(blockEccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < numShortBlocks) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) codewords.push(block[i])
    })
  }

  // ── Matrix ────────────────────────────────────────────────────────────────
  const size = ver * 4 + 17
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))
  const isFn: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))
  const setFn = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFn[y][x] = true }

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0) }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      const xx = x + dx, yy = y + dy
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)

  const alignPos: number[] = []
  if (ver > 1) {
    const numAlign = Math.floor(ver / 7) + 2
    const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2
    alignPos.push(6)
    for (let pos = size - 7; alignPos.length < numAlign; pos -= step) alignPos.splice(1, 0, pos)
  }
  const na = alignPos.length
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      setFn(alignPos[i] + dx, alignPos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }

  const drawFormat = (mask: number) => {
    const d = (FORMAT_BITS_M << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((d << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i))
    setFn(8, 7, getBit(bits, 6)); setFn(8, 8, getBit(bits, 7)); setFn(7, 8, getBit(bits, 8))
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(bits, i))
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(bits, i))
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(bits, i))
    setFn(8, size - 8, true)
  }
  drawFormat(0)

  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const c = getBit(bits, i), a = size - 11 + (i % 3), b = Math.floor(i / 3)
      setFn(a, b, c); setFn(b, a, c)
    }
  }

  // Codewords in the zig-zag.
  let bi = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFn[y][x] && bi < codewords.length * 8) {
          modules[y][x] = getBit(codewords[bi >>> 3], 7 - (bi & 7))
          bi++
        }
      }
    }
  }

  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let inv: boolean
      switch (m) {
        case 0: inv = (x + y) % 2 === 0; break
        case 1: inv = y % 2 === 0; break
        case 2: inv = x % 3 === 0; break
        case 3: inv = (x + y) % 3 === 0; break
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
      }
      if (!isFn[y][x] && inv) modules[y][x] = !modules[y][x]
    }
  }

  const penalty = () => {
    let result = 0
    const addHist = (len: number, h: number[]) => { if (h[0] === 0) len += size; h.pop(); h.unshift(len) }
    const count = (h: number[]) => {
      const n = h[1]
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0)
    }
    const terminate = (color: boolean, len: number, h: number[]) => {
      if (color) { addHist(len, h); len = 0 }
      len += size
      addHist(len, h)
      return count(h)
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let runColor = false, run = 0
        const h = [0, 0, 0, 0, 0, 0, 0]
        for (let b = 0; b < size; b++) {
          const c = pass === 0 ? modules[a][b] : modules[b][a]
          if (c === runColor) {
            run++
            if (run === 5) result += 3
            else if (run > 5) result++
          } else {
            addHist(run, h)
            if (!runColor) result += count(h) * 40
            runColor = c
            run = 1
          }
        }
        result += terminate(runColor, run, h) * 40
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x]
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3
    }
    let darkCount = 0
    for (const row of modules) for (const c of row) if (c) darkCount++
    const total = size * size
    const k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1
    result += k * 10
    return result
  }

  let mask = forceMask
  if (mask < 0) {
    let best = Infinity
    for (let i = 0; i < 8; i++) {
      applyMask(i); drawFormat(i)
      const p = penalty()
      if (p < best) { best = p; mask = i }
      applyMask(i)
    }
  }
  applyMask(mask)
  drawFormat(mask)
  return { size, version: ver, mask, modules }
}
