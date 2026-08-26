'use client'
// components/payroll/NpsReport.tsx — Payroll → Statutory & Tax → NPS.
//
// Who is enrolled in the corporate NPS, and who is not. The Y/N is the point of the
// screen, so everybody is listed by default and the filter narrows to the opted-in —
// a report that only ever shows enrolled people cannot answer "did we miss anyone".
//
// Opted-in means a declaration that is ACTIVE or PENDING_PRAN. STOPPED and SUPERSEDED
// are shown as N with the status spelled out, because "never enrolled" and "enrolled
// and then stopped" are different answers to the same question.
//
// All sub-components are defined OUTSIDE the parent (no focus-loss).
import { useState, useEffect, useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint, amberBd: TK.warningTint,
  red: TK.critical, redBg: TK.criticalTint, purpleBg: TK.brandTint, gray: TK.sunken,
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const fmtDate = (d?: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Payroll months of the FY, in payroll order: 1 = April … 12 = March.
const FY_MONTHS = ['April','May','June','July','August','September','October','November','December','January','February','March']
/** First day of payroll month `m` in FY `fy` — month 1 is April of the FY's start year. */
function monthStart(fy: string, m: number): string {
  const y = Number(fy.split('-')[0]) + (m <= 9 ? 0 : 1)
  const cal = m <= 9 ? m + 3 : m - 9          // 1→Apr(4) … 10→Jan(1)
  return `${y}-${String(cal).padStart(2, '0')}-01`
}
/** NPS effective date for one employee in one payroll month.
 *
 *  Whichever is later: the day they joined, or the 1st of the month being run.
 *  Somebody who joined on 31 March is on the payroll for the whole of April, so their
 *  date is 1 April. Somebody who joined on 14 April was not there for the first
 *  fortnight, so theirs is 14 April — starting them on the 1st would contribute for
 *  days the company did not employ them. Anyone who joined years ago is simply 1 April.
 *
 *  A DOJ after the month being run means the person had not joined yet; the same MAX
 *  returns their DOJ, which is the honest answer rather than a date they were not there. */
function npsEffectiveDate(doj: string | null, mStart: string): string {
  if (!doj) return mStart
  return doj > mStart ? doj : mStart
}

const S = {
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', marginBottom: 14, boxShadow: 'var(--ez-shadow-flat)' } as React.CSSProperties,
  sel: { padding: '8px 10px', border: `1px solid #DDD6FE`, borderRadius: 7, fontSize: 13, fontFamily: font, background: TK.sunken, color: C.navy, outline: 'none', minWidth: 150 } as React.CSSProperties,
  btnP: { padding: '9px 16px', borderRadius: 10, border: 'none', background: C.purple, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: font } as React.CSSProperties,
  btnO: { padding: '8px 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: TK.surface, color: C.purpleD, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: font } as React.CSSProperties,
  th: { padding: '9px 10px', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: '.04em', textAlign: 'left' as const, whiteSpace: 'nowrap' as const, background: C.gray, borderBottom: `1px solid ${C.border}` },
  td: { padding: '8px 10px', fontSize: 12, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' as const, color: C.navy },
}

export interface NpsRow {
  id: string
  company: string
  emp_code: string
  full_name: string
  department: string
  location: string
  doj: string | null
  dol: string | null
  regime: string          // the employee's own regime for the FY
  opted: boolean
  status: string          // ACTIVE / PENDING_PRAN / STOPPED / SUPERSEDED / —
  pran: string
  tier: string
  percent: number | null
  monthly: number | null
  nps_regime: string      // the regime the contribution % was worked out on
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: C.gray, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 14px', minWidth: 92 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: color || C.navy, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function YesNo({ yes }: { yes: boolean }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 99, background: yes ? C.greenBg : TK.sunken, color: yes ? C.green : TK.muted }}>
      {yes ? 'Y' : 'N'}
    </span>
  )
}

const STATUS_STYLE: Record<string, [string, string]> = {
  ACTIVE: [C.greenBg, C.green], PENDING_PRAN: [TK.infoTint, TK.info],
  STOPPED: [C.redBg, C.red], SUPERSEDED: [TK.sunken, TK.muted],
}
function StatusPill({ s }: { s: string }) {
  if (!s || s === '—') return <span style={{ color: C.muted }}>—</span>
  const [bg, fg] = STATUS_STYLE[s] || [TK.brandTint, C.purpleD]
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 99, background: bg, color: fg }}>{s.replace('_', ' ')}</span>
}

// ── Enrolment dialog ───────────────────────────────────────────────────────
// Search first, then act. The old version listed everybody the moment it opened,
// which is 397 rows of noise when HR already knows the one person they came for.
// Nothing is shown until something is typed.
//
// Both directions live here: Y enrols, N stops. Stopping is the one that changes
// what reaches somebody's bank account, so it costs a written reason and the
// reason is what goes into the audit log — 'the system did it' is not an answer
// six months later.
//
// Salary figures come from GET /api/ess/nps, the endpoint the employee's own ESS
// screen reads, so HR and the employee are never shown different numbers.
// Defined OUTSIDE the parent so typing never remounts the dialog.

const initials = (n: string) =>
  (n || '?').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase()

function DetailRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
      <span style={{ color: C.muted }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', color: C.navy }}>{v}</span>
    </div>
  )
}

