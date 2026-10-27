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
import {
  C, F, W, S, R, numeric, type IconProps,
  IconHome, IconTravel, IconFinance, IconHeart, IconEmployees, IconReceipt, IconMobile, IconSliders,
  IconAward, IconLoans, IconDot, IconPlus, IconClose, IconCalendar,
} from '@/lib/ui'
import { SectionCard, StatusPill, CountChip, EmptyState, PButton, InfoCallout, IconTile, IconInfo, type KitTone } from '@/components/payroll/kit'
import { RefChip, CField, Modal, Toast, cfgInput, cfgTextarea } from '@/components/payroll/configKit'

const METHOD_TONE: Record<ValuationMethod, KitTone> = {
  FLAT_AMOUNT: 'brand', PERCENT_OF_SALARY: 'positive', PERCENT_OF_COST: 'positive',
  SLAB_BASED: 'warning', FMV_BASED: 'info', MANUAL: 'neutral',
}

// One glyph per perquisite category, from the product's own icon set.
const CATEGORY_ICON: Record<string, (p: IconProps) => React.ReactElement> = {
  Accommodation: IconHome, Conveyance: IconTravel, Financial: IconFinance, Medical: IconHeart, Staff: IconEmployees,
  Meals: IconReceipt, Assets: IconMobile, Utilities: IconSliders, Education: IconAward, Retirement: IconLoans, Other: IconDot,
}
const catIcon = (cat: string, size = 15) => { const I = CATEGORY_ICON[cat] || IconDot; return <I size={size} /> }

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
  return <StatusPill t={METHOD_TONE[method]} size="sm">{VALUATION_METHOD_LABELS[method]}</StatusPill>
}

function PerquisiteRow({ row, selected, onSelect }: { row: PerquisiteConfigRow; selected: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect} role="button" tabIndex={0} aria-pressed={selected}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={selected ? undefined : 'ez-row'}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: R.md, cursor: 'pointer', marginBottom: 4,
        background: selected ? C.brandTint : C.surface, border: `1px solid ${selected ? C.brandEdge : 'transparent'}`,
        boxShadow: selected ? `inset 3px 0 0 ${C.brand}` : 'none',
      }}>
      <IconTile icon={catIcon(row.category)} t={selected ? 'brand' : 'neutral'} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: F.small, fontWeight: W.semi, color: selected ? C.brandDeep : C.ink, lineHeight: 1.35 }}>{row.name}</span>
          <span title={row.type_active ? 'Active' : 'Inactive'} style={{ width: 7, height: 7, borderRadius: 99, background: row.type_active ? C.positive : C.lineStrong, flexShrink: 0 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
          <MethodBadge method={row.valuation_method} />
          <span style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>{formatValue(row)}</span>
        </div>
      </div>
    </div>
  )
}

function CategorySection({ category, rows, selectedId, onSelect }: {
  category: string; rows: PerquisiteConfigRow[]; selectedId: string | null; onSelect: (id: string) => void
}) {
  return (
    <div style={{ marginBottom: S.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: F.micro, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.09em', margin: '0 4px 6px' }}>
        <span style={{ display: 'inline-flex', color: C.faint }}>{catIcon(category, 13)}</span>{category}
        <CountChip>{rows.length}</CountChip>
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

  return (
    <Modal icon={<IconPlus size={17} />} title="Add new perquisite" subtitle="A new perquisite type: no migration needed" maxWidth={480}
      footer={<>
        <PButton variant="primary" disabled={!valid} onClick={() => onCreate({ code, name, category, description, valuationMethod: method, lawReference: lawRef })} style={{ flex: 1 }}>
          Create
        </PButton>
        <PButton variant="secondary" onClick={onClose}>Cancel</PButton>
      </>}>
      <CField label="Code" required><input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))} placeholder="e.g. CRECHE_FACILITY" style={cfgInput} /></CField>
      <CField label="Name" required><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Crèche facility" style={cfgInput} /></CField>
      <CField label="Category" required><input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Other" style={cfgInput} /></CField>
      <CField label="Description"><textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...cfgTextarea, height: 60, resize: 'none' }} /></CField>
      <CField label="How is this valued?" required>
        <select value={method} onChange={e => setMethod(e.target.value as ValuationMethod)} style={{ ...cfgInput, cursor: 'pointer' }}>
          {Object.entries(VALUATION_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </CField>
      <CField label={<>Law reference <span style={{ fontWeight: W.regular, color: C.muted }}>(optional)</span></>}>
        <input value={lawRef} onChange={e => setLawRef(e.target.value)} placeholder="e.g. Section 17(1); Rule 15" style={cfgInput} />
      </CField>
    </Modal>
  )
}

