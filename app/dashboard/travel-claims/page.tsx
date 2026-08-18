'use client'
// app/dashboard/travel-claims/page.tsx — travel reimbursement back office.
//
// Four tabs, matching the approval chain plus the control that gates it:
//   HR Head    — reviews claims first (or second, if the RM stage is enabled)
//   Finance    — verifies line by line, approves, then marks paid
//   Manager    — only shown when travel_policies.rm_stage_enabled is true
//   Expense months — open / close / reopen / lock a month
//
// The vendor drop shipped the APIs for all of this but none of the screens;
// these are written for this repo.
//
// There is no server session to read an approver from yet, so the HR and
// Manager tabs ask who is acting. The chosen id is what the API filters the
// inbox by, so a person only ever sees claims genuinely routed to them.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import RouteMap, { type RouteData } from '@/components/travel/RouteMap'

// These endpoints require a signed-in dashboard session (lib/api-auth.ts).
// Mirrors the helper added to the recruitment page in 5220d59.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token
  return t ? { Authorization: `Bearer ${t}` } : {}
}

const V = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleDark: '#6D28D9', border: 'rgba(124,58,237,0.12)',
  muted: '#6B7280', card: '#FFFFFF', green: '#059669', greenBg: '#ECFDF5',
  red: '#DC2626', redBg: '#FEF2F2', amber: '#B45309', amberBg: '#FFFBEB',
  purpleBg: '#EDE9FE', field: '#FAFAF8', page: '#F5F3FF',
}

