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
import { authHeaders } from '@/lib/auth-headers'
import {
  C, F, W, S, R, numeric,
  IconEmployees, IconUser, IconCheck, IconClose, IconMail, IconDownload, IconSearch, IconLoans, IconCalendar, IconAlert,
} from '@/lib/ui'
import {
  SectionCard, KpiTile, KpiGrid, InfoCallout, PButton, StatusPill as KitPill, EmptyState, FilterBar, FilterField, fieldStyle,
  DataTable, dt, IconSync, IconInfo, type KitTone,
} from '@/components/payroll/kit'
import { RuleSummary, RefChip, Modal, OptionCard, CheckRow, cfgInput, cfgTextarea } from '@/components/payroll/configKit'

const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const fmtDate = (d?: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

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

function YesNo({ yes }: { yes: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 34, height: 22, padding: '0 8px',
      borderRadius: R.pill, fontSize: F.micro, fontWeight: W.bold, boxSizing: 'border-box',
      background: yes ? C.positiveTint : C.sunken, color: yes ? C.positive : C.muted, border: `1px solid ${yes ? C.positiveEdge : C.line}`,
    }}>
      {yes ? <IconCheck size={11} strokeWidth={2.6} /> : null}{yes ? 'Y' : 'N'}
    </span>
  )
}

const STATUS_TONE: Record<string, KitTone> = {
  ACTIVE: 'positive', PENDING_PRAN: 'info', STOPPED: 'critical', SUPERSEDED: 'neutral',
}
function StatusPill({ s }: { s: string }) {
  if (!s || s === '-') return <span style={{ color: C.faint }}>-</span>
  return <KitPill t={STATUS_TONE[s] || 'brand'} size="sm" dot>{s.replace('_', ' ')}</KitPill>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: `1px solid ${C.line}`, fontSize: F.small }}>
      <span style={{ color: C.muted }}>{k}</span>
      <span style={{ fontWeight: W.semi, textAlign: 'right', color: C.ink, ...numeric }}>{v}</span>
    </div>
  )
}

function Monogram({ name, opted, size = 36 }: { name: string; opted: boolean; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: W.bold, fontSize: size >= 40 ? F.small : F.tiny,
      background: opted ? C.positiveTint : C.brandTint, color: opted ? C.positive : C.brandDeep,
      border: `1px solid ${opted ? C.positiveEdge : C.brandEdge}`,
    }}>{initials(name)}</div>
  )
}

function SearchResult({ r, onPick }: { r: NpsRow; onPick: (r: NpsRow) => void }) {
  return (
    <button onClick={() => onPick(r)} className="ez-row ez-press"
      style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: R.md, border: `1px solid ${C.line}`, background: C.surface, cursor: 'pointer', fontFamily: 'inherit' }}>
      <Monogram name={r.full_name} opted={r.opted} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.full_name} <span style={{ color: C.muted, fontWeight: W.medium, ...numeric }}>· {r.emp_code}</span>
        </div>
        <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.department} · {r.location}
        </div>
      </div>
      <YesNo yes={r.opted} />
    </button>
  )
}

