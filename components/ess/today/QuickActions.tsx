'use client';
// components/ess/today/QuickActions.tsx
import { ROUTES } from '@/lib/today/schema';
import { Calendar, Download, Clock, Menu, Users, Layers } from './icons';

const ACTIONS = [
  { label: 'Apply leave', I: Calendar, to: ROUTES.applyLeave },
  { label: 'Payslip', I: Download, to: ROUTES.payslip, c: ['var(--ez-positive-tint)', 'var(--ez-positive)'] },
  { label: 'Regularise', I: Clock, to: ROUTES.regularise, c: ['var(--ez-warning-tint)', 'var(--ez-warning)'] },
  { label: 'Raise ticket', I: Menu, to: ROUTES.ticket, c: ['var(--ez-info-tint)', 'var(--ez-info)'] },
  { label: 'My team', I: Users, to: ROUTES.team },
  { label: 'Form 16', I: Layers, to: ROUTES.form16, c: ['var(--gold-soft)', 'var(--gold)'] },
];
export default function QuickActions({ nav }: { nav: (r: string) => void }) {
  return (
    <section className="card reveal" style={{ ['--i' as string]: 8 }}>
      <h2>Quick actions</h2>
      <div className="qa">
        {ACTIONS.map(a => (
          <button key={a.label} onClick={() => nav(a.to)} style={a.c ? { ['--c-bg' as string]: a.c[0], ['--c-fg' as string]: a.c[1], ['--c-edge' as string]: a.c[1] } : undefined}>
            <span className="ic"><a.I /></span>{a.label}
          </button>
        ))}
      </div>
    </section>
  );
}
