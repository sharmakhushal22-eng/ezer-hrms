'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────
type AdminTab = 'company' | 'masters'
type MasterCategory = { id: string; code: string; name: string; icon: string; sort_order: number }
type MasterType = { id: string; category_id: string; code: string; name: string; description: string; has_color: boolean; has_code: boolean; has_extra_data: boolean; extra_schema: any; is_system: boolean }
type MasterValue = { id: string; type_id: string; code: string; label: string; description: string; color: string; extra_data: any; sort_order: number; is_system: boolean; is_active: boolean }

// ── Styles ─────────────────────────────────────────────────────────
const C = {
  page: { minHeight:'100vh', background:'#F0F4F8', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' },
  topbar: { background:'#1E1B4B', padding:'14px 24px', display:'flex' as const, alignItems:'center' as const, justifyContent:'space-between' as const },
  tabs: { background:'#fff', borderBottom:'1px solid #E2E8F0', padding:'0 24px', display:'flex' as const },
  tab: (a: boolean) => ({ padding:'13px 20px', border:'none', background:'transparent', cursor:'pointer', fontSize:'13px', fontWeight: a?600:400, color: a?'#7C3AED':'#64748B', borderBottom: a?'2.5px solid #7C3AED':'2.5px solid transparent', whiteSpace:'nowrap' as const }),
  body: { padding:'20px 24px', maxWidth:'1200px', margin:'0 auto' },
  card: { background:'#fff', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'20px 24px', marginBottom:'14px' },
  priBtn: { padding:'9px 18px', background:'#7C3AED', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:600 as const, cursor:'pointer' },
  secBtn: { padding:'9px 14px', background:'#fff', color:'#374151', border:'1px solid #E2E8F0', borderRadius:'8px', fontSize:'12px', cursor:'pointer' },
  inp: { width:'100%', padding:'8px 11px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'#F8FAFC', boxSizing:'border-box' as const },
  sel: { width:'100%', padding:'8px 11px', border:'1.5px solid #E2E8F0', borderRadius:'8px', fontSize:'13px', outline:'none', background:'#F8FAFC', boxSizing:'border-box' as const },
  lbl: { fontSize:'11px', fontWeight:500 as const, color:'#374151', display:'block' as const, marginBottom:'4px' },
}

const COLORS = ['#7C3AED','#1D4ED8','#16A34A','#D97706','#DC2626','#0D9488','#9333EA','#BE185D','#0369A1','#374151','#059669','#CA8A04']

// ── Company Setup Steps ────────────────────────────────────────────
const STEPS = ['Group Setup','Company Details','Locations','Tax Registration','Labour Law','Bank Accounts','Review & Save']

// ── MASTER SECTION ─────────────────────────────────────────────────
function MasterSection() {
  const [categories, setCategories] = useState<MasterCategory[]>([])
  const [types, setTypes] = useState<MasterType[]>([])
  const [values, setValues] = useState<MasterValue[]>([])
  const [selCat, setSelCat] = useState<MasterCategory | null>(null)
  const [selType, setSelType] = useState<MasterType | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [showValueForm, setShowValueForm] = useState(false)
  const [showTypeForm, setShowTypeForm] = useState(false)
  const [editValue, setEditValue] = useState<MasterValue | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [vf, setVf] = useState({ code:'', label:'', description:'', color:'#7C3AED', sort_order:0, extra_data:'{}' })
  const [tf, setTf] = useState({ code:'', name:'', description:'', has_color:false, has_code:true, has_parent:false, has_extra_data:false })

  useEffect(() => {
    supabase.from('master_categories').select('*').eq('is_active',true).order('sort_order')
      .then(({ data }) => setCategories(data||[]))
  }, [])

  useEffect(() => {
    if (!selCat) return
    setSelType(null); setValues([])
    supabase.from('master_types').select('*').eq('category_id',selCat.id).eq('is_active',true).order('sort_order')
      .then(({ data }) => setTypes(data||[]))
  }, [selCat])

  useEffect(() => {
    if (!selType) return
    setLoading(true)
    supabase.from('master_values').select('*').eq('type_id',selType.id).order('sort_order').order('label')
      .then(({ data }) => { setValues(data||[]); setLoading(false) })
  }, [selType])

  const openAdd = () => {
    setEditValue(null)
    setVf({ code:'', label:'', description:'', color:'#7C3AED', sort_order: values.length+1, extra_data:'{}' })
    setError(''); setShowValueForm(true)
  }
  const openEdit = (v: MasterValue) => {
    setEditValue(v)
    setVf({ code:v.code, label:v.label, description:v.description||'', color:v.color||'#7C3AED', sort_order:v.sort_order, extra_data: v.extra_data ? JSON.stringify(v.extra_data,null,2) : '{}' })
    setError(''); setShowValueForm(true)
  }

  const refresh = () => {
    if (!selType) return
    supabase.from('master_values').select('*').eq('type_id',selType.id).order('sort_order').order('label')
      .then(({ data }) => setValues(data||[]))
  }

  const saveVal = async () => {
    if (!vf.code.trim()||!vf.label.trim()) { setError('Code aur Label required'); return }
    setSaving(true); setError('')
    try {
      let extra = null
      if (selType?.has_extra_data && vf.extra_data) {
        try { extra = JSON.parse(vf.extra_data) } catch { setError('Extra Data valid JSON nahi hai'); setSaving(false); return }
      }
      const payload: any = {
        type_id: selType!.id,
        code: vf.code.toUpperCase().trim(),
        label: vf.label.trim(),
        description: vf.description||null,
        color: selType?.has_color ? vf.color : null,
        sort_order: vf.sort_order,
        extra_data: extra,
        is_active: true,
        is_system: false,
        updated_at: new Date().toISOString()
      }
      if (editValue) {
        await supabase.from('master_values').update(payload).eq('id', editValue.id)
      } else {
        await supabase.from('master_values').insert(payload)
      }
      refresh(); setShowValueForm(false)
    } catch(e: any) { setError(e.message||'Save failed') }
    finally { setSaving(false) }
  }

  const toggle = async (v: MasterValue) => {
    if (v.is_system && v.is_active) { alert('System values disable nahi ho sakte'); return }
    await supabase.from('master_values').update({ is_active: !v.is_active, updated_at: new Date().toISOString() }).eq('id', v.id)
    refresh()
  }

  const saveType = async () => {
    if (!tf.code.trim()||!tf.name.trim()) { setError('Code aur Name required'); return }
    setSaving(true); setError('')
    await supabase.from('master_types').insert({ ...tf, code: tf.code.toLowerCase().replace(/\s/g,'_'), category_id: selCat!.id, sort_order: types.length+1, is_active:true, is_system:false })
    const { data } = await supabase.from('master_types').select('*').eq('category_id',selCat!.id).eq('is_active',true).order('sort_order')
    setTypes(data||[]); setShowTypeForm(false); setSaving(false)
    setTf({ code:'', name:'', description:'', has_color:false, has_code:true, has_parent:false, has_extra_data:false })
  }

  const filtered = values.filter(v => {
    const m = !search || v.label.toLowerCase().includes(search.toLowerCase()) || v.code.toLowerCase().includes(search.toLowerCase())
    return m && (showInactive ? true : v.is_active)
  })

  const Modal = ({ title, onClose, onSave, children, saveLabel='Save' }: any) => (
    <div style={{ position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'#fff', borderRadius:'14px', padding:'24px', width:'500px', maxHeight:'85vh', overflowY:'auto' as const, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'16px' }}>
          <div style={{ fontSize:'15px', fontWeight:600 }}>{title}</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:'20px', cursor:'pointer', color:'#94A3B8' }}>✕</button>
        </div>
        {error && <div style={{ padding:'8px 12px', background:'#FEE2E2', borderRadius:'8px', fontSize:'12px', color:'#DC2626', marginBottom:'12px' }}>⚠️ {error}</div>}
        {children}
        <div style={{ display:'flex', gap:'8px', marginTop:'16px' }}>
          <button style={{ ...C.priBtn, flex:1, opacity:saving?0.7:1 }} onClick={onSave} disabled={saving}>{saving?'Saving...':saveLabel}</button>
          <button style={C.secBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ display:'flex' as const, gap:'16px', minHeight:'70vh' }}>
      {/* Left Panel */}
      <div style={{ width:'240px', flexShrink:0 }}>
        <div style={{ ...C.card, padding:'0', overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', background:'#1E1B4B', fontSize:'12px', fontWeight:600, color:'#A78BFA' }}>Master Categories</div>
          {categories.map(cat => (
            <div key={cat.id}>
              <button onClick={() => { setSelCat(cat); setSearch('') }}
                style={{ width:'100%', padding:'10px 14px', border:'none', background: selCat?.id===cat.id?'#EDE9FE':'transparent', cursor:'pointer', textAlign:'left' as const, display:'flex', alignItems:'center', gap:'8px', borderLeft: selCat?.id===cat.id?'3px solid #7C3AED':'3px solid transparent' }}>
                <span>{cat.icon}</span>
                <span style={{ fontSize:'12px', fontWeight: selCat?.id===cat.id?600:400, color: selCat?.id===cat.id?'#7C3AED':'#374151' }}>{cat.name}</span>
              </button>
              {selCat?.id===cat.id && types.map(tp => (
                <button key={tp.id} onClick={() => setSelType(tp)}
                  style={{ width:'100%', padding:'7px 14px 7px 36px', border:'none', background: selType?.id===tp.id?'#F5F3FF':'transparent', cursor:'pointer', textAlign:'left' as const, fontSize:'11px', color: selType?.id===tp.id?'#7C3AED':'#64748B', fontWeight: selType?.id===tp.id?500:400, borderLeft: selType?.id===tp.id?'3px solid #A78BFA':'3px solid transparent' }}>
                  {tp.name}
                </button>
              ))}
            </div>
          ))}
          {selCat && (
            <div style={{ padding:'10px 12px', borderTop:'1px solid #E2E8F0' }}>
              <button style={{ ...C.priBtn, width:'100%', fontSize:'11px', padding:'7px' }} onClick={() => { setError(''); setShowTypeForm(true) }}>+ New Master Type</button>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel */}
      <div style={{ flex:1 }}>
        {!selCat && (
          <div style={{ ...C.card, textAlign:'center' as const, padding:'50px' }}>
            <div style={{ fontSize:'36px', marginBottom:'12px' }}>⚙️</div>
            <div style={{ fontSize:'15px', fontWeight:600, marginBottom:'6px' }}>Master Setup</div>
            <div style={{ fontSize:'12px', color:'#94A3B8' }}>Left mein category select karo · Values add/edit/disable karo · Naya master type add karo</div>
          </div>
        )}

        {selCat && !selType && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:'10px' }}>
            {types.map(tp => (
              <div key={tp.id} onClick={() => setSelType(tp)} style={{ ...C.card, cursor:'pointer', borderLeft:'3px solid #7C3AED' }}>
                <div style={{ fontSize:'13px', fontWeight:600, marginBottom:'4px' }}>{tp.name}</div>
                <div style={{ fontSize:'11px', color:'#64748B', marginBottom:'8px' }}>{tp.description||''}</div>
                <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' as const }}>
                  {tp.has_color && <span style={{ fontSize:'9px', padding:'1px 5px', background:'#EDE9FE', color:'#7C3AED', borderRadius:'4px' }}>Color</span>}
                  {tp.has_code && <span style={{ fontSize:'9px', padding:'1px 5px', background:'#DBEAFE', color:'#1D4ED8', borderRadius:'4px' }}>Code</span>}
                  {tp.has_extra_data && <span style={{ fontSize:'9px', padding:'1px 5px', background:'#FEF3C7', color:'#D97706', borderRadius:'4px' }}>Extra Fields</span>}
                  {tp.is_system && <span style={{ fontSize:'9px', padding:'1px 5px', background:'#F1F5F9', color:'#374151', borderRadius:'4px' }}>System</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {selType && (
          <div style={C.card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'14px', flexWrap:'wrap' as const, gap:'8px' }}>
              <div>
                <div style={{ fontSize:'14px', fontWeight:600 }}>{selType.name}</div>
                <div style={{ fontSize:'11px', color:'#94A3B8' }}>
                  Active: {values.filter(v=>v.is_active).length} · Disabled: {values.filter(v=>!v.is_active).length} · Total: {values.length}
                </div>
              </div>
              <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                <input style={{ ...C.inp, width:'180px' }} placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} />
                <label style={{ fontSize:'11px', color:'#64748B', display:'flex', alignItems:'center', gap:'4px', cursor:'pointer', whiteSpace:'nowrap' as const }}>
                  <input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)} /> Show Disabled
                </label>
                <button style={C.priBtn} onClick={openAdd}>+ Add</button>
              </div>
            </div>

            {loading ? <div style={{ padding:'30px', textAlign:'center' as const, color:'#94A3B8' }}>⏳ Loading...</div> : (
              <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:'12px' }}>
                <thead>
                  <tr style={{ background:'#1E1B4B' }}>
                    <th style={{ padding:'8px 10px', color:'#fff', textAlign:'left' as const, fontSize:'11px', width:'50px' }}>#</th>
                    {selType.has_color && <th style={{ padding:'8px 10px', color:'#fff', textAlign:'left' as const, fontSize:'11px', width:'50px' }}>Color</th>}
                    {selType.has_code && <th style={{ padding:'8px 10px', color:'#fff', textAlign:'left' as const, fontSize:'11px', width:'100px' }}>Code</th>}
                    <th style={{ padding:'8px 10px', color:'#fff', textAlign:'left' as const, fontSize:'11px' }}>Label</th>
                    <th style={{ padding:'8px 10px', color:'#fff', textAlign:'left' as const, fontSize:'11px' }}>Description</th>
                    {selType.has_extra_data && <th style={{ padding:'8px 10px', color:'#fff', textAlign:'left' as const, fontSize:'11px', width:'80px' }}>Data</th>}
                    <th style={{ padding:'8px 10px', color:'#fff', textAlign:'left' as const, fontSize:'11px', width:'80px' }}>Status</th>
                    <th style={{ padding:'8px 10px', color:'#fff', textAlign:'left' as const, fontSize:'11px', width:'140px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length===0 ? (
                    <tr><td colSpan={8} style={{ padding:'30px', textAlign:'center' as const, color:'#94A3B8' }}>
                      {search ? 'Koi value nahi mili' : '+ Add button se naya value add karo'}
                    </td></tr>
                  ) : filtered.map((v, i) => (
                    <tr key={v.id} style={{ background: !v.is_active?'#FEF2F2': i%2===0?'#F8FAFC':'#fff', borderBottom:'1px solid #E2E8F0', opacity: v.is_active?1:0.65 }}>
                      <td style={{ padding:'8px 10px', color:'#94A3B8', textAlign:'center' as const }}>{v.sort_order}</td>
                      {selType.has_color && <td style={{ padding:'8px 10px' }}>
                        {v.color && <div style={{ width:'22px', height:'22px', borderRadius:'50%', background:v.color, border:'2px solid rgba(0,0,0,0.1)' }}/>}
                      </td>}
                      {selType.has_code && <td style={{ padding:'8px 10px' }}>
                        <span style={{ padding:'2px 7px', background:v.color||'#EDE9FE', color: v.color?'#fff':'#7C3AED', borderRadius:'5px', fontSize:'10px', fontWeight:600 }}>{v.code}</span>
                      </td>}
                      <td style={{ padding:'8px 10px', fontWeight:500 }}>{v.label}</td>
                      <td style={{ padding:'8px 10px', color:'#64748B', fontSize:'11px' }}>{v.description||'—'}</td>
                      {selType.has_extra_data && <td style={{ padding:'8px 10px' }}>
                        {v.extra_data && <button onClick={()=>alert(JSON.stringify(v.extra_data,null,2))} style={{ padding:'2px 7px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>View</button>}
                      </td>}
                      <td style={{ padding:'8px 10px' }}>
                        <span style={{ padding:'2px 7px', borderRadius:'6px', fontSize:'10px', fontWeight:500, background: v.is_active?'#DCFCE7':'#FEE2E2', color: v.is_active?'#16A34A':'#DC2626' }}>
                          {v.is_active?'Active':'Off'}
                        </span>
                        {v.is_system && <span style={{ marginLeft:'3px', fontSize:'9px', color:'#94A3B8' }}>sys</span>}
                      </td>
                      <td style={{ padding:'8px 10px' }}>
                        <div style={{ display:'flex', gap:'4px' }}>
                          <button onClick={()=>openEdit(v)} style={{ padding:'4px 8px', background:'#EDE9FE', border:'none', borderRadius:'5px', cursor:'pointer', fontSize:'10px', color:'#7C3AED' }}>✏️</button>
                          <button onClick={()=>toggle(v)} disabled={v.is_system&&v.is_active} style={{ padding:'4px 8px', border:'none', borderRadius:'5px', cursor: v.is_system&&v.is_active?'not-allowed':'pointer', fontSize:'10px', background: v.is_active?'#FEE2E2':'#DCFCE7', color: v.is_active?'#DC2626':'#16A34A', opacity: v.is_system&&v.is_active?0.4:1 }}>
                            {v.is_active?'🔴':'🟢'}
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

      {/* Value Modal */}
      {showValueForm && selType && (
        <Modal title={editValue?`✏️ Edit — ${editValue.label}`:`+ Add — ${selType.name}`} onClose={()=>setShowValueForm(false)} onSave={saveVal} saveLabel={editValue?'Update':'Add Value'}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'10px' }}>
            {selType.has_code && (
              <div><label style={C.lbl}>Code<span style={{color:'#DC2626'}}> *</span></label>
                <input style={{...C.inp,fontFamily:'monospace',textTransform:'uppercase' as const}} placeholder="CODE" value={vf.code} onChange={e=>setVf(v=>({...v,code:e.target.value.toUpperCase()}))} disabled={!!editValue?.is_system} /></div>
            )}
            <div><label style={C.lbl}>Label<span style={{color:'#DC2626'}}> *</span></label>
              <input style={C.inp} placeholder="Display name" value={vf.label} onChange={e=>setVf(v=>({...v,label:e.target.value}))} /></div>
          </div>
          <div style={{marginBottom:'10px'}}><label style={C.lbl}>Description</label>
            <input style={C.inp} placeholder="Optional" value={vf.description} onChange={e=>setVf(v=>({...v,description:e.target.value}))} /></div>
          {selType.has_color && (
            <div style={{marginBottom:'10px'}}><label style={C.lbl}>Color</label>
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap' as const,marginTop:'4px'}}>
                {COLORS.map(col=>(
                  <div key={col} onClick={()=>setVf(v=>({...v,color:col}))} style={{width:'26px',height:'26px',borderRadius:'50%',background:col,cursor:'pointer',border:vf.color===col?'3px solid #0F172A':'2px solid transparent',boxShadow:vf.color===col?'0 0 0 2px #fff inset':'none'}}/>
                ))}
                <input type="color" value={vf.color} onChange={e=>setVf(v=>({...v,color:e.target.value}))} style={{width:'26px',height:'26px',border:'none',cursor:'pointer',borderRadius:'50%',padding:0}} />
              </div>
            </div>
          )}
          <div style={{marginBottom:'10px'}}><label style={C.lbl}>Sort Order</label>
            <input type="number" style={C.inp} value={vf.sort_order} onChange={e=>setVf(v=>({...v,sort_order:parseInt(e.target.value)||0}))} /></div>
          {selType.has_extra_data && (
            <div style={{marginBottom:'10px'}}><label style={C.lbl}>Extra Data (JSON)</label>
              <textarea style={{...C.inp,height:'90px',resize:'vertical' as const,fontFamily:'monospace',fontSize:'11px'}} value={vf.extra_data} onChange={e=>setVf(v=>({...v,extra_data:e.target.value}))} placeholder='{"key":"value"}'/></div>
          )}
        </Modal>
      )}

      {/* Type Modal */}
      {showTypeForm && selCat && (
        <Modal title={`+ New Master Type — ${selCat.name}`} onClose={()=>setShowTypeForm(false)} onSave={saveType} saveLabel="Create">
          <div style={{padding:'8px 12px',background:'#DBEAFE',borderRadius:'8px',fontSize:'11px',color:'#1D4ED8',marginBottom:'12px'}}>💡 New master type banne ke baad isme values add kar sakte ho</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'10px'}}>
            <div><label style={C.lbl}>Code (unique)<span style={{color:'#DC2626'}}> *</span></label>
              <input style={{...C.inp,fontFamily:'monospace'}} placeholder="my_master" value={tf.code} onChange={e=>setTf(t=>({...t,code:e.target.value.toLowerCase().replace(/\s/g,'_')}))} /></div>
            <div><label style={C.lbl}>Name<span style={{color:'#DC2626'}}> *</span></label>
              <input style={C.inp} placeholder="My Master Name" value={tf.name} onChange={e=>setTf(t=>({...t,name:e.target.value}))} /></div>
          </div>
          <div style={{marginBottom:'10px'}}><label style={C.lbl}>Description</label>
            <input style={C.inp} placeholder="Yeh master kisliye use hoga?" value={tf.description} onChange={e=>setTf(t=>({...t,description:e.target.value}))} /></div>
          <div><label style={C.lbl}>Options</label>
            <div style={{display:'flex',gap:'14px',flexWrap:'wrap' as const,marginTop:'4px'}}>
              {[{k:'has_code',l:'Has Code'},{k:'has_color',l:'Has Color'},{k:'has_parent',l:'Has Parent'},{k:'has_extra_data',l:'Extra Fields (JSONB)'}].map(f=>(
                <label key={f.k} style={{display:'flex',gap:'5px',alignItems:'center',fontSize:'12px',cursor:'pointer'}}>
                  <input type="checkbox" checked={(tf as any)[f.k]} onChange={e=>setTf(t=>({...t,[f.k]:e.target.checked}))} />{f.l}
                </label>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Company Setup (7-Step Wizard) ──────────────────────────────────
function CompanySetup() {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Form data
  const [grp, setGrp] = useState({ name:'', code:'', pan:'', address:'' })
  const [co, setCo] = useState({ name:'', short_name:'', type:'Private Limited', industry:'Manufacturing', cin:'', pan:'', tan:'', doi:'', reg_address:'', corp_address:'' })
  const [locs, setLocs] = useState([{ name:'', type:'Head Office', address:'', city:'', state:'', pin:'', is_hq:true }])
  const [tax, setTax] = useState({ gst_number:'', gst_state:'', tds_circle:'', pan:'', tan:'' })
  const [labour, setLabour] = useState({ epf:true, epf_code:'', esic:true, esic_code:'', pt:false, pt_state:'', lwf:false, factory_act:false, factory_lic:'' })
  const [banks, setBanks] = useState([{ bank_name:'HDFC Bank', account_number:'', ifsc:'', type:'Salary Account', is_primary:true }])

  const stepIcons = ['🏢','🏭','📍','🧾','⚖️','🏦','✅']

  const addLoc = () => setLocs(l => [...l, { name:'', type:'Branch', address:'', city:'', state:'', pin:'', is_hq:false }])
  const addBank = () => setBanks(b => [...b, { bank_name:'SBI', account_number:'', ifsc:'', type:'Operating Account', is_primary:false }])

  const Inp = ({ label, value, onChange, placeholder='', type='text', req=false }: any) => (
    <div>
      <label style={C.lbl}>{label}{req && <span style={{ color:'#DC2626' }}> *</span>}</label>
      <input type={type} style={C.inp} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
  const Sel = ({ label, value, onChange, opts }: any) => (
    <div>
      <label style={C.lbl}>{label}</label>
      <select style={C.sel} value={value} onChange={e => onChange(e.target.value)}>
        {opts.map((o: string) => <option key={o}>{o}</option>)}
      </select>
    </div>
  )

  return (
    <div>
      {/* Steps Progress */}
      <div style={{ display:'flex', alignItems:'center', marginBottom:'24px', overflowX:'auto' as const, paddingBottom:'4px' }}>
        {STEPS.map((s, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', flexShrink:0 }}>
            <div onClick={() => i <= step && setStep(i)} style={{ display:'flex', flexDirection:'column' as const, alignItems:'center', cursor: i<=step?'pointer':'default', padding:'0 8px' }}>
              <div style={{ width:'38px', height:'38px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px', background: i<step?'#7C3AED': i===step?'#EDE9FE':'#F1F5F9', border: i===step?'2.5px solid #7C3AED':'2px solid transparent', marginBottom:'4px' }}>
                {i < step ? '✓' : stepIcons[i]}
              </div>
              <div style={{ fontSize:'10px', fontWeight: i===step?600:400, color: i===step?'#7C3AED': i<step?'#16A34A':'#94A3B8', whiteSpace:'nowrap' as const }}>{s}</div>
            </div>
            {i < STEPS.length-1 && <div style={{ width:'30px', height:'2px', background: i<step?'#7C3AED':'#E2E8F0', flexShrink:0 }}/>}
          </div>
        ))}
      </div>

      {error && <div style={{ padding:'10px 14px', background:'#FEE2E2', borderRadius:'8px', fontSize:'12px', color:'#DC2626', marginBottom:'14px' }}>⚠️ {error}</div>}

      {/* Step Content */}
      {step===0 && (
        <div style={C.card}>
          <div style={{ fontSize:'14px', fontWeight:600, marginBottom:'16px', color:'#7C3AED' }}>🏢 Group Setup</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <Inp label="Group Name" value={grp.name} onChange={(v:string)=>setGrp(g=>({...g,name:v}))} placeholder="Sharma Group" req />
            <Inp label="Group Code" value={grp.code} onChange={(v:string)=>setGrp(g=>({...g,code:v.toUpperCase()}))} placeholder="SG" />
            <Inp label="Group PAN" value={grp.pan} onChange={(v:string)=>setGrp(g=>({...g,pan:v.toUpperCase()}))} placeholder="AABCG1234D" />
            <Inp label="Registered Address" value={grp.address} onChange={(v:string)=>setGrp(g=>({...g,address:v}))} placeholder="Full address" />
          </div>
        </div>
      )}

      {step===1 && (
        <div style={C.card}>
          <div style={{ fontSize:'14px', fontWeight:600, marginBottom:'16px', color:'#1D4ED8' }}>🏭 Company Details</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <Inp label="Company Name" value={co.name} onChange={(v:string)=>setCo(c=>({...c,name:v}))} placeholder="Sharma Sons Manufacturing Pvt Ltd" req />
            <Inp label="Short Name" value={co.short_name} onChange={(v:string)=>setCo(c=>({...c,short_name:v}))} placeholder="SSM" />
            <Sel label="Company Type" value={co.type} onChange={(v:string)=>setCo(c=>({...c,type:v}))} opts={['Private Limited','Public Limited','LLP','Partnership Firm','Proprietorship','OPC']} />
            <Sel label="Industry" value={co.industry} onChange={(v:string)=>setCo(c=>({...c,industry:v}))} opts={['Manufacturing','Trading','Retail','IT','FMCG','Automotive','Pharmaceuticals','Others']} />
            <Inp label="CIN" value={co.cin} onChange={(v:string)=>setCo(c=>({...c,cin:v}))} placeholder="U29100HR2010PTC040123" />
            <Inp label="Company PAN" value={co.pan} onChange={(v:string)=>setCo(c=>({...c,pan:v.toUpperCase()}))} placeholder="AABCS1234D" />
            <Inp label="TAN" value={co.tan} onChange={(v:string)=>setCo(c=>({...c,tan:v.toUpperCase()}))} placeholder="DELS12345B" />
            <Inp label="Date of Incorporation" value={co.doi} onChange={(v:string)=>setCo(c=>({...c,doi:v}))} type="date" />
            <div style={{ gridColumn:'1/-1' }}><Inp label="Registered Office Address" value={co.reg_address} onChange={(v:string)=>setCo(c=>({...c,reg_address:v}))} placeholder="Full registered address" /></div>
            <div style={{ gridColumn:'1/-1' }}><Inp label="Corporate Office Address" value={co.corp_address} onChange={(v:string)=>setCo(c=>({...c,corp_address:v}))} placeholder="Full corporate address (if different)" /></div>
          </div>
        </div>
      )}

      {step===2 && (
        <div style={C.card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
            <div style={{ fontSize:'14px', fontWeight:600, color:'#16A34A' }}>📍 Locations</div>
            <button style={C.secBtn} onClick={addLoc}>+ Add Location</button>
          </div>
          {locs.map((loc, i) => (
            <div key={i} style={{ padding:'14px', background:'#F8FAFC', borderRadius:'10px', marginBottom:'10px', border:'1px solid #E2E8F0' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'10px' }}>
                <span style={{ fontSize:'12px', fontWeight:600, color:'#374151' }}>Location {i+1}</span>
                <label style={{ display:'flex', gap:'5px', alignItems:'center', fontSize:'11px', cursor:'pointer' }}>
                  <input type="checkbox" checked={loc.is_hq} onChange={e=>setLocs(l=>{const n=[...l];n[i]={...n[i],is_hq:e.target.checked};return n})} /> Head Office
                </label>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px' }}>
                <Inp label="Location Name" value={loc.name} onChange={(v:string)=>setLocs(l=>{const n=[...l];n[i]={...n[i],name:v};return n})} placeholder="Delhi Head Office" />
                <Sel label="Type" value={loc.type} onChange={(v:string)=>setLocs(l=>{const n=[...l];n[i]={...n[i],type:v};return n})} opts={['Head Office','Branch','Factory','Warehouse','Sales Office','Corporate Office']} />
                <Inp label="City" value={loc.city} onChange={(v:string)=>setLocs(l=>{const n=[...l];n[i]={...n[i],city:v};return n})} placeholder="New Delhi" />
                <Inp label="State" value={loc.state} onChange={(v:string)=>setLocs(l=>{const n=[...l];n[i]={...n[i],state:v};return n})} placeholder="Delhi" />
                <Inp label="PIN Code" value={loc.pin} onChange={(v:string)=>setLocs(l=>{const n=[...l];n[i]={...n[i],pin:v};return n})} placeholder="110001" />
                <Inp label="Address" value={loc.address} onChange={(v:string)=>setLocs(l=>{const n=[...l];n[i]={...n[i],address:v};return n})} placeholder="Full address" />
              </div>
            </div>
          ))}
        </div>
      )}

      {step===3 && (
        <div style={C.card}>
          <div style={{ fontSize:'14px', fontWeight:600, marginBottom:'16px', color:'#D97706' }}>🧾 Tax Registration</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            <Inp label="GST Number" value={tax.gst_number} onChange={(v:string)=>setTax(t=>({...t,gst_number:v.toUpperCase()}))} placeholder="29AABCS1234D1Z5" />
            <Inp label="GST State" value={tax.gst_state} onChange={(v:string)=>setTax(t=>({...t,gst_state:v}))} placeholder="Delhi" />
            <Inp label="TDS Circle / Ward" value={tax.tds_circle} onChange={(v:string)=>setTax(t=>({...t,tds_circle:v}))} placeholder="ITO Ward 4(1)" />
            <Inp label="Company PAN" value={tax.pan} onChange={(v:string)=>setTax(t=>({...t,pan:v.toUpperCase()}))} placeholder="AABCS1234D" />
            <Inp label="TAN" value={tax.tan} onChange={(v:string)=>setTax(t=>({...t,tan:v.toUpperCase()}))} placeholder="DELS12345B" />
          </div>
        </div>
      )}

      {step===4 && (
        <div style={C.card}>
          <div style={{ fontSize:'14px', fontWeight:600, marginBottom:'16px', color:'#7C3AED' }}>⚖️ Labour Law Configuration</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
            <div style={{ padding:'14px', background:'#EFF6FF', borderRadius:'10px' }}>
              <label style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'10px', cursor:'pointer' }}>
                <input type="checkbox" checked={labour.epf} onChange={e=>setLabour(l=>({...l,epf:e.target.checked}))} />
                <span style={{ fontSize:'13px', fontWeight:600, color:'#1D4ED8' }}>EPF Applicable</span>
              </label>
              {labour.epf && <Inp label="EPF Establishment Code" value={labour.epf_code} onChange={(v:string)=>setLabour(l=>({...l,epf_code:v}))} placeholder="DLCPM0000000000" />}
            </div>
            <div style={{ padding:'14px', background:'#F0FDF4', borderRadius:'10px' }}>
              <label style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'10px', cursor:'pointer' }}>
                <input type="checkbox" checked={labour.esic} onChange={e=>setLabour(l=>({...l,esic:e.target.checked}))} />
                <span style={{ fontSize:'13px', fontWeight:600, color:'#16A34A' }}>ESIC Applicable</span>
              </label>
              {labour.esic && <Inp label="ESIC Employer Code" value={labour.esic_code} onChange={(v:string)=>setLabour(l=>({...l,esic_code:v}))} placeholder="41000000000000" />}
            </div>
            <div style={{ padding:'14px', background:'#FFF7ED', borderRadius:'10px' }}>
              <label style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'10px', cursor:'pointer' }}>
                <input type="checkbox" checked={labour.pt} onChange={e=>setLabour(l=>({...l,pt:e.target.checked}))} />
                <span style={{ fontSize:'13px', fontWeight:600, color:'#D97706' }}>PT Applicable</span>
              </label>
              {labour.pt && <Inp label="PT State" value={labour.pt_state} onChange={(v:string)=>setLabour(l=>({...l,pt_state:v}))} placeholder="Maharashtra" />}
            </div>
            <div style={{ padding:'14px', background:'#FEF2F2', borderRadius:'10px' }}>
              <label style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'10px', cursor:'pointer' }}>
                <input type="checkbox" checked={labour.factory_act} onChange={e=>setLabour(l=>({...l,factory_act:e.target.checked}))} />
                <span style={{ fontSize:'13px', fontWeight:600, color:'#DC2626' }}>Factory Act Applicable</span>
              </label>
              {labour.factory_act && <Inp label="Factory License Number" value={labour.factory_lic} onChange={(v:string)=>setLabour(l=>({...l,factory_lic:v}))} placeholder="HR/FAC/2024/001" />}
            </div>
          </div>
        </div>
      )}

      {step===5 && (
        <div style={C.card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
            <div style={{ fontSize:'14px', fontWeight:600, color:'#0D9488' }}>🏦 Bank Accounts</div>
            <button style={C.secBtn} onClick={addBank}>+ Add Account</button>
          </div>
          {banks.map((bk, i) => (
            <div key={i} style={{ padding:'14px', background:'#F8FAFC', borderRadius:'10px', marginBottom:'10px', border:'1px solid #E2E8F0' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px' }}>
                <Sel label="Bank Name" value={bk.bank_name} onChange={(v:string)=>setBanks(b=>{const n=[...b];n[i]={...n[i],bank_name:v};return n})} opts={['HDFC Bank','State Bank of India','ICICI Bank','Punjab National Bank','Axis Bank','Bank of Baroda','Kotak Mahindra Bank','Canara Bank','Yes Bank']} />
                <Sel label="Account Type" value={bk.type} onChange={(v:string)=>setBanks(b=>{const n=[...b];n[i]={...n[i],type:v};return n})} opts={['Salary Account','Operating Account','Tax Account','Petty Cash']} />
                <Inp label="Account Number" value={bk.account_number} onChange={(v:string)=>setBanks(b=>{const n=[...b];n[i]={...n[i],account_number:v};return n})} placeholder="00000000000000" />
                <Inp label="IFSC Code" value={bk.ifsc} onChange={(v:string)=>setBanks(b=>{const n=[...b];n[i]={...n[i],ifsc:v.toUpperCase()};return n})} placeholder="HDFC0001234" />
                <div style={{ display:'flex', alignItems:'center', gap:'6px', paddingTop:'20px' }}>
                  <input type="checkbox" checked={bk.is_primary} onChange={e=>setBanks(b=>{const n=[...b];n[i]={...n[i],is_primary:e.target.checked};return n})} />
                  <label style={{ fontSize:'12px' }}>Primary Account</label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {step===6 && (
        <div style={C.card}>
          <div style={{ fontSize:'14px', fontWeight:600, marginBottom:'16px', color:'#16A34A' }}>✅ Review & Save</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'20px' }}>
            {[
              { l:'Group', v: grp.name||'—', c:'#7C3AED' },
              { l:'Company', v: co.name||'—', c:'#1D4ED8' },
              { l:'Locations', v: `${locs.filter(l=>l.name).length} locations`, c:'#16A34A' },
              { l:'GST', v: tax.gst_number||'Not added', c:'#D97706' },
              { l:'EPF', v: labour.epf?`Yes — ${labour.epf_code||'No code'}`:'Not applicable', c:'#0D9488' },
              { l:'Bank Accounts', v: `${banks.filter(b=>b.account_number).length} accounts`, c:'#374151' },
            ].map(item => (
              <div key={item.l} style={{ padding:'12px', background:'#F8FAFC', borderRadius:'8px', border:`1px solid ${item.c}22` }}>
                <div style={{ fontSize:'10px', color:'#94A3B8', marginBottom:'4px' }}>{item.l}</div>
                <div style={{ fontSize:'13px', fontWeight:500, color:item.c }}>{item.v}</div>
              </div>
            ))}
          </div>
          {saved && <div style={{ padding:'12px 16px', background:'#DCFCE7', borderRadius:'8px', fontSize:'13px', color:'#16A34A', marginBottom:'12px' }}>✅ Company setup saved successfully!</div>}
          <button style={{ ...C.priBtn, padding:'12px 24px', fontSize:'13px' }} onClick={() => setSaved(true)}>
            💾 Save Company Setup
          </button>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:'16px' }}>
        <button style={{ ...C.secBtn, opacity: step===0?0.4:1 }} onClick={() => step>0 && setStep(s=>s-1)} disabled={step===0}>← Back</button>
        {step < STEPS.length-1 && <button style={C.priBtn} onClick={() => setStep(s=>s+1)}>Next →</button>}
      </div>
    </div>
  )
}

// ── MAIN PAGE ──────────────────────────────────────────────────────
export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('company')

  const masterTabs = [
    { id:'company', label:'🔧 Company Setup', desc:'New company onboard karo' },
    { id:'masters', label:'⚙️ Master Setup', desc:'Add/Edit/Disable values' },
  ]

  return (
    <div style={C.page}>
      {/* Top Bar */}
      <div style={C.topbar}>
        <div>
          <div style={{ fontSize:'15px', fontWeight:600, color:'#fff' }}>Admin Setup</div>
          <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.5)' }}>Company Setup · Master Configuration · ezerhrms.com</div>
        </div>
        <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>Sharma Group · Admin</div>
      </div>

      {/* Main Tabs */}
      <div style={C.tabs}>
        {masterTabs.map(t => (
          <button key={t.id} style={C.tab(tab===t.id)} onClick={() => setTab(t.id as AdminTab)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={C.body}>
        {tab==='company' && <CompanySetup />}
        {tab==='masters' && <MasterSection />}
      </div>
    </div>
  )
}