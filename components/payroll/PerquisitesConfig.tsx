// ================================================================
// EZER HRMS — Payroll Configuration: Perquisites
// Path: app/dashboard/payroll/config/perquisites/page.tsx
//
// "+ Add new perquisite" writes a plain row to perquisite_types — no
// migration needed when the law adds a new one. valuation_method
// picks which input shape the Configure panel renders: flat amount,
// percent, a slab table, or just notes (FMV/manual types are
// calculated elsewhere, not from a stored rate).
// ================================================================
'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  getPerquisiteConfig, getSlabsForValue, addPerquisiteType, savePerquisiteValue, saveSlab, deleteSlab, togglePerquisiteActive,
} from '@/lib/perquisites/actions'
import { VALUATION_METHOD_LABELS } from '@/lib/perquisites/types'
import type { PerquisiteConfigRow, PerquisiteSlab, ValuationMethod, PerquisiteUnit } from '@/lib/perquisites/types'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep,
  card: TK.surface, border: TK.line, muted: TK.muted,
  green: TK.positive, greenBg: TK.positiveTint, greenBd: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint,
  purpleBg: TK.brandTint, gray: TK.sunken,
}

const METHOD_COLOR: Record<ValuationMethod, string> = {
  FLAT_AMOUNT: C.purple, PERCENT_OF_SALARY: TK.positive, PERCENT_OF_COST: TK.positive,
  SLAB_BASED: C.amber, FMV_BASED: TK.info, MANUAL: C.muted,
}

const CATEGORY_ICON: Record<string, string> = {
  Accommodation: '', Conveyance: '', Financial: '', Medical: '', Staff: '',
  Meals: '', Assets: '', Utilities: '', Education: '', Retirement: '', Other: '',
}
const catIcon = (cat: string) => CATEGORY_ICON[cat] || ''

const UNITS: PerquisiteUnit[] = ['PER_MONTH', 'PER_YEAR', 'PER_MEAL', 'PER_TRANSACTION', 'LUMP_SUM']

function formatValue(row: PerquisiteConfigRow): string {
  if (row.valuation_method === 'SLAB_BASED') return `${row.slab_count} slab${row.slab_count !== 1 ? 's' : ''}`
  if (row.default_amount != null) return `₹${row.default_amount.toLocaleString('en-IN')}${row.unit ? ' ' + row.unit.replace('PER_', '/').toLowerCase() : ''}`
  if (row.default_percent != null) return `${row.default_percent}%`
  if (row.exemption_limit != null) return `Exempt up to ₹${row.exemption_limit.toLocaleString('en-IN')}`
  return 'Not configured'
}

// ── Sub-components — kept OUTSIDE the main component ──────────────

function MethodBadge({ method }: { method: ValuationMethod }) {
  return (
    <span style={{ fontSize: 8.5, padding: '2px 8px', borderRadius: 999, background: `${METHOD_COLOR[method]}16`, color: METHOD_COLOR[method], fontWeight: 700, letterSpacing: '.02em', whiteSpace: 'nowrap' }}>
      {VALUATION_METHOD_LABELS[method]}
    </span>
  )
}

function PerquisiteRow({ row, selected, onSelect }: { row: PerquisiteConfigRow; selected: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = C.gray }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = C.card }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, cursor: 'pointer', marginBottom: 5,
        background: selected ? C.purpleBg : C.card, border: `1px solid ${selected ? C.purple : C.border}`,
        boxShadow: selected ? '0 2px 10px rgba(37,99,235,0.14)' : 'none', transition: 'background .12s',
      }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: selected ? '#fff' : C.gray, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{catIcon(row.category)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: selected ? C.purpleD : C.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
          <span title={row.type_active ? 'Active' : 'Inactive'} style={{ width: 6, height: 6, borderRadius: 99, background: row.type_active ? C.green: TK.line, flexShrink: 0 }} />
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatValue(row)}</div>
      </div>
      <MethodBadge method={row.valuation_method} />
    </div>
  )
}

