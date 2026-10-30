// src/features/expenses/api.ts — the phone's way into /api/te. One typed function per route.
//
// PORT OF lib/te/client.ts (employee + approver half; the Finance desk, Travel
// Desk and admin halves are back office and not in the app). Every `te.*`
// signature and every response shape is the website's, unchanged, so a screen
// ported from components/te reads the same.
//
// What changed for the phone (spec Part 7.2):
//   · the calls go through @/core/api, which prefixes the deployment URL, sends
//     the ESS bearer token from SecureStore (with the website's 30 s expiry skew)
//     and signs the person out on a 401 — the website's authHeaders();
//   · `upload` takes a PickedFile ({ uri, name, type }) instead of a DOM File and
//     builds the multipart body with appendFile() — no Content-Type is set by
//     hand, so the boundary is written correctly;
//   · a refusal is still thrown as TeApiError with the server's sentence, code,
//     field, flags and issues (lib/te/errors.ts body shape, spec Part 1.2).
import { api, ApiError, appendFile, type PickedFile } from '@/core/api'
import type {
  Uuid, Snapshot, TeQueueRow, TeTripDetail, TeClaimDetail, PlaceInput, VehicleInput, TripDraft, TripPreview, TripIssue,
  TripStatus, TripDisplayStatus, GpsFix, GpsPing, StopInput, LegReportInput, ExtraLegInput, LegPreview, TeLegStats, TeFlag,
  ExpenseInput, ExpensePreview, ClaimInput, ClaimPreview, ClaimStatus, ClaimStage, RiskBand, DecideInput,
  TeUploadedFile, RcChecked, TeDashboard, TeDraft, TeDraftInput, TeDraftKind,
} from '@web/te/types'

export { errorText, rs, day, dayAt, when, plural, claimChip, claimHolder, currentStep, flagClass, type Tone } from '@web/te/format'

type TeErrorBody = { error?: string; code?: string | null; field?: string; flags?: TeFlag[]; issues?: TripIssue[] } | null

/** Extends the app's ApiError so the query client's "never retry a refusal" rule applies. */
export class TeApiError extends ApiError {
  code: string | null
  field: string | null
  flags: TeFlag[]
  issues: TripIssue[]
  constructor(status: number, body: TeErrorBody, fallback?: string) {
    super(body?.error || fallback || (status === 401 ? 'Sign in to continue.' : `The request failed (HTTP ${status}).`), status, body)
    this.name = 'TeApiError'
    this.code = body?.code ?? null
    this.field = body?.field ?? null
    this.flags = body?.flags ?? []
    this.issues = body?.issues ?? []
  }
  /** true = the rules refused it; show the message next to what the user was doing. */
  get refused(): boolean { return this.status === 409 || this.status === 403 }
}

type Query = Record<string, string | number | boolean | null | undefined>
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** One call to /api/te/<path>. Errors become TeApiError, as on the website. */
async function call<T>(method: Method, path: string, body?: unknown, query?: Query, form?: FormData): Promise<T> {
  try {
    return await api<T>(`/api/te/${path}`, { method, body: form ? undefined : body, form, query })
  } catch (e) {
    if (e instanceof ApiError) {
      const b = e.body && typeof e.body === 'object' ? (e.body as TeErrorBody) : null
      // status 0 = no network: keep @/core/api's own sentence.
      throw new TeApiError(e.status, b, e.status === 0 ? e.message : undefined)
    }
    throw e
  }
}
const get = <T>(path: string, query?: Query) => call<T>('GET', path, undefined, query)
const post = <T>(path: string, body: unknown = {}, query?: Query) => call<T>('POST', path, body, query)

/** Raw access for the staff-desk screens (src/features/expenses/desk), which keep their
 *  own row types (lib/te/client.ts is not importable: it reads lib/auth-headers). */
export const teCall = call

// ── result shapes that are not domain types (lib/te/client.ts) ───────────────
export type VehicleLookup =
  | { off: true; reg: string }
  | { notFound: true; reg: string }
  | { reg: string; rc: RcChecked; type: string; typeName: string; ownerMasked: string; match: 'match' | 'partial' | 'no'; valid: { rc: boolean; ins: boolean; puc: boolean } }
