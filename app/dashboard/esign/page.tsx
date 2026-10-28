'use client'
// app/dashboard/esign/page.tsx — Compliance & Docs → E-Sign.
//
// HR's desk for documents out for signature: what is waiting on whom, what completed, what
// was declined, and the full audit trail of any one of them. "Send for signature" opens the
// composer (components/esign/Composer.tsx). Access: the HR Letters module (VIEW to see,
// EDIT to send, remind or void) — the API enforces the same.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { useGrant } from '@/lib/rms/client'
import { hasLevel } from '@/lib/rms/resolve'
import { C, F, W, R, E, Z, IconClose, IconSearch, IconDownload, IconAlert, IconCheck, IconMail, IconClock } from '@/lib/ui'
import Composer, { type ComposerPrefill } from '@/components/esign/Composer'
import { Btn, Pill, font, numeric, ENVELOPE_STATUS, SIGNER_STATUS, IconPen, IconShield } from '@/components/esign/ui'
import { categoryLabel, CATEGORIES, describeAgent } from '@/lib/esign/core'

type Signer = { id: string; order_no: number; name: string; email: string; status: string; role_label: string | null; auth_method: string; signed_at: string | null; viewed_at: string | null; invited_at: string | null; decline_reason: string | null; aadhaar_last4?: string | null; signed_ip?: string | null; email_verified_at?: string | null; aadhaar_verified_at?: string | null; aadhaar_mode?: string | null }
type Env = { id: string; envelope_no: string; title: string; category: string; source: string; batch_id: string | null; status: string; signing_order: string; page_count: number; original_name: string | null; expires_at: string | null; created_by_name: string | null; created_at: string; updated_at: string; completed_at: string | null; void_reason: string | null; signers: Signer[] }

const TABS = [
  { id: 'all', label: 'All', match: (_e: Env) => true },
  { id: 'waiting', label: 'Waiting', match: (e: Env) => e.status === 'SENT' || e.status === 'IN_PROGRESS' },
  { id: 'completed', label: 'Completed', match: (e: Env) => e.status === 'COMPLETED' },
  { id: 'declined', label: 'Declined & voided', match: (e: Env) => e.status === 'DECLINED' || e.status === 'VOIDED' },
  { id: 'expired', label: 'Expired', match: (e: Env) => e.status === 'EXPIRED' },
]
const day = (s: string | null) => s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const when = (s: string | null) => s ? new Date(s).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
const EVENT: Record<string, string> = {
  CREATED: 'Created', SENT: 'Sent for signature', INVITED: 'Invite e-mailed', OPENED: 'Opened the link', OTP_SENT: 'OTP sent', OTP_VERIFIED: 'E-mail verified', OTP_FAILED: 'Wrong OTP',
  AADHAAR_OTP_SENT: 'Aadhaar OTP requested', AADHAAR_VERIFIED: 'Aadhaar verified', VIEWED: 'Viewed the document', SIGNED: 'Signed', DECLINED: 'Declined', REMINDED: 'Reminder sent',
  VOIDED: 'Voided', COMPLETED: 'Completed', DOWNLOADED: 'Downloaded', VERIFIED: 'Verified publicly',
}

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init?.headers || {}) }, cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { setup: j.setup })
  return j
}

function Kpi({ label, value, sub, tone, icon }: { label: string; value: number | string; sub: string; tone: 'brand' | 'warning' | 'positive' | 'critical'; icon: React.ReactNode }) {
  const fg = { brand: C.brand, warning: C.warning, positive: C.positive, critical: C.critical }[tone]
  const bg = { brand: C.brandTint, warning: C.warningTint, positive: C.positiveTint, critical: C.criticalTint }[tone]
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: '16px 18px', boxShadow: E.flat, display: 'flex', gap: 14, alignItems: 'center' }}>
      <span style={{ width: 40, height: 40, borderRadius: R.md, background: bg, color: fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: F.tiny, fontWeight: W.bold, color: C.muted, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: W.bold, color: C.ink, letterSpacing: '-.02em', ...numeric }}>{value}</div>
        <div style={{ fontSize: F.tiny, color: C.muted }}>{sub}</div>
      </div>
    </div>
  )
}

