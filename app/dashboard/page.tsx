'use client'
// app/dashboard/page.tsx — HR Dashboard home. Real data from Supabase.
// The sidebar/chrome is provided by app/dashboard/layout.tsx; this renders content only.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Page, PageHeader, Card, Section, Stat, StatRow, Button, Badge, Input, Empty,
  Person, TableWrap, Th, Td, Tr, Skeleton, Notice, CountUp,
  C, F, W, S, R, E, M, numeric, eyebrow, tone,
  IconEmployees, IconCheck, IconRecruitment, IconOnboarding, IconClock, IconSearch,
  IconBuilding, IconLetters, IconPlus, IconPerformance, IconCalendar, IconBell,
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

// Words that are names, not words. Without this list they get sentence-cased
// into something that reads like a typo — "Mrf", "Ess", "Kra".
const ACRONYMS = new Set(['MRF','MRFS','ESS','HR','HRMS','KRA','KRAS','PMS','MD','HOD',
  'AI','OTP','PF','ESIC','PT','LWF','GST','CTC','L1','L2','ID','NOC','DOJ'])

// ── The home page's own visual system ───────────────────────────────────────
// Scoped to .ez-home rather than pushed into lib/ui, because every token here
// is shared with 40-odd other screens and this is one page's brief.
//
// Two things it changes, both of which the page needed:
//
// INK. muted (#4B5563, 7.56:1) and faint (#626D80, 5.23:1) are the app's
// secondary greys, and this page is built almost entirely out of them — every
// bar label, every caption, every timestamp. Correct for a caption beside
// strong body copy; wrong when they ARE the content, which is why the page
// read as faded. Here they go to 9.71:1 and 6.28:1.
//
// MODULES. Every card was an identical white rectangle, so nothing said where
// one subject ended and the next began. Each is now a module with its own
// accent: a hue in the header, a tinted icon tile, and a top edge in the same
// colour. Same idea as the rail, so the two halves of the app agree.
const MOD = {
  location:  { l:'#1B5C9E', d:'#6FB6E8', Icon: IconBuilding },
  company:   { l:'#5B3FB5', d:'#A98FE4', Icon: IconEmployees },
  pipeline:  { l:'#1F6B4F', d:'#5FC79C', Icon: IconRecruitment },
  activity:  { l:'#155E75', d:'#5EC2DE', Icon: IconLetters },
  celebrate: { l:'#9A4A12', d:'#E9A06A', Icon: IconCalendar },
} as const
type ModKey = keyof typeof MOD

// Which icon belongs to which audit action. The rows used to render an empty
// 26px tinted square — `icon: ''` — so every entry had a blank box beside it.
const ACT_ICON = (kind: string) => {
  const k = kind.toUpperCase()
  if (k.includes('OFFER') || k.includes('LETTER')) return IconLetters
  if (k.includes('APPROV')) return IconCheck
  if (k.includes('CANDIDATE') || k.includes('MRF')) return IconRecruitment
  if (k.includes('ONBOARD') || k.includes('MAGIC')) return IconOnboarding
  if (k.includes('CREATE') || k.includes('ADD')) return IconPlus
  if (k.includes('RATING') || k.includes('PMS')) return IconPerformance
  return IconBell
}