const inr = (n: unknown) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const num = (v: unknown) => Number(v) || 0
const dmy = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const S = {
  card: { background: V.card, borderRadius: 10, border: `1px solid ${V.border}`,
          padding: '16px 18px', marginBottom: 12, boxShadow: '0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  inp:  { padding: '9px 11px', background: V.field, border: '1px solid #DDD6FE', borderRadius: 7,
          color: V.navy, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' } as React.CSSProperties,
  lbl:  { fontSize: 11, fontWeight: 600, color: V.purpleDark, textTransform: 'uppercase',
          letterSpacing: '.05em', display: 'block', marginBottom: 4 } as React.CSSProperties,
  btnP: { padding: '8px 17px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5,
          fontWeight: 600, fontFamily: 'inherit', background: V.purple, color: '#fff' } as React.CSSProperties,
  btnG: { padding: '8px 17px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5,
          fontWeight: 600, fontFamily: 'inherit', background: V.green, color: '#fff' } as React.CSSProperties,
  btnO: { padding: '7px 14px', borderRadius: 7, border: '1px solid #DDD6FE', cursor: 'pointer',
          fontSize: 12, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: V.purpleDark } as React.CSSProperties,
  btnR: { padding: '7px 14px', borderRadius: 7, border: `1px solid ${V.red}33`, cursor: 'pointer',
          fontSize: 12, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: V.red } as React.CSSProperties,
}

interface Company { id: string; company_name: string }
interface Approver { id: string; full_name: string; emp_code: string }
interface Claim {
  id: string; claim_no: string; employee_id: string; emp_code: string | null; full_name: string | null
  period_from: string | null; period_to: string | null
  total_claimed: number; total_approved: number; net_payable: number
  status: string; submitted_at: string | null; line_count: number; flag_count: number
  period_status: string | null
}
interface Line {
  id: string; type_code: string; expense_date: string; city: string | null
  description: string | null; amount_claimed: number
  amount_approved: number | null; entitlement_limit: number | null
  line_status: string; finance_remarks: string | null
  // set for GPS-priced lines, so the approver can open the route
  travel_log_id: string | null
}
interface FlagRow {
  id: string; claim_line_id: string | null; severity: string; message: string
  flag_type: string; resolved_at: string | null
}
interface Bill {
  id: string; file_name: string | null; mime_type: string | null
  file_size: number | null; url: string | null; attachment_type: string
  uploaded_at: string | null
}
interface Period {
  id: string; period_month: string; period_label: string; status: string
  claim_counts: { draft: number; pending: number; total: number }
}
interface RateRow {
  id: string; type_code: string | null; rate_per_km: number
  effective_from: string; rate_label: string | null; notes: string | null
  set_by_name: string | null; set_at: string | null; in_force: boolean
  vehicle_type: string | null; fuel_type: string | null
}
interface TypeRow {
  id: string; type_code: string; type_name: string
  calc_method: 'PER_KM' | 'ACTUAL' | 'ZERO'
  requires_gps: boolean; bill_required: boolean; is_active: boolean
  category: string | null; bill_threshold: number
}

const CATEGORY_LABEL: Record<string, string> = {
  CONVEYANCE: 'Local conveyance', OUTSTATION: 'Outstation travel', STAY: 'Stay',
  ALLOWANCE: 'Allowances', COMMUNICATION: 'Communication',
  DOCUMENTATION: 'Travel documents', CLIENT: 'Client facing', OTHER: 'Other',
}

const STATUS_TEXT: Record<string, [string, string, string]> = {
  PENDING_RM:      [V.amberBg,  V.amber,      'With manager'],
  PENDING_HR:      [V.amberBg,  V.amber,      'With HR Head'],
  PENDING_FINANCE: [V.purpleBg, V.purpleDark, 'With Finance'],
  APPROVED:        [V.greenBg,  V.green,      'Approved'],
  PAID:            [V.greenBg,  V.green,      'Paid'],
  SENT_BACK:       [V.redBg,    V.red,        'Sent back'],
  REJECTED:        [V.redBg,    V.red,        'Rejected'],
}

// ---------------------------------------------------------------------------
// Sub-components outside the parent — inside, every keystroke remounts them
// and the remarks box loses focus.
// ---------------------------------------------------------------------------
function Pill({ status }: { status: string }) {
  const [bg, fg, text] = STATUS_TEXT[status] ?? [V.purpleBg, V.purpleDark, status]
  return <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 99, background: bg,
                        color: fg, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>
}

function Empty({ text }: { text: string }) {
  return <div style={{ textAlign: 'center', padding: '34px 0', color: V.muted, fontSize: 12.5 }}>{text}</div>
}

function Note({ tone, children }: { tone: 'ok' | 'warn' | 'err'; children: React.ReactNode }) {
  const [bg, fg] = tone === 'ok' ? [V.greenBg, V.green] : tone === 'warn' ? [V.amberBg, V.amber] : [V.redBg, V.red]
  return <div style={{ background: bg, color: fg, border: `1px solid ${fg}22`, borderRadius: 8,
                       padding: '10px 13px', fontSize: 12, marginBottom: 12 }}>{children}</div>
}

/** One expense line. Finance can edit the approved amount; HR sees it read-only. */
/**
 * One expense line. For a bill-less journey there is no receipt to check, so
 * the approver gets the recorded route instead — loaded on demand, because a
 * claim can hold twenty lines and fetching every trail up front would be slow
 * and mostly wasted.
 */
function LineRow({ line, editable, value, onChange, flags }: {
  line: Line; editable: boolean; value: string
  onChange: (v: string) => void; flags: FlagRow[]
}) {
  const [route, setRoute] = useState<RouteData | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [noTrail, setNoTrail] = useState(false)
  const [bills, setBills] = useState<Bill[] | null>(null)

  // The proof for a billed expense. Fetched once per line, on mount, because an
  // approver's first question on any line is "is there a receipt".
  useEffect(() => {
    if (!line.travel_log_id) { setBills([]); return }
    let live = true
    ;(async () => {
      const r = await fetch(`/api/travel/upload-bill?travel_log_id=${line.travel_log_id}`,
                            { headers: await authHeaders() })
      if (!live) return
      setBills(r.ok ? ((await r.json()).attachments ?? []) : [])
    })()
    return () => { live = false }
  }, [line.travel_log_id])

  const showRoute = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (route || noTrail) return
    setLoading(true)
    try {
      const r = await fetch(`/api/travel/route?log_id=${line.travel_log_id}`,
                            { headers: await authHeaders() })
      if (!r.ok) { setNoTrail(true); return }
      setRoute(await r.json() as RouteData)
    } catch { setNoTrail(true) } finally { setLoading(false) }
  }

  const trimmed = editable && value !== '' && num(value) < num(line.amount_claimed)
  return (
    <div style={{ borderBottom: `1px solid ${V.border}` }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: V.navy, fontWeight: 500 }}>
          {line.description || line.type_code}
        </div>
        <div style={{ fontSize: 11, color: V.muted, marginTop: 2 }}>
          {line.type_code} · {dmy(line.expense_date)}{line.city ? ` · ${line.city}` : ''}
          {line.entitlement_limit != null && ` · limit ${inr(line.entitlement_limit)}`}
        </div>
        {flags.map(f => (
          <div key={f.id} style={{ fontSize: 11, marginTop: 3,
                                   color: f.resolved_at ? V.muted
                                        : f.severity === 'BLOCK' ? V.red : V.amber,
                                   textDecoration: f.resolved_at ? 'line-through' : 'none' }}>
            ⚑ {f.message}{f.resolved_at ? ' — resolved' : ''}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 3 }}>
          {line.travel_log_id && (
            <button onClick={showRoute}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                             fontSize: 11, fontWeight: 600, color: V.purpleDark, fontFamily: 'inherit' }}>
              {open ? '▲ Hide route' : '📍 View route on map'}
            </button>
          )}

          {/* Proof of travel. A missing slip is stated plainly rather than left
              as an absence the approver has to notice. */}
          {bills?.map(b => (
            <a key={b.id} href={b.url ?? '#'} target="_blank" rel="noreferrer"
               style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
                        fontWeight: 600, color: V.green, textDecoration: 'none',
                        background: V.greenBg, border: `1px solid ${V.green}33`,
                        borderRadius: 99, padding: '2px 9px' }}>
              {b.mime_type === 'application/pdf' ? '📄' : '🧾'} {b.file_name || 'bill'}
            </a>
          ))}
          {bills !== null && bills.length === 0 && (
            <span style={{ fontSize: 11, color: V.amber, fontWeight: 500 }}>
              ⚠ no bill attached
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: V.navy, width: 84,
                    textAlign: 'right', flexShrink: 0, paddingTop: 1 }}>
        {inr(line.amount_claimed)}
      </div>
      {editable ? (
        <input type="number" min="0" max={line.amount_claimed} value={value}
               onChange={e => onChange(e.target.value)}
               style={{ ...S.inp, width: 92, flexShrink: 0, padding: '6px 9px',
                        borderColor: trimmed ? V.amber : '#DDD6FE' }} />
      ) : (
        <div style={{ width: 92, textAlign: 'right', fontSize: 12.5, color: V.muted, flexShrink: 0 }}>
          {line.amount_approved != null ? inr(line.amount_approved) : '—'}
        </div>
      )}
    </div>

    {open && (
      <div style={{ padding: '0 0 10px' }}>
        {loading && <div style={{ fontSize: 12, color: V.muted, padding: '6px 0' }}>Loading the route…</div>}
        {noTrail && !loading && (
          <div style={{ fontSize: 12, color: V.muted, padding: '6px 0' }}>
            No recorded trail for this expense — it was not a GPS-priced journey.
          </div>
        )}
        {route && <RouteMap route={route} height={280} />}
      </div>
    )}
    </div>
  )
}

