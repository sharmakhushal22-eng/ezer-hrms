'use client';
// components/ess/today/Today.tsx — the Today tab. Drop-in replacement for the old Home
// component in components/ess/EmployeePortal.tsx. Fetches ONE payload, owns prefs + toast.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { usePrefs } from '@/lib/today/prefs-client';
import { tabTarget } from '@/lib/today/schema';
import { authHeaders } from '@/lib/auth-headers';
import HeroPanel from './HeroPanel';
import PunchDial from './PunchDial';
import StatTiles from './StatTiles';
import WeekStrip from './WeekStrip';
import PendingList from './PendingList';
import QuickActions from './QuickActions';
import Journey from './Journey';
import TeamToday from './TeamToday';
import HolidayCard from './HolidayCard';
import Celebrations from './Celebrations';
import RecognitionCard from './RecognitionCard';
import Announcements from './Announcements';
import Toast from './Toast';
import { useToast } from './hooks';
import './today.css';

type Props = {
  /** Pass the payload if the page already fetched it server-side; otherwise the tab fetches /api/ess/today. */
  initial?: TodayPayload;
  /** Optional: open the ⌘K command palette from the Apple-style nav. */
  onSearch?: () => void;
  /** Optional: post a birthday / anniversary wish to the Wall of Fame stream. */
  onWish?: (employeeId: string, kind: 'birthday' | 'anniversary') => Promise<void>;
  /** Switch the portal to another tab. The portal is one page whose sections are
   *  internal state, so almost every link on this tab is a tab switch, not a
   *  navigation — see ROUTES in lib/today/schema.ts. Without this, the links
   *  fall back to router.push and land on a 404. */
  onOpenTab?: (key: string) => void;
};

export default function Today({ initial, onSearch, onWish, onOpenTab }: Props) {
  const router = useRouter();
  const [data, setData] = useState<TodayPayload | null>(initial ?? null);
  const [err, setErr] = useState<string | null>(null);
  const { prefs, update } = usePrefs(initial?.prefs);
  const { msg, show } = useToast();
  const [liveIn, setLiveIn] = useState<Date | null>(null);
  // Outside .page on purpose — see the container-query note in today.css. A
  // fixed overlay inside the query container would be sized to the container.
  const confettiRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (initial) return;
    // The ESS token is what names the employee to these routes; a bare fetch
    // gets 401 "unauthenticated" and the tab shows nothing. The drop omitted it.
    (async () => {
      try {
        const r = await fetch('/api/ess/today', { headers: await authHeaders() });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Could not load');
        setData(j);
        if (j.prefs) update(j.prefs);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (data?.today?.punch_in && !data.today.punch_out) setLiveIn(new Date(data.today.punch_in)); }, [data]);

  // Three kinds of target, in order: an external link, a tab in this portal,
  // and — only then — a real route. cta_route values come from the database and
  // the approvals builder, so the tab check runs on them too rather than only on
  // the ROUTES table.
  const nav = (r: string) => {
    if (r.startsWith('http')) { window.open(r, '_blank', 'noopener'); return; }
    const tab = tabTarget(r);
    if (tab && onOpenTab) { onOpenTab(tab); return; }
    if (r.startsWith('/')) router.push(r);
  };
  // The drop's default was a 300ms sleep — the button said "Sent" and nothing
  // left the browser. This posts to the same endpoint the portal's own
  // Celebrations card uses, so a wish from here lands in exactly the same place,
  // duplicate-checked and notified the same way. The kind is upper-cased because
  // that is the contract the route expects.
  const wish = onWish ?? (async (id: string, kind: 'birthday' | 'anniversary') => {
    const r = await fetch('/api/ess/celebrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ to_employee_id: id, kind: kind.toUpperCase() }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not send the wish');
  });

  if (err) return <div className="ezt"><div className="page card">Could not load Today: {err}</div></div>;
  if (!data) return <div className="ezt"><div className="page"><div className="card" style={{ height: 320, opacity: .5 }} /></div></div>;

  return (
    <div className="ezt">
      <div className="page">
        <HeroPanel data={data} prefs={prefs} onPrefs={(p: Partial<Prefs>) => update(p)} onSearch={onSearch}>
          <PunchDial data={data} prefs={prefs} onToast={show} confettiRef={confettiRef}
            onPunched={(kind, at) => { setLiveIn(kind === 'in' ? at : null);
              setData(d => d && ({ ...d, today: kind === 'in' ? { punch_in: at.toISOString(), punch_out: null, work_mode: 'office' } : { ...(d.today ?? { punch_in: null, work_mode: null }), punch_out: at.toISOString() } })); }} />
        </HeroPanel>

        <StatTiles data={data} />

        <div className="cols">
          <div>
            <WeekStrip data={data} prefs={prefs} liveIn={liveIn} nav={nav} />
            <PendingList data={data} prefs={prefs} nav={nav} />
            <QuickActions nav={nav} />
            <Journey data={data} prefs={prefs} />
          </div>
          <div>
            <TeamToday data={data} nav={nav} />
            <HolidayCard data={data} nav={nav} />
            <Celebrations data={data} onWish={wish} onToast={show} />
            <RecognitionCard data={data} nav={nav} />
            <Announcements data={data} nav={nav} />
          </div>
        </div>
      </div>
      <canvas ref={confettiRef} className="ezt-confetti" aria-hidden="true" />
      <Toast msg={msg} />
    </div>
  );
}
