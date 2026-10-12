'use client';
// components/ess/today/HeroBrief.tsx — the one-line brief, and the day's meta.
//
// Two small pieces rather than one: the brief is a sentence that changes with
// the data, the meta is three fixed facts. Keeping them apart means the
// sentence can be reworded without touching the row of figures under it.
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtHHMM, two } from '@/lib/today/format';

export function HeroBrief({ data }: { data: TodayPayload }) {
  const pend = data.pending.length;
  const leaveDays = data.leave?.total ?? 0;
  const nextBday = data.celebrations.find(c => c.kind === 'birthday');
  return (
    <p className="brief serif">
      {pend > 0 ? <>You have <em>{pend} {pend === 1 ? 'thing' : 'things'}</em> waiting on you</> : <>Nothing is waiting on you</>}
      {nextBday && <>, {nextBday.name.split(' ')[0]}&apos;s birthday is coming up</>}
      , and <em>{leaveDays} days</em> of leave in the bank.
      {data.team.total > 0 && <> {data.team.in} of your team {data.team.in === 1 ? 'is' : 'are'} in office today.</>}
    </p>
  );
}

export function HeroMeta({ data, prefs }: { data: TodayPayload; prefs: Prefs }) {
  const weekH = Math.floor(data.week_hours);
  const weekM = Math.round((data.week_hours - weekH) * 60);
  return (
    <div className="hero-meta">
      <div>Shift<b>{fmtHHMM(data.shift.start, prefs.time_format)} – {fmtHHMM(data.shift.end, prefs.time_format)}</b></div>
      <div>This week<b>{weekH}h {two(weekM)}m logged</b></div>
      {data.next_holiday && (
        <div>Next holiday<b>{data.next_holiday.name}, {new Date(data.next_holiday.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</b></div>
      )}
    </div>
  );
}
