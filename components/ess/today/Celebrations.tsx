'use client';
// components/ess/today/Celebrations.tsx — birthdays & work anniversaries in the next 30 days.
// "Wish" posts a birthday/anniversary appreciation to the Wall of Fame stream (see HANDOFF).
import { useState } from 'react';
import type { TodayPayload } from '@/lib/today/types';

const TINT = [['var(--ez-brand-tint)', 'var(--ez-brand)'], ['var(--gold-soft)', 'var(--gold)'], ['var(--ez-positive-tint)', 'var(--ez-positive)'], ['var(--ez-info-tint)', 'var(--ez-info)']];
export default function Celebrations({ data, onWish, onToast }: { data: TodayPayload; onWish: (id: string, kind: 'birthday' | 'anniversary') => Promise<void>; onToast: (m: string) => void }) {
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const list = data.celebrations;
  const when = (iso: string) => { const d = new Date(iso + 'T00:00:00'), diff = Math.round((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 864e5);
    const dm = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff < 7 ? `on ${d.toLocaleDateString('en-IN', { weekday: 'long' })}, ${dm}` : `on ${dm}`; };
  return (
    <section className="card reveal" style={{ ['--i' as string]: 8 }}>
      <h2>Birthdays &amp; anniversaries</h2>
      {list.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ez-faint)' }}>No birthdays or anniversaries in the next 30 days.</div> : (
        <div className="people">
          {list.map((c, i) => (
            <div key={c.id + c.kind} className="person">
              <div className={'pav ' + (c.kind === 'birthday' ? 'cake' : 'star')} style={{ background: TINT[i % 4][0], color: TINT[i % 4][1] }}>{c.initials}</div>
              <div><div className="n">{c.name}</div><div className="w">{c.kind === 'birthday' ? `Birthday ${when(c.on)}` : `${c.years} year${c.years! > 1 ? 's' : ''} ${when(c.on)}`}</div></div>
              <button className={'wish' + (sent[c.id + c.kind] ? ' sent' : '')} disabled={!!sent[c.id + c.kind]}
                onClick={async () => { try { await onWish(c.id, c.kind); setSent(s => ({ ...s, [c.id + c.kind]: true })); onToast('Your wish is on their wall'); } catch { onToast('Could not send the wish'); } }}>
                {sent[c.id + c.kind] ? 'Sent' : 'Wish'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