const HOME_CSS = `
.ez-home{
  --ez-muted: #3B4553;
  --ez-faint: #57616F;
}
:root:not([data-ez-theme="light"]) .ez-home{ --ez-muted:#C3CAD4; --ez-faint:#A8B1BE }
@media (prefers-color-scheme: light){
  :root:not([data-ez-theme="dark"]) .ez-home{ --ez-muted:#3B4553; --ez-faint:#57616F }
}
:root[data-ez-theme="dark"]  .ez-home{ --ez-muted:#C3CAD4; --ez-faint:#A8B1BE }
:root[data-ez-theme="light"] .ez-home{ --ez-muted:#3B4553; --ez-faint:#57616F }

/* --m has to resolve on BOTH kinds of module surface. It was scoped to
   .ez-mod alone, so the KPI tiles — which carry .ez-kpi — left every
   var(--m) reference undefined and fell back to inherited grey: coloured
   labels that were not coloured, tinted tiles with no tint. */
.ez-mod, .ez-kpi{ --m: var(--m-l) }
:root:not([data-ez-theme="light"]) .ez-mod,
:root:not([data-ez-theme="light"]) .ez-kpi{ --m: var(--m-d) }
@media (prefers-color-scheme: light){
  :root:not([data-ez-theme="dark"]) .ez-mod,
  :root:not([data-ez-theme="dark"]) .ez-kpi{ --m: var(--m-l) }
}
:root[data-ez-theme="dark"]  .ez-mod,
:root[data-ez-theme="dark"]  .ez-kpi{ --m: var(--m-d) }
:root[data-ez-theme="light"] .ez-mod,
:root[data-ez-theme="light"] .ez-kpi{ --m: var(--m-l) }

/* Depth is built from three layers, not one blurry drop shadow: a tight
   contact shadow, a wide soft one, and a hairline of the module's own colour
   along the top edge catching the light. That last one is what stops the
   card reading as a flat rectangle. */
.ez-mod{
  position:relative; border-radius:16px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--m) 5%, transparent) 0,
                            color-mix(in srgb, var(--m) 0%, transparent) 92px),
    var(--ez-surface);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--m) 22%, transparent),
    0 1px 2px rgba(15,23,42,.07),
    0 10px 24px -10px rgba(15,23,42,.18);
  border:1px solid color-mix(in srgb, var(--m) 14%, var(--ez-line));
  transition: transform .26s cubic-bezier(.22,1,.36,1), box-shadow .26s ease;
}
.ez-mod:hover{
  transform: translateY(-3px);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--m) 32%, transparent),
    0 2px 4px rgba(15,23,42,.08),
    0 20px 40px -14px color-mix(in srgb, var(--m) 42%, rgba(15,23,42,.30));
}
.ez-mod-head{ display:flex; align-items:center; gap:10px; margin-bottom:14px }
.ez-mod-tile{
  width:30px; height:30px; border-radius:9px; flex-shrink:0;
  display:flex; align-items:center; justify-content:center;
  color: var(--m);
  background: color-mix(in srgb, var(--m) 13%, var(--ez-surface));
  box-shadow: inset 0 1px 0 color-mix(in srgb, #FFF 22%, transparent);
}
.ez-mod-title{
  font-size:12.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  color: var(--m);
}

/* Stat tiles. The number was already strong; the label and caption around it
   were not, so the tile read as one big figure floating on white. */
.ez-kpi{
  position:relative; overflow:hidden; border-radius:14px; cursor:pointer;
  padding:15px 16px; background: var(--ez-surface);
  border:1px solid color-mix(in srgb, var(--m) 16%, var(--ez-line));
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--m) 24%, transparent),
    0 1px 2px rgba(15,23,42,.06),
    0 8px 20px -10px rgba(15,23,42,.16);
  transition: transform .24s cubic-bezier(.22,1,.36,1), box-shadow .24s ease;
}
.ez-kpi::after{
  /* A sheen that crosses the tile on hover. Not a glow sitting there being
     decorative — it only moves when you point at something clickable. */
  content:''; position:absolute; inset:0; pointer-events:none;
  background: linear-gradient(105deg, transparent 30%,
              color-mix(in srgb, var(--m) 16%, transparent) 48%, transparent 66%);
  transform: translateX(-120%);
  transition: transform .62s cubic-bezier(.3,.7,.3,1);
}
.ez-kpi:hover{
  transform: translateY(-3px);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--m) 36%, transparent),
    0 2px 5px rgba(15,23,42,.09),
    0 18px 34px -12px color-mix(in srgb, var(--m) 45%, rgba(15,23,42,.28));
}
.ez-kpi:hover::after{ transform: translateX(120%) }
.ez-kpi-on{ border-color: var(--m); box-shadow: 0 0 0 2px color-mix(in srgb, var(--m) 34%, transparent),
            0 12px 28px -12px color-mix(in srgb, var(--m) 50%, transparent) }
.ez-kpi-lab{
  font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase;
  color: var(--m);
}
.ez-kpi-val{ font-size:30px; font-weight:800; letter-spacing:-.02em; line-height:1.1;
             color: var(--ez-ink); font-variant-numeric: tabular-nums }
.ez-kpi-sub{ font-size:12px; font-weight:600; color: var(--ez-muted) }

/* Entrance: cards arrive from slightly below and behind, in reading order. */
@keyframes ezHomeIn{ from{ opacity:0; transform: translateY(16px) scale(.985) } to{ opacity:1; transform:none } }
.ez-in{ animation: ezHomeIn .5s cubic-bezier(.22,1,.36,1) both; animation-delay: calc(var(--k) * 55ms) }

@media (prefers-reduced-motion: reduce){
  .ez-in{ animation:none }
  .ez-mod, .ez-kpi, .ez-kpi::after{ transition:none }
  .ez-mod:hover, .ez-kpi:hover{ transform:none }
  .ez-kpi:hover::after{ transform: translateX(-120%) }
}
`

