'use client'
// app/dashboard/page.tsx — HR Dashboard home. Real data from Supabase.
// The sidebar/chrome is provided by app/dashboard/layout.tsx; this renders content only.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// Small muted captions read as labels, so the first real word is capitalised:
//   "3 companies" → "3 Companies"      "3yr anniversary" → "3yr Anniversary"
//   "62% active"  → "62% Active"       "approved MRFs"   → "Approved MRFs"
// A leading count/unit is stepped over rather than being capitalised itself, and a
// caption that already starts with a capital (e.g. "MRFs approved") is left untouched.
const capFirst = (s: any) => {
  const str = String(s ?? '')
  const first = str.match(/[A-Za-z]/)
  if (!first || first[0] === first[0].toUpperCase()) return str
  return str.replace(/(^|\s)([a-z])/, (_m, sep, ch) => sep + ch.toUpperCase())
}

const RECRUIT_STAGES = ['Applied','AI Screened','Telephonic','L1','L2','Optional Round','Shortlisted','Offer Sent','Joined','Rejected']
const STAGE_COLOR: Record<string,string> = {
  'Applied':'#7C3AED','AI Screened':'#6D28D9','Telephonic':'#D97706','L1':'#DB2777',
  'L2':'#059669','Optional Round':'#4F46E5','Shortlisted':'#16A34A','Offer Sent':'#0891B2','Joined':'#15803D','Rejected':'#DC2626',
}
const PALETTE = ['#7C3AED','#3B82F6','#16A34A','#F97316','#EF4444','#0891B2','#D946EF','#65A30D']

const fmtMoney = (n: number) => '₹' + (n >= 10000000 ? (n/10000000).toFixed(1)+'Cr' : n >= 100000 ? (n/100000).toFixed(1)+'L' : n.toLocaleString('en-IN'))
const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
function timeAgo(s?: string) {
  if (!s) return ''
  const d = (Date.now() - new Date(s).getTime()) / 1000
  if (d < 3600) return Math.max(1, Math.floor(d/60)) + 'm ago'
  if (d < 86400) return Math.floor(d/3600) + 'h ago'
  const days = Math.floor(d/86400)
  return days === 1 ? 'Yesterday' : days + 'd ago'
}
// days until the next month/day occurrence of a date (0 = today)
function daysUntilAnnual(iso?: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const now = new Date(); now.setHours(0,0,0,0)
  let next = new Date(now.getFullYear(), d.getMonth(), d.getDate())
  if (next < now) next = new Date(now.getFullYear()+1, d.getMonth(), d.getDate())
  return Math.round((next.getTime() - now.getTime())/86400000)
}

