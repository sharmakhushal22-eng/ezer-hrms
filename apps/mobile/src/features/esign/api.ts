// src/features/esign/api.ts — EZER Sign, the employee side ("Documents to sign").
//
// Website: components/esign/MyDocumentsToSign.tsx + app/api/esign/mine/route.ts.
//   GET  /api/esign/mine                 every envelope this employee signs (by id or e-mail)
//   POST /api/esign/mine { signer_id }   a fresh signing link → { url }, only when it is their turn
// The signing itself happens on the website's public page /sign/<token>, which asks for the
// e-mail OTP and the IT-Act consent before it stamps the PDF — being logged in to ESS is
// deliberately not treated as a signature. The app opens that page (see DocumentsToSignScreen).
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { API_URL } from '@/core/config'
import type { Tone } from '@/ui/theme'

export interface SignItem {
  signer_id: string
  status: string
  signed_at: string | null
  invited_at: string | null
  role_label: string | null
  envelope: {
    envelope_no: string; title: string; category: string; status: string
    created_by_name: string | null; created_at: string; expires_at: string | null; completed_at: string | null
  }
}

export function useMyDocuments() {
  return useQuery({
    queryKey: ['esign', 'mine'],
    queryFn: async () => (await api<{ items?: SignItem[] }>('/api/esign/mine')).items || [],
  })
}

/** Asks the server for a fresh signing link. Note: this replaces any earlier link for the
 *  signer (the e-mailed one stops working) and logs an OPENED event — same as the website. */
export async function requestSigningUrl(signerId: string): Promise<string> {
  const j = await api<{ url: string }>('/api/esign/mine', { method: 'POST', body: { signer_id: signerId } })
  return signingPage(j.url)
}

/** The server builds the link from the request's Origin header (lib/esign/server.ts appBase).
 *  A native fetch sends none and gets the deployment's own origin; the web test build sends
 *  its dev-server origin, which has no /sign page. Re-root the token on the website. */
export function signingPage(url: string): string {
  const m = /\/sign\/([^/?#]+)/.exec(url || '')
  return m ? `${API_URL}/sign/${m[1]}` : url
}

// lib/esign/core.ts CATEGORIES / categoryLabel (copied: that module imports node `crypto`).
const CATEGORIES: Record<string, string> = {
  OFFER_LETTER: 'Offer letter', APPOINTMENT: 'Appointment letter', POLICY: 'Policy acknowledgement',
  NDA: 'NDA / confidentiality', HR_LETTER: 'HR letter', ONBOARDING: 'Onboarding form',
  EXIT: 'Exit / F&F', CONTRACT: 'Contract / agreement', GENERAL: 'Other',
}
export const categoryLabel = (id: string | null | undefined) => (id && CATEGORIES[id]) || 'Other'

// components/esign/ui.tsx ENVELOPE_STATUS
const ENVELOPE_STATUS: Record<string, { label: string; t: Tone }> = {
  DRAFT: { label: 'Draft', t: 'neutral' }, SENT: { label: 'Waiting for signatures', t: 'warning' }, IN_PROGRESS: { label: 'Partly signed', t: 'info' },
  COMPLETED: { label: 'Completed', t: 'positive' }, DECLINED: { label: 'Declined', t: 'critical' }, VOIDED: { label: 'Voided', t: 'neutral' }, EXPIRED: { label: 'Expired', t: 'neutral' },
}

const live = (it: SignItem) => it.envelope.status === 'SENT' || it.envelope.status === 'IN_PROGRESS'
/** Their turn now: the envelope is out and this signer is invited or has opened it. */
export const isMine = (it: SignItem) => live(it) && (it.status === 'PENDING' || it.status === 'VIEWED')
export const isQueued = (it: SignItem) => live(it) && it.status === 'WAITING'
export const isSigned = (it: SignItem) => it.status === 'SIGNED'

/** The row's pill — MyDocumentsToSign Row(). */
export function rowStatus(it: SignItem): { label: string; t: Tone } | undefined {
  if (isSigned(it)) return it.envelope.status === 'COMPLETED' ? { label: 'Completed', t: 'positive' } : { label: 'You signed · others pending', t: 'info' }
  if (isMine(it)) return { label: 'Action needed', t: 'warning' }
  if (isQueued(it)) return { label: 'Queued', t: 'neutral' }
  return ENVELOPE_STATUS[it.envelope.status]
}

/** en-GB "29 Oct 2026", as the website prints it. */
export const day = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
