'use client';
// components/ess/today/WeekStrip.tsx — Mon–Sun attendance cells for the current ISO week
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtISO, weekday } from '@/lib/today/format';
import { ROUTES } from '@/lib/today/schema';
import { useMounted } from './hooks';

export default function WeekStrip({ data, prefs, liveIn, nav }: { data: TodayPayload; prefs: Prefs; liveIn: Date | null; nav: (r: string) => void }) {
  const ready = useMounted(250);
  const todayISO = new Date().toISOString().slice(0, 10);
  const SHIFT_H = 9;
  return (
    <section className="card reveal" style={{ ['--i' as string]: 6 }}>
      <h2>This week <button className="more" onClick={() => nav(ROUTES.attendance)}>Attendance</button></h2>
      <div className="week">
        {data.week.map(d => {
          const isToday = d.date === todayISO, future = d.date > todayISO;
          const cls = ['day', isToday && 'today', d.is_off && 'off', d.is_late && 'late', future && !d.is_off && 'next'].filter(Boolean).join(' ');
          const liveHours = isToday && liveIn ? (Date.now() - liveIn.getTime()) / 3.6e6 : null;
          const w = ready ? Math.min(100, ((liveHours ?? d.hours ?? 0) / SHIFT_H) * 100) : 0;
          let l1 = '', l2 = '';
          if (d.is_off) l1 = 'Weekly off';
          else if (isToday && liveIn) { l1 = fmtISO(liveIn.toISOString(), prefs.time_format); l2 = 'In progress'; }
          else if (d.punch_in) { l1 = fmtISO(d.punch_in, prefs.time_format); l2 = d.punch_out ? fmtISO(d.punch_out, prefs.time_format) : (isToday ? 'In progress' : 'No punch out'); }
          else if (future) l1 = 'Upcoming';
          else if (isToday) l1 = 'Not in yet';
          else l1 = 'Absent';
          return (
            <div key={d.date} className={cls}>
              <div className="dn">{weekday(d.date)}</div>
              <div className="dd">{new Date(d.date + 'T00:00:00').getDate()}</div>
              <div className="st">{l1}</div>
              <div className="st" style={d.is_late ? { color: 'var(--ez-warning)' } : undefined}>{d.is_late && !isToday ? 'Late' : l2 || '\u00a0'}</div>
              <div className="bar"><i style={{ width: `${w}%` }} /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
