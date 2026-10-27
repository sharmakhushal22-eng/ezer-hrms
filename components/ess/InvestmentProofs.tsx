'use client'
// components/ess/InvestmentProofs.tsx — ESS → Investment Proofs.
//
// The declaration is a promise; this is the bill behind it. Normally the window opens at
// year-end, but a resigning employee will not be here in March — so their deadline is
// their Date of Leaving and the window is already open (sql99: investment_proof_deadline).
//
// The line that costs money: anything declared but not proven — rejected, or simply never
// submitted before the deadline — stops being exempt. The screen says so plainly, because
// an employee who does not know that only finds out in their final settlement.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { C, F, W, S, R, E, tone, eyebrow, numeric, inputStyle, type Tone, IconFinance, IconCalendar, IconLock } from '@/lib/ui'
import {
  SectionCard, KpiGrid, KpiTile, StatusPill, InfoCallout, PButton, IconTile, IconFile, IconCheckCircle, IconTimer, IconXCircle,
} from '@/components/ess/payroll/kit'
import { Meter, fieldLabel } from '@/components/ess/payroll/claimsKit'

const FY = '2026-27'
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0)
const fmtDate = (d: any) => {
  if (!d) return '-'
  const x = new Date(d)
  return `${String(x.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][x.getMonth()]} ${x.getFullYear()}`
}

interface Proof {
  id: string; section: string; declared_item: string
  declared_amount: number; submitted_amount: number
  proof_reference: string | null; status: string; rejection_reason: string | null; deadline: string | null
}

const TONE: Record<string, { t: Tone; label: string; icon: React.ReactNode }> = {
  PENDING:   { t: 'neutral',  label: 'Proof pending', icon: <IconTimer size={13} /> },
  SUBMITTED: { t: 'warning',  label: 'Under review',  icon: <IconTimer size={13} /> },
  APPROVED:  { t: 'positive', label: 'Approved',      icon: <IconCheckCircle size={13} /> },
  REJECTED:  { t: 'critical', label: 'Rejected',      icon: <IconXCircle size={13} /> },
}

