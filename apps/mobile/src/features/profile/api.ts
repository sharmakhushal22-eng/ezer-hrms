// src/features/profile/api.ts — every call the Profile section makes.
//
// My Details goes through /api/ess/profile* exactly as the website's
// lib/profile/client.ts does (that file reads localStorage, so it is not
// shared). The ESS token identifies the employee, so `employee_id` is not
// appended (spec §1: it has no effect for an ESS session).
//
// Letter Requests and My Letters run the website's own direct Supabase queries
// (lib/supabase-ess.ts loadLetterRequests / createLetterRequest and
// EmployeePortal.tsx MyLetters), with the same table, columns and filters,
// scoped to the signed-in employee.
import { useQuery } from '@tanstack/react-query'
import { api, ApiError, appendFile, type PickedFile } from '@/core/api'
import { must, supabase } from '@/core/supabase'
import { useEmployeeId } from '@/core/session'
import type { ProfilePayload } from '@web/profile/types'

// ── My Details ──────────────────────────────────────────────────────────────
export const profileKey = ['profile', 'payload'] as const

export function useProfile() {
  return useQuery({ queryKey: profileKey, queryFn: () => api<ProfilePayload>('/api/ess/profile') })
}

export const editField = (key: string, value: string) =>
  api<{ ok: true; saved: string }>('/api/ess/profile', { method: 'POST', body: { action: 'edit', key, value } })

export const requestChange = (key: string, value: string, reason: string) =>
  api<{ ok: true; request_id: string }>('/api/ess/profile', { method: 'POST', body: { action: 'request', key, value, reason } })

// ── Change requests (migration 105) ─────────────────────────────────────────
export interface MyRequest {
  id: string; field_key: string; field_label: string
  old_value: string | null; new_value: string; reason: string | null
  status: string; stage_label: string; remarks: string | null
  requested_at: string; decided_at: string | null
}
export interface QueueRequest {
  id: string; employee_id: string; emp_code: string; employee: string
  field_key: string; field_label: string
  old_value: string | null; new_value: string; reason: string | null
  route_to: string; status: string; stage_label: string
  requested_at: string; waiting_days: number
}

export function useMyRequests(enabled: boolean) {
  return useQuery({
    queryKey: ['profile', 'requests', 'mine'],
    enabled,
    queryFn: async () => (await api<{ ok: true; requests: MyRequest[] }>('/api/ess/profile/requests', { query: { scope: 'mine' } })).requests ?? [],
  })
}

/** The website ignores a queue error: most people are not approvers. */
export function useReviewQueue(enabled: boolean) {
  return useQuery({
    queryKey: ['profile', 'requests', 'queue'],
    enabled,
    queryFn: async () => {
      try { return (await api<{ ok: true; requests: QueueRequest[] }>('/api/ess/profile/requests', { query: { scope: 'queue' } })).requests ?? [] }
      catch { return [] as QueueRequest[] }
    },
  })
}

export const decideRequest = (id: string, decision: 'approve' | 'reject', remarks?: string) =>
  api<{ ok: true; status: string; applied: boolean; message?: string }>('/api/ess/profile/requests', { method: 'POST', body: { action: decision, id, remarks } })

export const cancelRequest = (id: string) =>
  api<{ ok: true; status: string }>('/api/ess/profile/requests', { method: 'POST', body: { action: 'cancel', id } })

// ── Photo ───────────────────────────────────────────────────────────────────
/** POST /api/ess/profile/photo, multipart field `file`. The website shows
 *  `j.message ?? j.error ?? 'Upload failed (<status>).'` — the 400s carry a
 *  machine code in `error` and the sentence in `message`. */
export async function uploadPhoto(f: PickedFile): Promise<{ ok: true; path: string; url: string | null }> {
  const form = new FormData()
  await appendFile(form, 'file', f)
  try {
    return await api('/api/ess/profile/photo', { method: 'POST', form })
  } catch (e) {
    if (e instanceof ApiError && e.status > 0) {
      const b = e.body && typeof e.body === 'object' ? e.body : null
      throw new Error(String(b?.message ?? b?.error ?? `Upload failed (${e.status}).`))
    }
    throw e
  }
}

// ── Digital ID card ─────────────────────────────────────────────────────────
export interface Issued {
  token: string; url: string; expiresAt: number
  ttl: number; refresh: number
  cardNo: string; validTill: string | null; accessZones: string[]
}

/** GET /api/ess/id-card/token. Errors as components/profile/IdCard.tsx words them. */
export async function fetchIdToken(): Promise<Issued> {
  try {
    return await api<Issued>('/api/ess/id-card/token')
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 0) throw new Error('Could not reach the server.')
      const b = e.body && typeof e.body === 'object' ? e.body : null
      throw new Error(String(b?.error ?? `Could not get a code (${e.status}).`))
    }
    throw new Error('Could not reach the server.')
  }
}

// ── Letter Requests (direct Supabase, lib/supabase-ess.ts) ──────────────────
export const LETTER_TYPES = ['Salary Certificate', 'Experience Letter', 'Address/Employment Verification', 'Bonafide Certificate', 'NOC', 'Visa / Travel Letter', 'Bank Loan Letter', 'Relieving Letter', 'PF Transfer Letter', 'Custom Request']

export interface LetterRequest { id: string; letter_type: string; purpose: string | null; status: string; requested_at: string; letter_url: string | null; rejection_reason: string | null }

export function useLetterRequests() {
  const employeeId = useEmployeeId()
  return useQuery({
    queryKey: ['profile', 'letter-requests', employeeId],
    enabled: !!employeeId,
    queryFn: async () => (must(await supabase.from('ess_letter_requests').select('*').eq('employee_id', employeeId).order('requested_at', { ascending: false })) as LetterRequest[]) || [],
  })
}

export async function createLetterRequest(employeeId: string, letter_type: string, purpose: string, custom_details: string) {
  const { error } = await supabase.from('ess_letter_requests').insert({ employee_id: employeeId, letter_type, purpose, custom_details })
  if (error) throw new Error(error.message)
}

// ── My Letters (direct Supabase, EmployeePortal.tsx MyLetters) ──────────────
export interface MyLetter { id: string; employee_id: string; letter_date: string; file_url: string; letter_name: string; generated_at?: string; emailed_at?: string | null; published_to_ess_at?: string | null }

export function useMyLetters() {
  const employeeId = useEmployeeId()
  return useQuery({
    queryKey: ['profile', 'letters', employeeId],
    enabled: !!employeeId,
    queryFn: async () => (must(await supabase.from('my_generated_letters').select('*').eq('employee_id', employeeId).order('letter_date', { ascending: false })) as MyLetter[]) || [],
  })
}

/** A 5-minute signed URL for a stored letter PDF, or null (the website then does nothing). */
export async function signLetter(fileUrl: string): Promise<string | null> {
  const { data } = await supabase.storage.from('generated-letters').createSignedUrl(fileUrl, 300)
  return data?.signedUrl || null
}
