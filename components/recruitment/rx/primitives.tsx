'use client';
import * as React from 'react';
import { Icon } from './icons';
import type { IconName, NextStep, Tone, ChainStepVM } from './logic/types';
import { useCountUp } from './logic/hooks';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* Badges and chips */
export function Badge({ children, tone = 'mute', dot = true, live, title }: { children: React.ReactNode; tone?: 'pos' | 'warn' | 'crit' | 'info' | 'brand' | 'mute' | 'dark'; dot?: boolean; live?: boolean; title?: string }) {
  return <span className={cx('rx-b', `b-${tone}`, !dot && 'nodot', live && 'rx-live')} title={title}>{children}</span>;
}
export function Chip({ children, variant }: { children: React.ReactNode; variant?: 'ok' | 'miss' }) {
  return <span className={cx('rx-chip', variant)}>{variant === 'ok' && <Icon name="check" />}{children}</span>;
}

/* Status → badge tone, shared by every screen so a colour always means the same thing */
export const MRF_TONE: Record<string, 'pos' | 'warn' | 'crit' | 'info' | 'brand' | 'mute'> = {
  DRAFT: 'brand', SUBMITTED: 'info', ON_HOLD: 'warn', APPROVED: 'pos', REJECTED: 'crit', CLOSED: 'mute',
};
export const MRF_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SUBMITTED: 'Submitted', ON_HOLD: 'On hold', APPROVED: 'Approved', REJECTED: 'Rejected', CLOSED: 'Closed',
};

