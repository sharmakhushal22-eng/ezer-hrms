// A small PostgREST + Storage + TUS stand-in over PGlite, for local end-to-end runs only.
// Same wire format as the real services for the calls this app makes, and the same 1,000
// row cap, so a query that would truncate in production truncates here too.
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { build, attachLateRoles, fkOf } from './db.mjs'

const here = path.dirname(new URL(import.meta.url).pathname)
const PORT = Number(process.env.RIG_PORT || 54400)
const ANON = 'rig-anon-key', SERVICE = 'rig-service-key', MAX_ROWS = 1000
const files = path.join(here, 'objects'); fs.rmSync(files, { recursive: true, force: true }); fs.mkdirSync(files, { recursive: true })

const db = await build(path.join(here, 'pgdata'))
await attachLateRoles(db)
const colTypes = new Map()
for (const r of (await db.query(`SELECT table_name t, column_name c, CASE WHEN data_type='ARRAY' THEN (udt_name::regtype)::text ELSE data_type END ty FROM information_schema.columns WHERE table_schema='public'`)).rows) {
  if (!colTypes.has(r.t)) colTypes.set(r.t, new Map()); colTypes.get(r.t).set(r.c, r.ty)
}
const q = s => `"${String(s).replace(/"/g, '')}"`
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers })
  res.end(body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Location, Upload-Offset, Upload-Length, Tus-Resumable, Content-Range' }
const readBody = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))) })
const roleOf = req => {
  const key = req.headers.apikey || String(req.headers.authorization || '').replace(/^Bearer /i, '')
  return key === SERVICE ? 'service_role' : key === ANON ? 'anon' : String(req.headers.authorization || '').replace(/^Bearer /i, '') === SERVICE ? 'service_role' : 'anon'
}