function SearchResult({ r, onPick }: { r: NpsRow; onPick: (r: NpsRow) => void }) {
  return (
    <button onClick={() => onPick(r)}
      style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 11px', borderRadius: 10, border: `1px solid ${C.border}`, marginTop: 7, background: TK.surface, cursor: 'pointer', fontFamily: font }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: r.opted ? C.greenBg : C.purpleBg, color: r.opted ? C.green : C.purpleD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
        {initials(r.full_name)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.full_name} <span style={{ color: C.muted, fontWeight: 500 }}>· {r.emp_code}</span>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.department} · {r.location}
        </div>
      </div>
      <YesNo yes={r.opted} />
    </button>
  )
}

function NpsDialog({ rows, onClose, onDone }: {
  rows: NpsRow[]; onClose: () => void; onDone: (msg: string) => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<NpsRow | null>(null)
  const [info, setInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'y' | 'n'>('y')
  const [hasPran, setHasPran] = useState(true)
  const [pran, setPran] = useState('')
  const [tier, setTier] = useState('Tier I')
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Nothing is listed until at least two characters are typed — a dialog that opens
  // onto 397 names makes HR scroll for someone they could have named.
  const terms = q.trim().toLowerCase()
  const results = terms.length < 2 ? [] : rows.filter(r =>
    r.emp_code.toLowerCase().includes(terms) || r.full_name.toLowerCase().includes(terms)).slice(0, 25)

  const pick = (r: NpsRow) => {
    setSel(r); setErr(''); setAck(false); setReason(''); setPran('')
    setMode(r.opted ? 'n' : 'y')   // land on the action that actually changes something
    setLoading(true); setInfo(null)
    fetch(`/api/ess/nps?employee_id=${r.id}`).then(x => x.json())
      .then(d => { setInfo(d); setLoading(false) })
      .catch(() => { setErr('Could not load this employee’s salary figures.'); setLoading(false) })
  }

  const e = info?.employee
  const pranLen = e?.pran_length || 12
  const pranClean = pran.replace(/\D/g, '')
  const pranOk = !hasPran || pranClean.length === pranLen
  const canSave = !busy && !!sel && (mode === 'y' ? (ack && pranOk && !!e) : reason.trim().length >= 3)

  async function save() {
    if (!sel) return
    setBusy(true); setErr('')
    try {
      const res = mode === 'y'
        ? await fetch('/api/ess/nps', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employee_id: sel.id, has_existing_pran: hasPran,
              pran_number: hasPran ? pranClean : null, pran_holder_name: sel.full_name,
              tier_type: tier, acknowledged: true, source: 'HR', performed_by_name: 'Payroll / HR',
            }),
          })
        : await fetch('/api/ess/nps', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employee_id: sel.id, action: 'STOP', stopped_reason: reason.trim(),
              source: 'HR', performed_by_name: 'Payroll / HR',
            }),
          })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'That did not go through.'); setBusy(false); return }
      onDone(mode === 'y'
        ? (d.pending_pran
            ? `${sel.emp_code} enrolled — PRAN pending, the form has been emailed to them.`
            : `${sel.emp_code} enrolled in NPS.`)
        : `${sel.emp_code} — NPS stopped. Nothing will be deducted from next month.`)
    } catch (x: any) { setErr(x?.message || String(x)); setBusy(false) }
  }

  const seg = (v: 'y' | 'n', label: string, on: boolean, disabled: boolean) => (
    <button key={v} onClick={() => !disabled && setMode(v)} disabled={disabled}
      style={{ flex: 1, padding: '10px 8px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: font, fontSize: 13, fontWeight: 700,
        border: on ? `2px solid ${v === 'y' ? C.green : C.red}` : `1px solid ${C.border}`,
        background: on ? (v === 'y' ? C.greenBg : C.redBg) : TK.surface,
        color: disabled ? TK.lineStrong : on ? (v === 'y' ? C.green : C.red) : C.navy, opacity: disabled ? .6 : 1 }}>
      {label}
    </button>
  )

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.5)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={ev => ev.stopPropagation()} style={{ background: TK.surface, borderRadius: 14, width: '100%', maxWidth: 540, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(30,27,75,0.35)', fontFamily: font, overflow: 'hidden' }}>

        {/* header */}
        <div style={{ background: `linear-gradient(135deg,${TK.brand},${TK.brand})`, padding: '16px 20px', color: TK.onAccent, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 20 }}></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Corporate NPS</div>
              <div style={{ fontSize: 12, opacity: .8, marginTop: 1 }}>
                {sel ? 'Turn NPS on or off for this employee' : 'Find an employee to begin'}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: TK.onAccent, width: 28, height: 28, borderRadius: 10, cursor: 'pointer', fontSize: 16, lineHeight: 1, fontFamily: font }}>×</button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
          {!sel ? (
            <>
              <input autoFocus value={q} onChange={ev => setQ(ev.target.value)}
                placeholder="Employee code or name — e.g. SRS9008, Nisha"
                style={{ ...S.sel, width: '100%', padding: '11px 13px', fontSize: 14, borderRadius: 10 }} />

              {terms.length < 2 ? (
                <div style={{ textAlign: 'center', padding: '34px 20px', color: C.muted }}>
                  <div style={{ fontSize: 30, marginBottom: 8 }}></div>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    Type at least two characters to search.<br />
                    <span style={{ fontSize: 12, opacity: .8 }}>{rows.length} employees on record.</span>
                  </div>
                </div>
              ) : results.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 20px', color: C.muted, fontSize: 13 }}>
                  Nobody matched “{q.trim()}”.
                </div>
              ) : (
                <>
                  {results.map(r => <SearchResult key={r.emp_code} r={r} onPick={pick} />)}
                  {results.length === 25 && (
                    <div style={{ fontSize: 11, color: C.muted, padding: '10px 2px 0' }}>Showing the first 25 — narrow the search to see more.</div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {/* employee card */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: C.gray, borderRadius: 11, border: `1px solid ${C.border}` }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: C.purpleBg, color: C.purpleD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                  {initials(sel.full_name)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>{sel.full_name}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{sel.emp_code} · {sel.department} · {sel.location}</div>
                </div>
                <button onClick={() => { setSel(null); setInfo(null); setErr('') }} style={{ ...S.btnO, padding: '6px 11px', fontSize: 11 }}>Change</button>
              </div>

              <div style={{ marginTop: 12 }}>
                <DetailRow k="Company" v={sel.company} />
                <DetailRow k="Date of Joining" v={fmtDate(sel.doj)} />
                {sel.dol && <DetailRow k="Date of Leaving" v={<span style={{ color: C.red }}>{fmtDate(sel.dol)}</span>} />}
                <DetailRow k="Current NPS" v={<><YesNo yes={sel.opted} /> {sel.status !== '—' && <span style={{ marginLeft: 6 }}><StatusPill s={sel.status} /></span>}</>} />
                {loading ? <DetailRow k="Salary figures" v={<span style={{ color: C.muted }}>loading…</span>} /> : e && (
                  <>
                    <DetailRow k="Tax regime" v={e.tax_regime} />
                    <DetailRow k="Monthly Basic" v={e.has_ctc ? inr(e.basic_monthly) : <span style={{ color: C.amber }}>no CTC set</span>} />
                    <DetailRow k="NPS rate" v={`${e.contribution_percent}% of Basic`} />
                    <DetailRow k="Monthly contribution" v={<span style={{ color: C.purpleD, fontWeight: 800 }}>{inr(e.monthly_nps_amount)}</span>} />
                  </>
                )}
              </div>

              {/* Y / N */}
              <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', margin: '16px 0 7px' }}>Set NPS</div>
              <div style={{ display: 'flex', gap: 9 }}>
                {seg('y', 'Yes — enrol', mode === 'y', sel.opted)}
                {seg('n', 'No — stop', mode === 'n', !sel.opted)}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
                {sel.opted
                  ? 'Already enrolled — only “No” does anything here.'
                  : 'Not enrolled — only “Yes” does anything here.'}
              </div>

              {mode === 'y' && !sel.opted && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', margin: '16px 0 7px' }}>PRAN</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[[true, 'Has a PRAN'], [false, 'Needs one']].map(([v, lbl]) => (
                      <button key={String(v)} onClick={() => setHasPran(v as boolean)}
                        style={{ flex: 1, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', fontFamily: font, fontSize: 13, fontWeight: 600,
                          border: hasPran === v ? `2px solid ${C.purple}` : `1px solid ${C.border}`,
                          background: hasPran === v ? C.purpleBg: TK.surface, color: hasPran === v ? C.purpleD : C.navy }}>
                        {lbl as string}
                      </button>
                    ))}
                  </div>
                  {hasPran ? (
                    <>
                      <input value={pran} maxLength={pranLen} placeholder={`${pranLen}-digit PRAN`}
                        onChange={ev => setPran(ev.target.value.replace(/\D/g, ''))}
                        style={{ ...S.sel, width: '100%', marginTop: 9, letterSpacing: 2, borderColor: pran && !pranOk ? C.red : TK.brandEdge }} />
                      {pran && !pranOk && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{pranLen - pranClean.length} more digit(s) needed</div>}
                    </>
                  ) : (
                    <div style={{ marginTop: 9, fontSize: 12, color: TK.brand, background: TK.brandTint, borderRadius: 10, padding: '10px 12px', lineHeight: 1.55 }}>
                      A PRAN creation form is emailed to the employee and the enrolment stays
                      <b> PRAN pending</b> until they submit it — it does not go active on its own.
                    </div>
                  )}

                  <select value={tier} onChange={ev => setTier(ev.target.value)} style={{ ...S.sel, width: '100%', marginTop: 9 }}>
                    <option>Tier I</option><option>Tier II</option>
                  </select>

                  {e && !e.has_ctc && (
                    <div style={{ marginTop: 10, fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBd}`, borderRadius: 10, padding: '10px 12px', lineHeight: 1.55 }}>
                      No CTC in ctc_master, so Basic reads ₹0 and the contribution would be ₹0.
                      Set their CTC first — enrolling now records a contribution of nothing.
                    </div>
                  )}

                  <label style={{ display: 'flex', gap: 9, marginTop: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={ack} onChange={ev => setAck(ev.target.checked)} style={{ marginTop: 2, width: 15, height: 15, accentColor: C.purple }} />
                    <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
                      I am enrolling this employee on their behalf, with their consent on record.
                      The contribution starts from the 1st of next month and repeats monthly.
                    </span>
                  </label>
                </>
              )}

              {mode === 'n' && sel.opted && (
                <>
                  <div style={{ marginTop: 14, fontSize: 12, color: C.red, background: C.redBg, border: `1px solid ${TK.criticalTint}`, borderRadius: 10, padding: '10px 12px', lineHeight: 1.55 }}>
                    Stopping NPS ends the employer contribution from next month. The employee&apos;s
                    take-home goes up, their retirement contribution stops, and the 80CCD(2)
                    benefit ends with it.
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', margin: '14px 0 6px' }}>Reason *</div>
                  <textarea value={reason} onChange={ev => setReason(ev.target.value)} rows={3}
                    placeholder="Why is this being stopped? The employee and any later audit will see this."
                    style={{ ...S.sel, width: '100%', resize: 'vertical', minHeight: 68, lineHeight: 1.5 }} />
                  {reason.trim().length > 0 && reason.trim().length < 3 && (
                    <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>Write a real reason, not a placeholder.</div>
                  )}
                </>
              )}

              {err && <div style={{ marginTop: 12, fontSize: 12, color: C.red, background: C.redBg, borderRadius: 10, padding: '10px 12px' }}>{err}</div>}
            </>
          )}
        </div>

        {sel && (
          <div style={{ display: 'flex', gap: 10, padding: '12px 20px 16px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
            <button onClick={onClose} style={{ ...S.btnO, flex: 1, padding: '10px 14px' }}>Cancel</button>
            <button onClick={save} disabled={!canSave}
              style={{ ...S.btnP, flex: 1.4, padding: '10px 14px', background: mode === 'y' ? C.green : C.red, opacity: canSave ? 1 : 0.45, cursor: canSave ? 'pointer' : 'not-allowed' }}>
              {busy ? 'Saving…' : mode === 'y' ? 'Enrol in NPS' : 'Stop NPS'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function NpsReport({ fy }: { fy: string }) {
  const [rows, setRows] = useState<NpsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fDept, setFDept] = useState('')
  const [fLoc, setFLoc] = useState('')
  // Default to the current calendar month when it sits inside this FY, else April —
  // HR opens this while running a month, not at a random point in the year.
  const [pMonth, setPMonth] = useState(() => {
    const cal = new Date().getMonth() + 1
    return cal >= 4 ? cal - 3 : cal + 9
  })
  const [fOpt, setFOpt] = useState<'all' | 'y' | 'n'>('all')
  const [q, setQ] = useState('')
  const [picker, setPicker] = useState(false)
  const [msg, setMsg] = useState('')
  const [mailing, setMailing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [empRes, npsRes, tdsRes] = await Promise.all([
        // locations!location_id — employees reaches locations through more than one key,
        // so the FK has to be named or the join is ambiguous.
        supabase.from('employees')
          .select('id, emp_code, full_name, group_doj, date_of_leaving, employment_status, tds_regime, companies(company_name), departments(dept_name), locations!location_id(location_name)')
          .order('emp_code'),
        supabase.from('nps_declarations')
          .select('employee_id, fy, status, tax_regime, pran_number, tier_type, contribution_percent, monthly_nps_amount, created_at')
          .eq('fy', fy),
        supabase.from('tds_declarations').select('employee_id, regime').eq('fy', fy),
      ])
      if (empRes.error) throw new Error(empRes.error.message)
      if (npsRes.error) throw new Error(npsRes.error.message)

      const regimeBy = new Map<string, string>()
      for (const t of (tdsRes.data as any[]) || []) regimeBy.set(t.employee_id, t.regime || '')

      // One employee can hold several declarations across a year — a stopped one, a
      // superseded one, a live one. The live record wins; otherwise the most recent,
      // so a stopped enrolment is still reported instead of vanishing.
      const npsBy = new Map<string, any>()
      for (const n of (npsRes.data as any[]) || []) {
        const cur = npsBy.get(n.employee_id)
        const live = (s: string) => s === 'ACTIVE' || s === 'PENDING_PRAN'
        if (!cur) { npsBy.set(n.employee_id, n); continue }
        if (live(n.status) && !live(cur.status)) { npsBy.set(n.employee_id, n); continue }
        if (live(n.status) === live(cur.status) && (n.created_at || '') > (cur.created_at || '')) npsBy.set(n.employee_id, n)
      }

      const out: NpsRow[] = ((empRes.data as any[]) || []).map(e => {
        const n = npsBy.get(e.id)
        const st = n?.status || '—'
        return {
          id: e.id,
          company: e.companies?.company_name || '—',
          emp_code: e.emp_code || '',
          full_name: e.full_name || '',
          department: e.departments?.dept_name || '—',
          location: e.locations?.location_name || '—',
          doj: e.group_doj || null,
          dol: e.date_of_leaving || null,
          // tds_declarations only exists once an employee actually declares — 9 rows for
          // 397 people. employees.tds_regime is the field that always holds an answer, and
          // it is what /api/ess/nps computes the contribution from. Reading the declaration
          // first and falling back to it keeps this screen agreeing with the engine.
          // Blank means nothing was chosen, and the new regime is the statutory default.
          regime: regimeBy.get(e.id) || e.tds_regime || n?.tax_regime || 'NEW',
          opted: st === 'ACTIVE' || st === 'PENDING_PRAN',
          status: st,
          pran: n?.pran_number || '',
          tier: n?.tier_type || '',
          percent: n?.contribution_percent ?? null,
          monthly: n?.monthly_nps_amount ?? null,
          nps_regime: n?.tax_regime || '',
        }
      })
      setRows(out)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [fy])
  useEffect(() => { load() }, [load])

  const companies = useMemo(() => Array.from(new Set(rows.map(r => r.company).filter(x => x && x !== '—'))).sort(), [rows])
  const depts = useMemo(() => Array.from(new Set(rows.map(r => r.department).filter(x => x && x !== '—'))).sort(), [rows])
  const locs = useMemo(() => Array.from(new Set(rows.map(r => r.location).filter(x => x && x !== '—'))).sort(), [rows])

  const shown = useMemo(() => {
    // A pasted list of codes works as well as a single name.
    const terms = q.split(/[\s,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
    return rows.filter(r => {
      if (fCompany && r.company !== fCompany) return false
      if (fDept && r.department !== fDept) return false
      if (fLoc && r.location !== fLoc) return false
      if (fOpt === 'y' && !r.opted) return false
      if (fOpt === 'n' && r.opted) return false
      if (!terms.length) return true
      return terms.some(t => r.emp_code.toLowerCase().includes(t) || r.full_name.toLowerCase().includes(t))
    })
  }, [rows, fCompany, fDept, fLoc, fOpt, q])

  const mStart = monthStart(fy, pMonth)
  const effOf = (r: NpsRow) => npsEffectiveDate(r.doj, mStart)

  const optedCount = shown.filter(r => r.opted).length
  const stopped = shown.filter(r => r.status === 'STOPPED').length
  const pendingRows = shown.filter(r => r.status === 'PENDING_PRAN')
  const pending = pendingRows.length
  const monthlyTotal = shown.filter(r => r.opted).reduce((s, r) => s + (r.monthly || 0), 0)
  // The contribution rate follows the regime — 10% of Basic on old, 14% on new. If the
  // employee switched regime after enrolling, the percent on file is for the old one.
  const regimeMismatch = shown.filter(r => r.opted && r.nps_regime && r.regime !== '—' && r.nps_regime !== r.regime)

  // Chasing whoever is still waiting on a PRAN. Until it arrives nothing is deducted and
  // nothing is credited, so an enrolment left pending is an enrolment that never happened.
  async function sendReminders() {
    if (mailing) return
    setMailing(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/nps/pran-reminder', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Could not send the reminders.'); setMailing(false); return }
      const failed = (d.results || []).filter((x: any) => !x.sent)
      setMsg(d.sent === 0 && !failed.length
        ? (d.message || 'Nobody is waiting on a PRAN.')
        : `PRAN reminder sent to ${d.sent} employee${d.sent === 1 ? '' : 's'}`
          + (failed.length ? ` · ${failed.length} could not be mailed: ${failed.map((x: any) => `${x.emp_code} (${x.reason || 'unknown'})`).join(', ')}` : ''))
      load()
    } catch (x: any) { setErr(x?.message || String(x)) } finally { setMailing(false) }
  }

  function download() {
    const sheet = shown.map(r => ({
      'Company Name': r.company,
      'Employee Code': r.emp_code,
      'Employee Name': r.full_name,
      'Department': r.department,
      'Location': r.location,
      'Date of Joining': r.doj || '',
      'Date of Leaving': r.dol || '',
      'Effective Date': effOf(r),
      'Regime': r.regime,
      'NPS Opted (Y/N)': r.opted ? 'Y' : 'N',
      'NPS Status': r.status === '—' ? '' : r.status,
      'PRAN': r.pran,
      'Tier': r.tier,
      'Contribution %': r.percent ?? '',
      'Monthly NPS': r.monthly ?? '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'NPS')
    XLSX.writeFile(wb, `NPS_Report_FY${fy}.xlsx`)
  }

  return (
    <div style={{ fontFamily: font, color: C.navy }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>Corporate NPS — Enrolment Report</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
          FY {fy} · who is enrolled in the corporate NPS and who is not. Employer contribution
          is 80CCD(2) — over and above the ₹1.5L 80C limit.
        </div>
      </div>

      {err && <div style={{ ...S.card, background: C.redBg, border: `1px solid ${TK.criticalTint}`, color: C.red, fontSize: 13 }}>{err}</div>}

      <div style={S.card}>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 12 }}>
          <Stat label="Employees" value={shown.length} />
          <Stat label="NPS opted" value={optedCount} color={optedCount ? C.green : C.muted} />
          <Stat label="Not opted" value={shown.length - optedCount} color={C.muted} />
          {pending > 0 && <Stat label="PRAN pending" value={pending} color={TK.info} />}
          {stopped > 0 && <Stat label="Stopped" value={stopped} color={C.red} />}
          <Stat label="Monthly NPS" value={inr(monthlyTotal)} color={C.purpleD} />
          <div style={{ flex: 1 }} />
          <button onClick={() => setPicker(true)} style={{ ...S.btnP, alignSelf: 'center', background: C.green }}>Set NPS for an employee
          </button>
          <button onClick={download} disabled={!shown.length} style={{ ...S.btnP, alignSelf: 'center', opacity: shown.length ? 1 : 0.5 }}>Download Excel
          </button>
          <button onClick={load} style={{ ...S.btnO, alignSelf: 'center' }}>Refresh</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={S.sel} value={fCompany} onChange={e => setFCompany(e.target.value)}>
            <option value="">All companies</option>{companies.map(c => <option key={c}>{c}</option>)}
          </select>
          <select style={S.sel} value={fDept} onChange={e => setFDept(e.target.value)}>
            <option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}
          </select>
          <select style={S.sel} value={fLoc} onChange={e => setFLoc(e.target.value)}>
            <option value="">All locations</option>{locs.map(l => <option key={l}>{l}</option>)}
          </select>
          <select style={S.sel} value={pMonth} onChange={e => setPMonth(Number(e.target.value))}
            title="The payroll month the effective date is worked out against">
            {FY_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m} {String(Number(fy.split('-')[0]) + (i + 1 <= 9 ? 0 : 1)).slice(2)}</option>)}
          </select>
          <select style={S.sel} value={fOpt} onChange={e => setFOpt(e.target.value as any)}>
            <option value="all">NPS: all</option>
            <option value="y">NPS opted only (Y)</option>
            <option value="n">Not opted only (N)</option>
          </select>
          <input style={{ ...S.sel, flex: 1, minWidth: 200 }} placeholder="Employee code or name" value={q} onChange={e => setQ(e.target.value)} />
          {(fCompany || fDept || fLoc || fOpt !== 'all' || q) && (
            <button onClick={() => { setFCompany(''); setFDept(''); setFLoc(''); setFOpt('all'); setQ('') }} style={S.btnO}>Clear</button>
          )}
        </div>

        {pending > 0 && (
          <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap', fontSize: 12, color: TK.brand, background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius: 10, padding: '10px 12px', lineHeight: 1.55 }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <b>{pending} employee{pending === 1 ? ' is' : 's are'} enrolled but waiting on a PRAN.</b> Nothing
              is being deducted or credited for {pending === 1 ? 'them' : 'them'} until it is submitted:{' '}
              {pendingRows.slice(0, 6).map(r => r.emp_code).join(', ')}{pending > 6 ? `, …and ${pending - 6} more` : ''}.
            </div>
            <button onClick={sendReminders} disabled={mailing}
              style={{ ...S.btnP, background: TK.info, whiteSpace: 'nowrap', opacity: mailing ? 0.6 : 1, cursor: mailing ? 'wait' : 'pointer' }}>
              {mailing ? 'Sending…' : 'Send PRAN reminder'}
            </button>
          </div>
        )}

        {regimeMismatch.length > 0 && (
          <div style={{ marginTop: 11, fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBd}`, borderRadius: 10, padding: '10px 12px', lineHeight: 1.55 }}>
            <b>{regimeMismatch.length} employee{regimeMismatch.length === 1 ? '' : 's'} changed tax regime after enrolling.</b> The
            NPS rate follows the regime — 10% of Basic on old, 14% on new — so the percent on
            file was worked out for the other one and the contribution is stale:{' '}
            {regimeMismatch.slice(0, 6).map(r => `${r.emp_code} (${r.nps_regime}→${r.regime})`).join(', ')}
            {regimeMismatch.length > 6 ? `, …and ${regimeMismatch.length - 6} more` : ''}.
          </div>
        )}
      </div>

      <div style={{ ...S.card, padding: 0, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>
            {rows.length === 0 ? 'No employees found.' : 'Nothing matched this filter.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Company', 'Emp Code', 'Employee Name', 'Department', 'Location', 'DOJ', 'DOL', 'Effective Date', 'Regime', 'NPS', 'Status', 'PRAN', 'Tier', '%', 'Monthly'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.emp_code} style={{ background: r.opted ? '#FCFDFF' : '#fff' }}>
                  <td style={S.td}>{r.company}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{r.emp_code}</td>
                  <td style={S.td}>{r.full_name}</td>
                  <td style={S.td}>{r.department}</td>
                  <td style={S.td}>{r.location}</td>
                  <td style={S.td}>{fmtDate(r.doj)}</td>
                  <td style={{ ...S.td, color: r.dol ? C.red : C.muted }}>{fmtDate(r.dol)}</td>
                  {/* Bold when it is their joining date rather than the 1st — that is the row
                      where a part-month contribution is owed, and the one worth noticing. */}
                  <td style={{ ...S.td, fontWeight: effOf(r) === mStart ? 400 : 700, color: effOf(r) === mStart ? C.navy : C.purpleD }}>
                    {fmtDate(effOf(r))}
                  </td>
                  <td style={S.td}>{r.regime}</td>
                  <td style={S.td}><YesNo yes={r.opted} /></td>
                  <td style={S.td}><StatusPill s={r.status} /></td>
                  <td style={{ ...S.td, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.pran || '—'}</td>
                  <td style={S.td}>{r.tier || '—'}</td>
                  <td style={S.td}>{r.percent == null ? '—' : `${r.percent}%`}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{r.monthly == null ? '—' : inr(r.monthly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {msg && (
        <div style={{ ...S.card, background: C.greenBg, border: `1px solid ${TK.positiveTint}`, color: C.green, fontSize: 13, fontWeight: 700 }}>✓ {msg}</div>
      )}

      {picker && (
        <NpsDialog rows={rows} onClose={() => setPicker(false)}
          onDone={m => { setPicker(false); setMsg(m); load() }} />
      )}

      <div style={{ fontSize: 11, color: C.purpleD, background: C.purpleBg, borderRadius: 10, padding: '11px 13px', lineHeight: 1.6 }}>
        <b>Y</b> means a live enrolment — ACTIVE, or PENDING_PRAN where the employee has enrolled
        but not yet submitted their PRAN. <b>N</b> covers both never enrolled and enrolled-then-stopped;
        the Status column separates the two, so a stopped enrolment is never mistaken for someone
        who was simply never asked.
        <br />Enrolment happens in the employee&apos;s ESS portal. This screen reports it — it does not change it.
      </div>
    </div>
  )
}
