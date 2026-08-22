'use client'
// app/dashboard/flexi-policy/page.tsx — Flexi Policy Config Builder (Admin)
// Build the FBP policy slab-by-slab. Old + New regime as TWO columns, saved together.
// Per component: Old Y/N + amount, New Y/N + amount, children/perquisite.
// Perquisite entered MONTHLY (stored monthly + annual x12). LTA = 8.33% formula.
// Writes flexi_policy_slabs + flexi_slab_limits (migration 043). Sub-components OUTSIDE parent.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleDark: TK.brandDeep,
  card: TK.surface, border: TK.line, muted: TK.muted, red: '#A32D2D',
  teal: '#0F6E56', tealBg: '#E1F5EE', purpleBg: TK.canvas,
}
const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')

interface Comp { code: string; name: string; formula?: boolean; perq?: boolean; kids?: boolean; oldOk: boolean; newOk: boolean }
// oldOk/newOk = whether the component CAN be offered in that regime (policy default)
const COMPONENTS: Comp[] = [
  { code: 'PDA', name: 'Prof. dev. allowance', oldOk: true, newOk: false },
  { code: 'TEL', name: 'Telephone / WiFi', oldOk: true, newOk: true },
  { code: 'DEVICE', name: 'Device leasing', oldOk: true, newOk: true },
  { code: 'LTA', name: 'LTA', formula: true, oldOk: true, newOk: false },
  { code: 'CAR', name: 'Car lease', perq: true, oldOk: true, newOk: true },
  { code: 'DRIVER', name: 'Driver allowance', perq: true, oldOk: true, newOk: true },
  { code: 'FUEL', name: 'Fuel', oldOk: true, newOk: true },
  { code: 'MEAL', name: 'Meal (Zaggle)', oldOk: true, newOk: true },
  { code: 'ATTIRE', name: 'Corporate attire', oldOk: true, newOk: false },
  { code: 'CHEDU', name: 'Children education', kids: true, oldOk: true, newOk: false },
  { code: 'HOSTEL', name: 'Hostel allowance', kids: true, oldOk: true, newOk: false },
]

interface RowState { oldOn: boolean; oldAmt: string; newOn: boolean; newAmt: string; kids: string; perqMo: string }
const blankRows = () => Object.fromEntries(
  COMPONENTS.map(c => [c.code, { oldOn: false, oldAmt: '', newOn: false, newAmt: '', kids: '1', perqMo: '' }])
) as Record<string, RowState>

