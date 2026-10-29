// src/features/expenses/desk/types.ts — the staff desks' row shapes and calls.
//
// COPIED FROM lib/te/client.ts (DeskContact, DeskToBook, DeskJourney, DeskStay,
// DeskVehicle, DeskWatch, DeskBooked, BookingInput, ClaimSummaryRow, Page and the
// te.desk.* / te.finance.* / te.legConfirm / te.legSendBack / te.claimReopen
// calls). client.ts itself cannot be imported by the app: it reads
// lib/auth-headers. Shapes are the website's, unchanged.
import { useQuery } from '@tanstack/react-query'
import type { ChainStep } from '@web/te/approval-chain'
import type { DeskKind } from '@web/te/desks'
import type { ClaimStage, ClaimStatus, RiskBand, TeConfig, TripStatus, Uuid } from '@web/te/types'
import { teCall } from '../api'
import { TE, useSignedIn } from '../data'

export interface DeskContactDetails { mobile: string; altMobile: string; email: string; from: 'form' | 'record' }
export interface DeskContact { emp_code: string | null; full_name: string | null; contact: DeskContactDetails }

export interface DeskToBook extends DeskContact {
  company_id: Uuid; trip_id: Uuid; trip_no: string; trip_name: string; employee_id: Uuid; emp_code: string | null; full_name: string | null
  trip_status?: TripStatus
  kind: 'leg' | 'hotel'; leg_id: Uuid | null; point_seq: number | null; on_date: string | null; mode: string | null; from_name: string | null; to_name: string | null
  pref_time: string | null; pref_url: string | null; pref_note: string | null
}
export interface DeskJourney extends DeskContact {
  leg_id: Uuid; company_id: Uuid; trip_id: Uuid; trip_no: string; trip_name: string; scope: string
  employee_id: Uuid; emp_code: string | null; full_name: string | null
  leg_no: number; kind: string; is_subtrip: boolean; leg_date: string
  mode: string; booked_by: string; gps_mode: string
  is_manual: boolean; no_gps_reason: string
  added_reason: string
  from_name: string | null; to_name: string | null
  planned_km: number | null; gps_km: number | null; route_km: number | null; payable_km: number | null
  route_polyline: string
  start_lat: number | null; start_lng: number | null; end_lat: number | null; end_lng: number | null
  start_off_m: number | null; end_off_m: number | null
  gps_points: number | null
  expense_id: Uuid | null; claimed: number | null; eligible: number | null; category: string | null
  file_count: number
  desk_confirmed_at: string | null; desk_confirmed_by: Uuid | null
  fin_confirmed_at: string | null; fin_confirmed_by: Uuid | null
  sent_back_at: string | null; sent_back_by: Uuid | null; sent_back_desk: string
  sent_back_reason: string; review_answer: string
  confirm_policy: string
}
export interface DeskStayOption { name: string; location: string; url: string; price?: number }
export interface DeskStay extends DeskContact {
  id: Uuid; trip_no: string; name: string; employee_id: Uuid
  emp_code: string | null; full_name: string | null
  scope: string; start_date: string | null; end_date: string | null
  stay_by: 'self' | 'desk'
  stay_options: DeskStayOption[]
}
export interface DeskVehicle extends DeskContact { id: Uuid; employee_id: Uuid; emp_code: string | null; full_name: string | null; reg_no: string; vehicle_type_code: string; declared_type_code: string | null; ownership: string; rc_file_url: string | null; created_at: string }
export interface DeskWatch extends DeskContact {
  company_id: Uuid; trip_id: Uuid; trip_no: string; trip_name: string
  employee_id: Uuid; emp_code: string | null; full_name: string | null
  scope: string; trip_status: TripStatus; start_date: string; end_date: string
  stay_wanted: boolean | null; stay_by: string | null; leg_count: number
}
export interface DeskBooked extends DeskContact {
  id: Uuid; booking_no: string; trip_id: Uuid; trip_no: string; trip_name: string
  employee_id: Uuid; emp_code: string | null; full_name: string | null
  leg_id: Uuid | null; point_seq: number | null; kind: 'travel' | 'hotel' | string
  vendor: string; reference: string; amount: number; paid_by: string; status: string; booked_at: string
  ticket_url: string | null
  emailed_at: string | null
  emailed_to: string | null
}
export interface DeskList {
  company_id: Uuid; may_book: boolean
  to_book: DeskToBook[]; booked: DeskBooked[]; vehicles: DeskVehicle[]; stays: DeskStay[]; watch: DeskWatch[]
  journeys: DeskJourney[]
  chains: Record<Uuid, ChainStep[]>
}
export interface BookingInput { trip_id: Uuid; leg_id?: Uuid; point_seq?: number; vendor: string; reference: string; amount: number; ticket_url?: string }

