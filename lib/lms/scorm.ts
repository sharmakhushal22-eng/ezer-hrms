// lib/lms/scorm.ts — SCORM packages on the server: reading one when it is uploaded, serving
// its files to the player, and saving what the learner's run reported. Server only.
//
// HOW A PAGE OF THE PACKAGE REACHES THE LEARNER. The player frames
//   /learn-scorm/<token>/<path inside the zip>
// The token is signed here after the entitlement check in openLesson, names the package and
// the learner's enrolment, and lapses after a working day. Because the token is a folder in the
// address, every relative link inside the package (scripts, images, the next page) carries it
// too, with no cookie and no header. The route (app/learn-scorm) checks it and streams that
// one file out of the zip with a range request; HTML pages get the SCORM API put at the top
// (runtimeScript, lib/lms/scorm-core.ts).
import crypto from 'node:crypto'
import { BUCKET, LmsError, must, notFound, sb } from './server'
import {
  cleanCmi, findEntry, manifestPath, parseManifest, readZipIndex, runtimeScript, scormOutcome, startingCmi,
  type Cmi, type ScormManifest, type ScormVersion, type ZipEntry, type ZipIndex,
} from './scorm-core'

/** A working day: long enough for a long module, short enough that a copied address dies. */
const TOKEN_TTL_S = 10 * 3600
const SIGNED_URL_TTL_S = 3600

// ── The address token ───────────────────────────────────────────────────────
interface ScormToken {
  a: string            // asset
  c: string            // company
  e: string | null     // enrolment; null for an admin's preview, which saves nothing
  l: string | null     // lesson
  u: string            // who the package is told the learner is
  n: string            // their name, as the package will show it
  r: 0 | 1             // read only: someone viewing another person's portal, or a preview
  x: number            // expires, epoch seconds
}

const key = () => crypto.createHmac('sha256', process.env.ESS_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').update('ezer-learn:scorm:v1').digest()
const mac = (body: string) => crypto.createHmac('sha256', key()).update(body).digest('base64url').slice(0, 32)

export function issueScormToken(t: Omit<ScormToken, 'x'>, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...t, x: Math.floor(now / 1000) + TOKEN_TTL_S })).toString('base64url')
  return `${body}.${mac(body)}`
}

export function verifyScormToken(token: string, now = Date.now()): ScormToken | null {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) return null
  const want = mac(body)
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ScormToken
    return t.x * 1000 > now ? t : null
  } catch { return null }
}

// ── Reading the zip in storage ──────────────────────────────────────────────
interface Pkg {
  storagePath: string
  size: number
  version: ScormVersion
  mastery: number | null
  index: ZipIndex
  url: string
  urlUntil: number
  /** Where each file's bytes start, once its local header has been read. */
  dataAt: Map<string, number>
  loadedAt: number
}
const packages = new Map<string, Pkg>()
const PKG_CACHE_MS = 20 * 60_000

async function signed(path: string): Promise<string> {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_S)
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not sign the package address')
  return data.signedUrl
}

async function readRange(url: string, start: number, end: number): Promise<Uint8Array> {
  if (end <= start) return new Uint8Array(0)
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } })
  if (r.status !== 206 && r.status !== 200) throw new Error(`Storage answered ${r.status} for a package range`)
  const buf = new Uint8Array(await r.arrayBuffer())
  // A server that ignores Range sends the whole file: cut out the part asked for.
  return r.status === 200 ? buf.subarray(start, end) : buf
}

async function loadPackage(assetId: string): Promise<Pkg> {
  const hit = packages.get(assetId)
  const now = Date.now()
  if (hit && now - hit.loadedAt < PKG_CACHE_MS) {
    if (hit.urlUntil - now < 10 * 60_000) { hit.url = await signed(hit.storagePath); hit.urlUntil = now + SIGNED_URL_TTL_S * 1000 }
    return hit
  }
  const { data: a } = await sb.from('lms_assets').select('storage_path, size_bytes, scorm, status').eq('id', assetId).maybeSingle()
  if (!a?.storage_path || !a.scorm?.index) throw notFound('That package')
  const pkg: Pkg = {
    storagePath: a.storage_path, size: Number(a.size_bytes), version: a.scorm.version, mastery: a.scorm.mastery ?? null,
    index: a.scorm.index, url: await signed(a.storage_path), urlUntil: now + SIGNED_URL_TTL_S * 1000, dataAt: new Map(), loadedAt: now,
  }
  packages.set(assetId, pkg)
  if (packages.size > 50) packages.delete(packages.keys().next().value!)
  return pkg
}

const LOCAL_HEADER = 30
/** Where a file's bytes start: its local header can carry a different "extra" field from the
 *  central directory's, so it has to be read once. Small files are read whole in the same trip. */
