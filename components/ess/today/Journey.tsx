'use client';
// components/ess/today/Journey.tsx — tenure bar with Joined / 1 yr / 3 yrs / 5 yrs milestones
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtDateCompact, tenure } from '@/lib/today/format';
import { useMounted } from './hooks';

const STOPS = [0, 1, 3, 5], POS = [12.5, 37.5, 62.5, 87.5];
export default function Journey({ data, prefs }: { data: TodayPayload; prefs: Prefs }) {
  const ready = useMounted(250);
  const e = data.employee, t = tenure(e.date_of_joining), yrs = t.totalMonths / 12;
  // position: piecewise-linear between the four stops
  let pos = POS[3];
  for (let i = 0; i < 3; i++) if (yrs <= STOPS[i + 1]) { pos = POS[i] + ((yrs - STOPS[i]) / (STOPS[i + 1] - STOPS[i])) * (POS[i + 1] - POS[i]); break; }
  const doj = new Date(e.date_of_joining);
  const yearOf = (n: number) => new Date(doj.getFullYear() + n, doj.getMonth(), doj.getDate());
  const toGo = (n: number) => { const m = Math.max(0, n * 12 - t.totalMonths); return m === 0 ? 'Reached' : m < 12 ? `${m} months to go` : `${Math.floor(m / 12)} yr ${m % 12} mo to go`; };
  const you = t.years > 0 ? `You, ${t.years} yr${t.years > 1 ? 's' : ''}${t.months ? ` ${t.months} mo` : ''}` : `You, ${t.months} mo`;
  return (
    <section className="card reveal" style={{ ['--i' as string]: 9 }}>
      <h2>My journey at the company</h2>
      <div className="track">
        <div className="fill" style={{ width: ready ? `${pos}%` : 0 }} />
        <div className="you" style={{ left: ready ? `${pos}%` : `${POS[0]}%` }}>{you}</div>
        {STOPS.map((s, i) => <div key={s} className={'ms' + (yrs >= s ? ' done' : '') + (s === 5 ? ' gold' : '')} style={{ left: `${POS[i]}%` }} />)}
      </div>
      <div className="mgrid">
        <div><b>Joined</b>{fmtDateCompact(e.date_of_joining, prefs.date_format)}</div>
        {[1, 3, 5].map(n => <div key={n}><b>{n} year{n > 1 ? 's' : ''}</b>{yrs >= n ? yearOf(n).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : toGo(n)}</div>)}
      </div>
      <div className="jgrid">
        <div>Designation<b>{e.designation ?? '—'}</b></div>
        <div>Reports to<b>{e.reports_to ?? '—'}</b></div>
        <div>Department<b>{e.department ?? '—'}</b></div>
      </div>
    </section>
  );
}
