import crypto from 'node:crypto';
import { svc } from './access';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EZER digital ID card — rotating QR
 * ═══════════════════════════════════════════════════════════════════════════
 *  Token layout:   EZ1.<payload>.<sig>
 *  payload (base64url JSON): { v, e, c, n, x }
 *      v  format version
 *      e  employee id
 *      c  card_version — bumped on revoke/rotate, kills every old token
 *      n  jti, 12 random bytes, registered in id_card_tokens
 *      x  expiry, epoch seconds
 *  sig = HMAC-SHA256(employeeSecret + SERVER_PEPPER, payload), first 24 bytes
 *
 *  Why this cannot be stolen usefully:
 *   1. TTL 30s. A screenshot sent on WhatsApp is dead before it arrives.
 *   2. Single use. consume_id_token() marks the jti; a second scan reports
 *      "already used", and the scan lands in id_card_scans for HR to see.
 *   3. No PII inside. The token is opaque; the reader must call our verify
 *      endpoint, which decides what to reveal.
 *   4. card_version binding. Report a phone lost, HR rotates, every token
 *      that ever existed stops verifying immediately.
 *   5. Signature needs a per-employee secret that never leaves the server.
 *   6. Issue is rate limited per employee, so nobody can farm a batch of
 *      codes to use later.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const TOKEN_TTL_SECONDS = 30;   // how long a code stays valid
export const REFRESH_SECONDS   = 15;   // how often the screen asks for a new one

const b64u = (b: Buffer) => b.toString('base64url');
const pepper = () => {
  const p = process.env.ID_CARD_PEPPER;
  if (!p || p.length < 32) {
    throw new Error('ID_CARD_PEPPER missing or shorter than 32 chars — set it in .env.local');
  }
  return p;
};

function sign(payload: string, secret: string) {
  return b64u(
    crypto.createHmac('sha256', secret + pepper()).update(payload).digest().subarray(0, 24)
  );
}

export interface IssuedToken {
  token: string;
  url: string;
  expiresAt: number;
  ttl: number;
  cardNo: string;
  validTill: string | null;
  accessZones: string[];
}

/** Called by the ESS page every REFRESH_SECONDS. */
export async function issueToken(employeeId: string): Promise<IssuedToken> {
  const db = svc();

  const { data: cred, error } = await db
    .from('id_card_credentials')
    .select('secret, card_version, card_no, state, valid_till, access_zones')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!cred) throw new Error('no_card');
  if (cred.state !== 'active') throw new Error('card_' + cred.state);

  // rate limit: at most 12 tokens per employee per minute
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db
    .from('id_card_tokens')
    .select('jti', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .gte('issued_at', since);
  if ((count ?? 0) > 12) throw new Error('rate_limited');

  const jti = b64u(crypto.randomBytes(12));
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = b64u(
    Buffer.from(JSON.stringify({ v: 1, e: employeeId, c: cred.card_version, n: jti, x: exp }))
  );
  const token = `EZ1.${payload}.${sign(payload, cred.secret)}`;

  const { error: regErr } = await db.rpc('register_id_token', {
    p_jti: jti,
    p_employee_id: employeeId,
    p_card_version: cred.card_version,
    p_ttl_seconds: TOKEN_TTL_SECONDS,
  });
  if (regErr) throw new Error(regErr.message);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ezerhrms.com';
  return {
    token,
    url: `${base}/verify/${token}`,
    expiresAt: exp * 1000,
    ttl: TOKEN_TTL_SECONDS,
    cardNo: cred.card_no,
    validTill: cred.valid_till,
    accessZones: cred.access_zones ?? [],
  };
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  employee_code?: string;
  name?: string;
  designation?: string;
  photo_path?: string;
  card_no?: string;
  access_zones?: string[];
  valid_till?: string;
  scanned_at?: string;
}

/** Called by the gate scanner / verify page. Consumes the token. */
export async function verifyToken(
  raw: string,
  ctx: { gate?: string; ip?: string; ua?: string } = {}
): Promise<VerifyResult> {
  const db = svc();
  const bad = async (reason: string, detail: string): Promise<VerifyResult> => {
    await db.from('id_card_scans').insert({
      jti: null, gate_id: ctx.gate ?? null, result: 'bad_signature',
      ip: ctx.ip ?? null, user_agent: ctx.ua ?? null, detail,
    });
    return { valid: false, reason };
  };

  const parts = (raw ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== 'EZ1') {
    return bad('This is not an EZER identity code.', 'malformed');
  }
  const [, payload, sig] = parts;

  let body: { v: number; e: string; c: number; n: string; x: number };
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return bad('This code could not be read.', 'payload parse failed');
  }

  if (body.x * 1000 < Date.now()) {
    return { valid: false, reason: 'This code has expired. Ask for a fresh one.' };
  }

  const { data: cred } = await db
    .from('id_card_credentials')
    .select('secret, card_version, state')
    .eq('employee_id', body.e)
    .maybeSingle();
  if (!cred) return bad('Unknown card.', 'no credential row');

  const expected = sign(payload, cred.secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return bad('This code is not genuine.', 'signature mismatch for ' + body.e);
  }
  if (cred.card_version !== body.c || cred.state !== 'active') {
    return { valid: false, reason: 'This card has been revoked.' };
  }

  // DB does the single-use check, the status checks and the logging
  const { data, error } = await db.rpc('consume_id_token', {
    p_jti: body.n,
    p_gate: ctx.gate ?? null,
    p_ip: ctx.ip ?? null,
    p_ua: ctx.ua ?? null,
  });
  if (error) return { valid: false, reason: 'Verification failed. Try again.' };
  return data as VerifyResult;
}
