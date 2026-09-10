// lib/today/schema.ts — the only place that names DB objects for this tab.
// The SQL side has the same list as ASSUMPTION comments in 111_ess_today.sql.
export const TODAY_RPC = {
  payload: 'ess_today_payload',        // (p_employee_id uuid) → jsonb
  punch: 'ess_punch',                  // from 087_mobile_app.sql — (p_employee_id, p_kind 'in'|'out', p_lat, p_lng, p_source)
  streak: 'ess_attendance_streak',
  teamPresence: 'ess_team_presence',
} as const;

export const TODAY_TABLES = {
  prefs: 'ess_user_preferences',
  announcements: 'company_announcements',
  announcementReads: 'announcement_reads',
  actionItems: 'ess_action_items',
} as const;

/** Where each quick action goes. Adjust to the real ESS routes. */
export const ROUTES = {
  applyLeave: '/ess/leave/apply',
  payslip: '/ess/payslips',
  regularise: '/ess/attendance/regularise',
  ticket: '/ess/helpdesk/new',
  team: '/ess/team',
  form16: '/ess/documents/form16',
  inbox: '/ess/inbox',
  attendance: '/ess/attendance',
  calendar: '/ess/holidays',
  wall: '/dashboard/ess',
  appreciate: '/dashboard/ess?compose=1',
  profile: '/ess/profile',
} as const;