/**
 * A claim in an approver's inbox. `actions` names what this stage can do, so
 * the same card serves HR, Finance and the manager without branching per tab.
 */
function ClaimCard({ claim, stage, onAction, busy }: {
  claim: Claim
  stage: 'HR' | 'FINANCE' | 'RM'
  onAction: (claimId: string, action: string, remarks: string, lines?: Line[]) => Promise<void>
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [flags, setFlags] = useState<FlagRow[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [remarks, setRemarks] = useState('')
  const [loadingLines, setLoadingLines] = useState(false)

  const isFinance = stage === 'FINANCE'

  const expand = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (lines.length) return
    setLoadingLines(true)
    const r = await fetch(`/api/travel/claims?claim_id=${claim.id}`).then(x => x.json()).catch(() => ({}))
    const ls = (r.lines ?? []) as Line[]
    setLines(ls)
    setFlags((r.flags ?? []) as FlagRow[])
    // Finance starts from "approve in full" and trims down, rather than an
    // empty box that would read as zero.
    setAmounts(Object.fromEntries(ls.map(l => [l.id, String(num(l.amount_claimed))])))
    setLoadingLines(false)
  }

  const approvedTotal = lines.reduce((s, l) => s + num(amounts[l.id]), 0)
  const trimmed = isFinance && lines.length > 0 && approvedTotal < num(claim.total_claimed)

  const act = async (action: string) => {
    if ((action === 'REJECT' || action === 'SEND_BACK') && !remarks.trim()) return
    const payload = isFinance && action === 'FINANCE_APPROVE'
      ? lines.map(l => ({ ...l, amount_approved: num(amounts[l.id]) }))
      : undefined
    await onAction(claim.id, action, remarks, payload)
  }

  const approveAction = isFinance ? 'FINANCE_APPROVE' : stage === 'HR' ? 'HR_APPROVE' : 'RM_APPROVE'

  return (
    <div style={{ border: `1px solid ${V.border}`, borderRadius: 9, marginBottom: 10, background: V.card }}>
      <div onClick={expand}
           style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', cursor: 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: V.navy }}>
            {claim.full_name || '—'}
            <span style={{ color: V.muted, fontWeight: 500, fontSize: 11.5 }}> · {claim.emp_code || '—'}</span>
          </div>
          <div style={{ fontSize: 11.5, color: V.muted, marginTop: 2 }}>
            {claim.claim_no} · {claim.line_count} {claim.line_count === 1 ? 'expense' : 'expenses'} ·
            {' '}{dmy(claim.period_from)} – {dmy(claim.period_to)}
            {claim.flag_count > 0 && <span style={{ color: V.amber }}> · ⚑ {claim.flag_count}</span>}
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: V.navy, flexShrink: 0 }}>
          {inr(claim.total_claimed)}
        </div>
        <Pill status={claim.status} />
        <span style={{ color: V.muted, fontSize: 12, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${V.border}` }}>
          {loadingLines ? (
            <div style={{ padding: '18px 0', color: V.muted, fontSize: 12 }}>Loading expenses…</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, fontSize: 10.5, fontWeight: 600, color: V.purpleDark,
                            textTransform: 'uppercase', letterSpacing: '.05em', padding: '10px 0 2px' }}>
                <div style={{ flex: 1 }}>Expense</div>
                <div style={{ width: 84, textAlign: 'right' }}>Claimed</div>
                <div style={{ width: 92, textAlign: 'right' }}>{isFinance ? 'Approve' : 'Approved'}</div>
              </div>

              {lines.map(l => (
                <LineRow key={l.id} line={l} editable={isFinance}
                         value={amounts[l.id] ?? ''}
                         onChange={v => setAmounts(a => ({ ...a, [l.id]: v }))}
                         flags={flags.filter(f => f.claim_line_id === l.id)} />
              ))}

              {isFinance && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10,
                              padding: '10px 0', fontSize: 12.5 }}>
                  <span style={{ color: V.muted }}>Approving</span>
                  <b style={{ color: trimmed ? V.amber : V.green }}>{inr(approvedTotal)}</b>
                  {trimmed && (
                    <span style={{ color: V.amber }}>
                      ({inr(num(claim.total_claimed) - approvedTotal)} disallowed)
                    </span>
                  )}
                </div>
              )}

              <div style={{ marginTop: 10 }}>
                <label style={S.lbl}>Remarks {`(required to send back or reject)`}</label>
                <input value={remarks} onChange={e => setRemarks(e.target.value)}
                       placeholder="Optional when approving"
                       style={{ ...S.inp, width: '100%' }} />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => act(approveAction)} disabled={busy} style={S.btnG}>
                  {busy ? 'Working…' : isFinance ? (trimmed ? 'Approve trimmed' : 'Approve & pass to payout') : 'Approve'}
                </button>
                <button onClick={() => act('SEND_BACK')} disabled={busy || !remarks.trim()}
                        style={{ ...S.btnO, opacity: remarks.trim() ? 1 : 0.5 }}>
                  Send back to employee
                </button>
                <button onClick={() => act('REJECT')} disabled={busy || !remarks.trim()}
                        style={{ ...S.btnR, opacity: remarks.trim() ? 1 : 0.5 }}>
                  Reject
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Approved-but-unpaid claims. Finance closes the loop here. */
function PayoutRow({ claim, onPay, busy }: { claim: Claim; onPay: () => void; busy: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px',
                  border: `1px solid ${V.border}`, borderRadius: 8, marginBottom: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: V.navy }}>
          {claim.full_name} <span style={{ color: V.muted, fontWeight: 500 }}>· {claim.emp_code}</span>
        </div>
        <div style={{ fontSize: 11, color: V.muted, marginTop: 2 }}>{claim.claim_no}</div>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: V.green, flexShrink: 0 }}>
        {inr(claim.net_payable)}
      </div>
      <button onClick={onPay} disabled={busy} style={S.btnP}>Mark paid</button>
    </div>
  )
}

/**
 * One GPS-priced mode on the rate card.
 *
 * Shows the rate in force, and lets the HR Head schedule the next one. The new
 * rate is a new version rather than an edit, so what a settled claim was paid
 * at stays true.
 */
function RateRow({ type, current, history, onSet, busy }: {
  type: TypeRow
  current: RateRow | null
  history: RateRow[]
  onSet: (typeCode: string, rate: string, from: string, notes: string) => Promise<void>
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [rate, setRate] = useState('')
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  const scheduled = history.filter(r => !r.in_force)
  const past = history.filter(r => r.in_force && r.id !== current?.id)

  return (
    <div style={{ border: `1px solid ${V.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: V.navy }}>
            {type.type_name}
            {type.requires_gps && (
              <span style={{ fontSize: 10, color: V.purpleDark, fontWeight: 500 }}> · 📍 recorded</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: V.muted, marginTop: 2 }}>
            {type.type_code}
            {current?.set_by_name && ` · set by ${current.set_by_name}`}
            {current && ` · from ${dmy(current.effective_from)}`}
          </div>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700,
                      color: current ? V.navy : V.red, minWidth: 96, textAlign: 'right' }}>
          {current ? `${inr(current.rate_per_km)}/km` : 'Not set'}
        </div>

        <button onClick={() => setOpen(o => !o)} style={S.btnO}>
          {open ? 'Cancel' : current ? 'Change' : 'Set rate'}
        </button>
      </div>

      {scheduled.length > 0 && (
        <div style={{ fontSize: 11.5, color: V.amber, marginTop: 7 }}>
          ⏱ {inr(scheduled[0].rate_per_km)}/km scheduled from {dmy(scheduled[0].effective_from)}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${V.border}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
                        gap: 10, marginBottom: 10 }}>
            <div>
              <label style={S.lbl}>Rate per km (₹)</label>
              <input type="number" min="0" step="0.5" value={rate}
                     onChange={e => setRate(e.target.value)}
                     placeholder={current ? String(current.rate_per_km) : '0'}
                     style={{ ...S.inp, width: '100%' }} />
            </div>
            <div>
              <label style={S.lbl}>Effective from</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                     style={{ ...S.inp, width: '100%' }} />
            </div>
            <div>
              <label style={S.lbl}>Note (optional)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                     placeholder="e.g. FY27 revision"
                     style={{ ...S.inp, width: '100%' }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: V.muted, marginBottom: 10 }}>
            This adds a new version. Claims already settled keep the rate they were paid at.
          </div>
          <button
            onClick={async () => { await onSet(type.type_code, rate, from, notes); setOpen(false); setRate(''); setNotes('') }}
            disabled={busy || !Number(rate)}
            style={{ ...S.btnP, opacity: Number(rate) ? 1 : 0.5 }}>
            {busy ? 'Saving…' : 'Save rate'}
          </button>

          {past.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 11.5, color: V.muted }}>
              <b style={{ color: V.navy }}>Earlier rates</b>
              {past.slice(0, 4).map(r => (
                <div key={r.id} style={{ marginTop: 3 }}>
                  {inr(r.rate_per_km)}/km from {dmy(r.effective_from)}
                  {r.set_by_name && ` · ${r.set_by_name}`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Turning a type off hides it from the ESS picker without deleting history. */
function TypeToggleRow({ type, onToggle, busy }: {
  type: TypeRow; onToggle: (id: string, active: boolean) => void; busy: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 0',
                  borderBottom: `1px solid ${V.border}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: type.is_active ? V.navy : V.muted, fontWeight: 500 }}>
          {type.type_name}
          {!type.bill_required && (
            <span style={{ fontSize: 10, color: V.muted }}> · no bill</span>
          )}
          {type.requires_gps && (
            <span style={{ fontSize: 10, color: V.purpleDark }}> · 📍</span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: V.muted }}>
          {type.calc_method === 'PER_KM' ? 'Paid on distance'
            : type.calc_method === 'ZERO' ? 'Not reimbursed'
            : type.bill_threshold > 0 ? `Bill required above ${inr(type.bill_threshold)}` : 'Paid on the bill'}
        </div>
      </div>
      <button onClick={() => onToggle(type.id, !type.is_active)} disabled={busy}
              style={{ ...S.btnO, color: type.is_active ? V.green : V.muted, minWidth: 74 }}>
        {type.is_active ? 'On' : 'Off'}
      </button>
    </div>
  )
}

function PeriodRow({ p, onAct, busy }: {
  p: Period; onAct: (id: string, action: string, reason: string) => Promise<void>; busy: boolean
}) {
  const [reason, setReason] = useState('')
  const [showReason, setShowReason] = useState(false)
  const tone = p.status === 'OPEN' ? [V.greenBg, V.green]
             : p.status === 'CLOSED' ? [V.amberBg, V.amber]
             : [V.redBg, V.red]

  // Reopening demands a reason of 10+ characters — the DB trigger enforces it
  // too, but asking here beats surfacing a Postgres exception.
  const needsReason = showReason && p.status === 'CLOSED'

  return (
    <div style={{ border: `1px solid ${V.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: V.navy, minWidth: 90 }}>{p.period_label}</div>
        <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 99,
                       background: tone[0], color: tone[1], fontWeight: 600 }}>{p.status}</span>
        <div style={{ fontSize: 11.5, color: V.muted, flex: 1 }}>
          {p.claim_counts.total} {p.claim_counts.total === 1 ? 'claim' : 'claims'}
          {p.claim_counts.pending > 0 && <span style={{ color: V.amber }}> · {p.claim_counts.pending} still in flight</span>}
        </div>

        {p.status === 'OPEN' && (
          <button onClick={() => onAct(p.id, 'CLOSE', '')} disabled={busy} style={S.btnO}>Close month</button>
        )}
        {p.status === 'CLOSED' && !showReason && (
          <>
            <button onClick={() => setShowReason(true)} disabled={busy} style={S.btnO}>Reopen</button>
            <button
              onClick={() => {
                if (p.claim_counts.pending > 0) return
                onAct(p.id, 'LOCK', '')
              }}
              disabled={busy || p.claim_counts.pending > 0}
              title={p.claim_counts.pending > 0
                ? 'Claims are still awaiting approval — settle them before locking.'
                : 'Locking is permanent.'}
              style={{ ...S.btnR, opacity: p.claim_counts.pending > 0 ? 0.45 : 1 }}>
              Lock
            </button>
          </>
        )}
        {p.status === 'LOCKED' && (
          <span style={{ fontSize: 11.5, color: V.muted }}>Paid through payroll — permanent</span>
        )}
      </div>

      {needsReason && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input value={reason} onChange={e => setReason(e.target.value)}
                 placeholder="Why is this month being reopened? (10 characters minimum)"
                 style={{ ...S.inp, flex: 1 }} />
          <button onClick={async () => { await onAct(p.id, 'REOPEN', reason); setShowReason(false); setReason('') }}
                  disabled={busy || reason.trim().length < 10}
                  style={{ ...S.btnP, opacity: reason.trim().length < 10 ? 0.5 : 1 }}>
            Reopen
          </button>
          <button onClick={() => { setShowReason(false); setReason('') }} style={S.btnO}>Cancel</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
export default function TravelClaimsAdmin() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [tab, setTab] = useState<'HR' | 'FINANCE' | 'RM' | 'PERIODS' | 'RATES'>('HR')

  const [rmEnabled, setRmEnabled] = useState(false)
  const [approvers, setApprovers] = useState<Approver[]>([])
  const [actingId, setActingId] = useState('')

  const [claims, setClaims] = useState<Claim[]>([])
  const [payouts, setPayouts] = useState<Claim[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [rates, setRates] = useState<RateRow[]>([])
  const [types, setTypes] = useState<TypeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null)

  // ---- companies -----------------------------------------------------------
  useEffect(() => {
    supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
      .then(({ data }) => {
        setCompanies((data ?? []) as Company[])
        if (data?.length) setCompanyId(data[0].id)
      })
  }, [])

  // ---- policy + the people who can approve for this company ----------------
  useEffect(() => {
    if (!companyId) return
    let live = true
    ;(async () => {
      const { data: pol } = await supabase.from('travel_policies')
        .select('rm_stage_enabled').eq('company_id', companyId).eq('is_active', true)
        .order('effective_from', { ascending: false }).limit(1)
      if (!live) return
      setRmEnabled(!!(pol?.[0] as any)?.rm_stage_enabled)

      // Anyone named as an hr_head_id (or l1_manager_id) for this company is a
      // possible approver. Derived rather than hardcoded, so it tracks the
      // employee master.
      const column = tab === 'RM' ? 'l1_manager_id' : 'hr_head_id'
      const { data: emps } = await supabase.from('employees')
        .select(column).eq('company_id', companyId).not(column, 'is', null)
      const ids = Array.from(new Set((emps ?? []).map((e: any) => e[column]).filter(Boolean)))
      if (!live) return
      if (ids.length === 0) { setApprovers([]); setActingId(''); return }

      // Chunked, not sliced: .slice(0,200) silently dropped approvers beyond the
      // first 200 and there are 397 employees.
      const people: Approver[] = []
      for (let i = 0; i < ids.length; i += 100) {
        const { data: chunk } = await supabase.from('employees')
          .select('id, full_name, emp_code').in('id', ids.slice(i, i + 100))
        people.push(...((chunk ?? []) as Approver[]))
      }
      people.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
      if (!live) return
      const list = people
      setApprovers(list)
      setActingId(prev => (list.some(p => p.id === prev) ? prev : list[0]?.id ?? ''))
    })()
    return () => { live = false }
  }, [companyId, tab])

  // ---- inbox ---------------------------------------------------------------
  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      if (tab === 'PERIODS') {
        const r = await fetch(`/api/travel/periods?company_id=${companyId}`,
          { headers: await authHeaders() }).then(x => x.json())
        setPeriods((r.periods ?? []) as Period[])
        return
      }

      if (tab === 'RATES') {
        const r = await fetch(`/api/travel/rates?company_id=${companyId}`,
          { headers: await authHeaders() })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setNote({ tone: 'err', text: j.error || 'Could not load the rate card.' })
          setRates([]); setTypes([])
          return
        }
        setRates((j.rates ?? []) as RateRow[])
        setTypes((j.types ?? []) as TypeRow[])
        return
      }

      // HR and manager inboxes are per-approver; Finance is company-wide but the
      // API still needs an employee id to read the company from.
      const who = tab === 'FINANCE' ? (actingId || approvers[0]?.id) : actingId
      if (!who) { setClaims([]); setPayouts([]); return }

      const r = await fetch(`/api/travel/claims?approver_id=${who}&stage=${tab}`,
        { headers: await authHeaders() })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setNote({ tone: 'err', text: j.error || 'Could not load the inbox.' })
        setClaims([])
        return
      }
      const j = await r.json()
      setClaims((j.claims ?? []) as Claim[])

      // Finance also owns the payout step, so approved-unpaid claims belong here.
      if (tab === 'FINANCE') {
        const { data } = await supabase.from('v_travel_claim_summary')
          .select('*').eq('company_id', companyId).eq('status', 'APPROVED')
          .order('submitted_at', { ascending: true })
        setPayouts((data ?? []) as Claim[])
      }
    } finally {
      setLoading(false)
    }
  }, [companyId, tab, actingId, approvers])

  useEffect(() => { load() }, [load])

  // ---- actions -------------------------------------------------------------
  const action = async (claimId: string, act: string, remarks: string, lines?: Line[]) => {
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/travel/claims', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          claim_id: claimId, action: act,
          actioned_by: actingId || null,
          remarks: remarks || null,
          lines: lines?.map(l => ({
            id: l.id,
            amount_claimed: l.amount_claimed,
            amount_approved: l.amount_approved,
            finance_remarks: l.finance_remarks ?? null,
          })),
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setNote({ tone: 'err', text: j.error || 'That action did not go through.' }); return }
      setNote({ tone: 'ok', text: 'Done.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const periodAction = async (periodId: string, act: string, reason: string) => {
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/travel/periods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ period_id: periodId, action: act, reason: reason || null, actioned_by: actingId || null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setNote({ tone: 'err', text: j.error || 'Could not change that month.' }); return }
      setNote({ tone: 'ok', text: 'Month updated.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const openThisMonth = async () => {
    setBusy(true)
    try {
      await fetch('/api/travel/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          company_id: companyId,
          period_month: new Date().toISOString().slice(0, 8) + '01',
          actioned_by: actingId || null,
        }),
      })
      await load()
    } finally { setBusy(false) }
  }

  const setRate = async (typeCode: string, rate: string, from: string, notes: string) => {
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/travel/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          company_id: companyId, type_code: typeCode,
          rate_per_km: Number(rate), effective_from: from,
          set_by: actingId || null, notes: notes || null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setNote({ tone: 'err', text: j.error || 'Could not set that rate.' }); return }
      setNote({ tone: 'ok', text: j.message || 'Rate saved.' })
      await load()
    } finally { setBusy(false) }
  }

  const toggleType = async (typeId: string, active: boolean) => {
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/travel/rates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ type_id: typeId, is_active: active }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setNote({ tone: 'err', text: j.error || 'Could not change that type.' }); return }
      await load()
    } finally { setBusy(false) }
  }

  const TABS: { k: typeof tab; label: string }[] = [
    { k: 'HR', label: 'HR Head' },
    { k: 'FINANCE', label: 'Finance' },
    ...(rmEnabled ? [{ k: 'RM' as const, label: 'Manager' }] : []),
    { k: 'RATES', label: 'Rate card' },
    { k: 'PERIODS', label: 'Expense months' },
  ]

  return (
    <div style={{ background: V.page, minHeight: '100vh', padding: 20,
                  fontFamily: '"DM Sans","Segoe UI",sans-serif', color: V.navy, fontSize: 13 }}>
      <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 3 }}>Travel Claims</div>
      <div style={{ fontSize: 12.5, color: V.muted, marginBottom: 14 }}>
        Reimbursement requests route {rmEnabled ? 'manager → HR Head → Finance' : 'HR Head → Finance'}.
      </div>

      {/* ---- controls ---- */}
      <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={S.lbl}>Company</label>
          <select value={companyId} onChange={e => setCompanyId(e.target.value)}
                  style={{ ...S.inp, minWidth: 220 }}>
            {companies.length === 0 && <option value="">No companies</option>}
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
        {/* The rate card stamps who set each rate, so it needs this too. */}
        {(tab === 'HR' || tab === 'RM' || tab === 'RATES') && (
          <div>
            <label style={S.lbl}>Acting as</label>
            <select value={actingId} onChange={e => setActingId(e.target.value)}
                    style={{ ...S.inp, minWidth: 240 }}>
              {approvers.length === 0 && <option value="">Nobody is mapped as an approver</option>}
              {approvers.map(a => (
                <option key={a.id} value={a.id}>{a.full_name} · {a.emp_code}</option>
              ))}
            </select>
          </div>
        )}
        <button onClick={load} disabled={loading} style={S.btnO}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* ---- tabs ---- */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
                  style={{ padding: '8px 16px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
                           fontFamily: 'inherit', cursor: 'pointer',
                           border: tab === t.k ? 'none' : `1px solid ${V.border}`,
                           background: tab === t.k ? V.purple : V.card,
                           color: tab === t.k ? '#fff' : V.purpleDark }}>
            {t.label}
            {t.k === tab && claims.length > 0 && t.k !== 'PERIODS' && ` · ${claims.length}`}
          </button>
        ))}
      </div>

      {note && <Note tone={note.tone}>{note.text}</Note>}

      {/* ---- body ---- */}
      {tab === 'RATES' ? (
        <>
          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
              Rate per kilometre
            </div>
            <div style={{ fontSize: 11.5, color: V.muted, marginBottom: 14, lineHeight: 1.6 }}>
              These modes leave no bill behind, so the journey is recorded from the employee&apos;s
              device and paid at the rate you set here. A new rate is a new version dated from
              when it applies — claims already settled keep the rate they were paid at.
            </div>

            {loading ? <Empty text="Loading…" />
              : types.filter(t => t.calc_method === 'PER_KM').length === 0
                ? <Empty text="No distance-priced expense types are configured." />
                : types.filter(t => t.calc_method === 'PER_KM').map(t => {
                    const mine = rates.filter(r => r.type_code === t.type_code)
                    // Newest in-force version is the one being paid today.
                    const current = mine.filter(r => r.in_force)
                      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null
                    return (
                      <RateRow key={t.id} type={t} current={current} history={mine}
                               onSet={setRate} busy={busy} />
                    )
                  })}
          </div>

          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Expense types</div>
            <div style={{ fontSize: 11.5, color: V.muted, marginBottom: 12 }}>
              Turning a type off removes it from the employee&apos;s picker. Existing claims that
              already use it are untouched.
            </div>
            {loading ? <Empty text="Loading…" />
              : Object.entries(
                  types.reduce((acc, t) => {
                    const k = t.category ?? 'OTHER'
                    ;(acc[k] ??= []).push(t)
                    return acc
                  }, {} as Record<string, TypeRow[]>)
                ).map(([cat, items]) => (
                  <div key={cat} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: V.purpleDark,
                                  textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                      {CATEGORY_LABEL[cat] ?? cat}
                    </div>
                    {items.map(t => (
                      <TypeToggleRow key={t.id} type={t} onToggle={toggleType} busy={busy} />
                    ))}
                  </div>
                ))}
          </div>
        </>
      ) : tab === 'PERIODS' ? (
        <div style={S.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Expense months</div>
            <button onClick={openThisMonth} disabled={busy} style={S.btnO}>Open this month</button>
          </div>
          <div style={{ fontSize: 11.5, color: V.muted, marginBottom: 12, lineHeight: 1.6 }}>
            A month must be <b>open</b> before anyone can log or submit expenses dated in it.
            Closing makes it read-only but reversible; locking is permanent and is meant for a
            month already paid through payroll.
          </div>
          {loading ? <Empty text="Loading…" />
            : periods.length === 0 ? <Empty text="No months configured yet." />
            : periods.map(p => <PeriodRow key={p.id} p={p} onAct={periodAction} busy={busy} />)}
        </div>
      ) : (
        <>
          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
              {tab === 'FINANCE' ? 'Awaiting Finance verification'
                : tab === 'HR' ? 'Awaiting your approval as HR Head'
                : 'Awaiting your approval as reporting manager'}
            </div>
            {loading ? <Empty text="Loading…" />
              : (tab !== 'FINANCE' && approvers.length === 0)
                ? <Empty text="Nobody in this company is mapped as an approver, so no claims can route here." />
              : claims.length === 0 ? <Empty text="Nothing waiting. You are all caught up." />
              : claims.map(c => (
                  <ClaimCard key={c.id} claim={c} stage={tab as 'HR' | 'FINANCE' | 'RM'}
                             onAction={action} busy={busy} />
                ))}
          </div>

          {tab === 'FINANCE' && (
            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Approved — ready to pay</div>
              <div style={{ fontSize: 11.5, color: V.muted, marginBottom: 12 }}>
                Marking paid closes the claim and stamps the payout date.
              </div>
              {payouts.length === 0
                ? <Empty text="Nothing approved and waiting for payout." />
                : payouts.map(c => (
                    <PayoutRow key={c.id} claim={c} busy={busy}
                               onPay={() => action(c.id, 'MARK_PAID', '')} />
                  ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