export interface ClaimSummaryRow {
  id: Uuid; company_id: Uuid; claim_no: string; claim_type: string; claim_seq: number; status: ClaimStatus; stage: ClaimStage
  employee_id: Uuid; emp_code: string; employee_name: string; grade: string | null; department: string | null
  trip_id: Uuid | null; trip_no: string | null; trip_name: string | null; scope: string | null
  period_label: string | null; period_month: string | null; is_late: boolean
  claimed_total: number; eligible_total: number; approved_total: number; advance_adjusted: number; net_amount: number | null
  risk_score: number; risk_band: RiskBand; is_exception: boolean; is_post_facto: boolean; auto_verified: boolean; sampled: boolean
  line_count: number; open_flags: number; waiting_role: string | null; waiting_person: Uuid | null; waiting_team: string | null
  submitted_at: string | null; verified_at: string | null; settled_at: string | null; paid_ref: string | null
}
export interface Page<T> { rows: T[]; total: number; limit: number; offset: number; company_id: Uuid }

export const deskApi = {
  list: () => teCall<DeskList>('GET', 'desk'),
  /** Admin config: vehicle types + fuel price for the rate note. Admin-only — a 403 for most desk users. */
  config: () => teCall<{ config: TeConfig }>('GET', 'admin/config'),
  stayDecide: (input: { tripId: Uuid; action: 'choose' | 'reject'; choice?: number; remark?: string }) =>
    teCall<{ trip_id: Uuid; status: 'CHOSEN' | 'REJECTED'; chosen: number | null; name: string }>('POST', 'stay', input),
  bookingRecord: (input: BookingInput) => teCall<{ booking_id: Uuid; booking_no: string; expense_id: Uuid }>('POST', 'bookings', input),
  bookingCancel: (id: Uuid, reason: string) => teCall<{ booking_id: Uuid; status: 'CANCELLED' }>('POST', `bookings/${id}/cancel`, { reason }),
  bookingEmail: (id: Uuid) => teCall<{ sent: true; to: string; address_kind: 'work' | 'personal'; subject: string; attached: boolean }>('POST', `bookings/${id}/email`, {}),
  vehicleVerify: (id: Uuid, typeCode?: string) => teCall<{ vehicle_id: Uuid; vehicle_type_code: string }>('POST', `vehicles/${id}/verify`, { type_code: typeCode }),
  legConfirm: (id: Uuid, desk: DeskKind) => teCall<{ leg_id: Uuid; desk: string; policy: string }>('POST', `legs/${id}/review`, { action: 'confirm', desk }),
  legSendBack: (id: Uuid, desk: DeskKind, reason: string) => teCall<{ leg_id: Uuid; desk: string }>('POST', `legs/${id}/review`, { action: 'send-back', desk, reason }),
  financeJourneys: (state: 'waiting' | 'back' | 'done') =>
    teCall<Page<DeskJourney>>('GET', 'finance/overview', undefined, { view: 'journeys', state, limit: 100 }),
  financeClaims: (status: string) => teCall<Page<ClaimSummaryRow>>('GET', 'finance/overview', undefined, { view: 'claims', status }),
  claimReopen: (id: Uuid, reason: string) => teCall<{ claim_id: Uuid; status: ClaimStatus }>('POST', `claims/${id}/reopen`, { reason }),
}

/** Query keys under 'te', so reloadTe() refreshes the desks with everything else. */
export const deskKey = {
  travel: [TE, 'desk', 'travel'] as const,
  config: [TE, 'desk', 'config'] as const,
  journeys: (state: string) => [TE, 'desk', 'finance-journeys', state] as const,
  claims: (status: string) => [TE, 'desk', 'finance-claims', status] as const,
}

export function useDeskList() {
  return useQuery({ queryKey: deskKey.travel, queryFn: deskApi.list, enabled: useSignedIn() })
}
/** null when the config is not readable (the web degrades the same way). */
export function useDeskConfig(enabled: boolean) {
  const on = useSignedIn()
  return useQuery<TeConfig | null>({
    queryKey: deskKey.config,
    queryFn: () => deskApi.config().then(r => r.config, () => null),
    enabled: on && enabled,
    staleTime: 10 * 60_000,
  })
}