async function locate(pkg: Pkg, name: string, e: ZipEntry, wantBody: boolean): Promise<{ start: number; body: Uint8Array | null }> {
  const [off, csize] = e
  const known = pkg.dataAt.get(name)
  if (known != null) return { start: known, body: wantBody ? await readRange(pkg.url, known, known + csize) : null }
  const guess = LOCAL_HEADER + name.length * 4 + 256
  const head = await readRange(pkg.url, off, off + guess + (wantBody ? csize : 0))
  const n = head[26] | (head[27] << 8), x = head[28] | (head[29] << 8)
  const start = off + LOCAL_HEADER + n + x
  pkg.dataAt.set(name, start)
  if (!wantBody) return { start, body: null }
  const rel = LOCAL_HEADER + n + x
  if (rel + csize <= head.length) return { start, body: head.subarray(rel, rel + csize) }
  return { start, body: await readRange(pkg.url, start, start + csize) }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Read a whole file out of the package. */
async function fileBytes(pkg: Pkg, name: string, e: ZipEntry): Promise<Uint8Array> {
  const { body } = await locate(pkg, name, e, true)
  if (e[3] === 0) return body!
  if (e[3] === 8) return inflate(body!)
  throw new LmsError('That package uses a compression this player cannot read. Re-export it as a standard zip.')
}

// ── On upload: is this a package, and where does it start? ─────────────────
export interface PackageSummary { version: ScormVersion; title: string; launch: string; mastery: number | null; files: number }

/** Read an uploaded zip's manifest and table of contents, and keep them on the asset. Refuses
 *  a zip that is not a SCORM package, saying why, so the author hears it at upload time. */
export async function indexPackage(assetId: string): Promise<PackageSummary> {
  const { data: a } = await sb.from('lms_assets').select('id, storage_path, size_bytes').eq('id', assetId).maybeSingle()
  if (!a?.storage_path) throw notFound('That file')
  const url = await signed(a.storage_path)
  const size = Number(a.size_bytes)
  const index = await readZipIndex(size, (s, e) => readRange(url, s, e)).catch(e => { throw new LmsError(String(e?.message || 'That file is not a zip.')) })
  const mp = manifestPath(index)
  if (!mp) throw new LmsError('This zip has no imsmanifest.xml, so it is not a SCORM package. Export it from your authoring tool as SCORM 1.2 or SCORM 2004.')
  const pkg: Pkg = { storagePath: a.storage_path, size, version: '1.2', mastery: null, index, url, urlUntil: Date.now() + SIGNED_URL_TTL_S * 1000, dataAt: new Map(), loadedAt: Date.now() }
  const xml = new TextDecoder('utf-8').decode(await fileBytes(pkg, mp, index[mp]))
  let m: ScormManifest
  try { m = parseManifest(xml, mp.split('/').slice(0, -1).join('/')) } catch (e: any) { throw new LmsError(e?.message || 'imsmanifest.xml could not be read.') }
  if (!findEntry(index, m.launch.split('?')[0])) throw new LmsError(`The manifest opens ${m.launch.split('?')[0]}, which is not in the zip.`)
  must(await sb.from('lms_assets').update({ kind: 'SCORM', scorm: { ...m, files: Object.keys(index).length, index } }).eq('id', assetId).select('id'))
  packages.delete(assetId)
  return { ...m, files: Object.keys(index).length }
}

// ── Serving one file ────────────────────────────────────────────────────────
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', xhtml: 'application/xhtml+xml', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', xml: 'application/xml', xsd: 'application/xml', txt: 'text/plain; charset=utf-8', vtt: 'text/vtt',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf', swf: 'application/x-shockwave-flash', wasm: 'application/wasm',
}
const typeOf = (name: string) => TYPES[name.split('.').pop()!.toLowerCase()] || 'application/octet-stream'