// ── Filters ─────────────────────────────────────────────────────────────────
function splitTop(s, sep = ',') { const out = []; let d = 0, q2 = false, cur = ''; for (const ch of s) { if (ch === '"') q2 = !q2; if (!q2 && ch === '(') d++; if (!q2 && ch === ')') d--; if (ch === sep && !d && !q2) { out.push(cur); cur = '' } else cur += ch } if (cur) out.push(cur); return out }
function cond(col, expr, params, table) {
  let neg = false
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4) }
  const i = expr.indexOf('.'); const op = expr.slice(0, i); const val = expr.slice(i + 1)
  const c = q(col), ty = colTypes.get(table)?.get(col) || 'text'
  const P = v => { params.push(v); return `$${params.length}::text::${ty.endsWith('[]') ? ty.slice(0, -2) : ty}` }
  const T = v => { params.push(v); return `$${params.length}::text` }
  let sql
  if (op === 'is') sql = `${c} IS ${val === 'null' ? 'NULL' : val === 'true' ? 'TRUE' : val === 'false' ? 'FALSE' : 'NULL'}`
  else if (op === 'in') {
    const items = splitTop(val.replace(/^\(|\)$/g, '')).map(v => v.replace(/^"|"$/g, ''))
    sql = items.length ? `${c} IN (${items.map(P).join(',')})` : 'false'
  } else if (op === 'like') sql = `${c}::text LIKE ${T(val.replace(/\*/g, '%'))}`
  else if (op === 'ilike') sql = `${c}::text ILIKE ${T(val.replace(/\*/g, '%'))}`
  else if (op === 'cs') { params.push(val); sql = `${c} @> $${params.length}::text::${ty}` }
  else sql = `${c} ${{ eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} ${P(val)}`
  return neg ? `NOT (${sql})` : sql
}
function where(sp, table) {
  const params = [], parts = []
  for (const [k, v] of sp) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue
    if (k === 'or') {
      const items = splitTop(v.replace(/^\(|\)$/g, '')).map(it => { const i = it.indexOf('.'); return cond(it.slice(0, i), it.slice(i + 1), params, table) })
      parts.push(`(${items.join(' OR ')})`)
    } else parts.push(cond(k, v, params, table))
  }
  return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', params }
}
function orderBy(sp) {
  const o = sp.get('order'); if (!o) return ''
  return ' ORDER BY ' + o.split(',').map(x => { const [c, dir, n] = x.split('.'); return `${q(c)} ${dir === 'desc' ? 'DESC' : 'ASC'}${n === 'nullsfirst' ? ' NULLS FIRST' : n === 'nullslast' ? ' NULLS LAST' : ''}` }).join(', ')
}
function parseSelect(s) {
  const cols = [], embeds = []
  for (const raw of splitTop(String(s || '*').replace(/\s+/g, ''))) {
    const m = raw.match(/^(?:([a-zA-Z0-9_]+):)?([a-zA-Z0-9_]+)(?:!([a-zA-Z0-9_]+))?\((.*)\)$/)
    if (m) embeds.push({ alias: m[1] || m[2], table: m[2], hint: m[3], cols: m[4] })
    // A JSON field as text, PostgREST's col->>key, named by its alias or its key.
    else if (/->>/.test(raw)) { const j = raw.match(/^(?:([a-zA-Z0-9_]+):)?([a-zA-Z0-9_]+)->>([a-zA-Z0-9_]+)$/); if (j) cols.push(`${q(j[2])}->>'${j[3]}' AS ${q(j[1] || j[3])}`) }
    else { const a = raw.match(/^(?:([a-zA-Z0-9_]+):)?([a-zA-Z0-9_*]+)$/); if (a) cols.push(a[2] === '*' ? '*' : a[1] ? `${q(a[2])} AS ${q(a[1])}` : q(a[2])) }
  }
  return { cols, embeds }
}
async function embed(tx, table, rows, embeds) {
  for (const e of embeds) {
    const fks = fkOf[table] || {}
    let col = e.hint && colTypes.get(table)?.has(e.hint) ? e.hint : Object.keys(fks).find(c => fks[c].table === e.table && (!e.hint || e.hint === `${table}_${c}_fkey`))
    if (col) {
      const ids = [...new Set(rows.map(r => r[col]).filter(Boolean))]
      const got = ids.length ? (await tx.query(`SELECT * FROM ${q(e.table)} WHERE id = ANY($1::uuid[])`, [ids])).rows : []
      for (const r of rows) r[e.alias] = got.find(g => g.id === r[col]) || null
    } else {
      const back = Object.keys(fkOf[e.table] || {}).find(c => fkOf[e.table][c].table === table)
      const ids = rows.map(r => r.id)
      const got = back && ids.length ? (await tx.query(`SELECT * FROM ${q(e.table)} WHERE ${q(back)} = ANY($1::uuid[])`, [ids])).rows : []
      for (const r of rows) r[e.alias] = got.filter(g => g[back] === r.id)
    }
  }
}
const lit = v => v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)
const litFor = (v, ty) => {
  if (v === null || v === undefined) return null
  if (Array.isArray(v) && ty.endsWith('[]')) return '{' + v.map(x => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',') + '}'
  return lit(v)
}

