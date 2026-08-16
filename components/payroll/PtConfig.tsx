'use client'
// components/payroll/PtConfig.tsx — Professional Tax configuration.
// Reached from Configuration → PT Slabs and from Statutory & Tax → Professional Tax;
// both render this one component, because two PT screens would eventually disagree and
// whichever one HR happened to open would decide what they believed.
//
// Two halves: a Quick check that resolves a single employee's PT, and the full month-wise
// grid of every state and slab. A column per month rather than one "monthly amount",
// because PT is not flat across the year — Maharashtra charges ₹300 in February,
// Tamil Nadu and Kerala bill twice a year and nothing in the other ten months.
//
// Quick check calls get_pt_amount(), the same function sync_month_pt() uses during a
// payroll run, so this screen cannot show ₹200 while the run deducts ₹300. Its
// rate_found flag carries the distinction that matters: ₹0 means the state levies no PT,
// null means the state was never configured. Reading the second as the first is what let
// 92 employees be charged for a tax their state does not have.
import { useState, useEffect, useCallback } from 'react'
import { getCurrentPtSlabs, reviseSlab, getPtAmount } from '@/lib/pt/actions'
import { MONTH_KEYS, MONTH_LABELS } from '@/lib/pt/types'
import type { PtConfig as PtRow, Gender } from '@/lib/pt/types'
import { INDIAN_STATES } from '@/lib/geo/india-states-districts'

const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489', card: '#FFFFFF',
  border: '#E9E7F5', muted: '#6B7280', amber: '#D97706', amberBg: '#FFFBEB',
  purpleBg: '#EEEDFE', gray: '#F8F7FF', red: '#DC2626', redBg: '#FEF2F2', green: '#059669',
}
const font = '"DM Sans","Segoe UI",sans-serif'
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 12.5, boxSizing: 'border-box', fontFamily: font, outline: 'none', background: '#FAFAF8', color: C.navy }
const labelStyle: React.CSSProperties = { fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }

function summarizeMonths(r: PtRow): string {
  const amts = [r.jan,r.feb,r.mar,r.apr,r.may,r.jun,r.jul,r.aug,r.sep,r.oct,r.nov,r.dec].map(Number)
  const uniq = Array.from(new Set(amts))
  if (uniq.length === 1) return uniq[0] === 0 ? 'Exempt (₹0)' : `₹${uniq[0]} every month`
  const nonZeroMonths = amts.map((a, i) => a > 0 ? MONTH_LABELS[i] : null).filter(Boolean)
  const zeroCount = amts.filter(a => a === 0).length
  if (zeroCount >= 10) return `₹${Math.max(...amts)} — only ${nonZeroMonths.join(', ')}`
  return `Varies (peak ₹${Math.max(...amts)})`
}
function slabLabel(r: PtRow): string {
  const min = Number(r.slab_min).toLocaleString('en-IN')
  return r.slab_max != null ? `₹${min}–${Number(r.slab_max).toLocaleString('en-IN')}` : `₹${min}+`
}

