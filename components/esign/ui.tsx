'use client'
// components/esign/ui.tsx — small pieces shared by the signer page, the verify page and the
// HR E-Sign module, so all three read as one product.
import { C, F, W, R, E } from '@/lib/ui'

export const font = '"DM Sans","Segoe UI",system-ui,sans-serif'
export const numeric: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' }

/** The quill mark used for "sign" actions — lib/ui has no pen icon. */
export function IconPen({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.6 3.4a1.9 1.9 0 0 1 2.7 2.7L7.2 15.2l-3.6.9.9-3.6 9.1-9.1Z" /><path d="M12.3 4.7l2.9 2.9" /><path d="M3 18.2h14" />
    </svg>
  )
}
export function IconShield({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 2.2 16.4 4.6v4.7c0 4.1-2.7 7-6.4 8.5-3.7-1.5-6.4-4.4-6.4-8.5V4.6L10 2.2Z" /><path d="m7.2 10 2 2 3.8-4" />
    </svg>
  )
}

/** The EZER Sign wordmark: a quill in a brand tile + the name. */
export function SignMark({ sub }: { sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: R.md, background: C.brand, color: C.onAccent, display: 'grid', placeItems: 'center', boxShadow: E.brand }}><IconPen size={18} /></div>
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontWeight: W.bold, fontSize: 15, color: C.ink, letterSpacing: '-.01em' }}>EZER <span style={{ color: C.brand }}>Sign</span></div>
        {sub && <div style={{ fontSize: F.micro, color: C.muted, fontWeight: W.semi, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  )
}

export type Tone = 'neutral' | 'brand' | 'positive' | 'warning' | 'critical' | 'info'
export const toneColors = (t: Tone) => ({
  neutral: { fg: C.inkSoft, bg: C.sunken, bd: C.line },
  brand: { fg: C.brandDeep, bg: C.brandTint, bd: C.brandEdge },
  positive: { fg: C.positive, bg: C.positiveTint, bd: C.positiveEdge },
  warning: { fg: C.warning, bg: C.warningTint, bd: C.warningEdge },
  critical: { fg: C.critical, bg: C.criticalTint, bd: C.criticalEdge },
  info: { fg: C.info, bg: C.infoTint, bd: C.infoEdge },
}[t])

export function Pill({ t = 'neutral', children, dot }: { t?: Tone; children: React.ReactNode; dot?: boolean }) {
  const c = toneColors(t)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: R.pill, background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, fontSize: F.tiny, fontWeight: W.bold, whiteSpace: 'nowrap', letterSpacing: '.01em' }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 99, background: c.fg }} />}{children}
    </span>
  )
}

export const ENVELOPE_STATUS: Record<string, { label: string; t: Tone }> = {
  DRAFT: { label: 'Draft', t: 'neutral' }, SENT: { label: 'Waiting for signatures', t: 'warning' }, IN_PROGRESS: { label: 'Partly signed', t: 'info' },
  COMPLETED: { label: 'Completed', t: 'positive' }, DECLINED: { label: 'Declined', t: 'critical' }, VOIDED: { label: 'Voided', t: 'neutral' }, EXPIRED: { label: 'Expired', t: 'neutral' },
}
export const SIGNER_STATUS: Record<string, { label: string; t: Tone }> = {
  WAITING: { label: 'Queued', t: 'neutral' }, PENDING: { label: 'Invited', t: 'warning' }, VIEWED: { label: 'Opened', t: 'info' },
  SIGNED: { label: 'Signed', t: 'positive' }, DECLINED: { label: 'Declined', t: 'critical' },
}

export function Btn({ kind = 'primary', children, style, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const dis = !!p.disabled
  const look: React.CSSProperties = kind === 'primary'
    ? { background: dis ? C.sunken : C.brand, color: dis ? C.faint : C.onAccent, border: `1px solid ${dis ? C.line : C.brand}`, boxShadow: dis ? 'none' : E.brand }
    : kind === 'danger' ? { background: C.surface, color: C.critical, border: `1px solid ${C.criticalEdge}` }
    : kind === 'ghost' ? { background: 'transparent', color: C.brand, border: '1px solid transparent' }
    : { background: C.surface, color: C.ink, border: `1px solid ${C.lineStrong}` }
  return (
    <button type="button" className={dis ? undefined : 'ez-press'} {...p}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 18px', borderRadius: R.md, fontFamily: font, fontSize: F.body, fontWeight: W.semi, cursor: dis ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', ...look, ...style }}>
      {children}
    </button>
  )
}

export function Panel({ children, style, pad = 22 }: { children: React.ReactNode; style?: React.CSSProperties; pad?: number }) {
  return <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.raised, padding: pad, ...style }}>{children}</div>
}

/** Six separate boxes that behave like one input (paste, backspace, arrows). */
export function OtpBoxes({ value, onChange, onDone, disabled }: { value: string; onChange: (v: string) => void; onDone?: (v: string) => void; disabled?: boolean }) {
  const set = (v: string) => { const d = v.replace(/\D/g, '').slice(0, 6); onChange(d); if (d.length === 6) onDone?.(d) }
  return (
    <div style={{ position: 'relative', display: 'flex', gap: 8, justifyContent: 'center' }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ width: 46, height: 54, borderRadius: R.md, border: `1.5px solid ${value.length === i && !disabled ? C.brand : value[i] ? C.lineStrong : C.line}`, background: C.surface, display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: W.bold, color: C.ink, boxShadow: value.length === i && !disabled ? `0 0 0 3px ${C.brandTint}` : 'none', ...numeric }}>{value[i] || ''}</div>
      ))}
      <input aria-label="One-time password" inputMode="numeric" autoComplete="one-time-code" autoFocus disabled={disabled} value={value} onChange={e => set(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, fontSize: 16, letterSpacing: 40, cursor: 'text' }} />
    </div>
  )
}
