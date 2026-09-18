// lib/today/types.ts — shape of ess_today_payload() (migration 111)

export type Theme = 'auto' | 'light' | 'dark';
export type TimeFormat = '12' | '24';
export type DateFormat = 'long' | 'short' | 'dmy' | 'mdy' | 'iso';

export interface Prefs { theme: Theme; time_format: TimeFormat; date_format: DateFormat }

export interface TodayPayload {
  employee: {
    id: string; code: string; name: string; first_name: string; initials: string;
    designation: string | null; department: string | null; location: string | null;
    date_of_joining: string; reports_to: string | null;
  };
  shift: { start: string; end: string };                 // 'HH:MM'
  prefs: Prefs;
  today: { punch_in: string | null; punch_out: string | null; work_mode: string | null } | null;
  week: Array<{ date: string; punch_in: string | null; punch_out: string | null; is_late: boolean; is_off: boolean; hours: number | null }>;
  week_hours: number;
  streak: number;
  attendance_month: { present: number; working_days: number; late: number; pct: number | null; prev_pct: number | null };
  leave: { total: number; accrued_this_month: number; by_type: Record<string, number> };
  payroll: { month: string; net: number; tds: number; pf: number; paid_on: string | null; on_time: boolean } | null;
  pending: Array<{
    kind: 'action' | 'approval'; id: string; type: string; title: string; description: string | null;
    due_on: string | null; cta_label: string; cta_route: string;
  }>;
  team: { members: Array<{ id: string; name: string; initials: string; status: 'in' | 'wfh' | 'leave' | 'out' }>;
          in: number; wfh: number; leave: number; out: number; total: number };
  next_holiday: { date: string; name: string; days_away: number; long_weekend: boolean } | null;
  celebrations: Array<{ id: string; name: string; initials: string; kind: 'birthday' | 'anniversary'; on: string; years?: number }>;
  recognition: { badge: string | null; from: string; message: string | null; tags: string[] | null; at: string } | null;
  /**
   * Everyone recently issued an ESS code who actually started recently — the
   * two-part rule in migration 116. Added to the payload by 117 as a straight
   * pass-through of ess_new_joiners_feed().
   *
   * OPTIONAL ON PURPOSE. 117 is a separate migration from the one that created
   * the ledger, so a database can legitimately have 116 and not 117. The card
   * falls back to calling the feed directly rather than showing nothing.
   */
  new_joiners?: Array<{
    id: string; name: string; initials: string; code: string | null;
    designation: string | null; department: string | null; photo: string | null;
    joined_on: string | null; code_issued_at: string;
    days_since_joining: number | null; already_congratulated: boolean;
  }>;
  announcements: {
    pinned: { id: string; title: string; body: string | null; cta_label: string | null; cta_route: string | null; published_at: string } | null;
    items: Array<{ id: string; title: string; body: string | null; published_at: string; unread: boolean }>;
  };
}