// ── Searchable dropdown ─────────────────────────────────────────────
function SearchSelect({ value, options, placeholder, onChange }: {
  value: string; options: string[]; placeholder: string; onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const filtered = (q.trim() ? options.filter(o => o.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 100)
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => { setOpen(o => !o); setQ('') }}
        style={{ ...inputStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, color: value ? C.navy : '#94A3B8' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || placeholder}</span>
        <span style={{ color: '#94A3B8', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 210 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, width: '100%', minWidth: 200, background: '#fff', border: '1px solid #DDD6FE', borderRadius: 8, boxShadow: '0 8px 24px rgba(30,27,75,0.16)', zIndex: 211, overflow: 'hidden' }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: '1px solid #EEF', fontSize: 12.5, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: '#94A3B8' }}>No matches</div>}
              {filtered.map(o => (
                <div key={o} onClick={() => { onChange(o); setOpen(false) }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#F5F3FF'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = o === value ? '#EEF2FF' : '#fff'}
                  style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', background: o === value ? '#EEF2FF' : '#fff', color: C.navy }}>
                  {o}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Add / revise slab modal ─────────────────────────────────────────
function ReviseModal({ preset, onClose, onSaved }: { preset?: PtRow | null; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState(preset?.state ?? '')
  const [slabMin, setSlabMin] = useState(preset ? String(preset.slab_min) : '')
  const [slabMax, setSlabMax] = useState(preset?.slab_max != null ? String(preset.slab_max) : '')
  const [gender, setGender] = useState<Gender>(preset?.gender ?? 'ALL')
  const [amounts, setAmounts] = useState<string[]>(
    preset ? [preset.jan,preset.feb,preset.mar,preset.apr,preset.may,preset.jun,preset.jul,preset.aug,preset.sep,preset.oct,preset.nov,preset.dec].map(String) : Array(12).fill('')
  )
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notificationRef, setNotificationRef] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const valid = state.trim() && slabMin !== '' && amounts.every(a => a !== '') && effectiveFrom

  async function handleSave() {
    setSaving(true); setErr('')
    try {
      await reviseSlab({
        state: state.trim(), slabMin: Number(slabMin), slabMax: slabMax ? Number(slabMax) : null,
        gender, amounts: amounts.map(Number),
        effectiveFrom, notificationReference: notificationRef || undefined,
      })
      onSaved()
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const quick = (label: string, fn: () => void) => (
    <button type="button" onClick={fn} style={{ fontSize: 10, padding: '3px 9px', borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', color: C.purpleD, fontWeight: 700 }}>{label}</button>
  )
  const setSame = () => { const v = amounts.find(a => a) || '200'; setAmounts(Array(12).fill(v)) }
  const setTwice = () => { const v = amounts.find((a, i) => (i === 2 || i === 8) && a) || amounts.find(a => a) || '300'; setAmounts(MONTH_LABELS.map((m) => (m === 'Mar' || m === 'Sep') ? v : '0')) }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: font }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 580, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(30,27,75,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⚖️</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>{preset ? 'Revise PT slab' : 'Add PT slab'}</div>
            <div style={{ fontSize: 10.5, color: C.muted }}>Salary band + per-month amount</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>State *</label><SearchSelect value={state} options={INDIAN_STATES} placeholder="Select state" onChange={setState} /></div>
          <div><label style={labelStyle}>Slab min (₹) *</label><input type="number" value={slabMin} onChange={e => setSlabMin(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Slab max (₹)</label><input type="number" value={slabMax} onChange={e => setSlabMax(e.target.value)} placeholder="blank = +" style={inputStyle} /></div>
          <div><label style={labelStyle}>Gender</label>
            <select value={gender} onChange={e => setGender(e.target.value as Gender)} style={inputStyle}>
              <option value="ALL">All</option><option value="MALE">Male only</option><option value="FEMALE">Female only</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label style={labelStyle}>Amount per month (₹) *</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {quick('Same all months', setSame)}
            {quick('Only Mar + Sep', setTwice)}
            {quick('Clear', () => setAmounts(Array(12).fill('0')))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
          {MONTH_LABELS.map((m, i) => (
            <div key={m}>
              <div style={{ fontSize: 9, color: C.muted, textAlign: 'center', marginBottom: 2 }}>{m}</div>
              <input type="number" value={amounts[i]} onChange={e => setAmounts(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                style={{ ...inputStyle, padding: '6px 4px', textAlign: 'center' }} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, background: C.gray, padding: '8px 10px', borderRadius: 7, marginBottom: 10, lineHeight: 1.5 }}>
          Use <b>Only Mar + Sep</b> for twice-yearly states (Tamil Nadu, Kerala). For Maharashtra&apos;s annual-cap adjustment, set February higher than the other months directly.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div><label style={labelStyle}>Effective from *</label><input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={inputStyle} /></div>
          <div><label style={labelStyle}>Notification reference</label><input value={notificationRef} onChange={e => setNotificationRef(e.target.value)} placeholder="PT/2026/…" style={inputStyle} /></div>
        </div>

        {err && <div style={{ fontSize: 11, color: C.red, background: C.redBg, padding: '8px 10px', borderRadius: 6, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!valid || saving} onClick={handleSave}
            style={{ flex: 1, padding: '11px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: (!valid || saving) ? 'not-allowed' : 'pointer', opacity: (!valid || saving) ? 0.5 : 1, boxShadow: '0 3px 10px rgba(124,58,237,0.22)' }}>
            {saving ? 'Saving…' : '💾 Save slab'}
          </button>
          <button onClick={onClose} style={{ padding: '11px 18px', borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 13, color: C.muted, fontWeight: 600 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function PtConfig() {
  const [slabs, setSlabs] = useState<PtRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<{ open: boolean; preset?: PtRow | null }>({ open: false })

  // Quick check
  const [qState, setQState] = useState('')
  const [qMonth, setQMonth] = useState('apr')
  const [qGross, setQGross] = useState('')
  const [qBusy, setQBusy] = useState(false)
  const [qErr, setQErr] = useState('')
  const [qRes, setQRes] = useState<{ amount: number | null; found: boolean; row: PtRow | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setSlabs(await getCurrentPtSlabs()) }
    catch (e: any) { setError(e.message || 'Could not load — run sql70 first.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const states = Array.from(new Set(slabs.map(s => s.state))).sort()

  // A state whose every month is zero in every slab levies no PT at all. Said out loud on
  // the row, because a column of zeros otherwise reads as missing data and somebody
  // eventually "fixes" it by typing 200 in.
  const noPt = new Set(
    states.filter(st => slabs.filter(s => s.state === st)
      .every(s => MONTH_KEYS.every(m => Number((s as any)[m]) === 0))))

  async function runCheck() {
    if (!qState || qGross.trim() === '') return
    setQBusy(true); setQErr(''); setQRes(null)
    try {
      // Calendar date for the chosen month — get_pt_amount reads the month off the date,
      // so the year only has to be one the slab's validity range covers.
      const mi = MONTH_KEYS.indexOf(qMonth as any) + 1
      const r = await getPtAmount({
        state: qState, grossSalary: Number(qGross) || 0,
        periodMonth: `2026-${String(mi).padStart(2, '0')}-01`, gender: 'ALL',
      })
      const g = Number(qGross) || 0
      const row = slabs.find(s => s.state === qState && g >= Number(s.slab_min)
        && (s.slab_max == null || g <= Number(s.slab_max))) || null
      setQRes({ amount: r?.pt_amount ?? null, found: !!r?.rate_found, row })
    } catch (e: any) {
      setQErr(/could not find the function/i.test(e?.message || '')
        ? 'get_pt_amount() is not in this database yet — run sql108, then sql109.'
        : (e?.message || String(e)))
    } finally { setQBusy(false) }
  }

  const card: React.CSSProperties = {
    background: C.card, borderRadius: 14, padding: '18px 20px', marginBottom: 16,
    border: `1px solid ${C.border}`, boxShadow: '0 1px 4px rgba(124,58,237,0.06)',
  }
  const th: React.CSSProperties = {
    background: C.navy, color: '#A5B4FC', padding: '7px 6px', textAlign: 'right',
    fontSize: 9, textTransform: 'uppercase', position: 'sticky', top: 0, whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    padding: 6, textAlign: 'right', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
  }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}>⚖️</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Professional Tax Configuration</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
            {loading ? 'Loading…' : `${states.length} states, ${slabs.length} slabs — exactly what the payroll run reads`}
          </div>
        </div>
        <button onClick={() => setModal({ open: true, preset: null })}
          style={{ padding: '10px 16px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', boxShadow: '0 3px 10px rgba(124,58,237,0.22)', whiteSpace: 'nowrap' }}>
          + Add / revise slab
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>{error}</div>}

      {/* ── Quick check ─────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>Quick check</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 14 }}>
          Pick a state, month and gross to see exactly which row payroll will use — same function the run calls.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr)) auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>State</label>
            <SearchSelect value={qState} options={states} placeholder="Select state"
              onChange={v => { setQState(v); setQRes(null) }} />
          </div>
          <div>
            <label style={labelStyle}>Month</label>
            <select style={inputStyle} value={qMonth} onChange={e => { setQMonth(e.target.value); setQRes(null) }}>
              {MONTH_KEYS.map((m, i) => <option key={m} value={m}>{MONTH_LABELS[i]}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Gross Salary</label>
            <input style={inputStyle} type="number" value={qGross} placeholder="e.g. 22000"
              onChange={e => { setQGross(e.target.value); setQRes(null) }} />
          </div>
          <button onClick={runCheck} disabled={qBusy || !qState || qGross.trim() === ''}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', fontFamily: font, fontSize: 12.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', background: (!qState || qGross.trim() === '') ? '#D8D3F5' : C.purple, cursor: (!qState || qGross.trim() === '') ? 'not-allowed' : 'pointer' }}>
            {qBusy ? 'Checking…' : 'Check PT'}
          </button>
        </div>

        {qErr && <div style={{ marginTop: 12, fontSize: 12, color: C.red, background: C.redBg, border: '1px solid #FECACA', borderRadius: 9, padding: '10px 12px' }}>{qErr}</div>}

        {qRes && (
          <div style={{
            marginTop: 14, borderRadius: 10, padding: '14px 16px',
            background: qRes.found ? '#ECFDF5' : C.amberBg,
            border: `1px solid ${qRes.found ? '#A7F3D0' : '#FDE8C8'}`,
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: qRes.found ? C.green : C.amber }}>
              {qRes.found ? `₹${Number(qRes.amount ?? 0).toLocaleString('en-IN')}` : 'Not configured'}
            </div>
            <div style={{ fontSize: 11.5, color: qRes.found ? '#047857' : '#92400E', marginTop: 3 }}>
              {!qRes.found
                ? `${qState} has no slab covering ₹${Number(qGross).toLocaleString('en-IN')} — payroll deducts nothing and flags it.`
                : Number(qRes.amount) === 0
                  ? (noPt.has(qState)
                    ? `${qState} does not levy Professional Tax at all.`
                    : `${qState} levies PT, but nothing is due in ${MONTH_LABELS[MONTH_KEYS.indexOf(qMonth as any)]} for this slab.`)
                  : `${qRes.row ? slabLabel(qRes.row) : 'slab'} · ${MONTH_LABELS[MONTH_KEYS.indexOf(qMonth as any)]}`}
            </div>
            {qRes.row?.notification_reference && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 5 }}>{qRes.row.notification_reference}</div>
            )}
          </div>
        )}
      </div>

      {/* ── Full grid ───────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>Full configuration table</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 14 }}>
          Every state, slab and month-wise amount. A <b>no PT</b> badge means the state levies none at all —
          that row exists on purpose, so a state with no tax can be told apart from a state nobody configured.
        </div>
        {loading ? (
          <div style={{ fontSize: 12, color: C.purple, padding: 8 }}>Loading…</div>
        ) : (
          <div style={{ maxHeight: 520, overflow: 'auto', borderRadius: 10, border: `1px solid ${C.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>State</th>
                  <th style={th}>Min Salary</th>
                  <th style={th}>Max Salary</th>
                  <th style={{ ...th, textAlign: 'left' }}>Gender</th>
                  {MONTH_LABELS.map(m => <th key={m} style={th}>{m}</th>)}
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {slabs.map((r, i) => {
                  const hit = !!qRes?.row && qRes.row.id === r.id
                  return (
                    <tr key={r.id} style={{
                      background: hit ? C.amberBg : i % 2 ? '#FBFAFF' : 'transparent',
                      outline: hit ? `2px solid ${C.amber}` : 'none',
                    }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: C.navy }}>
                        {r.state}
                        {noPt.has(r.state) && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#ECFDF5', color: C.green }}>no PT</span>}
                      </td>
                      <td style={td}>{Number(r.slab_min).toLocaleString('en-IN')}</td>
                      <td style={td}>{r.slab_max == null ? '—' : Number(r.slab_max).toLocaleString('en-IN')}</td>
                      <td style={{ ...td, textAlign: 'left', color: r.gender === 'ALL' ? C.muted : C.amber, fontWeight: r.gender === 'ALL' ? 400 : 700 }}>{r.gender}</td>
                      {MONTH_KEYS.map(m => {
                        const v = Number((r as any)[m]) || 0
                        return <td key={m} style={{ ...td, color: v === 0 ? '#C7C2E8' : C.navy, fontWeight: v > 0 ? 600 : 400 }}>{v}</td>
                      })}
                      <td style={{ ...td, textAlign: 'center' }}>
                        <button onClick={() => setModal({ open: true, preset: r })} title="Revise this slab"
                          style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff', color: C.purpleD, cursor: 'pointer' }}>Revise</button>
                      </td>
                    </tr>
                  )
                })}
                {!loading && slabs.length === 0 && (
                  <tr><td colSpan={17} style={{ padding: 26, textAlign: 'center', color: C.muted }}>
                    No PT slabs configured yet. Click <b>+ Add / revise slab</b> to add the first one.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ fontSize: 10.5, color: C.purpleD, background: C.purpleBg, borderRadius: 9, padding: '11px 13px', lineHeight: 1.6 }}>
        <b>This table is payroll&apos;s only source.</b> Run Payroll reads every employee&apos;s PT from here — by their
        <b> state</b>, that month&apos;s <b>column</b> and their <b>gross</b>. No rate is written anywhere in the app,
        so a rate changed here applies to the next run on its own.
        <br />PT is a <b>fixed monthly</b> amount — taking leave does not reduce it. Revising does not delete the
        old row, it closes it; so re-running an earlier month still applies the rate that was in force then.
      </div>

      {modal.open && <ReviseModal preset={modal.preset} onClose={() => setModal({ open: false })} onSaved={() => { setModal({ open: false }); load() }} />}
    </div>
  )
}