function SlabRow({ slab, onChange, onDelete }: { slab: Partial<PerquisiteSlab> & { _key: string }; onChange: (patch: Partial<PerquisiteSlab>) => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 34px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
      <input value={slab.slab_label ?? ''} onChange={e => onChange({ slab_label: e.target.value })} placeholder="Slab label" style={cfgInput} />
      <input type="number" value={slab.rate_amount ?? ''} onChange={e => onChange({ rate_amount: e.target.value ? Number(e.target.value) : null })} placeholder="₹ amount" style={cfgInput} />
      <input type="number" value={slab.rate_percent ?? ''} onChange={e => onChange({ rate_percent: e.target.value ? Number(e.target.value) : null })} placeholder="% rate" style={cfgInput} />
      <button onClick={onDelete} aria-label="Remove slab" title="Remove slab" className="ez-press" style={{
        width: 34, height: 34, borderRadius: R.md, border: `1px solid ${C.criticalEdge}`, background: C.surface, color: C.critical,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}><IconClose size={13} /></button>
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
      notify(`"${args.name}" added. Configure its value below.`)
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

  return (
    <div style={{ display: 'flex', gap: S.lg, fontFamily: F.family, fontSize: F.small, color: C.ink, flexWrap: 'wrap', alignItems: 'flex-start' }}>

      {/* ── List ── */}
      <SectionCard
        title="Perquisites" icon={<IconReceipt size={16} />}
        hint={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><RefChip t="brand" icon={<IconCalendar size={11} />}>FY {FY}</RefChip><span style={{ ...numeric }}>{rows.length} types</span></span>}
        style={{ flex: '1 1 340px', minWidth: 'min(300px, 100%)', marginBottom: 0 }} pad={S.md}>
        <PButton variant="primary" icon={<IconPlus size={15} />} onClick={() => setShowAddModal(true)} full style={{ marginBottom: S.md }}>
          Add new perquisite
        </PButton>
        {Object.entries(grouped).map(([cat, catRows]) => (
          <CategorySection key={cat} category={cat} rows={catRows} selectedId={selectedId} onSelect={setSelectedId} />
        ))}
      </SectionCard>

      {/* ── Configure panel ── */}
      <div style={{ flex: '999 1 420px', minWidth: 0 }}>
        {!selected ? (
          <SectionCard style={{ marginBottom: 0 }}>
            <EmptyState icon={<IconReceipt size={20} />} title="Pick a perquisite"
              hint={`Select a perquisite on the left to configure its FY ${FY} value, or add a new one.`} />
          </SectionCard>
        ) : (
          <SectionCard style={{ marginBottom: 0 }}
            title={selected.name} icon={catIcon(selected.category, 17)}
            hint={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
              <StatusPill t="brand" size="sm">{selected.category}</StatusPill>
              <MethodBadge method={selected.valuation_method} />
              {selected.law_reference && <span style={{ color: C.muted }}>{selected.law_reference}</span>}
            </span>}
            bodyStyle={{ display: 'flex', flexDirection: 'column', gap: S.md + 2 }}>
            {selected.description && <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>{selected.description}</div>}

            <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.brandDeep, textTransform: 'uppercase', letterSpacing: '.09em' }}>Value for FY {FY}</div>

            {(selected.valuation_method === 'FLAT_AMOUNT') && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: S.md }}>
                <CField label="Amount (₹)"><input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={cfgInput} /></CField>
                <CField label="Unit">
                  <select value={unit} onChange={e => setUnit(e.target.value as PerquisiteUnit)} style={{ ...cfgInput, cursor: 'pointer' }}>
                    <option value="">-</option>
                    {UNITS.map(u => <option key={u} value={u}>{u.replace('PER_', '/').toLowerCase()}</option>)}
                  </select>
                </CField>
              </div>
            )}

            {(selected.valuation_method === 'PERCENT_OF_SALARY' || selected.valuation_method === 'PERCENT_OF_COST') && (
              <CField label="Percent (%)"><input type="number" value={percent} onChange={e => setPercent(e.target.value)} style={{ ...cfgInput, maxWidth: 240 }} /></CField>
            )}

            {selected.valuation_method === 'SLAB_BASED' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 34px', gap: 6, marginBottom: 5 }}>
                  {['Slabs', '₹ amount', '% rate', ''].map((h, i) => <span key={i} style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft }}>{h}</span>)}
                </div>
                {slabs.map((s, i) => (
                  <SlabRow key={s._key} slab={s}
                    onChange={patch => setSlabs(prev => prev.map((x, idx) => idx === i ? { ...x, ...patch } : x))}
                    onDelete={() => setSlabs(prev => prev.filter((_, idx) => idx !== i))} />
                ))}
                <PButton size="sm" variant="secondary" icon={<IconPlus size={13} />} onClick={addSlabRow}>Add slab</PButton>
              </div>
            )}

            {(selected.valuation_method === 'FMV_BASED' || selected.valuation_method === 'MANUAL') && (
              <InfoCallout t="neutral" compact icon={<IconInfo size={14} />} style={{ marginBottom: 0 }}>
                {selected.valuation_method === 'FMV_BASED'
                  ? 'Calculated per transaction (FMV at exercise minus exercise price), no stored rate. Exemption limit and notes below still apply if relevant.'
                  : 'Case-by-case: no single rate to store. Use notes below for guidance shown to payroll processors.'}
              </InfoCallout>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: S.md }}>
              <CField label="Exemption limit (₹, optional)"><input type="number" value={exemptionLimit} onChange={e => setExemptionLimit(e.target.value)} style={cfgInput} /></CField>
              <CField label="Taxable?">
                <select value={isTaxable ? 'yes' : 'no'} onChange={e => setIsTaxable(e.target.value === 'yes')} style={{ ...cfgInput, cursor: 'pointer' }}>
                  <option value="yes">Taxable</option>
                </select>
              </CField>
            </div>

            <CField label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...cfgTextarea, height: 60, resize: 'none' }} /></CField>

            <div style={{ display: 'flex', alignItems: 'center', gap: S.md, flexWrap: 'wrap', paddingTop: S.md, borderTop: `1px solid ${C.line}` }}>
              <PButton variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save value'}</PButton>
              <span style={{ fontSize: F.tiny, color: C.muted }}>Saves {selected.name} for FY {FY}.</span>
            </div>
          </SectionCard>
        )}
      </div>

      {showAddModal && <AddTypeModal onClose={() => setShowAddModal(false)} onCreate={handleCreateType} />}

      {toast && <Toast>{toast}</Toast>}
    </div>
  )
}
