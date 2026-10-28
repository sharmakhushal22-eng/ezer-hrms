'use client'
// components/recruitment/CtcStatement.tsx — the Automated CTC Calculator's salary breakdown
// statement table and its read-only minimum-wages popup. Shared by Recruitment → Negotiation
// (app/dashboard/recruitment/page.tsx) and Help → TDS Calculator (CtcBreakupCalculator).
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { C, F, W, R, E, Z, numeric } from '@/lib/ui'
import { CAT_TO_DB } from '@/lib/recruitment/min-wages'
import type { StmtRow } from '@/lib/recruitment/ctc-statement'

const btnOutline: React.CSSProperties = { height:38, padding:'0 16px', borderRadius:R.md, border:`1px solid ${C.lineStrong}`, cursor:'pointer', fontSize:F.small, fontWeight:W.medium, fontFamily:'inherit', background:C.surface, color:C.ink, boxShadow:E.flat, whiteSpace:'nowrap' as const }

// ── Minimum wages — read-only view of the payroll master (minimum_wage_config), opened from the
// CTC calculator. HR edits the figures in Payroll → Minimum Wages; nothing here is editable.
const MW_CAT_LABEL:Record<string,string> = { UNSKILLED:'Unskilled', SEMI_SKILLED:'Semi Skilled', SKILLED:'Skilled', HIGHLY_SKILLED:'Highly Skilled' }
const MW_CAT_ORDER = ['UNSKILLED','SEMI_SKILLED','SKILLED','HIGHLY_SKILLED']
export function MinWagesPopup({ rates, state, category, onClose }:{ rates:any[]; state?:string; category?:string; onClose:()=>void }) {
  const [q, setQ] = useState('')
  const curCat = (CAT_TO_DB as any)[category||''] || ''
  const list = (rates||[]).filter(r => !q.trim() || (r.state||'').toLowerCase().includes(q.trim().toLowerCase()))
  // group by state (+ zone) → one row per category
  const groups:Record<string, any[]> = {}
  for (const r of list) { const k = `${r.state}${r.zone && r.zone!=='ALL' ? ` · ${r.zone}` : ''}`; (groups[k] ||= []).push(r) }
  const keys = Object.keys(groups).sort((a,b)=>a.localeCompare(b))
  const rs = (n:any) => n==null||n==='' ? '-' : `₹${Math.round(Number(n)).toLocaleString('en-IN')}`
  const isCur = (r:any) => (r.state||'').toLowerCase()===(state||'').toLowerCase()
  if (typeof document === 'undefined') return null
  // Portalled to <body>: inside the calculator column it sat under the nav band and the
  // calculator's own sticky header (an ancestor's stacking context capped its z-index).
  return createPortal(
    <div onMouseDown={e=>{ if (e.target===e.currentTarget) onClose() }}
      style={{ position:'fixed', inset:0, background:'rgba(30,27,75,0.5)', zIndex:Z.modal, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'28px 16px' }}>
      <div style={{ background:C.surface, borderRadius:14, width:'min(960px, 100%)', boxShadow:'0 24px 70px rgba(30,27,75,0.35)', padding:'16px 18px', color:C.ink }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' as const }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800 }}>Minimum wages (payroll master)</div>
            <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>Monthly figures, currently effective · read-only here. HR maintains them under Payroll → Minimum Wages</div>
          </div>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search state…" className="rx-input" style={{ width:200, marginLeft:'auto' }} />
          <button onClick={onClose} style={btnOutline}>Close</button>
        </div>
        {keys.length===0 ? (
          <div style={{ fontSize:12.5, color:C.faint, padding:'24px 0', textAlign:'center' as const }}>{rates?.length ? 'No state matches that search.' : 'No minimum-wage rows in the payroll master yet.'}</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:C.sunken }}>
                  {['State','Category','Basic','VDA','Total / month','Effective from','Notification'].map(h=>(
                    <th key={h} style={{ textAlign: ['Basic','VDA','Total / month'].includes(h)?'right':'left', padding:'8px 10px', fontSize:10.5, fontWeight:700, color:C.brandDeep, textTransform:'uppercase' as const, letterSpacing:'.05em', borderBottom:`1px solid ${C.line}`, whiteSpace:'nowrap' as const }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map(k => {
                  const rows = [...groups[k]].sort((a,b)=>MW_CAT_ORDER.indexOf(a.category)-MW_CAT_ORDER.indexOf(b.category))
                  return rows.map((r,i) => {
                    const hl = isCur(r)
                    const exact = hl && r.category===curCat
                    return (
                      <tr key={`${k}-${r.category}-${i}`} style={{ background: exact ? C.brandTint : hl ? C.sunken : 'transparent' }}>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, fontWeight: i===0 ? 700 : 400, color: i===0 ? C.ink : 'transparent', whiteSpace:'nowrap' as const }}>{k}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, fontWeight: exact ? 700 : 500 }}>{MW_CAT_LABEL[r.category]||r.category}{exact && <span style={{ marginLeft:6, fontSize:9.5, fontWeight:700, color:C.brandDeep, background:C.surface, border:`1px solid ${C.brandEdge}`, borderRadius:99, padding:'1px 6px' }}>in use</span>}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, textAlign:'right', ...numeric }}>{rs(r.basic_amount)}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, textAlign:'right', ...numeric }}>{rs(r.vda_amount)}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, textAlign:'right', fontWeight:700, ...numeric }}>{rs(r.total_minimum_wage)}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, color:C.muted, whiteSpace:'nowrap' as const }}>{r.effective_from ? new Date(r.effective_from).toLocaleDateString('en-IN',{ day:'2-digit', month:'short', year:'numeric' }) : '-'}</td>
                        <td style={{ padding:'7px 10px', borderBottom:`1px solid ${C.line}`, color:C.muted, fontSize:11 }}>{r.notification_reference||'-'}</td>
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize:10.5, color:C.faint, marginTop:10 }}>{rates?.length||0} rows · the highlighted state is the one selected in this negotiation.</div>
      </div>
    </div>,
    document.body,
  )
}

