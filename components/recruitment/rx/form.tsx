'use client';
import * as React from 'react';
import { Icon } from './icons';
import { Badge, Ring, Track } from './primitives';
import { MrfCard } from './cards';
import { formatINR, formatLakh } from './logic/derive';
import type { IconName, MrfVM } from './logic/types';

// TAKEN FROM THE KIT UNMODIFIED — which is unusual here and worth recording.
// cards.tsx, adapters.ts, types.ts, hooks.ts and MrfListView.tsx all needed a
// three-way merge, because this repo's copies hold resolved column names and
// behaviour the kit's do not. This one dropped in because three things happened
// to line up: MrfCard keeps onEdit/onMore OPTIONAL here, so LivePreview's
// <MrfCard m onView /> satisfies it; IconName is a superset of the five icons
// used below (check, lock, send, spark, x); and formatINR/formatLakh already
// exist in logic/derive. All 33 classes it uses are already in
// lib/ui/recruitment.redesign.css, so it needed no stylesheet work either.
//
// If the kit is ever re-imported, diff this file rather than overwriting the
// others alongside it.

/**
 * Raise MRF — form skin.
 *
 * These pieces RESTYLE the existing create form (components/ess/MrfForm.tsx)
 * and the inline ten-step edit form. They hold no form state and do no
 * validation or submission of their own:
 *   - every value/onChange is the form's existing state and setter
 *   - the lane check stays the form's own QUICK_HIRE_CAP check;
 *     <LaneMeter> only draws what that check already decided
 *   - "Draft with AI" calls the form's existing generate-jd handler
 *   - Submit / Save draft call the form's existing handlers
 * MrfForm is shared with ESS "Raise MRF"; see docs/03 for scoping the look.
 */

/* Layout: section nav · sections · sticky side panel */
export function RaiseMrfLayout({ nav, side, children }: { nav?: React.ReactNode; side: React.ReactNode; children: React.ReactNode }) {
  return <div className="rx-fwrap">{nav ?? <span />}<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div><aside className="rx-side">{side}</aside></div>;
}

export interface NavItem { id: string; label: string; done: boolean }
export function FormNav({ items, activeId, requiredDone, requiredTotal }: { items: NavItem[]; activeId?: string; requiredDone: number; requiredTotal: number }) {
  return (
    <nav className="rx-fnav" aria-label="Form sections">
      <div className="rx-row" style={{ justifyContent: 'space-between', margin: '2px 4px 8px' }}>
        <span className="rx-label">Progress</span><span className="rx-meta rx-num">{requiredDone} of {requiredTotal} required</span>
      </div>
      <div style={{ margin: '0 4px 10px' }}><Track label="Required fields completed" pct={requiredTotal ? (requiredDone / requiredTotal) * 100 : 0} /></div>
      {items.map((it, i) => (
        <a key={it.id} href={`#${it.id}`} className={it.id === activeId ? 'now' : it.done ? 'done' : ''} aria-current={it.id === activeId ? 'step' : undefined}>
          <span className="rx-sd">{it.done && it.id !== activeId ? <Icon name="check" /> : i + 1}</span>{it.label}
        </a>
      ))}
    </nav>
  );
}

export function FormSection({ id, icon, title, subtitle, done, active, children }: { id: string; icon: IconName; title: string; subtitle?: string; done?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className={active ? 'rx-fsec now' : 'rx-fsec'} aria-labelledby={`${id}-h`}>
      <div className="rx-fsec-h">
        <span className="rx-fsec-n"><Icon name={icon} /></span>
        <div><h2 id={`${id}-h`}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {done && <span style={{ marginLeft: 'auto' }}><Badge tone="pos">Done</Badge></span>}
      </div>
      {children}
    </section>
  );
}

/** A field MrfForm prefills from the raiser's employee record (company, department, RM1/RM2/HOD). */
export function AutoField({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="rx-field rx-auto">
      <label className="rx-label" htmlFor={id}>{label}</label>
      <input id={id} className="rx-input" value={value} readOnly aria-describedby={`${id}-auto`} />
      <span className="rx-auto-tag" id={`${id}-auto`}><Icon name="check" />From profile</span>
    </div>
  );
}

/** Radio group as cards — for REQ_TYPES (New Hire · Replacement · Temporary · Backfill). */
export function ChoiceCards<V extends string>({ name, label, value, onChange, options }: {
  name: string; label: string; value: V | null; onChange: (v: V) => void;
  options: { value: V; label: string; hint?: string; icon: IconName }[];
}) {
  return (
    <div className="rx-choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="ic"><Icon name={o.icon} /></span><b>{o.label}</b>{o.hint && <small>{o.hint}</small>}
        </label>
      ))}
    </div>
  );
}

