'use client';
// components/ess/today/Today.tsx — the Today tab. Drop-in replacement for the old Home
// component in components/ess/EmployeePortal.tsx. Fetches ONE payload, owns prefs + toast.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { usePrefs } from '@/lib/today/prefs-client';
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
};

export default function Today({ initial, onSearch, onWish }: Props) {
  const router = useRouter();
  const [data, setData] = useState<TodayPayload | null>(initial ?? null);
  const [err, setErr] = useState<string | null>(null);
  const { prefs, update } = usePrefs(initial?.prefs);
  const { msg, show } = useToast();
  const [liveIn, setLiveIn] = useState<Date | null>(null);

  useEffect(() => {
    if (initial) return;
    fetch('/api/ess/today').then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not load'); setData(j); if (j.prefs) update(j.prefs); })
      .catch(e => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (data?.today?.punch_in && !data.today.punch_out) setLiveIn(new Date(data.today.punch_in)); }, [data]);

  const nav = (r: string) => (r.startsWith('http') ? window.open(r, '_blank', 'noopener') : router.push(r));
  const wish = onWish ?? (async () => { await new Promise(r => setTimeout(r, 300)); });

  if (err) return <div className="ezt"><div className="page card">Could not load Today: {err}</div></div>;
  if (!data) return <div className="ezt"><div className="page"><div className="card" style={{ height: 320, opacity: .5 }} /></div></div>;

  return (
    <div className="ezt">
      <div className="page">
        <HeroPanel data={data} prefs={prefs} onPrefs={(p: Partial<Prefs>) => update(p)} onSearch={onSearch}>
          <PunchDial data={data} prefs={prefs} onToast={show}
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
      <Toast msg={msg} />
    </div>
  );
}