/** Small uppercase label between dialog sections. */
function DlgLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.09em', marginTop: 4 }}>{children}</div>
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
            ? `${sel.emp_code} enrolled. PRAN pending, the form has been emailed to them.`
            : `${sel.emp_code} enrolled in NPS.`)
        : `${sel.emp_code}: NPS stopped. Nothing will be deducted from next month.`)
    } catch (x: any) { setErr(x?.message || String(x)); setBusy(false) }
  }

  return (
    <Modal onBackdrop={onClose} onClose={onClose} icon={<IconLoans size={17} />} title="Corporate NPS"
      subtitle={sel ? 'Turn NPS on or off for this employee' : 'Find an employee to begin'} maxWidth={560}
      footer={sel ? <>
        <PButton variant="secondary" onClick={onClose} style={{ flex: 1 }}>Cancel</PButton>
        <PButton variant={mode === 'y' ? 'positive' : 'danger'} onClick={save} disabled={!canSave} style={{ flex: 1.4 }}
          icon={mode === 'y' ? <IconCheck size={14} /> : <IconClose size={14} />}>
          {busy ? 'Saving…' : mode === 'y' ? 'Enrol in NPS' : 'Stop NPS'}
        </PButton>
      </> : undefined}>
      {!sel ? (
        <>
          <div style={{ position: 'relative' }}>
            <span aria-hidden style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.muted, display: 'inline-flex' }}><IconSearch size={15} /></span>
            <input autoFocus value={q} onChange={ev => setQ(ev.target.value)}
              placeholder="Employee code or name, e.g. SRS9008, Nisha"
              style={{ ...cfgInput, height: 42, paddingLeft: 36, fontSize: F.body }} />
          </div>

          {terms.length < 2 ? (
            <EmptyState compact t="neutral" icon={<IconSearch size={20} />} title="Type at least two characters to search."
              hint={`${rows.length} employees on record.`} />
          ) : results.length === 0 ? (
            <EmptyState compact t="neutral" title={`Nobody matched “${q.trim()}”.`} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {results.map(r => <SearchResult key={r.emp_code} r={r} onPick={pick} />)}
              {results.length === 25 && (
                <div style={{ fontSize: F.tiny, color: C.muted, padding: '6px 2px 0' }}>Showing the first 25. Narrow the search to see more.</div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {/* employee card */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: C.sunken, borderRadius: R.md, border: `1px solid ${C.line}` }}>
            <Monogram name={sel.full_name} opted={sel.opted} size={42} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: F.body, fontWeight: W.bold, color: C.ink }}>{sel.full_name}</div>
              <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 1 }}>{sel.emp_code} · {sel.department} · {sel.location}</div>
            </div>
            <PButton size="sm" variant="secondary" onClick={() => { setSel(null); setInfo(null); setErr('') }}>Change</PButton>
          </div>

          <div>
            <DetailRow k="Company" v={sel.company} />
            <DetailRow k="Date of Joining" v={fmtDate(sel.doj)} />
            {sel.dol && <DetailRow k="Date of Leaving" v={<span style={{ color: C.critical }}>{fmtDate(sel.dol)}</span>} />}
            <DetailRow k="Current NPS" v={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><YesNo yes={sel.opted} /> {sel.status !== '-' && <StatusPill s={sel.status} />}</span>} />
            {loading ? <DetailRow k="Salary figures" v={<span style={{ color: C.muted }}>loading…</span>} /> : e && (
              <>
                <DetailRow k="Tax regime" v={e.tax_regime} />
                <DetailRow k="Monthly Basic" v={e.has_ctc ? inr(e.basic_monthly) : <span style={{ color: C.warning }}>no CTC set</span>} />
                <DetailRow k="NPS rate" v={`${e.contribution_percent}% of Basic`} />
                <DetailRow k="Monthly contribution" v={<span style={{ color: C.brandDeep, fontWeight: W.bold, fontSize: F.lead }}>{inr(e.monthly_nps_amount)}</span>} />
              </>
            )}
          </div>

          {/* Y / N */}
          <DlgLabel>Set NPS</DlgLabel>
          <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
            <OptionCard label="Yes, enrol" t="positive" active={mode === 'y'} disabled={sel.opted} onClick={() => !sel.opted && setMode('y')} />
            <OptionCard label="No, stop" t="critical" active={mode === 'n'} disabled={!sel.opted} onClick={() => sel.opted && setMode('n')} />
          </div>
          <div style={{ fontSize: F.tiny, color: C.muted, lineHeight: 1.5, marginTop: -4 }}>
            {sel.opted
              ? 'Already enrolled. Only “No” does anything here.'
              : 'Not enrolled. Only “Yes” does anything here.'}
          </div>

          {mode === 'y' && !sel.opted && (
            <>
              <DlgLabel>PRAN</DlgLabel>
              <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
                {[[true, 'Has a PRAN'], [false, 'Needs one']].map(([v, lbl]) => (
                  <OptionCard key={String(v)} label={lbl as string} active={hasPran === v} onClick={() => setHasPran(v as boolean)} />
                ))}
              </div>
              {hasPran ? (
                <div>
                  <input value={pran} maxLength={pranLen} placeholder={`${pranLen}-digit PRAN`}
                    onChange={ev => setPran(ev.target.value.replace(/\D/g, ''))}
                    style={{ ...cfgInput, letterSpacing: 2, borderColor: pran && !pranOk ? C.critical : C.lineStrong }} />
                  {pran && !pranOk && <div style={{ fontSize: F.tiny, color: C.critical, marginTop: 4 }}>{pranLen - pranClean.length} more digit(s) needed</div>}
                </div>
              ) : (
                <InfoCallout t="brand" compact icon={<IconMail size={14} />} style={{ marginBottom: 0 }}>
                  A PRAN creation form is emailed to the employee and the enrolment stays
                  <b> PRAN pending</b> until they submit it. It does not go active on its own.
                </InfoCallout>
              )}

              <select value={tier} onChange={ev => setTier(ev.target.value)} style={{ ...cfgInput, cursor: 'pointer' }}>
                <option>Tier I</option><option>Tier II</option>
              </select>

              {e && !e.has_ctc && (
                <InfoCallout t="warning" compact style={{ marginBottom: 0 }}>
                  No CTC in ctc_master, so Basic reads ₹0 and the contribution would be ₹0.
                  Set their CTC first. Enrolling now records a contribution of nothing.
                </InfoCallout>
              )}

              <CheckRow well checked={ack} onChange={ev => setAck(ev.target.checked)}>
                I am enrolling this employee on their behalf, with their consent on record.
                The contribution starts from the 1st of next month and repeats monthly.
              </CheckRow>
            </>
          )}

          {mode === 'n' && sel.opted && (
            <>
              <InfoCallout t="critical" compact style={{ marginBottom: 0 }}>
                Stopping NPS ends the employer contribution from next month. The employee&apos;s
                take-home goes up, their retirement contribution stops, and the 80CCD(2)
                benefit ends with it.
              </InfoCallout>
              <DlgLabel>Reason *</DlgLabel>
              <div>
                <textarea value={reason} onChange={ev => setReason(ev.target.value)} rows={3}
                  placeholder="Why is this being stopped? The employee and any later audit will see this."
                  style={{ ...cfgTextarea, minHeight: 72 }} />
                {reason.trim().length > 0 && reason.trim().length < 3 && (
                  <div style={{ fontSize: F.tiny, color: C.critical, marginTop: 4 }}>Write a real reason, not a placeholder.</div>
                )}
              </div>
            </>
          )}

          {err && <InfoCallout t="critical" compact style={{ marginBottom: 0 }}>{err}</InfoCallout>}
        </>
      )}
    </Modal>
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
          .select('id, emp_code, full_name, group_doj, date_of_leaving, employment_status, tds_regime, companies!employees_company_id_fkey(company_name), departments!employees_department_id_fkey(dept_name), locations!location_id(location_name)')
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
        const st = n?.status || '-'
        return {
          id: e.id,
          company: e.companies?.company_name || '-',
          emp_code: e.emp_code || '',
          full_name: e.full_name || '',
          department: e.departments?.dept_name || '-',
          location: e.locations?.location_name || '-',
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

  const companies = useMemo(() => Array.from(new Set(rows.map(r => r.company).filter(x => x && x !== '-'))).sort(), [rows])
  const depts = useMemo(() => Array.from(new Set(rows.map(r => r.department).filter(x => x && x !== '-'))).sort(), [rows])
  const locs = useMemo(() => Array.from(new Set(rows.map(r => r.location).filter(x => x && x !== '-'))).sort(), [rows])

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
  const regimeMismatch = shown.filter(r => r.opted && r.nps_regime && r.regime !== '-' && r.nps_regime !== r.regime)

  // Chasing whoever is still waiting on a PRAN. Until it arrives nothing is deducted and
  // nothing is credited, so an enrolment left pending is an enrolment that never happened.
  async function sendReminders() {
    if (mailing) return
    setMailing(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/nps/pran-reminder', { method: 'POST', headers: await authHeaders() })
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
      'NPS Status': r.status === '-' ? '' : r.status,
      'PRAN': r.pran,
      'Tier': r.tier,
      'Contribution %': r.percent ?? '',
      'Monthly NPS': r.monthly ?? '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'NPS')
    XLSX.writeFile(wb, `NPS_Report_FY${fy}.xlsx`)
  }

  const anyFilter = !!(fCompany || fDept || fLoc || fOpt !== 'all' || q)
  const sel: React.CSSProperties = { ...fieldStyle, cursor: 'pointer' }

  return (
    <div style={{ fontFamily: F.family, color: C.ink, minWidth: 0 }}>
      <RuleSummary icon={<IconLoans size={20} />} eyebrow="Statutory · NPS" title="Corporate NPS: Enrolment Report"
        rule={<>FY {fy} · who is enrolled in the corporate NPS and who is not. Employer contribution
          is 80CCD(2), over and above the ₹1.5L 80C limit.</>}
        meta={<><RefChip t="brand" icon={<IconCalendar size={12} />}>FY {fy}</RefChip><RefChip>Sec 80CCD(2)</RefChip></>}
        actions={<>
          <PButton variant="positive" icon={<IconUser size={14} />} onClick={() => setPicker(true)}>Set NPS for an employee</PButton>
          <PButton variant="primary" icon={<IconDownload size={14} />} onClick={download} disabled={!shown.length}>Download Excel ({shown.length})</PButton>
          <PButton variant="secondary" icon={<IconSync size={14} />} onClick={load}>Refresh</PButton>
        </>} />

      {err && <InfoCallout t="critical" compact>{err}</InfoCallout>}

      <KpiGrid min={150}>
        <KpiTile label="Employees" value={shown.length} icon={<IconEmployees size={15} />} />
        <KpiTile label="NPS opted" value={optedCount} t={optedCount ? 'positive' : 'neutral'} icon={<IconCheck size={15} />}
          progress={shown.length ? optedCount / shown.length : 0} progressTone="positive" />
        <KpiTile label="Not opted" value={shown.length - optedCount} icon={<IconUser size={15} />} />
        {pending > 0 && <KpiTile label="PRAN pending" value={pending} t="info" icon={<IconMail size={15} />} />}
        {stopped > 0 && <KpiTile label="Stopped" value={stopped} t="critical" icon={<IconClose size={15} />} />}
        <KpiTile label="Monthly NPS" value={inr(monthlyTotal)} emphasis icon={<IconLoans size={15} />} />
      </KpiGrid>

      <FilterBar label="Filter" active={anyFilter}
        onClear={() => { setFCompany(''); setFDept(''); setFLoc(''); setFOpt('all'); setQ('') }} clearLabel="Clear"
        summary={<>Showing <b>{shown.length}</b> of {rows.length} employees. The Excel download follows these filters.</>}>
        <FilterField label="Company" minWidth={170}>
          <select style={sel} value={fCompany} onChange={e => setFCompany(e.target.value)}>
            <option value="">All companies</option>{companies.map(c => <option key={c}>{c}</option>)}
          </select>
        </FilterField>
        <FilterField label="Department" minWidth={170}>
          <select style={sel} value={fDept} onChange={e => setFDept(e.target.value)}>
            <option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}
          </select>
        </FilterField>
        <FilterField label="Location" minWidth={160}>
          <select style={sel} value={fLoc} onChange={e => setFLoc(e.target.value)}>
            <option value="">All locations</option>{locs.map(l => <option key={l}>{l}</option>)}
          </select>
        </FilterField>
        <FilterField label="Payroll month" minWidth={140}>
          <select style={sel} value={pMonth} onChange={e => setPMonth(Number(e.target.value))}
            title="The payroll month the effective date is worked out against">
            {FY_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m} {String(Number(fy.split('-')[0]) + (i + 1 <= 9 ? 0 : 1)).slice(2)}</option>)}
          </select>
        </FilterField>
        <FilterField label="NPS" minWidth={170}>
          <select style={sel} value={fOpt} onChange={e => setFOpt(e.target.value as any)}>
            <option value="all">NPS: all</option>
            <option value="y">NPS opted only (Y)</option>
            <option value="n">Not opted only (N)</option>
          </select>
        </FilterField>
        <FilterField label="Search" grow minWidth={200}>
          <input style={fieldStyle} placeholder="Employee code or name" value={q} onChange={e => setQ(e.target.value)} />
        </FilterField>
      </FilterBar>

      {pending > 0 && (
        <InfoCallout t="info" icon={<IconMail size={16} />}
          title={`${pending} employee${pending === 1 ? ' is' : 's are'} enrolled but waiting on a PRAN.`}
          action={<PButton variant="secondary" icon={<IconMail size={14} />} onClick={sendReminders} disabled={mailing}>{mailing ? 'Sending…' : 'Send PRAN reminder'}</PButton>}>
          Nothing is being deducted or credited for {pending === 1 ? 'them' : 'them'} until it is submitted:{' '}
          {pendingRows.slice(0, 6).map(r => r.emp_code).join(', ')}{pending > 6 ? `, …and ${pending - 6} more` : ''}.
        </InfoCallout>
      )}

      {regimeMismatch.length > 0 && (
        <InfoCallout t="warning" icon={<IconAlert size={16} />}
          title={`${regimeMismatch.length} employee${regimeMismatch.length === 1 ? '' : 's'} changed tax regime after enrolling.`}>
          The NPS rate follows the regime (10% of Basic on old, 14% on new), so the percent on
          file was worked out for the other one and the contribution is stale:{' '}
          {regimeMismatch.slice(0, 6).map(r => `${r.emp_code} (${r.nps_regime}→${r.regime})`).join(', ')}
          {regimeMismatch.length > 6 ? `, …and ${regimeMismatch.length - 6} more` : ''}.
        </InfoCallout>
      )}

      <SectionCard flush>
        {loading ? (
          <EmptyState compact t="neutral" icon={<IconEmployees size={20} />} title="Loading…" />
        ) : shown.length === 0 ? (
          <EmptyState compact t="neutral" icon={<IconSearch size={20} />} title={rows.length === 0 ? 'No employees found.' : 'Nothing matched this filter.'} />
        ) : (
          <DataTable minWidth={1500} maxHeight="70vh">
            <thead>
              <tr>
                {['Company', 'Emp Code', 'Employee Name', 'Department', 'Location', 'DOJ', 'DOL', 'Effective Date', 'Regime', 'NPS', 'Status', 'PRAN', 'Tier', '%', 'Monthly'].map(h => (
                  <th key={h} style={h === '%' || h === 'Monthly' ? dt.thNum : dt.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.emp_code} className={dt.rowClass}>
                  <td style={{ ...dt.td, whiteSpace: 'nowrap' }}>{r.company}</td>
                  <td style={dt.tdMono}>{r.emp_code}</td>
                  <td style={{ ...dt.tdStrong, whiteSpace: 'nowrap' }}>{r.full_name}</td>
                  <td style={{ ...dt.td, whiteSpace: 'nowrap' }}>{r.department}</td>
                  <td style={{ ...dt.td, whiteSpace: 'nowrap' }}>{r.location}</td>
                  <td style={{ ...dt.td, whiteSpace: 'nowrap', ...numeric }}>{fmtDate(r.doj)}</td>
                  <td style={{ ...dt.td, whiteSpace: 'nowrap', ...numeric, color: r.dol ? C.critical : C.faint }}>{fmtDate(r.dol)}</td>
                  {/* Bold when it is their joining date rather than the 1st — that is the row
                      where a part-month contribution is owed, and the one worth noticing. */}
                  <td style={{ ...dt.td, whiteSpace: 'nowrap', ...numeric, fontWeight: effOf(r) === mStart ? W.regular : W.bold, color: effOf(r) === mStart ? C.ink : C.brandDeep }}>
                    {fmtDate(effOf(r))}
                  </td>
                  <td style={dt.td}>{r.regime}</td>
                  <td style={dt.td}><YesNo yes={r.opted} /></td>
                  <td style={dt.td}><StatusPill s={r.status} /></td>
                  <td style={{ ...dt.tdMono, fontWeight: W.regular, fontSize: F.tiny, letterSpacing: '.03em' }}>{r.pran || '-'}</td>
                  <td style={{ ...dt.td, whiteSpace: 'nowrap' }}>{r.tier || '-'}</td>
                  <td style={dt.tdNum}>{r.percent == null ? '-' : `${r.percent}%`}</td>
                  <td style={{ ...dt.tdNum, fontWeight: W.bold }}>{r.monthly == null ? '-' : inr(r.monthly)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </SectionCard>

      {msg && <InfoCallout t="positive" compact><b style={{ color: C.positive }}>{msg}</b></InfoCallout>}

      {picker && (
        <NpsDialog rows={rows} onClose={() => setPicker(false)}
          onDone={m => { setPicker(false); setMsg(m); load() }} />
      )}

      <InfoCallout t="neutral" icon={<IconInfo size={18} />} title="How to read Y and N">
        <b>Y</b> means a live enrolment: ACTIVE, or PENDING_PRAN where the employee has enrolled
        but not yet submitted their PRAN. <b>N</b> covers both never enrolled and enrolled-then-stopped;
        the Status column separates the two, so a stopped enrolment is never mistaken for someone
        who was simply never asked.
        <br />Enrolment happens in the employee&apos;s ESS portal. This screen reports it. It does not change it.
      </InfoCallout>
    </div>
  )
}
