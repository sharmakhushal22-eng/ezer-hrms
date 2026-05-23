'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

// ── Types ──────────────────────────────────────────────────────────
interface Category { id: string; code: string; name: string; icon: string; sort_order: number }
interface MasterType { id: string; category_id: string; code: string; name: string; description: string; has_color: boolean; has_code: boolean; has_parent: boolean; has_extra_data: boolean; extra_schema: any; is_system: boolean }
interface MasterValue { id: string; type_id: string; code: string; label: string; description: string; color: string; parent_id: string; extra_data: any; sort_order: number; is_system: boolean; is_active: boolean }

// ── Styles ─────────────────────────────────────────────────────────
const C = {
  page: { display:'flex' as const, minHeight:'100vh', background:'#F0F4F8', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' },
  sidebar: { width:'260px', background:'#fff', borderRight:'1px solid #E2E8F0', display:'flex' as const, flexDirection:'column' as const, flexShrink:0 },
  main: { flex:1, display:'flex' as const, flexDirection:'column' as const, overflow:'hidden' as const },
  topbar: { background:'#fff', padding:'11px 20px', borderBottom:'1px solid #E2E8F0', display:'flex' as const, alignItems:'center' as const, justifyContent:'space-between' as const },
  body: { flex:1, padding:'16px 20px', overflowY:'auto' as const },
  card: { background:'#fff', borderRadius:'10px', border:'1px solid #E2E8F0', padding:'14px 16px', marginBottom:'10px' },
  priBtn: { padding:'8px 16px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:600 as const, cursor:'pointer' },
  secBtn: { padding:'8px 12px', background:'#fff', color:'#374151', border:'1px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer' },
  dangerBtn: { padding:'6px 12px', background:'#FEE2E2', color:'#DC2626', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'pointer' },
  inp: { width:'100%', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'#F8FAFC', boxSizing:'border-box' as const, color:'#0F172A' },
  lbl: { fontSize:'11px', fontWeight:500 as const, color:'#374151', display:'block' as const, marginBottom:'4px' },
}

// ── Supabase helpers ───────────────────────────────────────────────
async function getCategories(): Promise<Category[]> {
  const { data } = await supabase.from('master_categories').select('*').eq('is_active', true).order('sort_order')
  return data || []
}
async function getTypes(category_id: string): Promise<MasterType[]> {
  const { data } = await supabase.from('master_types').select('*').eq('category_id', category_id).eq('is_active', true).order('sort_order')
  return data || []
}
async function getValues(type_id: string): Promise<MasterValue[]> {
  const { data } = await supabase.from('master_values').select('*').eq('type_id', type_id).order('sort_order').order('label')
  return data || []
}
async function saveValue(payload: any) {
  if (payload.id) {
    const { id, type_id, is_system, created_at, ...rest } = payload
    return supabase.from('master_values').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id)
  }
  return supabase.from('master_values').insert(payload)
}
async function toggleActive(id: string, val: boolean) {
  return supabase.from('master_values').update({ is_active: val, updated_at: new Date().toISOString() }).eq('id', id)
}
async function saveType(payload: any) {
  if (payload.id) {
    const { id, ...rest } = payload
    return supabase.from('master_types').update(rest).eq('id', id)
  }
  return supabase.from('master_types').insert(payload)
}

// ── Color Picker ───────────────────────────────────────────────────
const COLORS = ['#7C3AED','#1D4ED8','#16A34A','#D97706','#DC2626','#0D9488','#9333EA','#BE185D','#0369A1','#374151','#059669','#CA8A04']

export default function MasterSetupPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [types, setTypes] = useState<MasterType[]>([])
  const [values, setValues] = useState<MasterValue[]>([])
  const [selCat, setSelCat] = useState<Category | null>(null)
  const [selType, setSelType] = useState<MasterType | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  // Forms
  const [showValueForm, setShowValueForm] = useState(false)
  const [showTypeForm, setShowTypeForm] = useState(false)
  const [editValue, setEditValue] = useState<MasterValue | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Value form state
  const [vf, setVf] = useState({ code:'', label:'', description:'', color:'#7C3AED', sort_order:0, extra_data:'{}' })

  // Type form state
  const [tf, setTf] = useState({ code:'', name:'', description:'', has_color:false, has_code:true, has_parent:false, has_extra_data:false, is_system:false })

  // Load categories on mount
  useEffect(() => { getCategories().then(setCategories) }, [])

  // Load types when category changes
  useEffect(() => {
    if (!selCat) return
    setSelType(null); setValues([])
    getTypes(selCat.id).then(setTypes)
  }, [selCat])

  // Load values when type changes
  useEffect(() => {
    if (!selType) return
    setLoading(true)
    getValues(selType.id).then(v => { setValues(v); setLoading(false) })
  }, [selType])

  const openAddValue = () => {
    setEditValue(null)
    setVf({ code:'', label:'', description:'', color:'#7C3AED', sort_order: values.length + 1, extra_data:'{}' })
    setError(''); setShowValueForm(true)
  }

  const openEditValue = (v: MasterValue) => {
    setEditValue(v)
    setVf({ code: v.code, label: v.label, description: v.description||'', color: v.color||'#7C3AED', sort_order: v.sort_order, extra_data: v.extra_data ? JSON.stringify(v.extra_data, null, 2) : '{}' })
    setError(''); setShowValueForm(true)
  }

  const handleSaveValue = async () => {
    if (!vf.code.trim() || !vf.label.trim()) { setError('Code aur Label required hain'); return }
    setSaving(true); setError('')
    try {
      let extra = null
      if (selType?.has_extra_data && vf.extra_data) {
        try { extra = JSON.parse(vf.extra_data) } catch { setError('Extra Data valid JSON nahi hai'); setSaving(false); return }
      }
      const payload: any = {
        ...(editValue ? { id: editValue.id } : {}),
        type_id: selType!.id,
        code: vf.code.toUpperCase().trim(),
        label: vf.label.trim(),
        description: vf.description.trim() || null,
        color: selType?.has_color ? vf.color : null,
        sort_order: vf.sort_order,
        extra_data: extra,
        is_active: true,
        is_system: false,
      }
      const { error: err } = await saveValue(payload)
      if (err) throw err
      const fresh = await getValues(selType!.id)
      setValues(fresh); setShowValueForm(false)
    } catch (e: any) { setError(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  const handleToggle = async (v: MasterValue) => {
    if (v.is_system && v.is_active) { setError('System values disable nahi ho sakte'); return }
    await toggleActive(v.id, !v.is_active)
    const fresh = await getValues(selType!.id)
    setValues(fresh)
  }

  const handleSaveType = async () => {
    if (!tf.code.trim() || !tf.name.trim()) { setError('Code aur Name required'); return }
    setSaving(true); setError('')
    try {
      const { error: err } = await saveType({ ...tf, code: tf.code.toLowerCase().trim(), category_id: selCat!.id, sort_order: types.length + 1, is_active: true })
      if (err) throw err
      const fresh = await getTypes(selCat!.id)
      setTypes(fresh); setShowTypeForm(false)
      setTf({ code:'', name:'', description:'', has_color:false, has_code:true, has_parent:false, has_extra_data:false, is_system:false })
    } catch (e: any) { setError(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  const filteredValues = values.filter(v => {
    const match = !search || v.label.toLowerCase().includes(search.toLowerCase()) || v.code.toLowerCase().includes(search.toLowerCase())
    const active = showInactive ? true : v.is_active
    return match && active
  })

  // Modal wrapper
  const Modal = ({ title, onClose, children, onSave, saveLabel='Save' }: any) => (
    <div style={{ position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'#fff', borderRadius:'14px', padding:'24px', width:'520px', maxHeight:'85vh', overflowY:'auto' as const, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'16px' }}>
          <div style={{ fontSize:'15px', fontWeight:600 }}>{title}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:'20px', cursor:'pointer', color:'#94A3B8' }}>✕</button>
        </div>
        {error && <div style={{ padding:'8px 12px', background:'#FEE2E2', borderRadius:'8px', fontSize:'12px', color:'#DC2626', marginBottom:'12px' }}>⚠️ {error}</div>}
        {children}
        <div style={{ display:'flex', gap:'8px', marginTop:'16px' }}>
          <button style={{ ...C.priBtn, flex:1, opacity: saving ? 0.7:1 }} onClick={onSave} disabled={saving}>{saving ? 'Saving...' : saveLabel}</button>
          <button style={C.secBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )

  const Fld = ({ label, req, children }: any) => (
    <div style={{ marginBottom:'12px' }}>
      <label style={C.lbl}>{label}{req && <span style={{ color:'#DC2626' }}> *</span>}</label>
      {children}
    </div>
  )

  return (
    <div style={C.page}>

      {/* Left Sidebar */}
      <div style={C.sidebar}>
        <div style={{ padding:'14px 16px', borderBottom:'1px solid #E2E8F0', background:'#1E1B4B' }}>
          <div style={{ fontSize:'13px', fontWeight:600, color:'#fff' }}>⚙️ Master Setup</div>
          <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.5)', marginTop:'2px' }}>Select category → type → manage values</div>
        </div>

        <div style={{ flex:1, overflowY:'auto' as const, padding:'8px 0' }}>
          {categories.map(cat => (
            <div key={cat.id}>
              <button
                onClick={() => { setSelCat(cat); setSearch('') }}
                style={{
                  width:'100%', padding:'10px 14px', border:'none', background: selCat?.id===cat.id ? '#EDE9FE' : 'transparent',
                  cursor:'pointer', textAlign:'left' as const, display:'flex', alignItems:'center', gap:'8px',
                  borderLeft: selCat?.id===cat.id ? '3px solid #7C3AED' : '3px solid transparent',
                }}
              >
                <span style={{ fontSize:'16px' }}>{cat.icon}</span>
                <span style={{ fontSize:'12px', fontWeight: selCat?.id===cat.id ? 600 : 400, color: selCat?.id===cat.id ? '#7C3AED' : '#374151' }}>{cat.name}</span>
              </button>

              {/* Sub types under selected category */}
              {selCat?.id===cat.id && types.map(tp => (
                <button
                  key={tp.id}
                  onClick={() => { setSelType(tp); setSearch('') }}
                  style={{
                    width:'100%', padding:'7px 14px 7px 36px', border:'none',
                    background: selType?.id===tp.id ? '#F5F3FF' : 'transparent',
                    cursor:'pointer', textAlign:'left' as const,
                    fontSize:'11px', color: selType?.id===tp.id ? '#7C3AED' : '#64748B',
                    fontWeight: selType?.id===tp.id ? 500 : 400,
                    borderLeft: selType?.id===tp.id ? '3px solid #A78BFA' : '3px solid transparent',
                  }}
                >
                  {tp.name}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Add new master type button */}
        {selCat && (
          <div style={{ padding:'12px', borderTop:'1px solid #E2E8F0' }}>
            <button style={{ ...C.priBtn, width:'100%', fontSize:'11px' }} onClick={() => { setError(''); setShowTypeForm(true) }}>
              + Add New Master Type
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div style={C.main}>
        <div style={C.topbar}>
          <div>
            <div style={{ fontSize:'14px', fontWeight:600 }}>
              {selType ? selType.name : selCat ? selCat.name : 'Master Setup'}
            </div>
            <div style={{ fontSize:'11px', color:'#94A3B8', marginTop:'2px' }}>
              {selType ? `${filteredValues.length} values · ${selType.description || ''}` : selCat ? 'Left mein master type select karo' : 'Left mein category select karo'}
            </div>
          </div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            {selType && (
              <>
                <input
                  style={{ ...C.inp, width:'200px' }}
                  placeholder="Search values..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <label style={{ fontSize:'11px', color:'#64748B', display:'flex', alignItems:'center', gap:'4px', cursor:'pointer' }}>
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  Show Disabled
                </label>
                <button style={C.priBtn} onClick={openAddValue}>+ Add Value</button>
              </>
            )}
          </div>
        </div>

        <div style={C.body}>

          {/* No selection state */}
          {!selCat && (
            <div style={{ textAlign:'center' as const, padding:'60px 20px', color:'#94A3B8' }}>
              <div style={{ fontSize:'40px', marginBottom:'12px' }}>⚙️</div>
              <div style={{ fontSize:'16px', fontWeight:500, marginBottom:'6px', color:'#374151' }}>Master Setup</div>
              <div style={{ fontSize:'13px' }}>Left mein category select karo — phir master type choose karo</div>
            </div>
          )}

          {/* Category selected but no type */}
          {selCat && !selType && types.length > 0 && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'10px' }}>
              {types.map(tp => (
                <div
                  key={tp.id}
                  onClick={() => setSelType(tp)}
                  style={{ ...C.card, cursor:'pointer', borderLeft:'3px solid #7C3AED', ':hover':{ background:'#F5F3FF' } } as any}
                >
                  <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'4px' }}>{tp.name}</div>
                  <div style={{ fontSize:'11px', color:'#64748B', marginBottom:'8px' }}>{tp.description || ''}</div>
                  <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' as const }}>
                    {tp.has_color && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#EDE9FE', color:'#7C3AED', borderRadius:'4px' }}>Color</span>}
                    {tp.has_code && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#DBEAFE', color:'#1D4ED8', borderRadius:'4px' }}>Code</span>}
                    {tp.has_parent && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#DCFCE7', color:'#16A34A', borderRadius:'4px' }}>Hierarchy</span>}
                    {tp.has_extra_data && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#FEF3C7', color:'#D97706', borderRadius:'4px' }}>Extra Fields</span>}
                    {tp.is_system && <span style={{ fontSize:'9px', padding:'1px 6px', background:'#F1F5F9', color:'#374151', borderRadius:'4px' }}>System</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Values list */}
          {selType && (
            <div style={C.card}>
              {/* Stats bar */}
              <div style={{ display:'flex', gap:'16px', marginBottom:'14px', padding:'10px 14px', background:'#F8FAFC', borderRadius:'8px' }}>
                <span style={{ fontSize:'11px', color:'#64748B' }}>Total: <strong style={{ color:'#374151' }}>{values.length}</strong></span>
                <span style={{ fontSize:'11px', color:'#64748B' }}>Active: <strong style={{ color:'#16A34A' }}>{values.filter(v=>v.is_active).length}</strong></span>
                <span style={{ fontSize:'11px', color:'#64748B' }}>Disabled: <strong style={{ color:'#DC2626' }}>{values.filter(v=>!v.is_active).length}</strong></span>
                <span style={{ fontSize:'11px', color:'#64748B' }}>System: <strong style={{ color:'#7C3AED' }}>{values.filter(v=>v.is_system).length}</strong></span>
              </div>

              {loading ? (
                <div style={{ padding:'40px', textAlign:'center' as const, color:'#94A3B8' }}>⏳ Loading...</div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:'12px' }}>
                  <thead>
                    <tr style={{ background:'#1E1B4B' }}>
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'40px' }}>Order</th>
                      {selType.has_color && <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'60px' }}>Color</th>}
                      {selType.has_code && <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'120px' }}>Code</th>}
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px' }}>Label</th>
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px' }}>Description</th>
                      {selType.has_extra_data && <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'80px' }}>Extra Data</th>}
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'80px' }}>Status</th>
                      <th style={{ padding:'9px 10px', color:'#fff', textAlign:'left' as const, fontWeight:600, fontSize:'11px', width:'120px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredValues.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding:'30px', textAlign:'center' as const, color:'#94A3B8' }}>
                        {search ? 'No values match search' : 'No values yet · Click + Add Value'}
                      </td></tr>
                    ) : filteredValues.map((v, i) => (
                      <tr key={v.id} style={{ background: !v.is_active ? '#FEF2F2' : i%2===0 ? '#F8FAFC' : '#fff', borderBottom:'1px solid #E2E8F0', opacity: v.is_active ? 1 : 0.6 }}>
                        <td style={{ padding:'8px 10px', color:'#94A3B8', textAlign:'center' as const }}>{v.sort_order}</td>
                        {selType.has_color && (
                          <td style={{ padding:'8px 10px' }}>
                            {v.color && <div style={{ width:'22px', height:'22px', borderRadius:'50%', background:v.color, display:'inline-block', border:'2px solid rgba(0,0,0,0.1)' }}/>}
                          </td>
                        )}
                        {selType.has_code && (
                          <td style={{ padding:'8px 10px' }}>
                            <span style={{ padding:'2px 7px', background: v.color||'#EDE9FE', color:'#fff', borderRadius:'5px', fontSize:'10px', fontWeight:600 }}>{v.code}</span>
                          </td>
                        )}
                        <td style={{ padding:'8px 10px', fontWeight:500 }}>{v.label}</td>
                        <td style={{ padding:'8px 10px', color:'#64748B', fontSize:'11px' }}>{v.description||'—'}</td>
                        {selType.has_extra_data && (
                          <td style={{ padding:'8px 10px' }}>
                            {v.extra_data && <button onClick={() => alert(JSON.stringify(v.extra_data, null, 2))} style={{ padding:'2px 8px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>View</button>}
                          </td>
                        )}
                        <td style={{ padding:'8px 10px' }}>
                          <span style={{ padding:'2px 8px', borderRadius:'6px', fontSize:'10px', fontWeight:500, background: v.is_active ? '#DCFCE7':'#FEE2E2', color: v.is_active ? '#16A34A':'#DC2626' }}>
                            {v.is_active ? 'Active' : 'Disabled'}
                          </span>
                          {v.is_system && <span style={{ marginLeft:'4px', padding:'1px 5px', background:'#F1F5F9', color:'#64748B', borderRadius:'4px', fontSize:'9px' }}>System</span>}
                        </td>
                        <td style={{ padding:'8px 10px' }}>
                          <div style={{ display:'flex', gap:'4px' }}>
                            <button onClick={() => openEditValue(v)} style={{ padding:'4px 8px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>✏️ Edit</button>
                            <button onClick={() => handleToggle(v)} disabled={v.is_system && v.is_active} style={{ padding:'4px 8px', border:'none', borderRadius:'5px', cursor: v.is_system && v.is_active ? 'not-allowed':'pointer', fontSize:'10px', background: v.is_active ? '#FEE2E2':'#DCFCE7', color: v.is_active ? '#DC2626':'#16A34A', opacity: v.is_system && v.is_active ? 0.4:1 }}>
                              {v.is_active ? '🔴 Disable' : '🟢 Enable'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── ADD/EDIT VALUE MODAL ─────────────────────────────────────── */}
      {showValueForm && selType && (
        <Modal title={editValue ? `✏️ Edit — ${editValue.label}` : `+ Add New Value — ${selType.name}`} onClose={() => setShowValueForm(false)} onSave={handleSaveValue} saveLabel={editValue ? 'Update Value' : 'Add Value'}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            {selType.has_code && (
              <Fld label="Code" req>
                <input style={{ ...C.inp, fontFamily:'monospace', textTransform:'uppercase' as const }} placeholder="e.g. NAUKRI" value={vf.code} onChange={e => setVf(v => ({ ...v, code: e.target.value.toUpperCase() }))} disabled={!!editValue?.is_system} />
              </Fld>
            )}
            <Fld label="Label" req>
              <input style={C.inp} placeholder="Display name" value={vf.label} onChange={e => setVf(v => ({ ...v, label: e.target.value }))} />
            </Fld>
          </div>
          <Fld label="Description">
            <input style={C.inp} placeholder="Optional description" value={vf.description} onChange={e => setVf(v => ({ ...v, description: e.target.value }))} />
          </Fld>
          {selType.has_color && (
            <Fld label="Color">
              <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' as const, marginTop:'4px' }}>
                {COLORS.map(col => (
                  <div key={col} onClick={() => setVf(v => ({ ...v, color: col }))}
                    style={{ width:'28px', height:'28px', borderRadius:'50%', background:col, cursor:'pointer', border: vf.color===col ? '3px solid #0F172A' : '2px solid transparent', boxShadow: vf.color===col ? '0 0 0 2px #fff inset' : 'none' }} />
                ))}
                <input type="color" value={vf.color} onChange={e => setVf(v => ({ ...v, color: e.target.value }))} style={{ width:'28px', height:'28px', border:'none', cursor:'pointer', borderRadius:'50%', padding:0 }} title="Custom color" />
              </div>
            </Fld>
          )}
          <Fld label="Sort Order">
            <input type="number" style={C.inp} value={vf.sort_order} onChange={e => setVf(v => ({ ...v, sort_order: parseInt(e.target.value)||0 }))} />
          </Fld>
          {selType.has_extra_data && selType.extra_schema && (
            <div style={{ marginBottom:'12px' }}>
              <label style={C.lbl}>Extra Fields (as per schema)</label>
              <div style={{ padding:'8px 12px', background:'#EDE9FE', borderRadius:'8px', fontSize:'11px', color:'#7C3AED', marginBottom:'8px' }}>
                Fields: {Object.keys(selType.extra_schema).map((k: string) => `${k} (${selType.extra_schema[k]?.label})`).join(' · ')}
              </div>
              <textarea style={{ ...C.inp, height:'100px', resize:'vertical' as const, fontFamily:'monospace', fontSize:'11px' }}
                value={vf.extra_data} onChange={e => setVf(v => ({ ...v, extra_data: e.target.value }))}
                placeholder='{"key": "value"}'
              />
            </div>
          )}
          {editValue?.is_system && (
            <div style={{ padding:'8px 12px', background:'#FEF3C7', borderRadius:'8px', fontSize:'11px', color:'#D97706' }}>
              ⚠️ System value — sirf Label aur Description edit ho sakti hai
            </div>
          )}
        </Modal>
      )}

      {/* ── ADD NEW MASTER TYPE MODAL ────────────────────────────────── */}
      {showTypeForm && selCat && (
        <Modal title={`+ New Master Type — ${selCat.name}`} onClose={() => setShowTypeForm(false)} onSave={handleSaveType} saveLabel="Create Master Type">
          <div style={{ padding:'8px 12px', background:'#DBEAFE', borderRadius:'8px', fontSize:'11px', color:'#1D4ED8', marginBottom:'12px' }}>
            💡 New master type create hone ke baad usme values add kar sakte ho. Ye master type phir sab forms mein available hoga.
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
            <Fld label="Code (unique)" req>
              <input style={{ ...C.inp, fontFamily:'monospace' }} placeholder="e.g. my_master" value={tf.code} onChange={e => setTf(t => ({ ...t, code: e.target.value.toLowerCase().replace(/\s/g,'_') }))} />
            </Fld>
            <Fld label="Name" req>
              <input style={C.inp} placeholder="e.g. My Master Name" value={tf.name} onChange={e => setTf(t => ({ ...t, name: e.target.value }))} />
            </Fld>
          </div>
          <Fld label="Description">
            <input style={C.inp} placeholder="What is this master used for?" value={tf.description} onChange={e => setTf(t => ({ ...t, description: e.target.value }))} />
          </Fld>
          <div style={{ marginBottom:'12px' }}>
            <label style={C.lbl}>Features</label>
            <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' as const }}>
              {[
                { key:'has_code', label:'Has Code (short identifier)' },
                { key:'has_color', label:'Has Color (for visual tags)' },
                { key:'has_parent', label:'Has Parent (hierarchy)' },
                { key:'has_extra_data', label:'Has Extra Fields (JSONB)' },
              ].map(f => (
                <label key={f.key} style={{ display:'flex', gap:'6px', alignItems:'center', fontSize:'12px', cursor:'pointer' }}>
                  <input type="checkbox" checked={(tf as any)[f.key]} onChange={e => setTf(t => ({ ...t, [f.key]: e.target.checked }))} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}