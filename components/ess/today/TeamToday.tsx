'use client';
// components/ess/today/TeamToday.tsx — presence of people who share my RM L1 / report to me
import type { TodayPayload } from '@/lib/today/types';
import { ROUTES } from '@/lib/today/schema';

const TINT = ['', 'background:var(--ez-positive-tint);color:var(--ez-positive)', 'background:var(--ez-info-tint);color:var(--ez-info)', 'background:var(--gold-soft);color:var(--gold)', 'background:var(--ez-warning-tint);color:var(--ez-warning)'];
const styleOf = (i: number) => Object.fromEntries((TINT[i % TINT.length] || '').split(';').filter(Boolean).map(kv => { const [k, v] = kv.split(':'); return [k, v]; }));

export default function TeamToday({ data, nav }: { data: TodayPayload; nav: (r: string) => void }) {
  const t = data.team; if (!t || t.total === 0) return null;
  const shown = t.members.slice(0, 5), extra = t.total - shown.length;
  return (
    <section className="card reveal" style={{ ['--i' as string]: 6 }}>
      <h2>Team today <button className="more" onClick={() => nav(ROUTES.team)}>Team</button></h2>
      <div className="team">
        <div className="stack">
          {shown.map((m, i) => <div key={m.id} className="pav" style={styleOf(i)} title={`${m.name} · ${m.status}`}>{m.initials}<span className={'st ' + m.status} /></div>)}
          {extra > 0 && <div className="pav" style={{ background: 'var(--ez-sunken)', color: 'var(--ez-muted)' }}>+{extra}</div>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ez-muted)' }}><b style={{ color: 'var(--ez-ink)', fontSize: 14 }}>{t.in} of {t.total}</b> in office</div>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--ez-positive)' }} /><b>{t.in}</b> in office</span>
        <span><i style={{ background: 'var(--ez-info)' }} /><b>{t.wfh}</b> working from home</span>
        <span><i style={{ background: 'var(--ez-warning)' }} /><b>{t.leave}</b> on leave</span>
        {t.out > 0 && <span><i style={{ background: 'var(--ez-line-strong)' }} /><b>{t.out}</b> not in yet</span>}
      </div>
    </section>
  );
}
