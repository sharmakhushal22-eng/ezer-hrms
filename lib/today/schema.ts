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

/**
 * Where each quick action goes.
 *
 * The drop shipped a /ess/* URL tree — /ess/leave/apply, /ess/payslips and so
 * on. None of it exists here: this portal is ONE page whose sections are
 * internal state (`view` in EmployeePortal), reached by switching tabs, not by
 * navigating. Every quick action, every "Calendar" and "Attendance" link in the
 * drop therefore led to a 404.
 *
 * So a target is a TAB KEY, written `tab:<k>`, and Today's nav() switches the
 * portal to it in place. The prefix keeps the two kinds of target apart — a
 * real path (an announcement's cta_route, say) is still pushed to the router,
 * and an http(s) link still opens in a new window.
 *
 * The keys are item keys from EmployeePortal's nav, checked against it by
 * lib/today/__tests__/routes.test.ts. A key the view switch has no case for
 * lands on the portal's Placeholder — which is the honest destination for a
 * tab that is genuinely not built yet (Salary Slip is phase 3), but a key that
 * is in NO nav section at all renders the wrong header, so the test checks
 * membership rather than the switch.
 */
export const ROUTES = {
  applyLeave: 'tab:leave',
  payslip: 'tab:payslip',
  regularise: 'tab:attendance',
  ticket: 'tab:inbox',
  team: 'tab:team',
  form16: 'tab:documents',
  inbox: 'tab:inbox',
  attendance: 'tab:attendance',
  calendar: 'tab:company',        // the holiday calendar lives under Company
  // Both used to point at 'tab:wall'. The Wall is a sub-tab of Social now, and
  // Social opens on it — so these land exactly where they did, by the door the
  // rail actually has. Left pointing at 'wall' they resolved to a view key that
  // no longer exists in VIEWS, which sends viewMeta() to its fallback and draws
  // the Home header above the Wall.
  wall: 'tab:social',
  appreciate: 'tab:social',
  profile: 'tab:profile',
} as const;

/** The tab key in a target, or null when it is an ordinary link. Accepts the
 *  `tab:<k>` form and the ?tab= URLs that the approvals builder and older
 *  action items still carry. */
export function tabTarget(to: string): string | null {
  if (to.startsWith('tab:')) return to.slice(4) || null;
  const m = /[?&]tab=([a-z0-9_]+)/i.exec(to);
  return m ? m[1].toLowerCase() : null;
}