function CategorySection({ category, rows, selectedId, onSelect }: {
  category: string; rows: PerquisiteConfigRow[]; selectedId: string | null; onSelect: (id: string) => void
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>
        <span style={{ fontSize: 12 }}>{catIcon(category)}</span>{category}
        <span style={{ fontSize: 9, fontWeight: 700, color: C.muted, background: C.gray, borderRadius: 99, padding: '1px 7px' }}>{rows.length}</span>
      </div>
      {rows.map(r => <PerquisiteRow key={r.perquisite_type_id} row={r} selected={selectedId === r.perquisite_type_id} onSelect={() => onSelect(r.perquisite_type_id)} />)}
    </div>
  )
}

function AddTypeModal({ onClose, onCreate }: { onClose: () => void; onCreate: (args: any) => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [method, setMethod] = useState<ValuationMethod>('FLAT_AMOUNT')
  const [lawRef, setLawRef] = useState('')

  const valid = code.trim() && name.trim() && category.trim()
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `1px solid ${TK.brandEdge}`, borderRadius: 7, fontSize: 12, boxSizing: 'border-box', marginBottom: 10 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: TK.surface, borderRadius: 14, padding: 22, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 14 }}>Add new perquisite</div>

        <label style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Code *</label>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))} placeholder="e.g. CRECHE_FACILITY" style={inputStyle} />

        <label style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Crèche facility" style={inputStyle} />

        <label style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Category *</label>
        <input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Other" style={inputStyle} />

        <label style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, height: 50, resize: 'none' }} />

        <label style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>How is this valued? *</label>
        <select value={method} onChange={e => setMethod(e.target.value as ValuationMethod)} style={inputStyle}>
          {Object.entries(VALUATION_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <label style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Law reference <span style={{ fontWeight: 400 }}>(optional)</span></label>
        <input value={lawRef} onChange={e => setLawRef(e.target.value)} placeholder="e.g. Section 17(1); Rule 15" style={inputStyle} />

        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button disabled={!valid} onClick={() => onCreate({ code, name, category, description, valuationMethod: method, lawReference: lawRef })}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: C.purple, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: valid ? 1 : 0.5 }}>
            Create
          </button>
          <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 8, border: `1px solid ${C.border}`, background: TK.surface, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function SlabRow({ slab, onChange, onDelete }: { slab: Partial<PerquisiteSlab> & { _key: string }; onChange: (patch: Partial<PerquisiteSlab>) => void; onDelete: () => void }) {
  const cellStyle: React.CSSProperties = { padding: '6px 8px', border: `1px solid ${TK.brandEdge}`, borderRadius: 6, fontSize: 12, width: '100%', boxSizing: 'border-box' }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 30px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
      <input value={slab.slab_label ?? ''} onChange={e => onChange({ slab_label: e.target.value })} placeholder="Slab label" style={cellStyle} />
      <input type="number" value={slab.rate_amount ?? ''} onChange={e => onChange({ rate_amount: e.target.value ? Number(e.target.value) : null })} placeholder="₹ amount" style={cellStyle} />
      <input type="number" value={slab.rate_percent ?? ''} onChange={e => onChange({ rate_percent: e.target.value ? Number(e.target.value) : null })} placeholder="% rate" style={cellStyle} />
      <button onClick={onDelete} style={{ background: 'none', border: 'none', color: TK.critical, cursor: 'pointer', fontSize: 16 }}>×</button>
    </div>
  )
}