const card: React.CSSProperties = { background:'#fff', borderRadius:10, padding:'12px 14px', border:'1px solid #E2E8F0' }
const cardTitle: React.CSSProperties = { fontSize:12, fontWeight:600, color:'#374151', marginBottom:10, display:'flex', justifyContent:'space-between', alignItems:'center' }

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [wished, setWished] = useState<string[]>([])      // employee ids already wished
  const [wishing, setWishing] = useState<string | null>(null)
  const [wishErr, setWishErr] = useState('')
  const [d, setD] = useState<any>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [drillQ, setDrillQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const today = new Date(); today.setHours(0,0,0,0)
    const [empR, compR, candR, mrfR, audR, deptR, locR] = await Promise.all([
      supabase.from('employees').select('id, full_name, first_name, employment_status, blacklisted, date_of_birth, group_doj, last_working_date, company_id, location_id, companies(company_name), locations!location_id(location_name)').neq('is_test', true),
      supabase.from('companies').select('id, company_name'),
      supabase.from('candidates').select('id, full_name, stage, onboarding_date, blacklisted, created_at, designation, mrf_id, offer_accepted'),
      supabase.from('manpower_requisitions').select('id, status, no_of_openings, openings, designation, position, department_id, location_id'),
      supabase.from('recruitment_audit_logs').select('action_type, details, created_at').order('created_at', { ascending:false }).limit(8),
      // department / location names for the pipeline drill-down (candidate → MRF → dept/loc)
      supabase.from('departments').select('id, dept_name'),
      supabase.from('locations').select('id, location_name'),
    ])
    const emps = empR.data || [], cands = candR.data || [], mrfs = mrfR.data || [], audit = audR.data || []
    const mrfById = new Map((mrfs as any[]).map((m: any) => [m.id, m]))
    const deptById = new Map(((deptR.data as any[]) || []).map((x: any) => [x.id, x.dept_name]))
    const locById = new Map(((locR.data as any[]) || []).map((x: any) => [x.id, x.location_name]))
    // A candidate inherits its department and location from the MRF it was raised against.
    const mrfOf = (c: any) => mrfById.get(c.mrf_id) || {}
    const deptOf = (c: any) => deptById.get(mrfOf(c).department_id) || '—'
    const locOf = (c: any) => locById.get(mrfOf(c).location_id) || '—'
    const isLeft = (e: any) => e.blacklisted || (e.last_working_date && new Date(e.last_working_date) < today)
    const activeEmps: any[] = emps.filter((e: any) => !isLeft(e))

    // group helpers
    const byName = (arr: any[], pick: (x: any) => string) => {
      const m: Record<string, number> = {}
      for (const x of arr) { const k = pick(x) || '—'; m[k] = (m[k]||0)+1 }
      return Object.entries(m).sort((a,b) => b[1]-a[1])
    }
    const companyRows = byName(activeEmps, (e) => e.companies?.company_name).slice(0, 6)
    const locationRows = byName(activeEmps, (e) => e.locations?.location_name).slice(0, 8)

    const approvedMrfs = mrfs.filter((m: any) => m.status === 'APPROVED')
    const openPositions = approvedMrfs.reduce((s: number, m: any) => s + (Number(m.no_of_openings || m.openings || 0)), 0)
    const pipelineCands = cands.filter((c: any) => !['Joined','Rejected'].includes(c.stage) && !c.blacklisted)
    const inPipeline = pipelineCands.length
    // Mirrors the Onboarding module's candidate list exactly (see app/dashboard/onboarding
    // — .or('onboarding_date.not.is.null,offer_accepted.is.true,stage.eq.Joined') minus
    // blacklisted). Deliberately NOT limited to the next 30 days: a joining date that has
    // already passed still means the person is in onboarding and must stay visible, which
    // is why this card previously read 0 while the onboarding list had rows.
    const joiningCands = cands
      .filter((c: any) => (c.onboarding_date || c.offer_accepted === true || c.stage === 'Joined') && !c.blacklisted)
      .sort((a: any, b: any) => {
        const av = a.onboarding_date ? new Date(a.onboarding_date).getTime() : Infinity
        const bv = b.onboarding_date ? new Date(b.onboarding_date).getTime() : Infinity
        return av - bv
      })
    const joiningSoon = joiningCands.length

    // Drill-down detail rows per stat card (name / sub / meta).
    const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'
    const details: Record<string, any[]> = {
      total: [...emps].sort((a: any,b: any) => (a.full_name||'').localeCompare(b.full_name||''))
        .map((e: any) => ({ name: e.full_name || '—', sub: e.companies?.company_name || '—', meta: isLeft(e) ? 'Exited' : (e.employment_status || 'Active'), tone: isLeft(e) ? '#DC2626' : '#16A34A' })),
      active: [...activeEmps].sort((a: any,b: any) => (a.full_name||'').localeCompare(b.full_name||''))
        .map((e: any) => ({ name: e.full_name || '—', sub: e.companies?.company_name || '—', meta: e.locations?.location_name || '—', tone:'#16A34A' })),
      open: approvedMrfs.map((m: any) => ({ name: m.designation || m.position || '—', sub: `${Number(m.no_of_openings || m.openings || 0)} opening(s)`, meta: m.status || 'APPROVED', tone:'#3B82F6' })),
      pipeline: [...pipelineCands].sort((a: any,b: any) => RECRUIT_STAGES.indexOf(a.stage) - RECRUIT_STAGES.indexOf(b.stage))
        .map((c: any) => ({ name: c.full_name || '—', dept: deptOf(c), status: c.stage || '—', location: locOf(c), tone: STAGE_COLOR[c.stage] || '#7C3AED' })),
      // already ordered by joining date (undated last) when joiningCands was built
      joining: joiningCands.map((c: any) => ({ name: c.full_name || '—', sub: c.designation || '—', meta: fmtDate(c.onboarding_date), tone:'#0891B2' })),
    }

    const pipeline = RECRUIT_STAGES.filter(s => s !== 'Rejected').map(s => ({ stage: s, count: cands.filter((c: any) => c.stage === s).length }))

    // recent activity
    const actText = (a: any) => {
      const who = a.details?.candidate_name || a.details?.full_name || a.details?.name || ''
      const map: Record<string,string> = {
        OFFER_LETTER_SENT: `Offer letter sent${who?` — ${who}`:''}`,
        OFFER_REVISE_REQUESTED: `Offer revision requested${who?` — ${who}`:''}`,
        MAGIC_LINK_SENT: `Onboarding link sent${who?` — ${who}`:''}`,
      }
      return map[a.action_type] || (a.action_type || 'Activity').replace(/_/g,' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase()) + (who?` — ${who}`:'')
    }
    let activity = audit.map((a: any) => ({ icon:'📌', text: actText(a), time: timeAgo(a.created_at) }))
    if (!activity.length) {
      activity = [...cands].sort((a: any,b: any) => new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,6)
        .map((c: any) => ({ icon:'👤', text:`Candidate added — ${c.full_name}${c.designation?` (${c.designation})`:''}`, time: timeAgo(c.created_at) }))
    }

    // (see sendWish below — the Wish button writes a real ESS notification)
    // celebrations (birthdays + anniversaries within 7 days)
    const celeb: any[] = []
    for (const e of activeEmps) {
      const bd = daysUntilAnnual(e.date_of_birth)
      if (bd !== null && bd <= 7) celeb.push({ id: e.id, name: e.full_name, type:'birthday', days: bd, company: e.companies?.company_name || '' })
      const an = daysUntilAnnual(e.group_doj)
      if (an !== null && an <= 7 && e.group_doj) {
        const yrs = Math.round((Date.now() - new Date(e.group_doj).getTime())/(365.25*24*3600*1000))
        if (yrs >= 1) celeb.push({ id: e.id, name: e.full_name, type:'anniversary', days: an, years: yrs, company: e.companies?.company_name || '' })
      }
    }
    celeb.sort((a,b) => a.days - b.days)

    setD({
      total: emps.length, active: activeEmps.length, openPositions, inPipeline, joiningSoon,
      companyRows, locationRows, pipeline, details,
      activity: activity.slice(0,6),
      today: celeb.filter(c => c.days <= 0), week: celeb.filter(c => c.days > 0).slice(0,6),
    })
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Send the wish for real — it lands in the employee's ESS → 🔔 Notifications.
  // Previously this button only flipped local state, so nothing ever reached them.
  async function sendWish(c: any) {
    if (!c?.id || wished.includes(c.id)) return
    setWishing(c.id); setWishErr('')
    const isBday = c.type === 'birthday'
    const { error } = await supabase.from('ess_notifications').insert({
      employee_id: c.id,
      category: isBday ? 'BIRTHDAY' : 'ANNIVERSARY',
      title: isBday ? '🎂 Happy Birthday!' : `🌟 Happy Work Anniversary — ${c.years} year${c.years > 1 ? 's' : ''}!`,
      body: isBday
        ? `Wishing you a very happy birthday, ${c.name}! Have a wonderful year ahead. — Team HR`
        : `Congratulations on completing ${c.years} year${c.years > 1 ? 's' : ''} with us, ${c.name}. Thank you for everything you do! — Team HR`,
      is_read: false,
    })
    setWishing(null)
    if (error) { setWishErr(`Could not send to ${c.name}: ${error.message}`); return }
    setWished(p => [...p, c.id])
  }

  if (loading || !d) return <div style={{ padding:40, textAlign:'center', color:'#7C3AED', fontFamily:'"DM Sans",sans-serif' }}>Loading dashboard…</div>

  const stats = [
    { key:'total', label:'Total Employees', value: d.total.toLocaleString('en-IN'), sub:`${d.companyRows.length} companies`, color:'#7C3AED' },
    { key:'active', label:'Active', value: d.active.toLocaleString('en-IN'), sub: d.total ? `${Math.round(d.active/d.total*100)}% active` : '—', color:'#16A34A' },
    { key:'open', label:'Open Positions', value: d.openPositions, sub:'approved MRFs', color:'#3B82F6' },
    { key:'pipeline', label:'In Pipeline', value: d.inPipeline, sub:'active candidates', color:'#F97316' },
    { key:'joining', label:'Joining Soon', value: d.joiningSoon, sub:'in onboarding', color:'#0891B2' },
  ]
  const DRILL_TITLES: Record<string,string> = { total:'All Employees', active:'Active Employees', open:'Open Positions', pipeline:'Candidates in Pipeline', joining:'Candidates in Onboarding' }
  // A drill-down that declares columns renders as a proper headed table; the rest keep
  // the compact name / sub / badge list.
  const DRILL_COLUMNS: Record<string, { key:string; label:string; flex:number; pill?:boolean }[]> = {
    pipeline: [
      { key:'name',     label:'Candidate Name', flex:1.5 },
      { key:'dept',     label:'Department',     flex:1.2 },
      { key:'status',   label:'Status',         flex:1, pill:true },
      { key:'location', label:'Location',       flex:1.2 },
    ],
  }
  const cols = sel ? DRILL_COLUMNS[sel] : undefined
  const selRows: any[] = sel ? (d.details?.[sel] || []) : []
  const filteredRows = drillQ.trim()
    ? selRows.filter((r: any) => (cols ? cols.map(c => r[c.key]) : [r.name, r.sub, r.meta])
        .some((x: any) => String(x||'').toLowerCase().includes(drillQ.toLowerCase())))
    : selRows
  const maxCo = d.companyRows.reduce((m: number, [,v]: any) => Math.max(m, v), 0) || 1
  const maxLoc = d.locationRows.reduce((m: number, [,v]: any) => Math.max(m, v), 0) || 1
  const maxStage = d.pipeline.reduce((m: number, p: any) => Math.max(m, p.count), 0) || 1

  return (
    <div style={{ background:'#F0F4F8', minHeight:'100vh', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:13, color:'#0F172A' }}>
      {/* Header */}
      <div style={{ background:'#fff', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #E2E8F0' }}>
        <div style={{ fontSize:14, fontWeight:600 }}>HR Dashboard</div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ fontSize:11, color:'#64748B', background:'#F1F5F9', padding:'4px 10px', borderRadius:6 }}>{monthLabel}</div>
          <button onClick={load} style={{ fontSize:11, color:'#6D28D9', background:'#EDE9FE', border:'none', padding:'5px 12px', borderRadius:6, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ padding:14 }}>
        {/* Stats — click a card to drill down */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(172px,1fr))', gap:8, marginBottom: sel ? 8 : 12 }}>
          {stats.map((st) => {
            const isSel = sel === st.key
            return (
              <div key={st.key} onClick={() => { setSel(isSel ? null : st.key); setDrillQ('') }} title="Click to view details"
                style={{ ...card, borderTop:`3px solid ${st.color}`, cursor:'pointer', transition:'box-shadow .15s, transform .1s',
                  boxShadow: isSel ? `0 0 0 2px ${st.color}` : 'none',
                  background: isSel ? '#FAFAFF' : '#fff', position:'relative' }}>
                <div style={{ fontSize:11.5, color:'#94A3B8', marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.04em', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>{st.label}</span>
                  <span style={{ fontSize:12, color: isSel ? st.color : '#CBD5E1' }}>{isSel ? '▲' : '▾'}</span>
                </div>
                <div style={{ fontSize:23, fontWeight:700, color:'#0F172A', marginBottom:3 }}>{st.value}</div>
                <div style={{ fontSize:12.5, color:'#64748B', fontWeight:700 }}>{capFirst(st.sub)}</div>
              </div>
            )
          })}
        </div>

        {/* Drill-down detail panel */}
        {sel && (
          <div style={{ ...card, marginBottom:12, padding:0, overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, padding:'10px 14px', borderBottom:'1px solid #F1F5F9', flexWrap:'wrap' }}>
              <div style={{ fontSize:13, fontWeight:600, color:'#0F172A' }}>
                {DRILL_TITLES[sel]} <span style={{ fontSize:11, fontWeight:500, color:'#94A3B8' }}>· {filteredRows.length}{drillQ?` of ${selRows.length}`:''}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input value={drillQ} onChange={e => setDrillQ(e.target.value)} placeholder="Search…"
                  style={{ fontSize:12, padding:'5px 10px', border:'1px solid #E2E8F0', borderRadius:6, outline:'none', fontFamily:'inherit', width:160 }} />
              </div>
            </div>
            {cols && filteredRows.length > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 14px', background:'#F8FAFC', borderBottom:'1px solid #E2E8F0' }}>
                <div style={{ width:22, flexShrink:0 }} />
                {cols.map(c => (
                  <div key={c.key} style={{ flex:c.flex, minWidth:0, fontSize:10, fontWeight:700, color:'#64748B', textTransform:'uppercase', letterSpacing:'.04em' }}>{c.label}</div>
                ))}
              </div>
            )}
            <div style={{ maxHeight:340, overflowY:'auto' }}>
              {filteredRows.length === 0 && <div style={{ fontSize:12, color:'#94A3B8', padding:'18px 14px', textAlign:'center' }}>No records.</div>}
              {cols
                ? filteredRows.map((r: any, i: number) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderBottom: i < filteredRows.length-1 ? '1px solid #F8FAFC' : 'none' }}>
                      <div style={{ width:22, fontSize:10, color:'#CBD5E1', flexShrink:0, textAlign:'right' }}>{i+1}</div>
                      {cols.map(c => (
                        <div key={c.key} style={{ flex:c.flex, minWidth:0 }}>
                          {c.pill
                            ? <span style={{ fontSize:10.5, fontWeight:600, color: r.tone || '#64748B', background:`${(r.tone||'#64748B')}14`, padding:'3px 9px', borderRadius:99, whiteSpace:'nowrap' }}>{r[c.key]}</span>
                            : <div style={{ fontSize:12.5, fontWeight: c.key==='name' ? 500 : 400, color: c.key==='name' ? '#0F172A' : '#475569', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r[c.key]}</div>}
                        </div>
                      ))}
                    </div>
                  ))
                : filteredRows.map((r: any, i: number) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', borderBottom: i < filteredRows.length-1 ? '1px solid #F8FAFC' : 'none' }}>
                      <div style={{ width:22, fontSize:10, color:'#CBD5E1', flexShrink:0, textAlign:'right' }}>{i+1}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12.5, fontWeight:500, color:'#0F172A', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.name}</div>
                        <div style={{ fontSize:11, color:'#94A3B8', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.sub}</div>
                      </div>
                      <div style={{ fontSize:10.5, fontWeight:600, color: r.tone || '#64748B', background:`${(r.tone||'#64748B')}14`, padding:'3px 9px', borderRadius:99, flexShrink:0, whiteSpace:'nowrap' }}>{r.meta}</div>
                    </div>
                  ))}
            </div>
          </div>
        )}

        {/* Location + Company headcount */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
          <div style={card}>
            <div style={cardTitle}>📍 Location-wise Headcount</div>
            {d.locationRows.length === 0 && <div style={{ fontSize:11, color:'#94A3B8' }}>No employee location data.</div>}
            {d.locationRows.map(([name, count]: any, i: number) => (
              <div key={name} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <div style={{ width:110, fontSize:11, color:'#64748B', textAlign:'right', flexShrink:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</div>
                <div style={{ flex:1, height:8, background:'#F1F5F9', borderRadius:4, overflow:'hidden' }}><div style={{ height:'100%', width:`${(count/maxLoc)*100}%`, background:PALETTE[i%PALETTE.length], borderRadius:4 }} /></div>
                <div style={{ width:34, fontSize:11, color:'#374151', fontWeight:600 }}>{count}</div>
              </div>
            ))}
          </div>

          <div style={card}>
            <div style={cardTitle}>🏢 Company-wise Headcount</div>
            {d.companyRows.length === 0 && <div style={{ fontSize:11, color:'#94A3B8' }}>No employee company data.</div>}
            {d.companyRows.map(([name, count]: any, i: number) => (
              <div key={name} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <div style={{ width:110, fontSize:11, color:'#64748B', textAlign:'right', flexShrink:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</div>
                <div style={{ flex:1, height:8, background:'#F1F5F9', borderRadius:4, overflow:'hidden' }}><div style={{ height:'100%', width:`${(count/maxCo)*100}%`, background:PALETTE[i%PALETTE.length], borderRadius:4 }} /></div>
                <div style={{ width:34, fontSize:11, color:'#374151', fontWeight:600 }}>{count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom row */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
          {/* Recruitment pipeline */}
          <div style={card}>
            <div style={cardTitle}>🎯 Recruitment Pipeline</div>
            {d.pipeline.map((p: any) => (
              <div key={p.stage} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                <div style={{ width:90, fontSize:10.5, color:'#64748B', textAlign:'right', flexShrink:0 }}>{p.stage}</div>
                <div style={{ flex:1, height:7, background:'#F1F5F9', borderRadius:4, overflow:'hidden' }}><div style={{ height:'100%', width:`${(p.count/maxStage)*100}%`, background: STAGE_COLOR[p.stage]||'#7C3AED', borderRadius:4 }} /></div>
                <div style={{ width:24, fontSize:11, color:'#374151', fontWeight:600 }}>{p.count}</div>
              </div>
            ))}
          </div>

          {/* Recent activity */}
          <div style={card}>
            <div style={cardTitle}>🕐 Recent Activity</div>
            {d.activity.length === 0 && <div style={{ fontSize:11, color:'#94A3B8' }}>No recent activity.</div>}
            {d.activity.map((a: any, i: number) => (
              <div key={i} style={{ display:'flex', gap:8, padding:'6px 0', borderBottom: i < d.activity.length-1 ? '1px solid #F1F5F9' : 'none', alignItems:'flex-start' }}>
                <div style={{ width:24, height:24, borderRadius:7, background:'#EDE9FE', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, flexShrink:0 }}>{a.icon}</div>
                <div><div style={{ fontSize:11, color:'#374151', lineHeight:1.4 }}>{a.text}</div><div style={{ fontSize:10, color:'#94A3B8', marginTop:2 }}>{a.time}</div></div>
              </div>
            ))}
          </div>

          {/* Celebrations */}
          <div style={card}>
            <div style={cardTitle}>🎉 Birthdays &amp; Anniversaries</div>
            <div style={{ fontSize:10, fontWeight:600, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>Today</div>
            {d.today.length === 0 && <div style={{ fontSize:11, color:'#94A3B8', marginBottom:6 }}>Nothing today.</div>}
            {d.today.map((c: any, i: number) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 0', borderBottom:'1px solid #F1F5F9' }}>
                <div style={{ fontSize:18 }}>{c.type==='birthday'?'🎂':'🌟'}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:500, color:'#374151' }}>{c.name}</div>
                  <div style={{ fontSize:10, color:'#94A3B8', fontWeight:700 }}>{c.type==='birthday'?'Happy Birthday!':`${c.years} Years with us!`}{c.company?` · ${c.company}`:''}</div>
                </div>
                <button onClick={() => sendWish(c)} disabled={wished.includes(c.id) || wishing === c.id}
                  title={wished.includes(c.id) ? 'Delivered to their ESS notifications' : 'Send a wish to their ESS dashboard'}
                  style={{ padding:'3px 8px', borderRadius:6, border:'none', cursor: wished.includes(c.id)||wishing===c.id?'default':'pointer', fontSize:10, fontWeight:500, background: wished.includes(c.id)?'#DCFCE7':'#7C3AED', color: wished.includes(c.id)?'#16A34A':'#fff', opacity: wishing===c.id?0.6:1 }}>
                  {wished.includes(c.id) ? '✓ Sent' : wishing === c.id ? 'Sending…' : 'Wish'}
                </button>
              </div>
            ))}
            {wishErr && <div style={{ fontSize:10, color:'#DC2626', background:'#FEF2F2', borderRadius:6, padding:'6px 8px', marginTop:6 }}>{wishErr}</div>}
            <div style={{ fontSize:10, fontWeight:600, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'.04em', margin:'8px 0 6px' }}>This Week</div>
            {d.week.length === 0 && <div style={{ fontSize:11, color:'#94A3B8' }}>Nothing this week.</div>}
            {d.week.map((c: any, i: number) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 0', borderBottom: i < d.week.length-1 ? '1px solid #F8FAFC' : 'none' }}>
                <div style={{ fontSize:14 }}>{c.type==='birthday'?'🎂':'🌟'}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, color:'#374151' }}>{c.name}</div>
                  <div style={{ fontSize:10, color:'#94A3B8', fontWeight:700 }}>{capFirst(c.type==='anniversary'?`${c.years}yr anniversary`:'Birthday')} · in {c.days}d</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