/** A module card: its own accent, its own header, its own depth. */
function ModCard({ mod, title, k, children, style }: {
  mod: ModKey; title: string; k: number;
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  const m = MOD[mod]; const Icon = m.Icon
  return (
    <div className="ez-mod ez-in" style={{
      ['--m-l' as string]: m.l, ['--m-d' as string]: m.d, ['--k' as string]: k,
      padding: S.lg, ...style,
    }}>
      <div className="ez-mod-head">
        <span className="ez-mod-tile" aria-hidden><Icon size={16} /></span>
        <span className="ez-mod-title">{title}</span>
      </div>
      {children}
    </div>
  )
}

const RECRUIT_STAGES = ['Applied','AI Screened','Telephonic','L1','L2','Optional Round','Shortlisted','Offer Sent','Joined','Rejected']
// A funnel reads left to right as "further along". Colour follows that: violet
// through the middle stages, green once the outcome is good, red when it is not.
// The old set gave every stage its own unrelated hue, which encoded nothing.
const STAGE_COLOR: Record<string,string> = {
  'Applied':'var(--ez-ramp-1)','AI Screened':'var(--ez-ramp-2)','Telephonic':'var(--ez-ramp-3)','L1':'var(--ez-ramp-4)',
  'L2':'var(--ez-ramp-5)','Optional Round':'var(--ez-ramp-6)','Shortlisted':C.positive,'Offer Sent':C.positive,
  'Joined':C.positive,'Rejected':C.critical,
}

// Same stages, readable as text. A bar only has to be visible; the stage
// name has to be legible against the page in both themes.
const STAGE_TEXT: Record<string,string> = {
  'Applied':'var(--ez-ramp-1-fg)','AI Screened':'var(--ez-ramp-2-fg)','Telephonic':'var(--ez-ramp-3-fg)','L1':'var(--ez-ramp-4-fg)',
  'L2':'var(--ez-ramp-5-fg)','Optional Round':'var(--ez-ramp-6-fg)','Shortlisted':C.positive,'Offer Sent':C.positive,
  'Joined':C.positive,'Rejected':C.critical,
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
function BarRow({ label, count, max, colour = C.brand }: {
  label: string; count: number; max: number; colour?: string
}) {
  // The bar is rendered at zero width for one frame, then given its real
  // width, so the CSS transition has something to travel. Rendering straight
  // at the final width means the transition never fires and the bar just
  // exists — which is what was happening.
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const pct = grown ? Math.max((count / max) * 100, 2) : 0

  return (
    <div style={{ display:'flex', alignItems:'center', gap:S.sm, marginBottom:7 }}>
      <div title={label} style={{
        width:126, fontSize:F.tiny, color:C.muted, textAlign:'right', flexShrink:0,
        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
      }}>{label}</div>
      <div style={{ flex:1, height:7, background:C.sunken, borderRadius:R.pill, overflow:'hidden' }}>
        <div style={{
          height:'100%', width:`${pct}%`, background:colour,
          borderRadius:R.pill,
          // Eased out over 520ms: long enough to read as growth, short enough
          // that the page has settled before anyone reaches for it.
          transition:'width .52s cubic-bezier(.22,1,.36,1)',
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
      supabase.from('employees').select('id, full_name, emp_code, first_name, employment_status, blacklisted, date_of_birth, group_doj, last_working_date, company_id, location_id, companies!employees_company_id_fkey(company_name), locations!location_id(location_name)').neq('is_test', true),
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
        .map((e: any) => ({ name: e.full_name || '—', sub: e.companies?.company_name || '—', meta: isLeft(e) ? 'Exited' : (e.employment_status || 'Active'), tone: isLeft(e) ? C.critical : C.positive })),
      active: [...activeEmps].sort((a: any,b: any) => (a.full_name||'').localeCompare(b.full_name||''))
        .map((e: any) => ({ name: e.full_name || '—', sub: e.companies?.company_name || '—', meta: e.locations?.location_name || '—', tone:C.positive })),
      open: approvedMrfs.map((m: any) => ({ name: m.designation || m.position || '—', sub: `${Number(m.no_of_openings || m.openings || 0)} opening(s)`, meta: m.status || 'APPROVED', tone:C.info })),
      pipeline: [...pipelineCands].sort((a: any,b: any) => RECRUIT_STAGES.indexOf(a.stage) - RECRUIT_STAGES.indexOf(b.stage))
        .map((c: any) => ({ name: c.full_name || '—', dept: deptOf(c), status: c.stage || '—', location: locOf(c), tone: STAGE_COLOR[c.stage] || C.brand })),
      // already ordered by joining date (undated last) when joiningCands was built
      joining: joiningCands.map((c: any) => ({ name: c.full_name || '—', sub: c.designation || '—', meta: fmtDate(c.onboarding_date), tone: C.info })),
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
      // MRF_APPROVED used to come out "Mrf approved": the whole string was
      // lowercased and only the first letter put back. Every acronym this
      // company uses was being destroyed the same way.
      const words = (a.action_type || 'ACTIVITY').replace(/_/g, ' ').toLowerCase().split(' ')
      const said = words.map((w: string, i: number) => ACRONYMS.has(w.toUpperCase())
        ? w.toUpperCase()
        : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ')
      return map[a.action_type] || said + (who ? ` — ${who}` : '')
    }
    let activity = audit.map((a: any) => ({ kind: a.action_type || '', text: actText(a), time: timeAgo(a.created_at) }))
    if (!activity.length) {
      activity = [...cands].sort((a: any,b: any) => new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,6)
        .map((c: any) => ({ kind:'CANDIDATE_ADDED', text:`Candidate added — ${c.full_name}${c.designation?` (${c.designation})`:''}`, time: timeAgo(c.created_at) }))
    }

    // (see sendWish below — the Wish button writes a real ESS notification)
    // celebrations (birthdays + anniversaries within 7 days)
    const celeb: any[] = []
    for (const e of activeEmps) {
      const bd = daysUntilAnnual(e.date_of_birth)
      if (bd !== null && bd <= 7) celeb.push({ id: e.id, name: e.full_name, code: e.emp_code, type:'birthday', days: bd, company: e.companies?.company_name || '' })
      const an = daysUntilAnnual(e.group_doj)
      if (an !== null && an <= 7 && e.group_doj) {
        const yrs = Math.round((Date.now() - new Date(e.group_doj).getTime())/(365.25*24*3600*1000))
        if (yrs >= 1) celeb.push({ id: e.id, name: e.full_name, code: e.emp_code, type:'anniversary', days: an, years: yrs, company: e.companies?.company_name || '' })
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
    // Goes through the dispatcher rather than inserting here. A direct insert
    // worked, but it was a second writer with no catalogue code and — the part
    // that mattered — no way to know the recipient has no ESS login. 128 of
    // 398 active employees do not, and this button used to show a tick for a
    // message they could never open.
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      const res = await fetch('/api/notifications/celebrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ employee_id: c.id, kind: isBday ? 'BIRTHDAY' : 'ANNIVERSARY', years: c.years }),
      })
      const j = await res.json().catch(() => ({}))
      setWishing(null)
      if (!res.ok) { setWishErr(`Could not send to ${c.name}: ${j?.error || res.status}`); return }
      if (j.warning) setWishErr(j.warning)
      setWished(p => [...p, c.id])
    } catch (e: any) {
      setWishing(null)
      setWishErr(`Could not send to ${c.name}: ${e?.message || e}`)
    }
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
    { key:'total',    label:'Total Employees', value: <CountUp value={d.total} />, sub:`${d.companyRows.length} companies`,  m:{l:'#1B4FA0',d:'#7FB2F0'}, icon:<IconEmployees size={15}/> },
    { key:'active',   label:'Active',          value: <CountUp value={d.active} />, sub: d.total ? `${Math.round(d.active/d.total*100)}% active` : '—', m:{l:'#1F6B4F',d:'#5FC79C'}, icon:<IconCheck size={15}/> },
    { key:'open',     label:'Open Positions',  value: <CountUp value={d.openPositions} />, sub:'approved MRFs',      m:{l:'#155E75',d:'#5EC2DE'}, icon:<IconRecruitment size={15}/> },
    { key:'pipeline', label:'In Pipeline',     value: <CountUp value={d.inPipeline} />,    sub:'active candidates',  m:{l:'#9A4A12',d:'#E9A06A'}, icon:<IconClock size={15}/> },
    { key:'joining',  label:'Joining Soon',    value: <CountUp value={d.joiningSoon} />,   sub:'in onboarding',      m:{l:'#5B3FB5',d:'#A98FE4'}, icon:<IconOnboarding size={15}/> },
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
      <style>{HOME_CSS}</style>
      <div className="ez-home">
      <PageHeader
        title="HR Dashboard"
        context={<>{monthLabel} · {d.total.toLocaleString('en-IN')} employees across {d.companyRows.length} companies</>}
        actions={<Button onClick={load} icon={<IconClock size={16} />}>Refresh</Button>}
      />

      {/* Each tile is a filter. Clicking one opens the matching list below, so
          the summary and the detail are the same control rather than two. */}
      <StatRow>
        {stats.map((st, i) => {
          const on = sel === st.key
          const pick = () => { setSel(on ? null : st.key); setDrillQ('') }
          return (
            <div key={st.key} onClick={pick}
              className={`ez-kpi ez-in${on ? ' ez-kpi-on' : ''}`}
              role="button" tabIndex={0} aria-pressed={on}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }}
              title="Show these records"
              style={{ ['--m-l' as string]: st.m.l, ['--m-d' as string]: st.m.d,
                       ['--k' as string]: i, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                <span className="ez-kpi-lab">{st.label}</span>
                <span className="ez-mod-tile" aria-hidden
                      style={{ width:26, height:26, borderRadius:8 }}>{st.icon}</span>
              </div>
              <div className="ez-kpi-val" style={{ margin:'8px 0 3px' }}>{st.value}</div>
              <div className="ez-kpi-sub">{capFirst(st.sub)}</div>
            </div>
          )
        })}
      </StatRow>

      {sel && (
        <Card pad={0} className="ez-rise-3d" style={{ marginBottom:S.xl, overflow:'hidden' }}>
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
                  <IconSearch size={16} />
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
        <ModCard mod="location" title="Headcount by location" k={5}>
          {d.locationRows.length === 0
            ? <div style={{ fontSize:F.small, color:C.faint }}>No employee location data.</div>
            : d.locationRows.map(([name, count]: any) => (
                <BarRow key={name} label={name} count={count} max={maxLoc} colour={MOD.location.l} />
              ))}
        </ModCard>

        <ModCard mod="company" title="Headcount by company" k={6}>
          {d.companyRows.length === 0
            ? <div style={{ fontSize:F.small, color:C.faint }}>No employee company data.</div>
            : d.companyRows.map(([name, count]: any) => (
                <BarRow key={name} label={name} count={count} max={maxCo} colour={MOD.company.l} />
              ))}
        </ModCard>
      </div>

      <div style={{ display:'grid', gap:S.md, alignItems:'start',
                    gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <ModCard mod="pipeline" title="Recruitment pipeline" k={7}>
          {d.pipeline.map((p: any) => (
            <BarRow key={p.stage} label={p.stage} count={p.count} max={maxStage}
                    colour={STAGE_COLOR[p.stage] || C.brand} />
          ))}
        </ModCard>

        <ModCard mod="activity" title="Recent activity" k={8}>
          {d.activity.length === 0
            ? <div style={{ fontSize:F.small, color:C.faint }}>No recent activity.</div>
            : d.activity.map((a: any, i: number) => {
                const Ico = ACT_ICON(a.kind || '')
                return (
                <div key={i} style={{
                  display:'flex', gap:S.sm, padding:'8px 0', alignItems:'flex-start',
                  borderBottom: i < d.activity.length - 1 ? `1px solid ${C.line}` : 'none',
                }}>
                  {/* This square used to be empty: the data carried icon:'' and
                      the row rendered it faithfully — a blank tinted box beside
                      every entry. */}
                  <span className="ez-mod-tile" aria-hidden
                        style={{ width:26, height:26, borderRadius:8 }}><Ico size={14} /></span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:F.small, fontWeight:W.medium, color:C.ink, lineHeight:1.45 }}>{a.text}</div>
                    <div style={{ fontSize:F.micro, color:C.muted, marginTop:2 }}>{a.time}</div>
                  </div>
                </div>
              )})}
        </ModCard>

        {/* Celebrations keep their emoji. Everywhere else emoji were standing in
            for an icon system; here the cake IS the content, and a line-drawn
            equivalent would be colder for no gain. */}
        <ModCard mod="celebrate" title="Birthdays & anniversaries" k={9}>
          <div style={{ ...eyebrow, color:'var(--m)', marginBottom:6 }}>Today</div>
          {d.today.length === 0 && (
            <div style={{ fontSize:F.small, color:C.faint, marginBottom:S.md }}>Nothing today.</div>
          )}
          {d.today.map((c: any, i: number) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:S.sm, padding:'7px 0',
              borderBottom:`1px solid ${C.line}`,
            }}>
              {/* Both arms of this were empty strings, so the comment above
                  promised an emoji the row never drew. */}
              <span style={{ fontSize:17, lineHeight:1 }}>{c.type === 'birthday' ? '\u{1F382}' : '\u{1F389}'}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:F.small, fontWeight:W.semi, color:C.ink }}>
                  {c.name}
                  {/* Names are not unique here — two active employees are both
                      "Sunita Kapoor". Without the code an HR user cannot tell
                      which one they are wishing, and the wish lands on a
                      colleague who then sees a birthday message on the wrong day. */}
                  {c.code ? <span style={{ fontWeight:W.regular, color:C.faint, fontFamily:'monospace', fontSize:F.micro }}> · {c.code}</span> : null}
                </div>
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

          <div style={{ ...eyebrow, color:'var(--m)', margin:'14px 0 6px' }}>This week</div>
          {d.week.length === 0 && <div style={{ fontSize:F.small, color:C.faint }}>Nothing this week.</div>}
          {d.week.map((c: any, i: number) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:S.sm, padding:'6px 0',
              borderBottom: i < d.week.length - 1 ? `1px solid ${C.line}` : 'none',
            }}>
              <span style={{ fontSize:14, lineHeight:1 }}>{c.type === 'birthday' ? '\u{1F382}' : '\u{1F389}'}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:F.small, fontWeight:W.medium, color:C.ink }}>{c.name}</div>
                <div style={{ fontSize:F.micro, color:C.faint }}>
                  {capFirst(c.type === 'anniversary' ? `${c.years}yr anniversary` : 'Birthday')} · in {c.days}d
                </div>
              </div>
            </div>
          ))}
        </ModCard>
      </div>
      </div>
    </Page>
  )
}
