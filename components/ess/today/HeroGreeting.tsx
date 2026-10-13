'use client';
// components/ess/today/HeroGreeting.tsx — avatar, greeting, and who you are.
//
// The dot on the avatar goes live while a session is open. It reads the same
// punch state the hero's right side does, from the same payload, so the two
// cannot disagree.
import type { TodayPayload } from '@/lib/today/types';
import { greeting } from '@/lib/today/format';
import { punchState, dayFromToday } from '@/lib/today/punch';

export default function HeroGreeting({ data, now }: { data: TodayPayload; now: Date }) {
  const e = data.employee;
  const live = punchState(dayFromToday(data.today)) === 'IN';
  return (
    <div className="greet">
      <div className="av">{e.initials}<span className={live ? 'on live' : 'on'} /></div>
      <div>
        <h1 className="serif">{greeting(now.getHours())}, <span className="name">{e.first_name}</span></h1>
        <div className="sub">
          {e.designation && <span>{e.designation}</span>}
          <span className="chip">{e.code}</span>
          {e.location && <span className="chip">{e.location}</span>}
        </div>
      </div>
    </div>
  );
}