// Outside the parent so typing in an amount box never remounts the row.
function ProofRow({ p, draftAmt, draftRef, onAmt, onRef, onSave, busy }: {
  p: Proof; draftAmt: string; draftRef: string
  onAmt: (v: string) => void; onRef: (v: string) => void; onSave: () => void; busy: boolean
}) {
  const t = TONE[p.status] || TONE.PENDING
  const locked = p.status === 'APPROVED'
  const shortfall = Math.max(0, num(p.declared_amount) - num(draftAmt || p.submitted_amount))
  const proofAmt = num(draftAmt || p.submitted_amount)
  const cover = num(p.declared_amount) > 0 ? proofAmt / num(p.declared_amount) : 0
  const hasRef = !!(draftRef || '').trim()
  const field: React.CSSProperties = { ...inputStyle(), background: locked ? C.sunken : C.surface, color: locked ? C.inkSoft : C.ink }
  return (
    <div className="ez-rise" style={{
      background: C.surface, border: `1px solid ${C.line}`, borderLeft: `3px solid ${tone(t.t === 'neutral' ? 'brand' : t.t).fg}`,
      borderRadius: R.lg, padding: `${S.md + 2}px ${S.lg}px`, marginBottom: S.md, boxShadow: E.flat,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm + 2, flexWrap: 'wrap', marginBottom: S.md }}>
        <span style={{ fontSize: F.micro, fontWeight: W.bold, color: C.brandDeep, background: C.brandTint, border: `1px solid ${C.brandEdge}`, borderRadius: R.sm, padding: '3px 8px', letterSpacing: '.03em' }}>{p.section}</span>
        <div style={{ flex: 1, minWidth: 160, fontSize: F.body, fontWeight: W.semi, color: C.ink }}>{p.declared_item}</div>
        <StatusPill t={t.t} icon={t.icon} title="HR verification status">{t.label}</StatusPill>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))', gap: S.md, alignItems: 'end' }}>
        <div>
          <div style={fieldLabel}>Declared</div>
          <div style={{ height: 38, display: 'flex', alignItems: 'center', fontSize: F.lead, fontWeight: W.bold, color: C.ink, ...numeric }}>{inr(p.declared_amount)}</div>
        </div>
        <div>
          <label style={fieldLabel}>Proof amount</label>
          <input style={{ ...field, ...numeric }}
            value={draftAmt} readOnly={locked} inputMode="numeric"
            onChange={e => onAmt(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <label style={fieldLabel}>Bill / policy reference</label>
          <input style={field}
            value={draftRef} readOnly={locked} placeholder="Policy no. / receipt no. / drive link"
            onChange={e => onRef(e.target.value)} />
        </div>
      </div>

      {/* Proof vs declared, and whether a reference is on file. */}
      <div style={{ marginTop: S.md, display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: F.micro, color: C.muted, marginBottom: 4, ...numeric }}>
            <span>Proof covers {Math.min(100, Math.round(cover * 100))}% of declared</span>
            <span>{inr(proofAmt)} / {inr(p.declared_amount)}</span>
          </div>
          <Meter value={cover} t={locked ? 'positive' : cover >= 1 ? 'brand' : 'warning'} label="Proof amount against declared amount" />
        </div>
        <StatusPill size="sm" t={hasRef ? 'info' : 'neutral'} icon={<IconFile size={12} />}>
          {hasRef ? 'Reference on file' : 'No reference yet'}
        </StatusPill>
      </div>

      {!locked && shortfall > 0 && (
        <InfoCallout compact t="warning" style={{ marginTop: S.md, marginBottom: 0 }}>
          Proof for {inr(shortfall)} is still pending. That much will not stay exempt.
        </InfoCallout>
      )}
      {p.status === 'REJECTED' && p.rejection_reason && (
        <InfoCallout compact t="critical" style={{ marginTop: S.md, marginBottom: 0 }}>
          Rejected: {p.rejection_reason}
        </InfoCallout>
      )}
      {locked && (
        <div style={{ marginTop: S.md, display: 'flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: C.muted }}>
          <IconLock size={13} /> Verified by HR. This line is locked.
        </div>
      )}
      {!locked && (
        <div style={{ marginTop: S.md }}>
          <PButton variant="primary" size="sm" onClick={onSave} disabled={busy}>
            {p.status === 'PENDING' ? 'Submit proof' : 'Update proof'}
          </PButton>
        </div>
      )}
    </div>
  )
}

/** Declared vs proof-submitted, rolled up per tax section (80C, 80D, HRA …). Display only. */
function SectionProgress({ rows }: { rows: Proof[] }) {
  const map = new Map<string, { declared: number; submitted: number; approved: number; lines: number }>()
  rows.forEach(p => {
    const m = map.get(p.section) || { declared: 0, submitted: 0, approved: 0, lines: 0 }
    m.declared += num(p.declared_amount)
    if (p.status !== 'PENDING') m.submitted += num(p.submitted_amount)
    if (p.status === 'APPROVED') m.approved += num(p.submitted_amount)
    m.lines += 1
    map.set(p.section, m)
  })
  const list = Array.from(map.entries())
  return (
    <SectionCard title="Declared vs proof submitted" hint="By tax section. Green is verified by HR, blue is submitted and waiting." icon={<IconFinance size={16} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: S.md }}>
        {list.map(([sec, m]) => {
          const pct = m.declared > 0 ? Math.min(1, m.submitted / m.declared) : 0
          return (
            <div key={sec} style={{ padding: `${S.md}px ${S.md + 2}px`, background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: S.sm, marginBottom: 6 }}>
                <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>{sec}</span>
                <span style={{ fontSize: F.micro, color: C.muted }}>{m.lines} line{m.lines === 1 ? '' : 's'}</span>
                <span style={{ marginLeft: 'auto', fontSize: F.tiny, fontWeight: W.semi, color: pct >= 1 ? C.positive : C.inkSoft, ...numeric }}>{Math.round(pct * 100)}%</span>
              </div>
              <div style={{ display: 'flex', height: 7, borderRadius: R.pill, background: C.surface, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
                <div style={{ width: `${m.declared ? Math.min(100, (m.approved / m.declared) * 100) : 0}%`, background: C.positive }} />
                <div style={{ width: `${m.declared ? Math.max(0, Math.min(100, ((m.submitted - m.approved) / m.declared) * 100)) : 0}%`, background: C.brand }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: F.micro, color: C.muted, ...numeric }}>
                <span>Submitted <b style={{ color: C.ink }}>{inr(m.submitted)}</b></span>
                <span>Declared <b style={{ color: C.ink }}>{inr(m.declared)}</b></span>
              </div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

export default function InvestmentProofs({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<Proof[]>([])
  const [draft, setDraft] = useState<Record<string, { amt: string; ref: string }>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [leaving, setLeaving] = useState<string | null>(null)
  const [hasDecl, setHasDecl] = useState(false)
  const [regime, setRegime] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: emp } = await supabase.from('employees')
        .select('date_of_leaving, last_working_date, relieving_date').eq('id', employeeId).maybeSingle()
      setLeaving((emp as any)?.date_of_leaving || (emp as any)?.last_working_date || (emp as any)?.relieving_date || null)

      const { data: d } = await supabase.from('tds_declarations')
        .select('regime').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
      setHasDecl(!!d); setRegime((d as any)?.regime || '')

      const { data, error } = await supabase.from('investment_proofs')
        .select('*').eq('employee_id', employeeId).eq('fy', FY).order('section')
      if (error) throw new Error(error.message)
      const list = (data || []) as any as Proof[]
      setRows(list)
      const dr: Record<string, { amt: string; ref: string }> = {}
      list.forEach(p => { dr[p.id] = { amt: num(p.submitted_amount) ? String(num(p.submitted_amount)) : '', ref: p.proof_reference || '' } })
      setDraft(dr)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setLoading(false) }
  }, [employeeId])
  useEffect(() => { load() }, [load])

  async function openWindow() {
    setErr(''); setMsg(''); setBusy('open')
    const { data, error } = await supabase.rpc('open_investment_proof_window', { p_employee_id: employeeId, p_fy: FY })
    setBusy('')
    if (error) { setErr(error.message); return }
    if (!Number(data)) { setErr('No declared line found. Fill in and submit the Investment Declaration first.'); return }
    setMsg(`Proof window opened for ${data} line${Number(data) === 1 ? '' : 's'}.`)
    load()
  }

  async function saveProof(p: Proof) {
    setErr(''); setMsg(''); setBusy(p.id)
    const d = draft[p.id] || { amt: '', ref: '' }
    const { error } = await supabase.from('investment_proofs').update({
      submitted_amount: num(d.amt), proof_reference: d.ref.trim() || null,
      status: 'SUBMITTED', rejection_reason: null, updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    setBusy('')
    if (error) { setErr(error.message); return }
    setMsg(`${p.section} proof submitted. HR will review it.`)
    load()
  }

  const deadline = rows[0]?.deadline || null
  const overdue = deadline ? new Date(deadline) < new Date() : false
  const declared = rows.reduce((a, p) => a + num(p.declared_amount), 0)
  const proven = rows.filter(p => p.status === 'APPROVED').reduce((a, p) => a + num(p.submitted_amount), 0)
  // Display-only: days until the deadline, and how many lines sit in each state.
  const daysLeft = deadline ? Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000) : null
  const countOf = (s: string) => rows.filter(p => p.status === s).length

  if (loading) return <div style={{ padding: 24, color: C.muted, fontSize: F.small }}>Loading…</div>

  return (
    <div style={{ fontFamily: F.family, fontSize: F.small, color: C.ink, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md, marginBottom: S.lg, flexWrap: 'wrap' }}>
        <IconTile icon={<IconFile size={18} />} t="brand" size={40} />
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ fontSize: F.title, fontWeight: W.bold, letterSpacing: '-.01em' }}>Investment Proofs</div>
          <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2 }}>FY {FY}: bills for what you declared</div>
        </div>
        {hasDecl && regime && <StatusPill t={regime === 'NEW' ? 'positive' : 'brand'} dot>{regime === 'NEW' ? 'New regime' : 'Old regime'}</StatusPill>}
      </div>

      {leaving && (
        <InfoCallout t="warning" title="Your proof window is open now" icon={<IconCalendar size={17} />}>
          Your last working day is <b>{fmtDate(leaving)}</b>, so the deadline is not the end of the year, it is <b>that day</b>.
          Anything not proved by then will not stay exempt and will be taxed in the final settlement.
        </InfoCallout>
      )}

      {!hasDecl ? (
        <InfoCallout t="info" title="Declaration needed first">
          No <b>Investment Declaration</b> found for this FY. Proofs are submitted against it. Fill in and submit the declaration first.
        </InfoCallout>
      ) : regime === 'NEW' ? (
        <InfoCallout t="positive" title="Nothing to prove">
          You are on the <b>New regime</b>: the 80C/80D/HRA exemptions do not apply, so no proof is needed.
        </InfoCallout>
      ) : (
        <>
          {/* Window status — the one thing to know before anything else. */}
          {rows.length > 0 && deadline && (
            overdue ? (
              <InfoCallout t="critical" title="The proof deadline has passed" icon={<IconCalendar size={17} />}>
                The deadline was <b>{fmtDate(deadline)}</b>. Anything declared but not proven will not stay exempt.
              </InfoCallout>
            ) : (
              <InfoCallout t="info" title={`Proof window open · submit by ${fmtDate(deadline)}`} icon={<IconCalendar size={17} />}
                action={daysLeft != null ? <StatusPill t={daysLeft <= 15 ? 'warning' : 'info'} solid>{Math.max(0, daysLeft)} day{daysLeft === 1 ? '' : 's'} left</StatusPill> : undefined}>
                Enter the proof amount and a bill or policy reference for each line, then submit. HR verifies each one.
              </InfoCallout>
            )
          )}

          <KpiGrid min={150}>
            <KpiTile label="Declared" value={inr(declared)} emphasis sub={`${rows.length} line${rows.length === 1 ? '' : 's'} in your declaration`} />
            <KpiTile label="Proven" value={inr(proven)} t="positive" icon={<IconCheckCircle size={15} />}
              progress={declared > 0 ? proven / declared : 0} progressTone="positive"
              sub={declared > 0 ? `${Math.round((proven / declared) * 100)}% verified by HR` : 'Verified by HR'} />
            <KpiTile label="Not yet proven" value={inr(Math.max(0, declared - proven))} t={declared - proven > 0 ? 'warning' : 'neutral'}
              sub={declared - proven > 0 ? 'Taxable if not proved in time' : 'All clear'} />
            {deadline && (
              <KpiTile label="Deadline" value={fmtDate(deadline)} t={overdue ? 'critical' : 'neutral'} icon={<IconCalendar size={15} />}
                sub={overdue ? 'Passed' : daysLeft != null ? `${Math.max(0, daysLeft)} day${daysLeft === 1 ? '' : 's'} left` : undefined} />
            )}
          </KpiGrid>

          {rows.length === 0 ? (
            <SectionCard title="Proof window not open yet" icon={<IconCalendar size={16} />}
              hint="Opening it creates one proof line for every line of your declaration.">
              <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.6, marginBottom: S.md }}>
                The proof window is not open yet. Use the button below to open a window for each line of your declaration.
              </div>
              <PButton variant="primary" onClick={openWindow} disabled={busy === 'open'}>
                {busy === 'open' ? 'Opening…' : 'Proof window kholein'}
              </PButton>
            </SectionCard>
          ) : (
            <>
              <SectionProgress rows={rows} />
              <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', margin: `${S.xs}px 0 ${S.md}px` }}>
                <span style={{ ...eyebrow }}>Your proofs</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const).map(s => countOf(s) > 0 && (
                    <StatusPill key={s} size="sm" t={TONE[s].t}>{countOf(s)} {TONE[s].label.toLowerCase()}</StatusPill>
                  ))}
                </span>
              </div>
              {rows.map(p => (
                <ProofRow key={p.id} p={p}
                  draftAmt={draft[p.id]?.amt ?? ''} draftRef={draft[p.id]?.ref ?? ''}
                  onAmt={v => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], amt: v } }))}
                  onRef={v => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], ref: v } }))}
                  onSave={() => saveProof(p)} busy={busy === p.id} />
              ))}
            </>
          )}
        </>
      )}

      {msg && <InfoCallout t="positive" compact style={{ marginTop: S.md }}>{msg}</InfoCallout>}
      {err && <InfoCallout t="critical" compact style={{ marginTop: S.md }}>{err}</InfoCallout>}
    </div>
  )
}
