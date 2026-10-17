'use client';
// components/ess/today/WeekStrip.tsx — Mon–Sun attendance cells for the current week
//
// THE WEEK IS THE CALENDAR'S. This strip used to render `week` from the
// ess_today_payload RPC, which read attendance_records alone, picked the week
// with UTC `current_date`, and had no idea of holidays, half days or missed
// punches — so a half day showed as "Late", a holiday as "Weekly off · Late",
// and the strip disagreed with the Attendance calendar about the same days.
// It now reads GET /api/ess/attendance for this Monday–Sunday, the same verdict
// per day (`kind`) that the calendar renders. The RPC's week is only a fallback
// while that loads or if it fails.
import { useEffect, useState } from 'react';
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtISO, weekday } from '@/lib/today/format';
import { ROUTES } from '@/lib/today/schema';
import { api } from '@/lib/ess/api';
import type { AttendanceDay, DayKind } from '@/lib/supabase-attendance';
import { useMounted } from './hooks';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday and Sunday of the week containing `d`, in the browser's (Indian) local date. */
function thisWeek(d = new Date()): { from: string; to: string } {
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return { from: ymd(mon), to: ymd(sun) };
}

/** The cell's colour class, from the day's kind. Matches the calendar's colours. */
const CLASS_OF: Record<DayKind, string> = {
  PRESENT: 'present', LATE: 'late', HALF_DAY: 'half', MISS_IN: 'miss', MISS_OUT: 'miss',
  IN_PROGRESS: 'present', ABSENT: 'absent', LEAVE: 'leave', HALF_LEAVE: 'leave',
  HOLIDAY: 'holiday', WEEKLY_OFF: 'off', UPCOMING: 'next',
};

interface Cell { date: string; kind: DayKind | null; in: string | null; out: string | null; minutes: number | null; note: string | null; late: boolean }

export default function WeekStrip({ data, prefs, liveIn, nav }: { data: TodayPayload; prefs: Prefs; liveIn: Date | null; nav: (r: string) => void }) {
  const ready = useMounted(250);
  const todayISO = ymd(new Date());
  const { from, to } = thisWeek();
  const [days, setDays] = useState<AttendanceDay[] | null>(null);

  // Re-read after a punch: the payload's today changes, and so does liveIn.
  const punchKey = `${data.today?.punch_in ?? ''}|${data.today?.punch_out ?? ''}|${liveIn?.getTime() ?? ''}`;
  useEffect(() => {
    let live = true;
    api(`/api/ess/attendance?from=${from}&to=${to}`, data.employee.id)
      .then((r: { days?: AttendanceDay[] }) => { if (live && Array.isArray(r.days)) setDays(r.days); })
      .catch(() => { /* keep the payload's week */ });
    return () => { live = false; };
  }, [data.employee.id, from, to, punchKey]);

  // The server's days when we have them; the RPC's week (no kinds) until then.
  const cells: Cell[] = days
    ? days.map(d => ({ date: d.date, kind: d.kind, in: d.work_in, out: d.work_out, minutes: d.total_minutes,
                       note: d.kind === 'LEAVE' || d.kind === 'HALF_LEAVE' ? (d.leave?.name ?? d.note) : d.note, late: d.late_minutes > 0 }))
    : data.week.map(d => ({ date: String(d.date).slice(0, 10), kind: d.is_off ? 'WEEKLY_OFF' : null, in: d.punch_in, out: d.punch_out,
                            minutes: d.hours != null ? d.hours * 60 : null, note: null, late: d.is_late }));

  const SHIFT_H = 9;
  const t = (iso: string | null) => fmtISO(iso, prefs.time_format);
  // In and out on one line fits a cell in 24-hour time; in 12-hour it does not, so the IN alone.
  const span = (a: string | null, b: string | null) => prefs.time_format === '24' && b ? `${t(a)}–${t(b)}` : t(a);
  return (
    <section className="card reveal" style={{ ['--i' as string]: 6 }}>
      <h2>This week <button className="more" onClick={() => nav(ROUTES.attendance)}>Attendance</button></h2>
      <div className="week">
        {cells.map(d => {
          const isToday = d.date === todayISO, future = d.date > todayISO;
          const liveHours = isToday && liveIn ? (Date.now() - liveIn.getTime()) / 3.6e6 : null;
          // Hours worked, against a shift. Not on days that are not working days.
          const offDay = d.kind === 'HOLIDAY' || d.kind === 'WEEKLY_OFF' || d.kind === 'LEAVE' || d.kind === 'ABSENT';
          const w = ready && !offDay ? Math.min(100, ((liveHours ?? (d.minutes ?? 0) / 60) / SHIFT_H) * 100) : 0;

          // What the two lines say, per kind — the calendar's words, not raw punches.
          let l1 = '', l2 = '';
          switch (d.kind) {
            case 'WEEKLY_OFF': l1 = 'Weekly off'; break;
            case 'HOLIDAY':    l1 = 'Holiday'; l2 = d.note ?? ''; break;
            case 'LEAVE':      l1 = 'On leave'; l2 = d.note ?? ''; break;
            case 'HALF_LEAVE': l1 = d.in ? t(d.in) : 'Half-day leave'; l2 = d.in ? 'Half-day leave' : (d.note ?? ''); break;
            case 'ABSENT':     l1 = 'Absent'; break;
            case 'MISS_OUT':   l1 = t(d.in); l2 = 'Missed out'; break;
            case 'MISS_IN':    l1 = t(d.out); l2 = 'Missed in'; break;
            case 'HALF_DAY':   l1 = span(d.in, d.out); l2 = 'Half day'; break;
            case 'LATE':       l1 = span(d.in, d.out); l2 = 'Late'; break;
            case 'PRESENT':    l1 = span(d.in, d.out); l2 = 'Present'; break;
            case 'IN_PROGRESS': l1 = t(liveIn ? liveIn.toISOString() : d.in); l2 = 'In progress'; break;
            case 'UPCOMING':   l1 = isToday ? 'Not in yet' : 'Upcoming'; break;
            default:           // fallback cells, before the server answers
              if (d.in) { l1 = t(d.in); l2 = d.out ? t(d.out) : (isToday ? 'In progress' : ''); }
              else l1 = future ? 'Upcoming' : isToday ? 'Not in yet' : '';
          }
          const kindCls = d.kind ? CLASS_OF[d.kind] : (future ? 'next' : '');
          const cls = ['day', isToday ? 'today' : kindCls].filter(Boolean).join(' ');
          return (
            <div key={d.date} className={cls} title={[l1, l2].filter(Boolean).join(' · ')}>
              <div className="dn">{weekday(d.date)}</div>
              <div className="dd">{new Date(d.date + 'T00:00:00').getDate()}</div>
              <div className="st">{l1 || ' '}</div>
              <div className="st">{l2 || ' '}</div>
              <div className="bar"><i style={{ width: `${w}%` }} /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
