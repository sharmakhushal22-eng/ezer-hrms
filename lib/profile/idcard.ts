// lib/profile/idcard.ts — the rotating QR behind the digital ID card.
//
// Adapted from the vendor drop's lib/profile/idcard.ts. The scheme is theirs
// and it is a good one; what changed is the service client (rmsServiceClient,
// not their svc()) and the column names this database actually uses.
//
//   token   EZ1.<payload>.<sig>
//   payload base64url JSON { v, e, c, n, x }
//             v  format version
//             e  employee id
//             c  card_version — bumped on revoke, kills every old token
//             n  jti, registered in id_card_tokens
//             x  expiry, epoch seconds
//   sig     HMAC-SHA256(employeeSecret + ID_CARD_PEPPER, payload), 24 bytes
//
// WHY A STOLEN CODE IS USELESS
//
//   1. It lives 30 seconds. A screenshot forwarded on WhatsApp is dead
//      before it arrives.
//   2. It is single use. consume_id_token marks the jti; a second scan says
//      "already used" and lands in id_card_scans for HR to see.
//   3. It carries no PII. The token is opaque — the reader must call our
//      verify endpoint, which decides what to reveal.
//   4. It is bound to card_version. Phone lost, HR revokes, and every token
//      that has ever existed stops verifying at that moment.
//   5. The signature needs a per-employee secret that never leaves the
//      server.
//   6. Issue is rate limited, so nobody can farm a batch to use later.
//
// The screen asks for a fresh token every 15 seconds while one lives 30, so
// there is always a live overlap and the guard never meets a dead code.

import crypto from 'node:crypto'
import { rmsServiceClient as sb } from '@/lib/rms/server'

export const TOKEN_TTL_SECONDS = 30
export const REFRESH_SECONDS = 15

const b64u = (b: Buffer) => b.toString('base64url')

/** Server-only, and required. A short or missing pepper is a configuration
 *  error rather than something to paper over with a default — a predictable
 *  pepper would make every signature forgeable. */
function pepper(): string {
  const p = process.env.ID_CARD_PEPPER
  if (!p || p.length < 32) {
    throw new Error('ID_CARD_PEPPER is missing or shorter than 32 characters.')
  }
  return p
}

const sign = (payload: string, secret: string) =>
  b64u(crypto.createHmac('sha256', secret + pepper()).update(payload).digest().subarray(0, 24))

export interface IssuedToken {
  token: string
  url: string
  expiresAt: number
  ttl: number
  refresh: number
  cardNo: string
  validTill: string | null
  accessZones: string[]
}

interface Cred {
  secret: string; card_version: number; card_no: string
  state: string; valid_till: string | null; access_zones: string[] | null
}

/** Called by /api/ess/id-card/token every REFRESH_SECONDS. */
/** A scannable absolute URL, always.
 *
 *  This used to be `process.env.NEXT_PUBLIC_APP_URL ?? ''`, which fails two
 *  ways that both look like "the QR does not work":
 *
 *    1. Env unset -> base is '' and the QR encodes `/verify/<token>`, a bare
 *       PATH. A camera cannot resolve that against anything, so it offers a
 *       web search instead of opening the card.
 *    2. Env set to a loopback host -> the QR encodes localhost. Scanned from a
 *       phone that resolves to the PHONE, not this machine, so it is
 *       unreachable by construction. That is the dev case, and it is exactly
 *       what "the QR is not working" looks like on a desk.
 *
 *  So a loopback env value is treated as absent and the request's own origin
 *  wins: open the portal on a LAN address and the code points back at the same
 *  address the browser already reached. A real deployment sets the env to its
 *  domain and that keeps winning, which is what it is for. */
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i

export function verifyBase(requestOrigin?: string | null): string {
  const env = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '')
  if (env && !LOOPBACK.test(env)) return env
  const origin = (requestOrigin ?? '').trim().replace(/\/+$/, '')
  if (origin) return origin
  return env                       // loopback is still better than a bare path
}