const COMMON: Record<string, string> = {
  // The frame is sandboxed with an opaque origin, so fonts, fetch() and module scripts it loads
  // are cross-origin requests to us. The token in the address is the permission.
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

function page(status: number, words: string) {
  return new Response(`<!doctype html><meta charset="utf-8"><body style="font:15px system-ui,sans-serif;padding:32px;line-height:1.6">${words}</body>`,
    { status, headers: { ...COMMON, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

/** The learner's saved data and the package's API, put first in the page so it exists before
 *  any of the package's own scripts look for it. */
async function withApi(html: string, t: ScormToken, token: string, pkg: Pkg): Promise<string> {
  let saved: { cmi?: Cmi; total_s?: number } | null = null
  if (t.e && t.l) {
    const { data } = await sb.from('lms_lesson_progress').select('scorm').eq('enrollment_id', t.e).eq('lesson_id', t.l).maybeSingle()
    saved = (data?.scorm as any) || null
  }
  const cmi = startingCmi(pkg.version, saved?.cmi || null, { id: t.u, name: t.n }, pkg.mastery, Number(saved?.total_s || 0), !!t.r)
  const tag = `<script>${runtimeScript({ version: pkg.version, token, cmi, readOnly: !!t.r })}</script>`
  const head = /<head\b[^>]*>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
  const top = /<html\b[^>]*>/i.exec(html)
  if (top) return html.slice(0, top.index + top[0].length) + tag + html.slice(top.index + top[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  return doctype ? doctype[0] + tag + html.slice(doctype[0].length) : tag + html
}

export async function serveFile(token: string, parts: string[], req: Request): Promise<Response> {
  const t = verifyScormToken(token)
  if (!t) return page(403, 'This lesson link has expired. Close it and open the lesson again from EZER Learn.')
  let pkg: Pkg
  try { pkg = await loadPackage(t.a) } catch { return page(404, 'This package is no longer available.') }
  const found = findEntry(pkg.index, parts.join('/'))
  if (!found) return page(404, 'This file is not part of the package.')
  const { name, entry } = found
  const type = typeOf(name)

  if (/^(text\/html|application\/xhtml)/.test(type)) {
    const html = new TextDecoder('utf-8').decode(await fileBytes(pkg, name, entry))
    return new Response(await withApi(html, t, token, pkg), { headers: { ...COMMON, 'Content-Type': type, 'Cache-Control': 'no-store' } })
  }

  const cache = { ...COMMON, 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' }
  const [, csize, usize, method] = entry
  if (method === 8) {
    // Compressed: inflated as it streams, so even a large file never sits whole in memory.
    const { start } = await locate(pkg, name, entry, false)
    const up = await fetch(pkg.url, { headers: { Range: `bytes=${start}-${start + csize - 1}` } })
    if (!up.ok || !up.body) return page(502, 'Storage did not answer. Try again.')
    return new Response(up.body.pipeThrough(new DecompressionStream('deflate-raw')), { headers: { ...cache, 'Content-Length': String(usize) } })
  }
  if (method !== 0) return page(415, 'This file uses a compression the player cannot read.')

  // Stored as is (how authoring tools keep video and audio): ranges map straight onto the zip,
  // so the browser can seek a long video without fetching all of it.
  const { start } = await locate(pkg, name, entry, false)
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '')
  let from = 0, to = usize - 1
  if (range) {
    if (range[1] === '' && range[2] !== '') { from = Math.max(0, usize - Number(range[2])) }
    else { from = Number(range[1] || 0); if (range[2] !== '') to = Math.min(usize - 1, Number(range[2])) }
    if (from > to || from >= usize) return new Response(null, { status: 416, headers: { ...cache, 'Content-Range': `bytes */${usize}` } })
  }
  const up = await fetch(pkg.url, { headers: { Range: `bytes=${start + from}-${start + to}` } })
  if (!up.ok || !up.body) return page(502, 'Storage did not answer. Try again.')
  const headers: Record<string, string> = { ...cache, 'Accept-Ranges': 'bytes', 'Content-Length': String(to - from + 1) }
  if (range) headers['Content-Range'] = `bytes ${from}-${to}/${usize}`
  return new Response(req.method === 'HEAD' ? null : up.body, { status: range ? 206 : 200, headers })
}

// ── The learner's run ───────────────────────────────────────────────────────
export interface SavedRun { cmi: Cmi; launches: Record<string, number>; total_s: number; label: string; score_pct: number | null; updated_at: string }

/** What a commit from the package changes. Pure, so the engine and its tests agree. */
export function nextRun(prev: SavedRun | null, version: ScormVersion, mastery: number | null, body: { cmi?: unknown; launch?: unknown; session?: unknown }, now = Date.now()) {
  const cmi = cleanCmi(body.cmi)
  const launches = { ...(prev?.launches || {}) }
  const launch = String(body.launch || '').slice(0, 24)
  // A page's own clock, capped at a working day: it only ever adds to the time on record.
  if (launch) launches[launch] = Math.max(launches[launch] || 0, Math.min(10 * 3600, Math.max(0, Math.round(Number(body.session) || 0))))
  const keep = Object.entries(launches).slice(-100)
  const total = keep.reduce((s, [, v]) => s + v, 0)
  const outcome = scormOutcome(version, cmi, mastery)
  const run: SavedRun = { cmi, launches: Object.fromEntries(keep), total_s: total, label: outcome.label, score_pct: outcome.scorePct, updated_at: new Date(now).toISOString() }
  return { run, outcome }
}
