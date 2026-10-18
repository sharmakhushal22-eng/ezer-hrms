'use client';
// components/ess/today/StatTiles.tsx — leave, attendance, pending actions.
// Net salary used to be the second tile; it was removed from this screen.
import type { PointerEvent } from 'react';
import type { TodayPayload } from '@/lib/today/types';
import { useCountUp, useMounted, useReducedMotion } from './hooks';

export default function StatTiles({ data }: { data: TodayPayload }) {
  const ready = useMounted(250);
  const reduce = useReducedMotion();
  const leave = useCountUp(data.leave?.total ?? 0, 1);
  const present = useCountUp(data.attendance_month?.present ?? 0);
  const pend = useCountUp(data.pending.length);
  const am = data.attendance_month, pct = am?.pct ?? null, delta = pct !== null && am?.prev_pct != null ? Math.round(pct - am.prev_pct) : null;
  const byType = data.leave?.by_type ? Object.entries(data.leave.by_type).map(([k, v]) => `${k} ${v}`).join(' · ') : '';
  const dueThisMonth = data.pending.filter(p => p.due_on && new Date(p.due_on).getMonth() === new Date().getMonth()).length;

  // 3D tilt on hover (pointer devices only)
  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || !matchMedia('(hover:hover)').matches) return;
    const r = e.currentTarget.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    e.currentTarget.style.transform = `rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-2px)`;
  };
  const untilt = (e: PointerEvent<HTMLDivElement>) => { e.currentTarget.style.transform = ''; };
  const T = ({ i, children }: { i: number; children: React.ReactNode }) => <div className="tile reveal tilt" style={{ ['--i' as string]: i }} onPointerMove={tilt} onPointerLeave={untilt}>{children}</div>;
  const Ring = ({ to, cls, label }: { to: number; cls?: string; label: string }) => (
    <div className="ez-ring"><svg viewBox="0 0 54 54"><circle className="bg" cx="27" cy="27" r="23" /><circle className={'fg ' + (cls ?? '')} pathLength={1} cx="27" cy="27" r="23" style={{ strokeDashoffset: ready ? 1 - to : 1 }} /></svg><i>{label}</i></div>
  );

  return (
    <div className="stats">
      <T i={2}>
        <Ring to={Math.min(1, (data.leave?.total ?? 0) / 24)} label={String(data.leave?.total ?? 0)} />
        <div><div className="k">Leave balance</div><div className="v"><span>{leave}</span><span>days</span></div>
          <div className="s">{byType}{data.leave?.accrued_this_month ? <span className="delta up">+{data.leave.accrued_this_month}</span> : null}</div></div>
      </T>
      {/* The Net salary tile was here, between Leave balance and Attendance.
          Removed from this screen only — data.payroll still arrives in the
          payload, and the styles it used (.paybar, .masked, .eye) stay because
          other screens use them: .eye is Profile360's reveal button. Salary
          remains on Payroll → Salary Slip. */}
      <T i={3}>
        <Ring to={(pct ?? 0) / 100} cls="pos" label={pct !== null ? `${pct}%` : '-'} />
        <div><div className="k">Attendance, {new Date().toLocaleDateString('en-IN', { month: 'long' })}</div>
          <div className="v"><span>{present}</span><span>of {am?.working_days ?? 0} days</span></div>
          <div className="s">{am?.late ? `${am.late} late mark${am.late > 1 ? 's' : ''}` : 'No late marks'}{delta !== null && delta !== 0 && <span className={'delta ' + (delta > 0 ? 'up' : 'warn')}>{delta > 0 ? '+' : ''}{delta}%</span>}</div></div>
      </T>
      <T i={4}>
        <div><div className="k">Pending actions</div><div className="v"><span>{pend}</span></div>
          <div className="s">{dueThisMonth > 0 ? <span className="delta warn">{dueThisMonth} due this month</span> : data.pending.length === 0 ? 'All clear' : 'No deadlines'}</div></div>
        <svg className="spark" viewBox="0 0 64 30" aria-hidden="true"><path className="area" d="M2 22 L14 18 L26 20 L38 10 L50 13 L62 6 L62 30 L2 30Z" /><path pathLength={1} d="M2 22 L14 18 L26 20 L38 10 L50 13 L62 6" /></svg>
      </T>
    </div>
  );
}
