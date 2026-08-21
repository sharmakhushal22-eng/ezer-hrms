'use client'
// app/dashboard/page.tsx — HR Dashboard home. Real data from Supabase.
// The sidebar/chrome is provided by app/dashboard/layout.tsx; this renders content only.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Page, PageHeader, Card, Section, Stat, StatRow, Button, Badge, Input, Empty,
  Person, TableWrap, Th, Td, Tr, Skeleton, Notice,
  C, F, W, S, R, E, M, numeric, eyebrow, tone,
  IconEmployees, IconCheck, IconRecruitment, IconOnboarding, IconClock, IconSearch,
} from '@/lib/ui'

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
// A funnel reads left to right as "further along". Colour follows that: violet
// through the middle stages, green once the outcome is good, red when it is not.
// The old set gave every stage its own unrelated hue, which encoded nothing.
const STAGE_COLOR: Record<string,string> = {
  'Applied':'#B39BF5','AI Screened':'#9B7BF0','Telephonic':'#8A66EC','L1':'#7B54E8',
  'L2':'#6D3BEF','Optional Round':'#5F30D4','Shortlisted':'#0B7A5B','Offer Sent':'#0B7A5B',
  'Joined':'#0B7A5B','Rejected':'#C42B32',
}

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

/**
 * A labelled horizontal bar. Used for headcount by location and by company,
 * where the only quantity that matters is the length of the bar relative to the
 * longest one — so every bar is the same violet. Colouring them differently
 * would imply the categories mean something they do not.
 */
