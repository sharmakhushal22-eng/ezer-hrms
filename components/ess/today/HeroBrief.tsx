'use client';
// components/ess/today/HeroBrief.tsx — the one-line brief, and the day's meta.
//
// Two small pieces rather than one: the brief is a sentence that changes with
// the data, the meta is three fixed facts. Keeping them apart means the
// sentence can be reworded without touching the row of figures under it.
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtHHMM, two } from '@/lib/today/format';
import { leaveClause, pendingClause, teamClause } from '@/lib/today/brief';

export function HeroBrief({ data }: { data: TodayPayload }) {
  const nextBday = data.celebrations.find(c => c.kind === 'birthday');
  // Each clause is built in lib/today/brief.ts, where the wording is tested.
  // The leave one can come back null — see leaveClause: this screen greeted
  // somebody with "and -13.5 days of leave in the bank", which it will no
  // longer do.
  const leave = leaveClause(data.leave?.total);
  const team = teamClause(data.team.in, data.team.total);
  return (
    <p className="brief serif">
      {pendingClause(data.pending.length)}
      {nextBday && <>, {nextBday.name.split(' ')[0]}&apos;s birthday is coming up</>}
      {leave ? <>, and <em>{leave}</em></> : null}.
      {team ? <> {team}</> : null}
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
