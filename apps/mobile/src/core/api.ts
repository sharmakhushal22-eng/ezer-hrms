// src/core/api.ts — every call the app makes to the website's /api routes.
//
// This is the phone's version of the website's lib/ess/api.ts + lib/auth-headers.ts:
//   · the ESS session token goes in `Authorization: Bearer …` — the server
//     verifies its HMAC and resolves the employee from it (lib/ess-session.ts);
//     an employee id in a body or query is never trusted on its own;
//   · `cache: 'no-store'`, as on the website, so what comes back is current;
//   · a non-2xx throws an ApiError carrying the server's own `error` text and the
//     parsed body (the leave route's 409, for instance, carries an offer to split
//     the request with LWP, and the screen needs that body).
//
// A 401 means the token is missing, expired (12 hours) or forged. The session
// layer listens for it and sends the person back to sign in.
import { Platform } from 'react-native'
import { API_URL } from './config'

export class ApiError extends Error {
  status: number
  body: any
  constructor(message: string, status: number, body: any) { super(message); this.status = status; this.body = body }
}

let tokenGetter: () => string | null = () => null
let onUnauthorized: () => void = () => {}
/** Wired once by the session provider. */
export function configureApi(opts: { token: () => string | null; onUnauthorized: () => void }) {
  tokenGetter = opts.token
  onUnauthorized = opts.onUnauthorized
}
export const currentToken = () => tokenGetter()

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** JSON body. */
  body?: unknown
  /** multipart/form-data body — Content-Type is left to fetch so the boundary is set. */
  form?: FormData
  query?: Record<string, string | number | boolean | null | undefined>
  /** Some ESS routes (lib/ess/api.ts) take ?employee_id= alongside the token. */
  employeeId?: string
  /** Don't sign out on 401 (the login call itself). */
  anonymous?: boolean
  signal?: AbortSignal
}

export function apiUrl(path: string, query?: ApiOptions['query'], employeeId?: string) {
  const q = new URLSearchParams()
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  if (employeeId) q.set('employee_id', employeeId)
  const s = q.toString()
  return `${API_URL}${path}${s ? (path.includes('?') ? '&' : '?') + s : ''}`
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = tokenGetter()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token && !opts.anonymous) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined && !opts.form) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(apiUrl(path, opts.query, opts.employeeId), {
      method: opts.method || (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ? (opts.form as any) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      signal: opts.signal,
    })
  } catch {
    throw new ApiError('No connection. Check your internet and try again.', 0, null)
  }

  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }

  if (!res.ok) {
    // Only a token the server REJECTED means the session is over. A call that went
    // out with no token (fired before the session was restored) proves nothing.
    if (res.status === 401 && !opts.anonymous && headers.Authorization) onUnauthorized()
    const msg = (body && typeof body === 'object' && (body.error || body.message)) || `Request failed (HTTP ${res.status})`
    throw new ApiError(String(msg), res.status, body)
  }
  return body as T
}

/** A file to send in a multipart body, from an image/document picker result. */
export interface PickedFile { uri: string; name: string; type: string; size?: number | null }
export async function appendFile(form: FormData, field: string, f: PickedFile) {
  if (Platform.OS === 'web') {
    // The browser test build: the picker hands back a blob: URL, which a browser
    // FormData can only take as a Blob.
    const blob = await (await fetch(f.uri)).blob()
    form.append(field, blob, f.name)
    return
  }
  // React Native's FormData takes { uri, name, type } and streams the file itself.
  form.append(field, { uri: f.uri, name: f.name, type: f.type } as any)
}