// ── Sub-components OUTSIDE parent (focus-loss rule) ──
function RegimeCell({ c, reg, rs, onToggle, onAmt }: {
  c: Comp; reg: 'old' | 'new'; rs: RowState; onToggle: () => void; onAmt: (v: string) => void
}) {
  const ok = reg === 'old' ? c.oldOk : c.newOk
  const on = reg === 'old' ? rs.oldOn : rs.newOn
  const amt = reg === 'old' ? rs.oldAmt : rs.newAmt
  const color = reg === 'old' ? C.purple : C.teal
  const dark = reg === 'old' ? C.purpleDark : C.teal
  const bg = reg === 'old' ? C.purpleBg : C.tealBg
  if (!ok) return <div style={{ width: 120, textAlign: 'center', fontSize: 11, color: C.muted }}>n/a</div>
  return (
    <div style={{ width: 120, display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
      <button onClick={onToggle} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit', border: `1px solid ${on ? color : C.border}`, background: on ? bg : 'transparent', color: on ? dark : C.muted }}>{on ? 'Y' : 'N'}</button>
      {c.formula
        ? <span style={{ width: 66, fontSize: 10, color: C.muted }}>{on ? '8.33%' : '—'}</span>
        : <input type="number" min={0} step={1000} placeholder="amt" disabled={!on} value={amt} onChange={e => onAmt(e.target.value)} style={{ width: 66, padding: 5, borderRadius: 6, border: `1px solid ${C.border}`, opacity: on ? 1 : 0.35, fontFamily: 'inherit', boxSizing: 'border-box' }} />}
    </div>
  )
}

function ComponentRow({ c, rs, onToggle, onField }: {
  c: Comp; rs: RowState; onToggle: (reg: 'old' | 'new') => void; onField: (field: keyof RowState, val: string) => void
}) {
  const anyOn = rs.oldOn || rs.newOn
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
      <span style={{ flex: 1, fontSize: 12, color: C.navy }}>{c.name}</span>
      <RegimeCell c={c} reg="old" rs={rs} onToggle={() => onToggle('old')} onAmt={v => onField('oldAmt', v)} />
      <RegimeCell c={c} reg="new" rs={rs} onToggle={() => onToggle('new')} onAmt={v => onField('newAmt', v)} />
      {c.kids ? (
        <select value={rs.kids} onChange={e => onField('kids', e.target.value)} style={{ width: 76, padding: 5, borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: 'inherit' }}>
          <option value="1">1 kid</option><option value="2">2 kids</option>
        </select>
      ) : c.perq ? (
        <input type="number" min={0} step={500} placeholder="perq/mo" disabled={!anyOn} value={rs.perqMo} onChange={e => onField('perqMo', e.target.value)} style={{ width: 76, padding: 5, borderRadius: 6, border: `1px solid ${C.border}`, opacity: anyOn ? 1 : 0.35, fontFamily: 'inherit', boxSizing: 'border-box' }} />
      ) : <span style={{ width: 76 }} />}
    </div>
  )
}

export default function FlexiConfigBuilder() {
  const [companies, setCompanies] = useState<any[]>([])
  const [companyId, setCompanyId] = useState('')
  const [smin, setSmin] = useState('0')
  const [smax, setSmax] = useState('500000')
  const [rows, setRows] = useState<Record<string, RowState>>(blankRows)
  const [slabs, setSlabs] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
      .then(({ data }) => { setCompanies(data || []); if (data && data.length && !companyId) setCompanyId(data[0].id) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadSlabs = useCallback(async () => {
    // No company selected = "All Companies" → list slabs across every company.
    let q = supabase.from('flexi_policy_slabs').select('*').order('company_id').order('sort_order')
    if (companyId) q = q.eq('company_id', companyId)
    const { data } = await q
    setSlabs(data ?? [])
  }, [companyId])
  const companyName = (id: string) => companies.find(c => c.id === id)?.company_name || '—'
  useEffect(() => { loadSlabs() }, [loadSlabs])

  const toggle = (code: string, reg: 'old' | 'new') =>
    setRows(r => ({ ...r, [code]: { ...r[code], [reg === 'old' ? 'oldOn' : 'newOn']: !r[code][reg === 'old' ? 'oldOn' : 'newOn'] } }))
  const setField = (code: string, field: keyof RowState, val: string) => {
    if ((field === 'oldAmt' || field === 'newAmt' || field === 'perqMo') && +val < 0) val = '0'
    setRows(r => ({ ...r, [code]: { ...r[code], [field]: val } }))
  }

  // Build the flexi_slab_limits rows for a given saved slab id from the current form.
  function buildLimitRows(slabId: string, idByCode: Record<string, string>) {
    const limitRows: any[] = []
    for (const c of COMPONENTS) {
      const rs = rows[c.code]
      if (!rs.oldOn && !rs.newOn) continue
      if (!idByCode[c.code]) continue   // skip any component missing in the DB master
      const oldVal = rs.oldOn ? (c.formula ? -1 : (+rs.oldAmt || 0)) : null
      const newVal = rs.newOn ? (c.formula ? -1 : (+rs.newAmt || 0)) : null
      const perqAnnual = c.perq && (rs.oldOn || rs.newOn) ? (+rs.perqMo || 0) * 12 : null
      limitRows.push({
        slab_id: slabId, component_id: idByCode[c.code],
        old_regime_max: oldVal, new_regime_max: newVal,
        is_formula: !!c.formula, formula_expr: c.formula ? '0.0833 * basic_annual' : null,
        perquisite_value: perqAnnual, perquisite_monthly: c.perq ? (+rs.perqMo || 0) : null,
        children_count: c.kids ? (+rs.kids || 1) : null, is_active: true,
      })
    }
    return limitRows
  }

  async function saveSlab() {
    setErr(''); setMsg('')
    const mn = +smin, mx = +smax
    if (!Number.isFinite(mn) || !Number.isFinite(mx)) { setErr('Enter valid min and max salary amounts.'); return }
    if (mx <= mn) { setErr('Max salary must be greater than min.'); return }

    // Company selected → save for that company. "All Companies" → save the same slab for every company.
    const targets = companyId ? [companyId] : companies.map(c => c.id)
    if (!targets.length) { setErr('No companies available to save to.'); return }

    setSaving(true)
    try {
      const { data: comps, error: ce } = await supabase.from('flexi_components').select('id, code')
      if (ce) { setErr(`Failed to read component master: ${ce.message}`); setSaving(false); return }
      const idByCode: Record<string, string> = {}
      ;(comps ?? []).forEach((c: any) => { idByCode[c.code] = c.id })

      let saved = 0
      const errors: string[] = []
      for (const cid of targets) {
        // Per-company existing slabs → sort order + no-overlap check.
        const { data: ex } = await supabase.from('flexi_policy_slabs').select('fixed_to, sort_order').eq('company_id', cid).order('sort_order')
        const existing = ex ?? []
        const lastMax = existing.length ? existing[existing.length - 1].fixed_to : -1
        if (existing.length && mn <= lastMax) { errors.push(`${companyName(cid)}: min must be > ${inr(lastMax)}`); continue }
        const sortOrder = existing.length + 1

        const { data: slab, error: se } = await supabase.from('flexi_policy_slabs').insert({
          company_id: cid, slab_label: `${inr(mn)}–${inr(mx)}`, fixed_from: mn, fixed_to: mx, sort_order: sortOrder, is_active: true,
        }).select().single()
        if (se || !slab) { errors.push(`${companyName(cid)}: ${se?.message || 'insert failed'}`); continue }

        const limitRows = buildLimitRows(slab.id, idByCode)
        if (limitRows.length) {
          const { error: le } = await supabase.from('flexi_slab_limits').insert(limitRows)
          if (le) { errors.push(`${companyName(cid)}: components — ${le.message}`); continue }
        }
        saved++
      }

      if (saved > 0) {
        const scope = companyId ? companyName(companyId) : `${saved} companies`
        setMsg(`✓ Slab (${inr(mn)}–${inr(mx)}) saved for ${scope}${errors.length ? ` · ${errors.length} skipped` : ''}.`)
        setSmin(String(mx + 1)); setSmax(String(mx + 500000)); setRows(blankRows()); loadSlabs()
        if (errors.length) setErr(`Skipped — ${errors.join(' · ')}`)
      } else {
        setErr(errors.length ? errors.join(' · ') : 'Nothing was saved.')
      }
    } catch (e: any) {
      setErr(`Unexpected error: ${e?.message || 'save failed'}`)
    }
    setSaving(false)
  }

  async function deleteSlab(id: string) {
    await supabase.from('flexi_policy_slabs').delete().eq('id', id)
    loadSlabs()
  }

  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }

  return (
    <div style={{ padding: 24, fontFamily: '"DM Sans","Segoe UI",sans-serif', maxWidth: 820, margin: '0 auto', background: C.bg, minHeight: '100vh' }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: C.navy, marginBottom: 4 }}>Flexi policy — slab builder (Old + New together)</div>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 16 }}>Build the FBP policy slab-by-slab per company. Each slab covers a salary range and both regimes; saved in one action.</div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ background: TK.brandTint, color: C.purpleDark, fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 500 }}>{companyId ? `Slab ${slabs.length + 1}` : 'New slab'}</span>
          <span style={{ fontSize: 11, color: C.muted }}>Annual Fixed = CTC − Variable</span>
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={{ marginLeft: 'auto', padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: 'inherit', background: TK.surface, color: C.navy }}>
            <option value="">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Min salary ₹</label>
            <input type="number" value={smin} min={0} step={10000} onChange={e => setSmin(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Max salary ₹</label>
            <input type="number" value={smax} min={0} step={10000} onChange={e => setSmax(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>
        </div>
        {err && <div style={{ fontSize: 12.5, color: TK.critical, background: TK.criticalTint, border: '1px solid #FCA5A5', borderRadius: 8, padding: '9px 12px', marginBottom: 10 }}>⚠ {err}</div>}
        {msg && <div style={{ fontSize: 12.5, color: C.teal, background: C.tealBg, border: '1px solid #A7E3CE', borderRadius: 8, padding: '9px 12px', marginBottom: 10 }}>{msg}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
          <span style={{ flex: 1, fontSize: 11, color: C.muted, letterSpacing: 0.5 }}>COMPONENT</span>
          <span style={{ width: 120, textAlign: 'center', fontSize: 11, color: C.purpleDark, fontWeight: 500 }}>OLD regime</span>
          <span style={{ width: 120, textAlign: 'center', fontSize: 11, color: C.teal, fontWeight: 500 }}>NEW regime</span>
          <span style={{ width: 76, textAlign: 'center', fontSize: 11, color: C.muted }}>EXTRA</span>
        </div>

        {COMPONENTS.map(c => (
          <ComponentRow key={c.code} c={c} rs={rows[c.code]} onToggle={reg => toggle(c.code, reg)} onField={(f, v) => setField(c.code, f, v)} />
        ))}

        <button onClick={saveSlab} disabled={saving || companies.length === 0} style={{ width: '100%', marginTop: 12, padding: 12, borderRadius: 8, fontWeight: 500, fontFamily: 'inherit', border: `1px solid ${C.purple}`, background: saving ? '#C4B5FD' : C.purple, color: TK.onAccent, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving…' : companyId ? 'Save slab (Old + New together) & create next' : `Save slab for all ${companies.length} companies`}
        </button>
        {!companyId && <div style={{ fontSize: 11, color: C.muted, marginTop: 8, textAlign: 'center' }}>This slab range + components will be added to every company at once.</div>}
      </div>

      {slabs.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.navy, marginBottom: 8 }}>Saved slabs ({slabs.length}){!companyId && ' · all companies'}</div>
          {slabs.map(s => (
            <div key={s.id} style={{ background: TK.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.purpleDark }}>
                {!companyId && <span style={{ background: TK.brandTint, color: C.purpleDark, fontSize: 11, padding: '2px 8px', borderRadius: 20, marginRight: 8, fontWeight: 500 }}>{companyName(s.company_id)}</span>}
                Slab {s.sort_order} · {inr(s.fixed_from)} – {inr(s.fixed_to)}
              </span>
              <button onClick={() => deleteSlab(s.id)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.red}`, background: TK.surface, color: C.red, cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