export function NumberStepper({ value, onChange, min = 1, max = 999, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Number.isFinite(n) ? n : min)));
  return (
    <div className="rx-num-step">
      <button type="button" aria-label={`Fewer ${label}`} onClick={() => set(value - 1)} disabled={value <= min}>−</button>
      <input inputMode="numeric" aria-label={label} value={value} onChange={(e) => set(parseInt(e.target.value, 10))} />
      <button type="button" aria-label={`More ${label}`} onClick={() => set(value + 1)} disabled={value >= max}>+</button>
    </div>
  );
}

/**
 * Where the budget band sits against the Quick Hire cap. Inputs in RUPEES,
 * already annualised if the pay basis is monthly (the form does that today).
 * `lane` is what the form's own check decided; the meter only draws it.
 */
export function LaneMeter({ minRupees, maxRupees, cap, lane, scaleMax }: { minRupees: number | null; maxRupees: number | null; cap: number; lane: 'Quick Hire' | 'Full MRF' | null; scaleMax?: number }) {
  const top = scaleMax ?? Math.max(cap * 2, (maxRupees ?? 0) * 1.1);
  const pos = (v: number) => Math.max(0, Math.min(100, (v / top) * 100));
  const lo = minRupees ?? maxRupees; const hi = maxRupees ?? minRupees;
  return (
    <div className="rx-lane">
      <div className="rx-row" style={{ justifyContent: 'space-between', marginBottom: 22 }}>
        <span className="rx-label">Where your band sits</span>
        {lane && <Badge tone={lane === 'Quick Hire' ? 'pos' : 'brand'}>{lane}</Badge>}
      </div>
      <div className="rx-lane-bar" role="img" aria-label={lo != null && hi != null ? `${formatINR(lo)} to ${formatINR(hi)}, cap ${formatINR(cap)}` : 'No budget yet'}>
        {lo != null && hi != null && <span className="rx-lane-band" style={{ left: `${pos(lo)}%`, width: `${Math.max(1, pos(hi) - pos(lo))}%` }} />}
        <span className="rx-lane-cap" data-label={`${formatLakh(cap, 1)} cap`} style={{ left: `${pos(cap)}%` }} />
      </div>
      <div className="rx-lane-leg"><span>₹0</span><span>Quick Hire up to {formatINR(cap)}</span><span>Full MRF above</span><span>{formatLakh(top, 0)}</span></div>
    </div>
  );
}

export function ChipsInput({ id, label, values, onAdd, onRemove, placeholder }: { id: string; label: string; values: string[]; onAdd: (v: string) => void; onRemove: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = React.useState('');
  return (
    <div className="rx-chips-in">
      {values.map((v) => <span className="rx-tag" key={v}>{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onRemove(v)}><Icon name="x" /></button></span>)}
      <input id={id} aria-label={label} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ',') && draft.trim()) { e.preventDefault(); onAdd(draft.trim()); setDraft(''); }
          if (e.key === 'Backspace' && !draft && values.length) onRemove(values[values.length - 1]);
        }} />
    </div>
  );
}

/** Calls the form's existing generate-jd handler. */
export function AiButton({ onClick, busy, children = 'Draft with AI' }: { onClick: () => void; busy?: boolean; children?: React.ReactNode }) {
  return <button type="button" className="rx-ai" onClick={onClick} disabled={busy} aria-busy={busy}><Icon name="spark" />{busy ? 'Drafting…' : children}</button>;
}

/** Live preview of the requisition as its card will look, built from the form's current values. */
export function LivePreview({ mrf }: { mrf: MrfVM }) {
  return (
    <div className="rx-prev" aria-label="Preview of this requisition">
      <div className="rx-prev-l"><i />Live preview</div>
      <MrfCard m={mrf} onView={() => {}} />
    </div>
  );
}

/** Required-field checklist + the form's own submit and save-draft handlers. */
export function SubmitPanel({ checks, onSubmit, onSaveDraft, submitting }: {
  checks: { label: string; ok: boolean }[]; onSubmit: () => void; onSaveDraft?: () => void; submitting?: boolean;
}) {
  const done = checks.filter((c) => c.ok).length;
  const missing = checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase());
  const ready = missing.length === 0;
  return (
    <div className="rx-submit">
      <div className="rx-row" style={{ justifyContent: 'space-between' }}>
        <span className="rx-mod-t">Ready to submit?</span>
        <Ring pct={checks.length ? (done / checks.length) * 100 : 0} label={`${done}/${checks.length}`} tone={ready ? 'pos' : undefined} />
      </div>
      <div className="rx-reqs">{checks.map((c) => <div key={c.label} className={c.ok ? 'ok' : ''}><span className="rx-sd">{c.ok && <Icon name="check" />}</span>{c.label}</div>)}</div>
      {!ready && <span className="rx-why"><Icon name="lock" />Add {missing.join(' and ')}</span>}
      <button type="button" className="rx-btn p" style={{ height: 46 }} disabled={!ready || submitting} onClick={onSubmit}><Icon name="send" />{submitting ? 'Submitting…' : 'Submit for approval'}</button>
      {onSaveDraft && <button type="button" className="rx-btn g" onClick={onSaveDraft}>Save as draft</button>}
    </div>
  );
}