/* Module (card section) */
export function Module({ title, icon, meta, actions, children, className, tone }: { title?: React.ReactNode; icon?: IconName; meta?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string; tone?: 'brand' | 'dark' }) {
  return (
    <section className={cx('rx-mod', tone, className)}>
      {(title || actions || meta) && (
        <div className="rx-mod-h">
          <div>{title && <div className="rx-mod-t">{icon && <Icon name={icon} />}{title}</div>}</div>
          <div className="rx-row" style={{ gap: 10 }}>{meta && <span className="rx-mod-m">{meta}</span>}{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

/* Progress ring. pct 0–100. */
export function Ring({ pct, label, tone, size = 'md' }: { pct: number; label: React.ReactNode; tone?: 'pos' | 'warn' | 'crit'; size?: 'md' | 'lg' }) {
  const zero = pct <= 0;
  const off = Math.round(163.4 * (1 - Math.min(100, Math.max(0, pct)) / 100) * 10) / 10;
  return (
    <div className={cx('rx-ring', tone, size === 'lg' && 'lg', zero && 'zero')} role="img" aria-label={typeof label === 'string' ? label : undefined}>
      <svg viewBox="0 0 64 64" aria-hidden="true"><circle className="bg" cx="32" cy="32" r="26" /><circle className="fg" cx="32" cy="32" r="26" style={{ strokeDashoffset: off }} /></svg>
      <span>{label}</span>
    </div>
  );
}

export function Track({ pct, tone }: { pct: number; tone?: 'pos' | 'warn' | 'crit' }) {
  return <div className={cx('rx-track', tone)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(1, Math.min(100, pct))}%` }} /></div>;
}

export function PropBar({ parts }: { parts: { value: number; color: string; label: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return <div className="rx-prop" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
    {parts.filter((p) => p.value > 0).map((p) => <i key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
  </div>;
}

/* KPI tile — the whole tile is the link to where the number lives */
export function KpiCard({ icon, iconTone, label, value, sub, viz, valueTone, onClick }: { icon: IconName; iconTone?: 'pos' | 'warn' | 'crit' | 'info'; label: string; value: number; sub?: React.ReactNode; viz?: React.ReactNode; valueTone?: 'pos' | 'brand'; onClick?: () => void }) {
  const v = useCountUp(value);
  return (
    <button type="button" className="rx-mod rx-lift rx-kpi-card" onClick={onClick} style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: onClick ? 'pointer' : 'default' }}>
      <span className="rx-kpi">
        <span className="rx-kpi-l"><span className={cx('rx-ico', iconTone)}><Icon name={icon} /></span>{label}{onClick && <span className="rx-kpi-go"><Icon name="right" /></span>}</span>
        <span className="rx-row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <span className="rx-kpi-v" style={valueTone ? { color: valueTone === 'pos' ? 'var(--ez-positive)' : 'var(--ez-brand)' } : undefined} aria-label={String(value)}>{v}</span>{viz}
        </span>
        {sub && <span className="rx-kpi-s">{sub}</span>}
      </span>
    </button>
  );
}

export function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return <div className="rx-mini" aria-hidden="true">{values.map((n, i) => <i key={i} style={{ height: Math.max(8, Math.round((n / max) * 44)), background: `var(--ez-ramp-${Math.min(6, i + 1)})` }} />)}</div>;
}

/* Next-step line */
export function NextStepLine({ step, compact }: { step: NextStep; compact?: boolean }) {
  return <span className={cx('rx-next', step.tone)} style={compact ? { padding: '4px 8px' } : undefined}><Icon name={step.icon} />{step.text}</span>;
}

/* Inline help — native <details>, keyboard and screen-reader friendly */
export function Help({ label, children, align = 'left' }: { label: string; children: React.ReactNode; align?: 'left' | 'right' }) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    const onDoc = (e: MouseEvent) => { if (el.open && !el.contains(e.target as Node)) el.open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && el.open) { el.open = false; el.querySelector('summary')?.focus(); } };
    document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  return <details className="rx-help" ref={ref}><summary><Icon name="info" />{label}</summary><div className={cx('rx-help-body', align === 'right' && 'r')}>{children}</div></details>;
}

export function Callout({ tone, icon, children }: { tone: 'warn' | 'info' | 'pos' | 'crit'; icon?: IconName; children: React.ReactNode }) {
  return <div className={cx('rx-call', tone)} role={tone === 'crit' || tone === 'warn' ? 'alert' : undefined}><Icon name={icon ?? (tone === 'pos' ? 'check' : tone === 'info' ? 'info' : 'alert')} /><div>{children}</div></div>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return <div className="rx-empty"><Icon name="search" /><b>{title}</b>{hint && <span>{hint}</span>}{action}</div>;
}

export function Avatar({ initials, tone = 0, size }: { initials: string; tone?: 0 | 1 | 2 | 3; size?: 'sm' | 'lg' }) {
  return <span className={cx('rx-av', tone > 0 && `a${tone + 1}`, size)} aria-hidden="true">{initials}</span>;
}
/** Stable tone per person so the same name keeps the same colour everywhere. */
export const toneFor = (s: string) => ([...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 4) as 0 | 1 | 2 | 3;
export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/* Approval chain stepper (horizontal) */
export function ApprovalChain({ steps }: { steps: ChainStepVM[] }) {
  return (
    <ol className="rx-chain" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((s, i) => {
        const st = s.status === 'APPROVED' ? 'done' : s.status === 'REJECTED' ? 'no' : s.status === 'PENDING' && steps.slice(0, i).every((p) => p.status === 'APPROVED') ? 'now' : '';
        return (
          <li key={i} className={cx('rx-step', st)} aria-label={`${s.role}: ${s.approverName}, ${s.status.toLowerCase()}`}>
            <div className="rx-sd">{st === 'done' ? <Icon name="check" /> : st === 'no' ? <Icon name="x" /> : i + 1}</div>
            <div className="rx-sr">{s.role}</div><div className="rx-sn">{s.approverName}</div>
          </li>
        );
      })}
    </ol>
  );
}

/* Timeline (audit trail, rounds) */
export function Timeline({ items }: { items: { title: React.ReactNode; meta?: React.ReactNode; tone?: 'pos' | 'warn' | 'mute' | '' ; body?: React.ReactNode }[] }) {
  return <div className="rx-tl">{items.map((it, i) => (
    <div className="rx-tli" key={i}><span className={cx('rx-tld', it.tone)} /><div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13.5, fontWeight: 550 }}>{it.title}</div>{it.meta && <div className="rx-meta" style={{ fontSize: 12, marginTop: 2 }}>{it.meta}</div>}{it.body}
    </div></div>
  ))}</div>;
}

/* Filter pills with counts; a zero-count filter is disabled rather than hidden */
export function FilterPills({ options, value, onChange, label }: { options: { value: string; label: string; count: number }[]; value: string; onChange: (v: string) => void; label: string }) {
  return <div className="rx-bar" role="group" aria-label={label}>{options.map((o) => (
    <button key={o.value} type="button" className="rx-filter" aria-pressed={value === o.value} disabled={o.count === 0 && o.value !== '*'} onClick={() => onChange(o.value)}>{o.label} <b>{o.count}</b></button>
  ))}</div>;
}

/* Segmented switch */
export function Segmented<V extends string>({ options, value, onChange, label }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; label: string }) {
  return <div className="rx-seg" role="group" aria-label={label}>{options.map((o) => (
    <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
  ))}</div>;
}

/* Search box with "/" hint */
export const SearchBox = React.forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void; placeholder: string; label: string }>(
  function SearchBox({ value, onChange, placeholder, label }, ref) {
    return <label className="rx-search"><Icon name="search" /><input ref={ref} className="rx-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} /><span className="rx-kbd" aria-hidden="true">/</span></label>;
  });

export { cx };