function BarRow({ label, count, max, colour = C.violet }: {
  label: string; count: number; max: number; colour?: string
}) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:S.sm, marginBottom:7 }}>
      <div title={label} style={{
        width:126, fontSize:F.tiny, color:C.muted, textAlign:'right', flexShrink:0,
        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
      }}>{label}</div>
      <div style={{ flex:1, height:7, background:C.sunken, borderRadius:R.pill, overflow:'hidden' }}>
        <div style={{
          height:'100%', width:`${Math.max((count/max)*100, 2)}%`, background:colour,
          borderRadius:R.pill, transition:`width ${M.ease}`,
        }} />
      </div>
      <div style={{ width:32, fontSize:F.tiny, color:C.ink, fontWeight:W.semi, ...numeric }}>{count}</div>
    </div>
  )
}

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

  // A skeleton shaped like the page it replaces, so the layout does not jump
  // when the data lands.
  if (loading || !d) return (
    <Page>
      <PageHeader title="HR Dashboard" context={monthLabel} />
      <StatRow>{Array.from({length:5}).map((_,i)=>(
        <Card key={i} pad={S.md} elevation="flat">
          <Skeleton w={72} h={9} /><div style={{height:10}}/><Skeleton w={54} h={26} />
        </Card>))}</StatRow>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:S.md }}>
        <Card><Skeleton w={140} h={12}/><div style={{height:14}}/>
          {Array.from({length:5}).map((_,i)=><div key={i} style={{marginBottom:9}}><Skeleton h={8}/></div>)}</Card>
        <Card><Skeleton w={140} h={12}/><div style={{height:14}}/>
          {Array.from({length:5}).map((_,i)=><div key={i} style={{marginBottom:9}}><Skeleton h={8}/></div>)}</Card>
      </div>
    </Page>
  )

  const stats = [
    { key:'total',    label:'Total Employees', value: d.total.toLocaleString('en-IN'), sub:`${d.companyRows.length} companies`,  t:'violet'   as const, icon:<IconEmployees size={16}/> },
    { key:'active',   label:'Active',          value: d.active.toLocaleString('en-IN'), sub: d.total ? `${Math.round(d.active/d.total*100)}% active` : '—', t:'positive' as const, icon:<IconCheck size={16}/> },
    { key:'open',     label:'Open Positions',  value: d.openPositions, sub:'approved MRFs',      t:'info'    as const, icon:<IconRecruitment size={16}/> },
    { key:'pipeline', label:'In Pipeline',     value: d.inPipeline,    sub:'active candidates',  t:'warning' as const, icon:<IconClock size={16}/> },
    { key:'joining',  label:'Joining Soon',    value: d.joiningSoon,   sub:'in onboarding',      t:'violet'  as const, icon:<IconOnboarding size={16}/> },
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
    <Page>
      <PageHeader
        title="HR Dashboard"
        context={<>{monthLabel} · {d.total.toLocaleString('en-IN')} employees across {d.companyRows.length} companies</>}
        actions={<Button onClick={load} icon={<IconClock size={15} />}>Refresh</Button>}
      />

      {/* Each tile is a filter. Clicking one opens the matching list below, so
          the summary and the detail are the same control rather than two. */}
      <StatRow>
        {stats.map(st => {
          const on = sel === st.key
          return (
            <div key={st.key} onClick={() => { setSel(on ? null : st.key); setDrillQ('') }}
              className="ez-lift" title="Show these records"
              style={{
                cursor:'pointer', borderRadius:R.lg, minWidth:0,
                outline: on ? `2px solid ${C.violet}` : '2px solid transparent',
                outlineOffset: 1, transition:`outline-color ${M.quick}`,
              }}>
              <Stat label={st.label} value={st.value} sub={capFirst(st.sub)} t={st.t} icon={st.icon} />
            </div>
          )
        })}
      </StatRow>

      {sel && (
        <Card pad={0} className="ez-rise" style={{ marginBottom:S.xl, overflow:'hidden' }}>
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            gap:S.md, padding:`${S.md}px ${S.lg}px`, borderBottom:`1px solid ${C.line}`, flexWrap:'wrap',
          }}>
            <div style={{ fontSize:F.lead, fontWeight:W.semi, color:C.ink }}>
              {DRILL_TITLES[sel]}
              <span style={{ marginLeft:8, fontSize:F.small, fontWeight:W.regular, color:C.muted, ...numeric }}>
                {filteredRows.length}{drillQ ? ` of ${selRows.length}` : ''}
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:S.sm }}>
              <div style={{ position:'relative' }}>
                <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:C.faint, display:'flex' }}>
                  <IconSearch size={14} />
                </span>
                <Input value={drillQ} onChange={e => setDrillQ(e.target.value)} placeholder="Search…"
                  style={{ width:190, paddingLeft:29 }} />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSel(null)}>Close</Button>
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <Empty
              title={drillQ ? 'Nothing matches that search' : 'No records'}
              hint={drillQ ? 'Try a shorter search, or clear it to see everything in this list.' : undefined}
              action={drillQ ? <Button size="sm" onClick={() => setDrillQ('')}>Clear search</Button> : undefined}
            />
          ) : (
            <div className="ez-scroll" style={{ maxHeight:380, overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:F.small }}>
                <thead>
                  <tr>
                    <Th width={44}>#</Th>
                    {cols
                      ? cols.map(c => <Th key={c.key}>{c.label}</Th>)
                      : <><Th>Name</Th><Th align="right">Status</Th></>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r: any, i: number) => (
                    <Tr key={i}>
                      <Td mono style={{ color:C.faint }}>{i + 1}</Td>
                      {cols
                        ? cols.map(c => (
                            <Td key={c.key}>
                              {c.pill
                                ? <Badge t="neutral" dot>{r[c.key]}</Badge>
                                : c.key === 'name'
                                  ? <Person name={r.name} />
                                  : <span style={{ color:C.muted }}>{r[c.key] || '—'}</span>}
                            </Td>
                          ))
                        : <>
                            <Td><Person name={r.name} meta={r.sub} /></Td>
                            <Td align="right"><Badge t="neutral">{r.meta}</Badge></Td>
                          </>}
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <div style={{ display:'grid', gap:S.md, marginBottom:S.xl, alignItems:'start',
                    gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Card>
          <div style={{ ...eyebrow, marginBottom:S.md }}>Headcount by location</div>
          {d.locationRows.length === 0
            ? <div style={{ fontSize:F.small, color:C.faint }}>No employee location data.</div>
            : d.locationRows.map(([name, count]: any) => (
                <BarRow key={name} label={name} count={count} max={maxLoc} />
              ))}
        </Card>

        <Card>
          <div style={{ ...eyebrow, marginBottom:S.md }}>Headcount by company</div>
          {d.companyRows.length === 0
            ? <div style={{ fontSize:F.small, color:C.faint }}>No employee company data.</div>
            : d.companyRows.map(([name, count]: any) => (
                <BarRow key={name} label={name} count={count} max={maxCo} />
              ))}
        </Card>
      </div>

      <div style={{ display:'grid', gap:S.md, alignItems:'start',
                    gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <Card>
          <div style={{ ...eyebrow, marginBottom:S.md }}>Recruitment pipeline</div>
          {d.pipeline.map((p: any) => (
            <BarRow key={p.stage} label={p.stage} count={p.count} max={maxStage}
                    colour={STAGE_COLOR[p.stage] || C.violet} />
          ))}
        </Card>

        <Card>
          <div style={{ ...eyebrow, marginBottom:S.md }}>Recent activity</div>
          {d.activity.length === 0
            ? <div style={{ fontSize:F.small, color:C.faint }}>No recent activity.</div>
            : d.activity.map((a: any, i: number) => (
                <div key={i} style={{
                  display:'flex', gap:S.sm, padding:'8px 0', alignItems:'flex-start',
                  borderBottom: i < d.activity.length - 1 ? `1px solid ${C.line}` : 'none',
                }}>
                  <div style={{
                    width:26, height:26, borderRadius:R.sm, background:C.violetTint,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:12, flexShrink:0,
                  }}>{a.icon}</div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:F.small, color:C.inkSoft, lineHeight:1.45 }}>{a.text}</div>
                    <div style={{ fontSize:F.micro, color:C.faint, marginTop:2 }}>{a.time}</div>
                  </div>
                </div>
              ))}
        </Card>

        {/* Celebrations keep their emoji. Everywhere else emoji were standing in
            for an icon system; here the cake IS the content, and a line-drawn
            equivalent would be colder for no gain. */}
        <Card>
          <div style={{ ...eyebrow, marginBottom:S.md }}>Birthdays &amp; anniversaries</div>

          <div style={{ ...eyebrow, color:C.violetDeep, marginBottom:6 }}>Today</div>
          {d.today.length === 0 && (
            <div style={{ fontSize:F.small, color:C.faint, marginBottom:S.md }}>Nothing today.</div>
          )}
          {d.today.map((c: any, i: number) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:S.sm, padding:'7px 0',
              borderBottom:`1px solid ${C.line}`,
            }}>
              <span style={{ fontSize:17, lineHeight:1 }}>{c.type === 'birthday' ? '🎂' : '🌟'}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:F.small, fontWeight:W.semi, color:C.ink }}>{c.name}</div>
                <div style={{ fontSize:F.micro, color:C.muted }}>
                  {c.type === 'birthday' ? 'Happy Birthday!' : `${c.years} years with us`}
                  {c.company ? ` · ${c.company}` : ''}
                </div>
              </div>
              <Button size="sm"
                variant={wished.includes(c.id) ? 'secondary' : 'primary'}
                disabled={wished.includes(c.id) || wishing === c.id}
                onClick={() => sendWish(c)}
                title={wished.includes(c.id)
                  ? 'Delivered to their ESS notifications'
                  : 'Send a wish to their ESS dashboard'}>
                {wished.includes(c.id) ? 'Sent' : wishing === c.id ? 'Sending…' : 'Wish'}
              </Button>
            </div>
          ))}

          {wishErr && <div style={{ marginTop:S.md }}><Notice t="critical">{wishErr}</Notice></div>}

          <div style={{ ...eyebrow, color:C.violetDeep, margin:'14px 0 6px' }}>This week</div>
          {d.week.length === 0 && <div style={{ fontSize:F.small, color:C.faint }}>Nothing this week.</div>}
          {d.week.map((c: any, i: number) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:S.sm, padding:'6px 0',
              borderBottom: i < d.week.length - 1 ? `1px solid ${C.line}` : 'none',
            }}>
              <span style={{ fontSize:14, lineHeight:1, opacity:.85 }}>{c.type === 'birthday' ? '🎂' : '🌟'}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:F.small, color:C.inkSoft }}>{c.name}</div>
                <div style={{ fontSize:F.micro, color:C.faint }}>
                  {capFirst(c.type === 'anniversary' ? `${c.years}yr anniversary` : 'Birthday')} · in {c.days}d
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </Page>
  )
}