export async function issueToken(employeeId: string, requestOrigin?: string | null): Promise<IssuedToken> {
  let { data: cred } = await sb.from('id_card_credentials')
    .select('secret, card_version, card_no, state, valid_till, access_zones')
    .eq('employee_id', employeeId).maybeSingle()

  // 092's seeding step never ran, so most employees have no credential row.
  // Rather than fail with "no card" and wait on a migration, mint one on
  // first use — issue_id_card is idempotent and rotates on conflict.
  if (!cred) {
    const { error } = await sb.rpc('issue_id_card', { p_employee_id: employeeId })
    if (error) throw new Error(error.message)
    const again = await sb.from('id_card_credentials')
      .select('secret, card_version, card_no, state, valid_till, access_zones')
      .eq('employee_id', employeeId).maybeSingle()
    cred = again.data
    if (!cred) throw new Error('no_card')
  }

  const c = cred as unknown as Cred
  if (c.state !== 'active') throw new Error('card_' + c.state)

  // At most 12 a minute. Twelve covers a screen refreshing every 15 seconds
  // with room to spare, and stops anybody stockpiling codes.
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await sb.from('id_card_tokens')
    .select('jti', { count: 'exact', head: true })
    .eq('employee_id', employeeId).gte('issued_at', since)
  if ((count ?? 0) > 12) throw new Error('rate_limited')

  const jti = b64u(crypto.randomBytes(12))
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  const payload = b64u(Buffer.from(JSON.stringify({
    v: 1, e: employeeId, c: c.card_version, n: jti, x: exp,
  })))
  const token = `EZ1.${payload}.${sign(payload, c.secret)}`

  const { error: regErr } = await sb.rpc('register_id_token', {
    p_jti: jti, p_employee_id: employeeId,
    p_card_version: c.card_version, p_ttl_seconds: TOKEN_TTL_SECONDS,
  })
  if (regErr) throw new Error(regErr.message)

  const base = verifyBase(requestOrigin)
  return {
    token,
    url: `${base}/verify/${token}`,
    expiresAt: exp * 1000,
    ttl: TOKEN_TTL_SECONDS,
    refresh: REFRESH_SECONDS,
    cardNo: c.card_no,
    validTill: c.valid_till,
    accessZones: c.access_zones ?? [],
  }
}

export interface VerifyResult {
  valid: boolean
  reason?: string
  employee_code?: string
  name?: string
  designation?: string
  photo_path?: string
  card_no?: string
  access_zones?: string[]
  valid_till?: string
  scanned_at?: string
}

/** Called by the verify page and by a fixed gate device. CONSUMES the token. */
export async function verifyToken(
  raw: string,
  ctx: { gate?: string; ip?: string; ua?: string } = {},
): Promise<VerifyResult> {
  const reject = async (reason: string, detail: string): Promise<VerifyResult> => {
    // Every failed scan is logged, not just the successful ones — a cluster
    // of these against one employee is how sharing gets noticed.
    await sb.from('id_card_scans').insert({
      jti: null, gate_id: ctx.gate ?? null, result: 'bad_signature',
      ip: ctx.ip ?? null, user_agent: ctx.ua ?? null, detail,
    })
    return { valid: false, reason }
  }

  const parts = (raw ?? '').split('.')
  if (parts.length !== 3 || parts[0] !== 'EZ1') {
    return reject('This is not an EZER identity code.', 'malformed')
  }
  const [, payload, sig] = parts

  let body: { v: number; e: string; c: number; n: string; x: number }
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return reject('This code could not be read.', 'payload parse failed')
  }

  // Checked before touching the database: an expired code is the ordinary
  // case, not an attack, and it does not deserve a bad_signature row.
  if (body.x * 1000 < Date.now()) {
    return { valid: false, reason: 'This code has expired. Ask for a fresh one.' }
  }

  const { data: cred } = await sb.from('id_card_credentials')
    .select('secret, card_version, state').eq('employee_id', body.e).maybeSingle()
  if (!cred) return reject('Unknown card.', 'no credential row for ' + body.e)

  const c = cred as unknown as { secret: string; card_version: number; state: string }
  const expected = sign(payload, c.secret)
  const a = Buffer.from(sig), b = Buffer.from(expected)
  // Constant time: a fast reject on the first wrong byte leaks the signature
  // one byte at a time.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return reject('This code is not genuine.', 'signature mismatch for ' + body.e)
  }
  if (c.card_version !== body.c || c.state !== 'active') {
    return { valid: false, reason: 'This card has been revoked.' }
  }

  // The database does the single-use check, the employment checks and the
  // logging, so two scanners racing the same code cannot both win.
  const { data, error } = await sb.rpc('consume_id_token', {
    p_jti: body.n, p_gate: ctx.gate ?? null,
    p_ip: ctx.ip ?? null, p_ua: ctx.ua ?? null,
  })
  if (error) return { valid: false, reason: 'Verification failed. Try again.' }
  return data as VerifyResult
}
