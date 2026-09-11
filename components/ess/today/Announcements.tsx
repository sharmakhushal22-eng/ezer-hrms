'use client';
import { authHeaders } from '@/lib/auth-headers';
// components/ess/today/Announcements.tsx — pinned banner + latest five; unread dot cleared via POST /api/ess/announcements
import { useState } from 'react';
import type { TodayPayload } from '@/lib/today/types';
const when = (iso: string) => { const d = new Date(iso), diff = Math.round((Date.now() - d.getTime()) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? d.toLocaleDateString('en-IN', { weekday: 'short' }) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
export default function Announcements({ data, nav }: { data: TodayPayload; nav: (r: string) => void }) {
  const a = data.announcements; const [read, setRead] = useState<Record<string, boolean>>({});
  const markRead = async (id: string) => { if (read[id]) return; setRead(r => ({ ...r, [id]: true })); fetch('/api/ess/announcements', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ id }) }).catch(() => {}); };
  if (!a.pinned && a.items.length === 0) return (
    <section className="card reveal" style={{ ['--i' as string]: 10 }}><h2>Announcements</h2><div style={{ fontSize: 12.5, color: 'var(--ez-faint)' }}>No announcements right now.</div></section>);
  return (
    <section className="card reveal" style={{ ['--i' as string]: 10 }}>
      <h2>Announcements</h2>
      {a.pinned && (
        <div className="feat">
          <div className="fk">Pinned</div>
          <div className="ft">{a.pinned.title}</div>
          {a.pinned.body && <div className="fd">{a.pinned.body}</div>}
          {a.pinned.cta_label && a.pinned.cta_route && <button className="fb" onClick={() => nav(a.pinned!.cta_route!)}>{a.pinned.cta_label}</button>}
        </div>
      )}
      <ul className="ann">
        {a.items.map(it => (
          <li key={it.id} onClick={() => markRead(it.id)} style={{ cursor: 'pointer' }}>
            <span className={'dot' + (it.unread && !read[it.id] ? ' new' : '')} />
            <div><div className="t">{it.title}</div>{it.body && <div className="d">{it.body}</div>}</div>
            <span className="when">{when(it.published_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