export interface ClaimResult { claim_id: Uuid; status: ClaimStatus; stage: ClaimStage; net_amount?: number | null; advance_adjusted?: number }
export interface StayRequestInput {
  trip_id: Uuid
  point_seq?: number
  leg_id?: Uuid
  vendor: string
  amount: number
  ticket_url?: string
  details?: { address?: string; room?: string; platform?: string; check_in?: string; check_out?: string; note?: string }
}
export type UploadKind = 'BILL' | 'TICKET' | 'TOLL_SLIP' | 'FASTAG_STATEMENT' | 'OTHER' | 'RC'

export const te = {
  // ── the employee ──────────────────────────────────────────────────────────
  /** Everything my own screens show. Render from this; read it again after every change. */
  me: () => get<Snapshot>('me'),
  placeAdd: (input: PlaceInput) => post<{ place_id: Uuid; matched?: true }>('places', input),
  /** What is at this position, without saving anything (lib/te/client.ts placeLookup).
   *  found: false means no geocoder is configured; the fields stay empty. */
  placeLookup: (lat: number, lng: number) =>
    get<{ found: boolean; lat: number; lng: number; name?: string; address?: string; city?: string; pin?: string; country?: string }>(
      'places/lookup', { lat, lng }),
  stayRequest: (input: StayRequestInput) => post<{ booking_id: Uuid; booking_no: string; status: 'REQUESTED' }>('bookings/request', input),
  vehicleLookup: (reg: string) => get<VehicleLookup>('vehicles/lookup', { reg }),
  vehicleAdd: (input: VehicleInput) => post<{ vehicle_id: Uuid; vehicle_type_code: string; is_verified: boolean }>('vehicles', input),

  tripPreview: (draft: TripDraft) => post<TripPreview>('trips/preview', draft),
  tripSave: (draft: TripDraft) => post<{ trip_id: Uuid; trip_no: string; status: TripStatus; warnings: string[] }>('trips', draft),
  trip: (id: Uuid) => get<TeTripDetail>(`trips/${id}`),
  tripAnswer: (id: Uuid, text: string) => post<{ trip_id: Uuid; status: TripStatus }>(`trips/${id}/action`, { action: 'answer', text }),
  tripCancel: (id: Uuid) => post<{ trip_id: Uuid; status: 'CANCELLED'; deleted: boolean }>(`trips/${id}/action`, { action: 'cancel' }),
  tripRecordMissed: (id: Uuid, reason: string, note?: string) => post<{ trip_id: Uuid; status: TripDisplayStatus }>(`trips/${id}/action`, { action: 'record-missed', reason, note }),
  legAdd: (tripId: Uuid, leg: ExtraLegInput) => post<{ leg_id: Uuid; leg_no: number }>(`trips/${tripId}/legs`, leg),

  legStart: (id: Uuid, fix: GpsFix) => post<{ leg_id: Uuid; status: 'ACTIVE'; start_off_m: number | null }>(`legs/${id}/action`, { action: 'start', fix }),
  legPings: (id: Uuid, pings: GpsPing[]) => post<{ leg_id: Uuid; stored: number; total: number }>(`legs/${id}/action`, { action: 'pings', pings }),
  legStop: (id: Uuid, stop: StopInput) => post<{ leg_id: Uuid; stop_id: Uuid; seq: number; status: 'PAUSED' }>(`legs/${id}/action`, { action: 'stop', stop }),
  legContinue: (id: Uuid, minutes?: number, at?: string) => post<{ leg_id: Uuid; stop_id: Uuid; minutes: number; status: 'ACTIVE' }>(`legs/${id}/action`, { action: 'continue', minutes, at }),
  legEnd: (id: Uuid, fix: GpsFix) => post<{ leg_id: Uuid; status: 'ENDED'; gps_km: number; end_off_m: number | null; stats: TeLegStats }>(`legs/${id}/action`, { action: 'end', fix }),
  legPreview: (id: Uuid, report: LegReportInput) => post<LegPreview>(`legs/${id}/action`, { action: 'preview', report }),
  legFile: (id: Uuid, report: LegReportInput) => post<{ leg_id: Uuid; status: 'SUBMITTED'; expense_id: Uuid | null; trip_status: TripDisplayStatus; eligible: number; flags: TeFlag[] }>(`legs/${id}/action`, { action: 'file', report }),
  legSkip: (id: Uuid, reason: string) => post<{ leg_id: Uuid; status: 'SKIPPED'; trip_status: TripDisplayStatus }>(`legs/${id}/action`, { action: 'skip', reason }),
  legNoGps: (id: Uuid, reason: string, note?: string) => post<{ leg_id: Uuid; status: 'ENDED' }>(`legs/${id}/action`, { action: 'no-gps', reason, note }),

  /** The traveller answers what a desk asked about a journey. */
  legAnswer: (id: Uuid, text: string) => post<{ leg_id: Uuid }>(`legs/${id}/action`, { action: 'answer', text }),

  expensePreview: (input: ExpenseInput) => post<ExpensePreview>('expenses/preview', input),
  expenseSave: (input: ExpenseInput) => post<{ expense_id: Uuid; expense_no: string; status: string; eligible: number; flags: TeFlag[] }>('expenses', input),
  expenseDiscard: (id: Uuid) => call<{ expense_id: Uuid; status: 'DISCARDED' }>('DELETE', `expenses/${id}`),
  /** Move an unclaimed line into a trip's bucket; null moves it out of every trip. */
  expenseMoveTrip: (id: Uuid, tripId: Uuid | null) =>
    call<{ moved: boolean; expense_no: string; from_no?: string | null; trip_no: string | null }>('PATCH', `expenses/${id}`, { trip_id: tripId }),

  /** Unfinished work (lib/te/client.ts te.drafts). `body` is the form's own state, stored verbatim. */
  drafts: {
    list: (kind?: TeDraftKind) => get<{ drafts: TeDraft[] }>('drafts', kind ? { kind } : undefined),
    save: (d: TeDraftInput) => post<{ draft_id: Uuid; updated_at: string }>('drafts', d),
    remove: (id: Uuid) => call<{ deleted: boolean }>('DELETE', `drafts/${id}`),
    removeMany: (ids: Uuid[]) => call<{ deleted: number; asked: number }>('DELETE', 'drafts', { ids }),
  },

  /** Desk probes (TeHome): succeed only for members of the Travel / Finance desk. */
  deskList: () => get<Record<string, unknown>>('desk'),
  financeSummary: () => get<Record<string, unknown>>('finance/overview', { view: 'summary' }),

  /** Reports and dashboard: every employee may call it; scoped to them and their reports. */
  dashboard: (q?: { from?: string; to?: string }) => get<TeDashboard>('dashboard', q),

  /** Store a bill or an RC photo. Send the returned file back, unchanged, in `files: [file]`. */
  async upload(file: PickedFile, kind: UploadKind = 'BILL'): Promise<TeUploadedFile> {
    const fd = new FormData()
    await appendFile(fd, 'file', file)
    fd.append('kind', kind)
    const r = await call<{ file: TeUploadedFile }>('POST', 'upload', undefined, undefined, fd)
    return r.file
  },
  /** A one-hour link to open a stored file. claimId is needed for a file that is not your own. */
  fileUrl: (path: string, claimId?: Uuid) => get<{ url: string; expires_in: number }>('upload', { path, claim_id: claimId }),

  claimPreview: (input: ClaimInput = {}) => post<ClaimPreview>('claims/preview', input),
  claimSubmit: (input: ClaimInput) => post<{ claim_id: Uuid; claim_no: string; status: ClaimStatus; stage: ClaimStage; risk_band: RiskBand; chain_notes: string[] }>('claims', input),
  claim: (id: Uuid) => get<TeClaimDetail>(`claims/${id}`),
  claimRespond: (id: Uuid, text: string) => post<ClaimResult>(`claims/${id}/action`, { action: 'respond', text }),
  claimRecall: (id: Uuid) => post<{ claim_id: Uuid; status: 'CANCELLED' }>(`claims/${id}/action`, { action: 'recall' }),

  // ── approvers (the server decides whether this person may act) ─────────────
  queue: () => get<{ queue: TeQueueRow[] }>('queue').then(r => r.queue),
  tripDecide: (id: Uuid, action: 'approve' | 'sendback' | 'reject', comment?: string) => post<{ trip_id: Uuid; status: TripStatus }>(`trips/${id}/decide`, { action, comment }),
  /** approval levels: approve | sendback | reject · finance levels: verify | hold | sendback | reject */
  claimDecide: (id: Uuid, action: 'approve' | 'verify' | 'hold' | 'sendback' | 'reject', o: DecideInput & { stage?: ClaimStage } = {}) => post<ClaimResult>(`claims/${id}/decide`, { action, ...o }),
  flagResolve: (id: Uuid, status: 'dismissed' | 'confirmed', note: string) => post<{ flag_id: Uuid; status: string; risk_band?: RiskBand }>(`flags/${id}`, { status, note }),
}