// Module-scope (never re-mounts) — the statement table, themed like the reference studio.
export function CtcStatementTable({ rows }:{ rows:StmtRow[] }) {
  const cell:React.CSSProperties = { padding:'6px 10px', fontSize:12 }
  const num:React.CSSProperties = { ...cell, textAlign:'right' as const, whiteSpace:'nowrap' as const, fontVariantNumeric:'tabular-nums' }
  const tone:Record<string,{ color?:string; bg?:string; weight?:number }> = {
    row:{}, sum:{ bg:C.sunken, weight:700 }, emp:{ color:C.brandDeep }, grat:{ color:C.positive }, bonus:{ color:C.info },
    muted:{ color:C.faint }, total:{ bg:C.brand, color:C.onAccent, weight:700 }, ded:{ color:C.critical }, net:{ bg:C.positive, color:C.onAccent, weight:700 },
  }
  // The ₹ columns are nowrap and cannot shrink, so once the grid track above
  // was allowed a zero minimum this table became the thing that would overflow.
  // A table is permitted to be wider than the page — but inside its own
  // scroller, not by dragging the whole document sideways. Comment sits above
  // the return: a JSX comment after `return (` parses as an empty object
  // literal and breaks the file.
  return (
    <div style={{ overflowX:'auto' }}>
    <table style={{ width:'100%', borderCollapse:'separate', borderSpacing:0 }}>
      <thead>
        <tr style={{ background:C.sunken }}>
          <th style={{ ...cell, textAlign:'left' as const, fontSize:10, textTransform:'uppercase' as const, letterSpacing:'.05em', color:C.faint, fontWeight:700, borderRadius:'8px 0 0 8px' }}>Component</th>
          <th style={{ ...num, fontSize:10, textTransform:'uppercase' as const, letterSpacing:'.05em', color:C.faint, fontWeight:700 }}>Monthly (₹)</th>
          <th style={{ ...num, fontSize:10, textTransform:'uppercase' as const, letterSpacing:'.05em', color:C.faint, fontWeight:700, borderRadius:'0 8px 8px 0' }}>Annual (₹)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r,i)=>{
          if (r.kind==='head') return <tr key={i}><td colSpan={3} style={{ ...cell, paddingTop:16, paddingBottom:4, fontSize:11, fontWeight:700, color:C.muted }}>{r.label}</td></tr>
          if (r.kind==='note') return <tr key={i}><td colSpan={3} style={{ ...cell, fontSize:10, color:C.faint, lineHeight:1.5 }}>{r.label}</td></tr>
          const t = tone[r.kind]||{}
          const big = r.kind==='total'||r.kind==='net'
          const base:React.CSSProperties = { background:t.bg, color:t.color||C.ink, fontWeight:t.weight||500, borderBottom: t.bg?'none':`1px solid ${C.brandEdge}` }
          const nil = (r.monthly||0)===0 && (r.kind==='emp'||r.kind==='ded')
          return (
            <tr key={i}>
              <td style={{ ...cell, ...base, padding: big?'9px 10px':cell.padding, fontSize: big?13:12, borderRadius: t.bg?'10px 0 0 10px':0 }}>
                {r.label}{r.basis && <span style={{ fontSize:10, color: t.bg&&t.color===C.onAccent ? 'rgba(255,255,255,.75)' : C.faint, fontWeight:400, marginLeft:6 }}>· {r.basis}</span>}
              </td>
              <td style={{ ...num, ...base, padding: big?'9px 10px':cell.padding, fontSize: big?13:12, opacity: nil?.55:1 }}>{nil?'Nil':`₹${Math.round(r.monthly||0).toLocaleString('en-IN')}`}</td>
              <td style={{ ...num, ...base, padding: big?'9px 10px':cell.padding, fontSize: big?14:12, borderRadius: t.bg?'0 10px 10px 0':0, opacity: nil?.55:1 }}>{nil?'Nil':`₹${Math.round(r.annual||0).toLocaleString('en-IN')}`}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
    </div>
  )
}
