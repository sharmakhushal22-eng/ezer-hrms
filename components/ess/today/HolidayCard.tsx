'use client';
import type { TodayPayload } from '@/lib/today/types';
import { ROUTES } from '@/lib/today/schema';
export default function HolidayCard({ data, nav }: { data: TodayPayload; nav: (r: string) => void }) {
  const h = data.next_holiday; if (!h) return null;
  const d = new Date(h.date + 'T00:00:00');
  return (
    <section className="card reveal" style={{ ['--i' as string]: 7 }}>
      <div className="holi">
        <div className="date-block"><b>{String(d.getDate()).padStart(2, '0')}</b><span>{d.toLocaleDateString('en-IN', { month: 'short' })}</span></div>
        <div><div className="n">{h.name}</div><div className="w">{d.toLocaleDateString('en-IN', { weekday: 'long' })}, {h.days_away === 0 ? 'today' : h.days_away === 1 ? 'tomorrow' : `in ${h.days_away} days`}{h.long_weekend && ' · long weekend'}</div></div>
        <button className="more" onClick={() => nav(ROUTES.calendar)}>Calendar</button>
      </div>
    </section>
  );
}
