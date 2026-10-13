'use client';
// components/ess/today/HeroClock.tsx — the wall clock and date under it.
//
// `now` is passed in rather than ticked here: the hero already holds one
// useNow() for the sun/moon arc and the greeting, and a second timer in a
// child would re-render it on a different beat for no gain.
import type { Prefs } from '@/lib/today/types';
import { fmtDate, two } from '@/lib/today/format';

export default function HeroClock({ now, prefs }: { now: Date; prefs: Prefs }) {
  const h = now.getHours();
  return (
    <div className="clock">
      <b>
        {prefs.time_format === '24'
          ? <>{two(h)}<i>:</i>{two(now.getMinutes())}</>
          : <>{h % 12 || 12}<i>:</i>{two(now.getMinutes())}<span className="ampm">{h >= 12 ? 'PM' : 'AM'}</span></>}
      </b>
      <span>{fmtDate(now, prefs.date_format)}</span>
    </div>
  );
}