// ── Main component (rendered inside Payroll → Configuration → Perquisite) ──
export default function PerquisitesConfig({ fy = '2026-27' }: { fy?: string }) {
  const FY = fy
  const [rows, setRows] = useState<PerquisiteConfigRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [slabs, setSlabs] = useState<(Partial<PerquisiteSlab> & { _key: string })[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  // Configure-panel form state
  const [amount, setAmount] = useState<string>('')
  const [percent, setPercent] = useState<string>('')
  const [unit, setUnit] = useState<PerquisiteUnit | ''>('')
  const [exemptionLimit, setExemptionLimit] = useState<string>('')
  const [isTaxable, setIsTaxable] = useState(true)
  const [notes, setNotes] = useState('')

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000) }

  const load = useCallback(async () => {
    const data = await getPerquisiteConfig(FY)
    setRows(data)
  }, [])

  useEffect(() => { load() }, [load])

  const selected = rows.find(r => r.perquisite_type_id === selectedId) ?? null

  useEffect(() => {
    if (!selected) return
    setAmount(selected.default_amount?.toString() ?? '')
    setPercent(selected.default_percent?.toString() ?? '')
    setUnit(selected.unit ?? '')
    setExemptionLimit(selected.exemption_limit?.toString() ?? '')
    setIsTaxable(selected.is_taxable ?? true)
    setNotes(selected.notes ?? '')
    if (selected.valuation_method === 'SLAB_BASED' && selected.perquisite_value_id) {
      getSlabsForValue(selected.perquisite_value_id).then(s => setSlabs(s.map(x => ({ ...x, _key: x.id }))))
    } else {
      setSlabs([])
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateType(args: any) {
    try {
      await addPerquisiteType(args)
      setShowAddModal(false)
      notify(`"${args.name}" added — configure its value below.`)
      load()
    } catch (err: any) {
      notify('Could not create: ' + err.message)
    }
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    try {
      const value = await savePerquisiteValue({
        perquisiteTypeId: selected.perquisite_type_id, fy: FY,
        defaultAmount: amount ? Number(amount) : null,
        defaultPercent: percent ? Number(percent) : null,
        unit: unit || null, exemptionLimit: exemptionLimit ? Number(exemptionLimit) : null,
        isTaxable, notes,
      })

      if (selected.valuation_method === 'SLAB_BASED') {
        for (let i = 0; i < slabs.length; i++) {
          const s = slabs[i]
          if (s.slab_label) {
            await saveSlab({
              perquisiteValueId: (value as any).id, slabLabel: s.slab_label,
              rateAmount: s.rate_amount, ratePercent: s.rate_percent, sortOrder: i,
            })
          }
        }
      }

      notify('Saved.')
      load()
    } catch (err: any) {
      notify('Could not save: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  function addSlabRow() {
    setSlabs(prev => [...prev, { _key: `new-${Date.now()}`, slab_label: '', rate_amount: null, rate_percent: null }])
  }

  const grouped: Record<string, PerquisiteConfigRow[]> = {}
  for (const r of rows) { (grouped[r.category] ??= []).push(r) }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `1px solid ${TK.brandEdge}`, borderRadius: 7, fontSize: 12, boxSizing: 'border-box' }

  return (
    <div style={{ display: 'flex', gap: 20, fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13, flexWrap: 'wrap' }}>

      {/* ── List ── */}
      <div style={{ width: 300, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${TK.brand},${TK.brand})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}></div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Perquisites</div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
              <span style={{ fontWeight: 700, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '1px 7px' }}>FY {FY}</span>
              <span> · {rows.length} types</span>
            </div>
          </div>
        </div>
        <button onClick={() => setShowAddModal(true)}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.08)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.filter = 'none'}
          style={{ width: '100%', padding: '10px', borderRadius: 10, border: 'none', background: `linear-gradient(120deg,${TK.brand},${TK.brand})`, color: TK.onAccent, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', marginBottom: 16, boxShadow: '0 3px 10px rgba(37,99,235,0.22)', transition: 'filter .12s' }}>
          + Add new perquisite
        </button>
        {Object.entries(grouped).map(([cat, catRows]) => (
          <CategorySection key={cat} category={cat} rows={catRows} selectedId={selectedId} onSelect={setSelectedId} />
        ))}
      </div>

      {/* ── Configure panel ── */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 560 }}>
        {!selected ? (
          <div style={{ color: C.muted }}>Select a perquisite on the left to configure its FY {FY} value, or add a new one.</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
              <div style={{ width: 46, height: 46, borderRadius: 12, background: C.purpleBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0, border: `1px solid ${C.border}` }}>{catIcon(selected.category)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.15 }}>{selected.name}</div>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '2px 9px', textTransform: 'uppercase', letterSpacing: '.04em' }}>{selected.category}</span>
                  <MethodBadge method={selected.valuation_method} />
                  {selected.law_reference && <span style={{ fontSize: 10, color: C.muted }}>{selected.law_reference}</span>}
                </div>
              </div>
            </div>
            {selected.description && <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.45 }}>{selected.description}</div>}

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px', boxShadow: '0 1px 6px rgba(37,99,235,0.07)' }}>
              <div style={{ height: 3, borderRadius: 99, background: `linear-gradient(90deg,${TK.brand},${TK.brand})`, width: 44, marginBottom: 12 }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: 'uppercase', marginBottom: 10 }}>Value for FY {FY}</div>

              {(selected.valuation_method === 'FLAT_AMOUNT') && (
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Amount (₹)</div>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Unit</div>
                    <select value={unit} onChange={e => setUnit(e.target.value as PerquisiteUnit)} style={inputStyle}>
                      <option value="">—</option>
                      {UNITS.map(u => <option key={u} value={u}>{u.replace('PER_', '/').toLowerCase()}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {(selected.valuation_method === 'PERCENT_OF_SALARY' || selected.valuation_method === 'PERCENT_OF_COST') && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Percent (%)</div>
                  <input type="number" value={percent} onChange={e => setPercent(e.target.value)} style={inputStyle} />
                </div>
              )}

              {selected.valuation_method === 'SLAB_BASED' && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 6 }}>Slabs</div>
                  {slabs.map((s, i) => (
                    <SlabRow key={s._key} slab={s}
                      onChange={patch => setSlabs(prev => prev.map((x, idx) => idx === i ? { ...x, ...patch } : x))}
                      onDelete={() => setSlabs(prev => prev.filter((_, idx) => idx !== i))} />
                  ))}
                  <button onClick={addSlabRow} style={{ padding: '5px 10px', fontSize: 11, borderRadius: 6, border: `1px solid ${C.border}`, background: TK.surface, color: C.purpleD, cursor: 'pointer' }}>+ Add slab</button>
                </div>
              )}

              {(selected.valuation_method === 'FMV_BASED' || selected.valuation_method === 'MANUAL') && (
                <div style={{ fontSize: 11, color: C.muted, background: C.gray, padding: '8px 10px', borderRadius: 7, marginBottom: 10 }}>
                  {selected.valuation_method === 'FMV_BASED'
                    ? 'Calculated per transaction (FMV at exercise minus exercise price) — no stored rate. Exemption limit and notes below still apply if relevant.'
                    : 'Case-by-case — no single rate to store. Use notes below for guidance shown to payroll processors.'}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Exemption limit (₹, optional)</div>
                  <input type="number" value={exemptionLimit} onChange={e => setExemptionLimit(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Taxable?</div>
                  <select value={isTaxable ? 'yes' : 'no'} onChange={e => setIsTaxable(e.target.value === 'yes')} style={inputStyle}>
                    <option value="yes">Taxable</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Notes</div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, height: 50, resize: 'none' }} />
              </div>

              <button onClick={handleSave} disabled={saving}
                onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.08)' }}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.filter = 'none'}
                style={{ padding: '10px 22px', borderRadius: 9, border: 'none', background: `linear-gradient(120deg,${TK.brand},${TK.brand})`, color: TK.onAccent, fontWeight: 700, fontSize: 12.5, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, boxShadow: '0 3px 10px rgba(37,99,235,0.22)', transition: 'filter .12s' }}>
                {saving ? 'Saving…' : 'Save value'}
              </button>
            </div>
          </>
        )}
      </div>

      {showAddModal && <AddTypeModal onClose={() => setShowAddModal(false)} onCreate={handleCreateType} />}

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: C.navy, color: TK.onAccent, padding: '10px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, zIndex: 999, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