async function rest(req, res, url, role) {
  const table = decodeURIComponent(url.pathname.split('/')[3] || '')
  const sp = url.searchParams, prefer = String(req.headers.prefer || ''), single = /vnd\.pgrst\.object/.test(String(req.headers.accept || ''))
  const body = await readBody(req)
  const wantCount = /count=exact/.test(prefer)
  try {
    const out = await db.transaction(async tx => {
      await tx.exec(`SET LOCAL ROLE ${role}`)
      if (table === 'rpc') {
        const fn = decodeURIComponent(url.pathname.split('/')[4])
        const args = body.length ? JSON.parse(body) : {}
        const sig = (await tx.query(`SELECT proargnames n, pg_get_function_identity_arguments(oid) a, proretset s, prorettype::regtype::text r FROM pg_proc WHERE proname=$1 ORDER BY pronargs DESC LIMIT 1`, [fn])).rows[0]
        if (!sig) throw Object.assign(new Error(`Could not find the function public.${fn}`), { code: 'PGRST202' })
        const types = Object.fromEntries(sig.a.split(/,\s*(?![^(]*\))/).filter(Boolean).map(x => { const m = x.trim().match(/^(\S+)\s+(.+?)(?:\s+DEFAULT.*)?$/); return [m[1], m[2]] }))
        const params = [], named = Object.entries(args).map(([k, v]) => { params.push(litFor(v, types[k] || 'text')); return `${q(k)} => $${params.length}::text::${types[k] || 'text'}` }).join(', ')
        const rowy = sig.s
        const base = `${q(fn)}(${named})`
        if (rowy) {
          const scalar = !/record|TABLE/i.test(sig.r) && !colTypes.has(sig.r)
          const inner = scalar ? `SELECT r AS value FROM ${base} AS r` : `SELECT * FROM ${base}`
          const w = where(sp, '__none')
          const limit = Math.min(Number(sp.get('limit') ?? MAX_ROWS), MAX_ROWS), offset = Number(sp.get('offset') ?? 0)
          const total = wantCount ? Number((await tx.query(`SELECT count(*) c FROM (${inner}) x`, params)).rows[0].c) : null
          const rows = (await tx.query(`SELECT * FROM (${inner}) x LIMIT ${limit} OFFSET ${offset}`, params)).rows
          return { status: 200, json: scalar ? rows.map(r => r.value) : rows, total, offset, w }
        }
        const r = (await tx.query(`SELECT ${base} AS value`, params)).rows[0]
        return { status: 200, json: r?.value ?? null }
      }
      if (!colTypes.has(table)) throw Object.assign(new Error(`Could not find the table 'public.${table}' in the schema cache`), { code: 'PGRST205' })
      const { cols, embeds } = parseSelect(sp.get('select'))
      const types = colTypes.get(table)
      const selectList = cols.length ? cols.join(',') : '*'
      const needAll = embeds.length ? ',*' : ''
      const returning = /return=representation/.test(prefer)
      if (req.method === 'GET' || req.method === 'HEAD') {
        const w = where(sp, table)
        const limit = Math.min(Number(sp.get('limit') ?? MAX_ROWS), MAX_ROWS), offset = Number(sp.get('offset') ?? 0)
        const total = wantCount ? Number((await tx.query(`SELECT count(*) c FROM ${q(table)}${w.sql}`, w.params)).rows[0].c) : null
        const rows = (await tx.query(`SELECT ${selectList}${needAll} FROM ${q(table)}${w.sql}${orderBy(sp)} LIMIT ${limit} OFFSET ${offset}`, w.params)).rows
        await embed(tx, table, rows, embeds)
        return { status: 200, json: rows, total, offset, single }
      }
      if (req.method === 'POST') {
        const list = [].concat(JSON.parse(body.length ? body : '[]'))
        if (!list.length) return { status: 201, json: [] }
        const keys = [...new Set(list.flatMap(o => Object.keys(o)))]
        const params = [], values = list.map(o => '(' + keys.map(k => {
          if (!(k in o)) return 'DEFAULT'
          params.push(litFor(o[k], types.get(k) || 'text')); return `$${params.length}::text::${types.get(k) || 'text'}`
        }).join(',') + ')').join(',')
        let conflict = ''
        if (/resolution=/.test(prefer) || sp.get('on_conflict')) {
          const target = sp.get('on_conflict'); const tgt = target ? `(${target.split(',').map(q).join(',')})` : ''
          if (/ignore-duplicates/.test(prefer)) conflict = ` ON CONFLICT ${tgt} DO NOTHING`
          else conflict = ` ON CONFLICT ${tgt} DO UPDATE SET ${keys.filter(k => !(target || '').split(',').includes(k)).map(k => `${q(k)}=EXCLUDED.${q(k)}`).join(',') || `${q(keys[0])}=EXCLUDED.${q(keys[0])}`}`
        }
        const rows = (await tx.query(`INSERT INTO ${q(table)} (${keys.map(q).join(',')}) VALUES ${values}${conflict} RETURNING ${returning ? selectList + needAll : '1 AS x'}`, params)).rows
        await embed(tx, table, rows, embeds)
        return { status: 201, json: returning ? rows : undefined, single }
      }
      if (req.method === 'PATCH') {
        const patch = JSON.parse(body), keys = Object.keys(patch)
        const w = where(sp, table)
        const set = keys.map(k => { w.params.push(litFor(patch[k], types.get(k) || 'text')); return `${q(k)}=$${w.params.length}::text::${types.get(k) || 'text'}` }).join(',')
        const rows = (await tx.query(`UPDATE ${q(table)} SET ${set}${w.sql} RETURNING ${returning ? selectList + needAll : '1 AS x'}`, w.params)).rows
        return { status: returning ? 200 : 204, json: returning ? rows : undefined, single }
      }
      if (req.method === 'DELETE') {
        const w = where(sp, table)
        const rows = (await tx.query(`DELETE FROM ${q(table)}${w.sql} RETURNING ${returning ? selectList : '1 AS x'}`, w.params)).rows
        return { status: returning ? 200 : 204, json: returning ? rows : undefined, single }
      }
      return { status: 405, json: { message: 'method' } }
    })
    const h = {}
    if (out.total != null) { const n = (out.json || []).length; h['Content-Range'] = `${n ? `${out.offset}-${out.offset + n - 1}` : '*'}/${out.total}` }
    if (out.single) {
      const a = out.json || []
      if (a.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${a.length} rows`, hint: null })
      return send(res, out.status, a[0], h)
    }
    return send(res, out.status, out.json === undefined ? undefined : JSON.stringify(out.json), h)
  } catch (e) {
    const status = e.code === '42501' ? 403 : /PGRST/.test(e.code || '') ? 404 : 400
    return send(res, status, { code: e.code, message: e.message, details: e.detail || null, hint: e.hint || null })
  }
}

// ── Storage ─────────────────────────────────────────────────────────────────
const objPath = (b, p) => path.join(files, b, p)
const signTok = (b, p, exp, kind) => crypto.createHmac('sha256', 'rig').update(`${kind}:${b}/${p}:${exp}`).digest('hex') + `.${exp}`
const okTok = (b, p, t, kind) => { const [, exp] = String(t).split('.'); return exp && Number(exp) > Date.now() && t === signTok(b, p, exp, kind) }
const tus = new Map()
const save = (b, p, buf) => { const f = objPath(b, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf) }

async function storage(req, res, url, role) {
  const parts = url.pathname.split('/').slice(3).map(decodeURIComponent)
  const authed = role === 'service_role'
  if (parts[0] === 'upload' && parts[1] === 'resumable') {
    if (req.method === 'OPTIONS') return send(res, 204)
    if (req.method === 'POST') {
      const token = req.headers['x-signature']
      const meta = Object.fromEntries(String(req.headers['upload-metadata'] || '').split(',').map(kv => { const [k, v] = kv.trim().split(' '); return [k, v ? Buffer.from(v, 'base64').toString() : ''] }))
      const { bucketName: b, objectName: p } = meta
      if (!okTok(b, p, token, 'upload')) return send(res, 403, { message: 'bad signature' })
      const id = crypto.randomUUID()
      tus.set(id, { b, p, len: Number(req.headers['upload-length']), buf: Buffer.alloc(0) })
      return send(res, 201, undefined, { Location: `http://127.0.0.1:${PORT}/storage/v1/upload/resumable/sign/${id}`, 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0' })
    }
    const u = tus.get(parts[3] || parts[2])
    if (!u) return send(res, 404, { message: 'no upload' })
    if (req.method === 'HEAD') return send(res, 200, undefined, { 'Upload-Offset': String(u.buf.length), 'Upload-Length': String(u.len), 'Tus-Resumable': '1.0.0' })
    if (req.method === 'PATCH') {
      const chunk = await readBody(req)
      const last = u.buf.length + chunk.length >= u.len
      if (!last && chunk.length !== 6 * 1024 * 1024) return send(res, 400, { message: 'chunks must be exactly 6 MB' })
      u.buf = Buffer.concat([u.buf, chunk])
      if (u.buf.length >= u.len) save(u.b, u.p, u.buf)
      return send(res, 204, undefined, { 'Upload-Offset': String(u.buf.length), 'Tus-Resumable': '1.0.0' })
    }
  }
  if (parts[0] !== 'object') return send(res, 404, { message: 'nope' })
  if (parts[1] === 'upload' && parts[2] === 'sign') {
    const b = parts[3], p = parts.slice(4).join('/')
    if (req.method === 'POST') {
      if (!authed) return send(res, 403, { message: 'forbidden' })
      const t = signTok(b, p, Date.now() + 2 * 3600e3, 'upload')
      return send(res, 200, { url: `/object/upload/sign/${b}/${p}?token=${t}` })
    }
    if (!okTok(b, p, url.searchParams.get('token'), 'upload')) return send(res, 403, { message: 'bad token' })
    let buf = await readBody(req)
    const ct = String(req.headers['content-type'] || '')
    const m = ct.match(/boundary=(.+)$/)
    if (m) { const s = buf.indexOf('\r\n\r\n') + 4; const e = buf.lastIndexOf(`\r\n--${m[1]}`); buf = buf.subarray(s, e) }
    save(b, p, buf)
    return send(res, 200, { Key: `${b}/${p}` })
  }
  if (parts[1] === 'sign') {
    const b = parts[2], p = parts.slice(3).join('/')
    if (req.method === 'POST') {
      if (!authed) return send(res, 403, { message: 'forbidden' })
      const body = JSON.parse((await readBody(req)) || '{}')
      if (body.paths) return send(res, 200, body.paths.map(x => { const exp = Date.now() + body.expiresIn * 1000; return { path: x, signedURL: `/object/sign/${b}/${x}?token=${signTok(b, x, exp, 'read')}`, error: null } }))
      const exp = Date.now() + body.expiresIn * 1000
      return send(res, 200, { signedURL: `/object/sign/${b}/${p}?token=${signTok(b, p, exp, 'read')}` })
    }
    if (!okTok(b, p, url.searchParams.get('token'), 'read')) return send(res, 400, { message: 'InvalidJWT' })
    const f = objPath(b, p)
    if (!fs.existsSync(f)) return send(res, 404, { message: 'not found' })
    const size = fs.statSync(f).size
    const type = p.endsWith('.mp4') ? 'video/mp4' : p.endsWith('.pdf') ? 'application/pdf' : p.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'
    const range = String(req.headers.range || '').match(/bytes=(\d+)-(\d*)/)
    if (range) {
      const s = Number(range[1]), e = range[2] ? Number(range[2]) : size - 1
      res.writeHead(206, { ...cors, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 })
      return fs.createReadStream(f, { start: s, end: e }).pipe(res)
    }
    res.writeHead(200, { ...cors, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size })
    return fs.createReadStream(f).pipe(res)
  }
  if (parts[1] === 'list') {
    if (!authed) return send(res, 403, { message: 'forbidden' })
    const b = parts[2], body = JSON.parse((await readBody(req)) || '{}'), dir = objPath(b, body.prefix || '')
    return send(res, 200, fs.existsSync(dir) ? fs.readdirSync(dir).map(name => ({ name, id: name })) : [])
  }
  return send(res, 404, { message: 'unsupported storage call' })
}

const broadcasts = []
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (req.method === 'OPTIONS') return send(res, 204)
  const role = roleOf(req)
  if (url.pathname.startsWith('/rest/v1/')) return rest(req, res, url, role)
  if (url.pathname.startsWith('/storage/v1/')) return storage(req, res, url, role)
  if (url.pathname === '/__sql' && role === 'service_role') {
    const { sql, params } = JSON.parse(await readBody(req))
    try { return send(res, 200, (await db.query(sql, params || [])).rows) } catch (e) { return send(res, 400, { message: e.message }) }
  }
  // Realtime broadcast, as the webinar room's server sends it: kept, so the suite can read what
  // went out and on which channel. Only the service key may send, as on the real service.
  if (url.pathname === '/realtime/v1/api/broadcast' && req.method === 'POST') {
    if (role !== 'service_role') return send(res, 401, { message: 'service key required' })
    const b = JSON.parse((await readBody(req)) || '{}')
    broadcasts.push(...(b.messages || []))
    return send(res, 202)
  }
  if (url.pathname === '/__rig/broadcasts' && role === 'service_role') return send(res, 200, broadcasts)
  if (url.pathname.startsWith('/auth/v1/')) return send(res, 401, { message: 'no session' })
  return send(res, 404, { message: 'nope' })
})
server.listen(PORT, '127.0.0.1', () => console.log(`rig ready on ${PORT}`))
