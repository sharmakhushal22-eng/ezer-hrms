'use client';
// components/ess/today/PendingList.tsx — action items + approvals (same card for everyone)
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtDateCompact } from '@/lib/today/format';
import { ROUTES } from '@/lib/today/schema';
import { Doc, Inbox, Shield } from './icons';

const ICON: Record<string, { I: typeof Doc; bg: string; fg: string }> = {
  investment_declaration: { I: Doc, bg: 'var(--ez-warning-tint)', fg: 'var(--ez-warning)' },
  investment_proof: { I: Doc, bg: 'var(--ez-warning-tint)', fg: 'var(--ez-warning)' },
  policy_ack: { I: Shield, bg: 'var(--ez-info-tint)', fg: 'var(--ez-info)' },
  approval: { I: Inbox, bg: 'var(--ez-brand-tint)', fg: 'var(--ez-brand)' },
};
export default function PendingList({ data, prefs, nav }: { data: TodayPayload; prefs: Prefs; nav: (r: string) => void }) {
  const items = data.pending;
  return (
    <section className="card reveal" style={{ ['--i' as string]: 7 }}>
      <h2>Pending on you {items.length > 0 && <span className="count">{items.length}</span>}<button className="more" onClick={() => nav(ROUTES.inbox)}>Inbox</button></h2>
      {items.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ez-faint)' }}>Nothing waiting on you right now.</div> : (
        <ul className="todo">
          {items.map(it => {
            const m = ICON[it.kind === 'approval' ? 'approval' : it.type] ?? ICON.policy_ack;
            const due = it.due_on ? new Date(it.due_on) : null;
            const soon = due ? (due.getTime() - Date.now()) / 864e5 <= 21 : false;
            return (
              <li key={it.id}>
                <div className="ic" style={{ background: m.bg, color: m.fg }}><m.I /></div>
                <div className="tx"><div className="t">{it.title}</div>{it.description && <div className="d">{it.description}</div>}</div>
                <span className={'due ' + (due ? (soon ? 'soon' : 'ok') : 'ok')}>{due ? `Due ${fmtDateCompact(it.due_on!, prefs.date_format === 'long' ? 'short' : prefs.date_format).replace(/^\w{3}, /, '')}` : 'No deadline'}</span>
                <button className="go" onClick={() => nav(it.cta_route)}>{it.cta_label}</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