function SignerDots({ signers }: { signers: Signer[] }) {
  const done = signers.filter(s => s.status === 'SIGNED').length
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex' }}>
        {signers.slice(0, 4).map((s, i) => {
          const c = s.status === 'SIGNED' ? C.positive : s.status === 'DECLINED' ? C.critical : s.status === 'VIEWED' ? C.info : s.status === 'PENDING' ? C.warning : C.faint
          return <span key={s.id} title={`${s.name} — ${SIGNER_STATUS[s.status]?.label}`} style={{ width: 26, height: 26, borderRadius: 99, marginLeft: i ? -7 : 0, background: C.surface, border: `2px solid ${c}`, color: C.inkSoft, display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: W.bold }}>{s.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
        })}
        {signers.length > 4 && <span style={{ width: 26, height: 26, borderRadius: 99, marginLeft: -7, background: C.sunken, border: `2px solid ${C.line}`, display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: W.bold, color: C.muted }}>+{signers.length - 4}</span>}
      </div>
      <span style={{ fontSize: F.small, color: C.muted, ...numeric }}><b style={{ color: C.ink }}>{done}</b>/{signers.length} signed</span>
    </div>
  )
}

function Drawer({ id, canEdit, onClose, onChanged }: { id: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const load = useCallback(() => api(`/api/esign/envelopes/${id}`).then(setD).catch(e => setErr(e.message)), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const act = async (body: object, ok: string) => {
    setBusy(true); setErr(''); setNote('')
    try { const j = await api(`/api/esign/envelopes/${id}`, { method: 'POST', body: JSON.stringify(body) }); setNote(j.link ? `Mail could not be sent. Link: ${j.link}` : ok); await load(); onChanged() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const env = d?.envelope, signers: Signer[] = d?.signers || [], open = env && (env.status === 'SENT' || env.status === 'IN_PROGRESS')
  const st = env ? ENVELOPE_STATUS[env.status] : null
  return (
    <div role="dialog" aria-modal="true" aria-label="Document details" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: Z.modal, background: 'rgba(8,15,35,.42)', display: 'flex', justifyContent: 'flex-end' }}>
      <div className="ez-rise" style={{ width: 'min(760px, 100%)', height: '100%', background: C.canvas, boxShadow: E.overlay, display: 'flex', flexDirection: 'column', fontFamily: font, color: C.ink }}>
        <div style={{ padding: '18px 22px', background: C.surface, borderBottom: `1px solid ${C.line}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{st && <Pill t={st.t} dot>{st.label}</Pill>}<span style={{ fontSize: F.small, color: C.muted, ...numeric }}>{env?.envelope_no}</span></div>
            <div style={{ fontSize: 19, fontWeight: W.bold, marginTop: 6, letterSpacing: '-.01em' }}>{env?.title || 'Loading…'}</div>
            {env && <div style={{ fontSize: F.small, color: C.muted, marginTop: 4 }}>{categoryLabel(env.category)} · {env.page_count} pages · sent {when(env.created_at)} by {env.created_by_name}{env.expires_at && open ? ` · link valid till ${day(env.expires_at)}` : ''}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: R.sm, border: `1px solid ${C.line}`, background: C.surface, color: C.muted, cursor: 'pointer', display: 'grid', placeItems: 'center' }}><IconClose size={16} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'grid', gap: 18, alignContent: 'start' }}>
          {env && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {d.files.signed && <a href={d.files.signed} style={{ textDecoration: 'none' }}><Btn><IconDownload size={15} /> Signed PDF + certificate</Btn></a>}
              {d.files.current && !d.files.signed && <a href={d.files.current} style={{ textDecoration: 'none' }}><Btn kind="secondary"><IconDownload size={15} /> Signed so far</Btn></a>}
              {d.files.original && <a href={d.files.original} style={{ textDecoration: 'none' }}><Btn kind="secondary"><IconDownload size={15} /> Original</Btn></a>}
              {d.files.preview && <a href={d.files.preview} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><Btn kind="ghost">Open preview ↗</Btn></a>}
              {open && canEdit && <Btn kind="secondary" onClick={() => act({ action: 'remind' }, 'Reminder sent.')} disabled={busy}><IconMail size={15} /> Remind</Btn>}
              {open && canEdit && <Btn kind="danger" onClick={() => setVoiding(v => !v)} disabled={busy}>Void</Btn>}
            </div>
          )}
          {voiding && (
            <div style={{ padding: 14, borderRadius: R.md, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, display: 'grid', gap: 10 }}>
              <div style={{ fontSize: F.small, color: C.inkSoft }}>Voiding cancels the document: every signing link stops working at once. This cannot be undone.</div>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason, e.g. wrong CTC — a corrected letter will follow" style={{ padding: '9px 12px', borderRadius: R.md, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink, fontFamily: font, fontSize: F.body }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Btn kind="secondary" onClick={() => setVoiding(false)}>Keep</Btn><Btn kind="danger" disabled={busy || reason.trim().length < 3} onClick={() => act({ action: 'void', reason }, 'Voided.').then(() => setVoiding(false))}>Void document</Btn></div>
            </div>
          )}
          {(err || note) && <div role="status" style={{ fontSize: F.small, padding: '9px 12px', borderRadius: R.md, wordBreak: 'break-all', color: err ? C.critical : C.positive, background: err ? C.criticalTint : C.positiveTint }}>{err || note}</div>}
          {env?.void_reason && <div style={{ fontSize: F.small, color: C.muted }}>Voided: {env.void_reason}</div>}

          <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', fontWeight: W.bold, borderBottom: `1px solid ${C.line}`, display: 'flex' }}>Signers<span style={{ marginLeft: 'auto', fontSize: F.small, color: C.muted, fontWeight: W.medium }}>{env?.signing_order === 'PARALLEL' ? 'any order' : 'in order'}</span></div>
            {signers.map(s => {
              const ss = SIGNER_STATUS[s.status]
              return (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '30px 1fr auto', gap: 12, padding: '12px 16px', borderTop: `1px solid ${C.line}`, alignItems: 'start' }}>
                  <span style={{ width: 28, height: 28, borderRadius: 99, display: 'grid', placeItems: 'center', background: s.status === 'SIGNED' ? C.positive : C.sunken, color: s.status === 'SIGNED' ? C.onAccent : C.muted, fontSize: F.tiny, fontWeight: W.bold }}>{s.status === 'SIGNED' ? <IconCheck size={13} /> : s.order_no}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: W.semi }}>{s.name} <span style={{ color: C.muted, fontWeight: W.regular, fontSize: F.small }}>· {s.email}</span></div>
                    <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, lineHeight: 1.6 }}>
                      {s.role_label || 'Signer'} · {s.auth_method === 'EMAIL_AADHAAR_OTP' ? 'E-mail + Aadhaar OTP' : 'E-mail OTP'}
                      {s.invited_at && ` · invited ${when(s.invited_at)}`}{s.viewed_at && ` · opened ${when(s.viewed_at)}`}{s.signed_at && ` · signed ${when(s.signed_at)}${s.signed_ip ? ` from ${s.signed_ip}` : ''}`}
                      {s.aadhaar_verified_at && ` · Aadhaar ••${s.aadhaar_last4}${s.aadhaar_mode === 'DEMO' ? ' (demo)' : ''}`}
                    </div>
                    {s.decline_reason && <div style={{ marginTop: 6, fontSize: F.small, color: C.critical }}>“{s.decline_reason}”</div>}
                  </div>
                  <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                    {ss && <Pill t={ss.t}>{ss.label}</Pill>}
                    {open && canEdit && (s.status === 'PENDING' || s.status === 'VIEWED') && <button type="button" onClick={() => act({ action: 'resend', signer_id: s.id }, `New link sent to ${s.email}.`)} disabled={busy} style={{ border: 'none', background: 'none', color: C.brand, fontWeight: W.semi, fontSize: F.tiny, cursor: 'pointer', fontFamily: font }}>Resend link</button>}
                  </div>
                </div>
              )
            })}
          </section>

          <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: '14px 16px' }}>
            <div style={{ fontWeight: W.bold, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><IconShield size={16} color={C.brand} /> Audit trail</div>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {(d?.events || []).map((e: any, i: number, all: any[]) => {
                const sgn = signers.find(s => s.id === e.signer_id)
                const tone = e.action === 'SIGNED' || e.action === 'COMPLETED' || e.action.endsWith('VERIFIED') ? C.positive : e.action === 'DECLINED' || e.action === 'VOIDED' || e.action === 'OTP_FAILED' ? C.critical : C.lineStrong
                return (
                  <li key={e.id} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 12, position: 'relative', paddingBottom: i < all.length - 1 ? 14 : 0 }}>
                    {i < all.length - 1 && <span style={{ position: 'absolute', left: 6, top: 14, bottom: 0, width: 2, background: C.line }} />}
                    <span style={{ width: 14, height: 14, marginTop: 2, borderRadius: 99, background: C.surface, border: `3px solid ${tone}` }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: F.small }}><b>{EVENT[e.action] || e.action}</b>{sgn ? <span style={{ color: C.inkSoft }}> · {sgn.name}</span> : e.actor ? <span style={{ color: C.inkSoft }}> · {e.actor}</span> : null}{e.details?.reason ? <span style={{ color: C.muted }}> — {e.details.reason}</span> : null}{e.details?.mail && e.details.mail !== 'sent' ? <span style={{ color: C.warning }}> · mail: {e.details.mail}</span> : null}</div>
                      <div style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>{when(e.at)} IST{e.ip ? ` · ${e.ip}` : ''}{e.user_agent ? ` · ${describeAgent(e.user_agent)}` : ''}</div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
          {env?.status === 'COMPLETED' && <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.55 }}>Fingerprint (SHA-256) of the signed file: <span style={{ wordBreak: 'break-all', color: C.inkSoft, ...numeric }}>{env.signed_sha256}</span>. Anyone can check a copy at <a href={`/sign/verify?id=${env.envelope_no}`} target="_blank" rel="noreferrer" style={{ color: C.brand }}>/sign/verify</a>.</div>}
        </div>
      </div>
    </div>
  )
}

export default function ESignPage() {
  const { grant } = useGrant()
  const canEdit = hasLevel(grant, 'HR Letters', 'EDIT')
  const [rows, setRows] = useState<Env[] | null>(null)
  const [err, setErr] = useState('')
  const [setup, setSetup] = useState(false)
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [compose, setCompose] = useState<ComposerPrefill | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(() => api('/api/esign/envelopes').then(j => { setRows(j.envelopes); setErr(''); setSetup(false) }).catch(e => { setErr(e.message); setSetup(!!e.setup); setRows([]) }), [])
  useEffect(() => { load() }, [load])
  // Another module can hand a PDF over: it stores it in sessionStorage-free memory via window event.
  useEffect(() => {
    const h = (e: Event) => setCompose((e as CustomEvent<ComposerPrefill>).detail || {})
    window.addEventListener('ezer:esign-compose', h)
    return () => window.removeEventListener('ezer:esign-compose', h)
  }, [])

  const list = rows || []
  const stats = useMemo(() => {
    const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0)
    const done = list.filter(e => e.status === 'COMPLETED')
    const turn = done.filter(e => e.completed_at).map(e => (new Date(e.completed_at!).getTime() - new Date(e.created_at).getTime()) / 3600_000)
    return {
      waiting: list.filter(e => e.status === 'SENT' || e.status === 'IN_PROGRESS').length,
      waitingPeople: list.filter(e => e.status === 'SENT' || e.status === 'IN_PROGRESS').reduce((n, e) => n + e.signers.filter(s => s.status !== 'SIGNED').length, 0),
      doneMonth: done.filter(e => new Date(e.completed_at || e.updated_at) >= month).length, done: done.length,
      problems: list.filter(e => e.status === 'DECLINED' || e.status === 'EXPIRED').length,
      turn: turn.length ? turn.reduce((a, b) => a + b, 0) / turn.length : null,
    }
  }, [list])
  const shown = useMemo(() => {
    const m = TABS.find(t => t.id === tab)!.match
    const t = q.trim().toLowerCase()
    return list.filter(e => m(e) && (!cat || e.category === cat) && (!t || e.title.toLowerCase().includes(t) || e.envelope_no.toLowerCase().includes(t) || e.signers.some(s => s.name.toLowerCase().includes(t) || s.email.includes(t))))
  }, [list, tab, q, cat])

  return (
    <div style={{ background: C.canvas, minHeight: '100vh', fontFamily: font, color: C.ink }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 22px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: R.md, background: C.brand, color: C.onAccent, display: 'grid', placeItems: 'center', boxShadow: E.brand }}><IconPen size={19} /></span>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: W.bold, letterSpacing: '-.02em' }}>E-Sign</h1>
            </div>
            <div style={{ color: C.muted, fontSize: F.body, marginTop: 6 }}>Send offer letters, policies and agreements for signature — verified by e-mail OTP, stamped and sealed with an audit certificate.</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <a href="/sign/verify" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><Btn kind="secondary"><IconShield size={15} /> Verify a PDF</Btn></a>
            {canEdit && <Btn onClick={() => setCompose({})} disabled={setup}><IconPen size={15} /> Send for signature</Btn>}
          </div>
        </div>

        {setup && (
          <div style={{ display: 'flex', gap: 12, padding: 16, borderRadius: R.lg, background: C.warningTint, border: `1px solid ${C.warningEdge}`, marginBottom: 18 }}>
            <span style={{ color: C.warning }}><IconAlert size={18} /></span>
            <div style={{ fontSize: F.body, color: C.inkSoft }}><b>One-time setup needed.</b> {err} It creates four tables and a private storage bucket; nothing existing is changed.</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 18 }}>
          <Kpi label="Waiting" value={stats.waiting} sub={`${stats.waitingPeople} signature${stats.waitingPeople === 1 ? '' : 's'} outstanding`} tone="warning" icon={<IconClock size={18} />} />
          <Kpi label="Completed this month" value={stats.doneMonth} sub={`${stats.done} completed in all`} tone="positive" icon={<IconCheck size={18} />} />
          <Kpi label="Average turnaround" value={stats.turn === null ? '—' : stats.turn < 48 ? `${Math.round(stats.turn)}h` : `${(stats.turn / 24).toFixed(1)}d`} sub="sent → last signature" tone="brand" icon={<IconPen size={18} />} />
          <Kpi label="Needs attention" value={stats.problems} sub="declined or expired" tone="critical" icon={<IconAlert size={18} />} />
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
            <div role="tablist" style={{ display: 'flex', gap: 2, overflowX: 'auto' }}>
              {TABS.map(t => {
                const n = list.filter(t.match).length
                return (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
                    style={{ padding: '8px 12px', border: 'none', borderBottom: `2px solid ${tab === t.id ? C.brand : 'transparent'}`, background: 'transparent', color: tab === t.id ? C.ink : C.muted, fontWeight: tab === t.id ? W.bold : W.medium, fontSize: F.small, cursor: 'pointer', fontFamily: font, whiteSpace: 'nowrap' }}>
                    {t.label} <span style={{ marginLeft: 4, padding: '1px 7px', borderRadius: 99, background: tab === t.id ? C.brandTint : C.sunken, color: tab === t.id ? C.brandDeep : C.muted, fontSize: F.micro, ...numeric }}>{n}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={cat} onChange={e => setCat(e.target.value)} style={{ padding: '8px 10px', borderRadius: R.md, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontFamily: font, fontSize: F.small }}><option value="">All categories</option>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: 9, color: C.faint }}><IconSearch size={14} /></span>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Document, envelope or signer" data-no-titlecase style={{ padding: '8px 10px 8px 30px', width: 240, borderRadius: R.md, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontFamily: font, fontSize: F.small, outline: 'none' }} />
              </div>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead><tr style={{ background: C.sunken }}>
                {['Document', 'Signers', 'Status', 'Sent', 'Last activity'].map(h => <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: F.tiny, fontWeight: W.bold, color: C.muted, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: `1px solid ${C.line}` }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {shown.map(e => {
                  const st = ENVELOPE_STATUS[e.status] || ENVELOPE_STATUS.SENT
                  const next = e.signers.find(s => s.status !== 'SIGNED' && s.status !== 'WAITING')
                  return (
                    <tr key={e.id} onClick={() => setOpen(e.id)} className="ez-row" style={{ cursor: 'pointer', borderBottom: `1px solid ${C.line}` }}>
                      <td style={{ padding: '13px 16px', minWidth: 260 }}>
                        <div style={{ fontWeight: W.semi, fontSize: F.body }}>{e.title}</div>
                        <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, ...numeric }}>{e.envelope_no} · {categoryLabel(e.category)}{e.source === 'BULK' ? ' · bulk' : ''} · {e.page_count} pp</div>
                      </td>
                      <td style={{ padding: '13px 16px' }}><SignerDots signers={e.signers} />{(e.status === 'SENT' || e.status === 'IN_PROGRESS') && next && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 4 }}>Waiting on {next.name}</div>}</td>
                      <td style={{ padding: '13px 16px' }}><Pill t={st.t} dot>{st.label}</Pill></td>
                      <td style={{ padding: '13px 16px', fontSize: F.small, color: C.inkSoft, whiteSpace: 'nowrap' }}>{day(e.created_at)}<div style={{ fontSize: F.tiny, color: C.muted }}>{e.created_by_name}</div></td>
                      <td style={{ padding: '13px 16px', fontSize: F.small, color: C.muted, whiteSpace: 'nowrap', ...numeric }}>{when(e.completed_at || e.updated_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows === null && <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading…</div>}
            {rows && !shown.length && !setup && (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <div style={{ width: 52, height: 52, borderRadius: R.lg, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><IconPen size={22} /></div>
                <div style={{ fontWeight: W.bold }}>{list.length ? 'Nothing matches' : 'No documents sent for signature yet'}</div>
                <div style={{ color: C.muted, fontSize: F.small, marginTop: 4 }}>{list.length ? 'Try another tab, category or search.' : 'Upload a PDF, add who signs, place the boxes, send. Signers verify by e-mail OTP.'}</div>
                {!list.length && canEdit && <div style={{ marginTop: 14 }}><Btn onClick={() => setCompose({})}>Send your first document</Btn></div>}
              </div>
            )}
            {err && !setup && <div style={{ padding: 16, color: C.critical, fontSize: F.small }}>{err}</div>}
          </div>
        </div>
      </div>
      {compose && <Composer prefill={compose} onClose={() => setCompose(null)} onSent={load} />}
      {open && <Drawer id={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}
