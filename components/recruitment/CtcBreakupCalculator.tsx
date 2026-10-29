'use client'
// components/recruitment/CtcBreakupCalculator.tsx — Help → TDS Calculator.
//
// The Automated CTC Calculator from Recruitment → Negotiation, on its own: type an annual CTC
// and variable and see the whole salary breakdown statement — the same model (computeCtc), the
// same statement rows (ctcStatementRows), table and minimum-wages popup. It is only a
// calculator: no candidate, no employee, nothing saved and no salary link. The one read is the
// minimum-wage master, so the floor on Basic matches what Negotiation uses.
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { C, F, W, R, E, S, Z } from '@/lib/ui'
import { MIN_WAGE_STATES, WAGE_CATS, resolveMinWage, DEFAULT_STATE, DEFAULT_CATEGORY } from '@/lib/recruitment/min-wages'
import { computeCtc, inr, EPF_WAGE_CEILING, HRA_MAX_METRO, HRA_MAX_NON_METRO } from '@/lib/recruitment/ctc-model'
import { ctcStatementRows, ctcStatementHtml } from '@/lib/recruitment/ctc-statement'
import { CtcStatementTable, MinWagesPopup } from './CtcStatement'
import '@/lib/ui/recruitment.redesign.css'

const T = {
  card: { background:C.surface, borderRadius:R.xl, border:`1px solid ${C.line}`, padding:S.xl, marginBottom:S.lg, boxShadow:E.raised } as React.CSSProperties,
  cardPurple: { background:C.brandTint, borderRadius:R.xl, border:`1px solid ${C.brandEdge}`, padding:S.xl, marginBottom:S.lg, boxShadow:E.brand } as React.CSSProperties,
  btnPrimary: { height:38, padding:'0 18px', borderRadius:R.md, border:`1px solid ${C.brandDeep}`, cursor:'pointer', fontSize:F.small, fontWeight:W.semi, fontFamily:'inherit', background:`linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color:C.onAccent, boxShadow:E.brand, whiteSpace:'nowrap' as const } as React.CSSProperties,
  btnOutline: { height:38, padding:'0 16px', borderRadius:R.md, border:`1px solid ${C.lineStrong}`, cursor:'pointer', fontSize:F.small, fontWeight:W.medium, fontFamily:'inherit', background:C.surface, color:C.ink, boxShadow:E.flat, whiteSpace:'nowrap' as const } as React.CSSProperties,
  section: { fontSize:F.lead, fontWeight:W.bold, color:C.ink, letterSpacing:'-.01em', borderLeft:`3px solid ${C.brand}`, paddingLeft:S.sm, marginBottom:S.md, marginTop:S.xs, display:'flex', alignItems:'center', gap:S.sm, lineHeight:1.3 } as React.CSSProperties,
}
const ADD_FREQS = ['One-time','Monthly','Quarterly','Half-yearly','Yearly']
const lakh = (v:number) => `₹${(v/100000).toFixed(2)}L`

export default function CtcBreakupCalculator() {
  const [form, setForm] = useState({ ctc:'', varAmt:'', joining_bonus:'', joining_freq:'With Salary', retention_bonus:'', retention_freq:'After 3 Months', esop:'', esop_plan:'', terms:'',
    state:DEFAULT_STATE, category:DEFAULT_CATEGORY as string, metro:'no', gratuity:'yes', bonusPct:'8.33', bonusMode:'salary' })
  const F_ = (k:string, v:any) => setForm(f=>({ ...f, [k]:v }))
  const [mwRates, setMwRates] = useState<any[]>([])
  useEffect(()=>{
    supabase.from('minimum_wage_config').select('state, zone, category, basic_amount, vda_amount, total_minimum_wage, effective_from, notification_reference').is('effective_to', null)
      .order('state').then(({ data }:any)=>setMwRates(data||[]))
  },[])
  const [showMw, setShowMw] = useState(false)
  const [addItems, setAddItems] = useState<{ amount:string; freq:string; remark:string }[]>([])
  const addRow = () => setAddItems(a=>[...a, { amount:'', freq:'One-time', remark:'' }])
  const setRow = (i:number, k:'amount'|'freq'|'remark', v:string) => setAddItems(a=>a.map((r,idx)=>idx===i ? { ...r, [k]:v } : r))
  const delRow = (i:number) => setAddItems(a=>a.filter((_,idx)=>idx!==i))
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [pulse, setPulse] = useState(0)

  const mw = resolveMinWage(mwRates, form.state, form.category as any)
  const model = useMemo(()=>{
    const ctcAnnual = Number(form.ctc)
    if (!ctcAnnual) return null
    return computeCtc({ ctcAnnual, variableAnnual:Number(form.varAmt)||0, minWage:mw.amount, state:form.state,
      gratuity:form.gratuity as 'yes'|'no', bonusPct:Number(form.bonusPct)||0, bonusMode:form.bonusMode as 'salary'|'ctc',
      hraMax: form.metro==='yes' ? HRA_MAX_METRO : HRA_MAX_NON_METRO })
  },[form.ctc, form.varAmt, form.state, form.gratuity, form.bonusPct, form.bonusMode, form.metro, mw.amount])
  const calcError = model && !model.ok
    ? `Required minimum fixed CTC for ${form.state} (${form.category}) is ${inr(model.minReqFixedAnn)}/year (${inr(model.minReqFixedAnn/12)}/month) to satisfy basic wages (₹${Math.round(model.basic).toLocaleString('en-IN')}), PF/ESIC, gratuity and bonus rules. Given fixed CTC is ${inr(model.fixedAnnual)}/year.`
    : ''
  const calc = useMemo(()=>{
    if (!model || !model.ok) return null
    return { ...model,
      minWage:mw.amount, minWageSource:mw.source, state:form.state, category:form.category,
      gratuity:form.gratuity, bonusPct:Number(form.bonusPct)||0, bonusMode:form.bonusMode,
      joining_bonus:Number(form.joining_bonus)||0, retention_bonus:Number(form.retention_bonus)||0, esop:Number(form.esop)||0,
      additional_items:addItems.map(r=>({ amount:Number(r.amount)||0, freq:r.freq, remark:r.remark.trim() })).filter(r=>r.amount>0),
      terms_conditions:(form.terms||'').trim()||null }
  },[model, mw.amount, mw.source, form.state, form.category, form.gratuity, form.bonusPct, form.bonusMode, form.joining_bonus, form.retention_bonus, form.esop, form.terms, addItems])
  const statementRows = () => calc ? ctcStatementRows(calc, form) : []

  const extrasSummary = (()=>{
    const bits:string[] = []
    if (Number(form.joining_bonus)>0) bits.push(`Joining ${lakh(Number(form.joining_bonus))}`)
    if (Number(form.retention_bonus)>0) bits.push(`Retention ${lakh(Number(form.retention_bonus))}`)
    if (Number(form.esop)>0) bits.push(`ESOP ${lakh(Number(form.esop))}`)
    const n = addItems.filter(r=>Number(r.amount)>0).length
    if (n) bits.push(`${n} additional`)
    if ((form.terms||'').trim()) bits.push('T&C')
    return bits.length ? bits.join(' · ') : 'none yet (joining / retention / ESOP / T&C / additional)'
  })()

  function downloadExcel() {
    if (!calc) return
    const rows:any[] = [['Component','Formula / basis','Monthly (₹)','Annual (₹)','Remark'],
      ['State / Category',`${calc.state} / ${calc.category}`,'','',`Minimum wage ₹${Math.round(calc.minWage||0)}/mo (${calc.minWageSource})`]]
    for (const r of statementRows()) rows.push(r.kind==='head' ? [r.label] : [r.label, r.basis||'', r.monthly!=null?Math.round(r.monthly):'', r.annual!=null?Math.round(r.annual):'', r.remark||''])
    rows.push([])
    rows.push(['Joining Bonus ('+form.joining_freq+')','','',calc.joining_bonus,'One-time'])
    rows.push(['Retention Bonus ('+form.retention_freq+')','','',calc.retention_bonus,'One-time'])
    rows.push(['ESOP','','',calc.esop,form.esop_plan||'As per grant letter'])
    for (const a of calc.additional_items||[]) rows.push(['Additional amount',a.remark||'','',a.amount,a.freq])
    if (calc.gratuity==='no') { rows.push([]); rows.push(['Note:','Gratuity is Over and Above the mentioned CTC package as per The Payment of Gratuity Act, 1972.']) }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'CTC Structure')
    XLSX.writeFile(wb, `CTC_Breakup_${Math.round(calc.ctcAnnual)}.xlsx`)
  }

  // PDF: a print view of the statement in a new window (the browser's Save as PDF).
  function printPdf() {
    if (!calc) return
    const w = window.open('', '_blank', 'width=900,height=1000'); if (!w) return
    w.document.write(ctcStatementHtml(calc, form, 'Salary Breakdown Statement', `${calc.state} · ${calc.category}`))
    w.document.close()
  }

  return (
    <div style={{ minWidth:0 }}>
      {/* header strip */}
      <div style={{ ...T.card, display:'flex', alignItems:'center', gap:12, padding:'12px 16px', marginBottom:12, position:'sticky', top:0, zIndex:Z.sticky + 1 }}>
        <div style={{ width:40, height:40, borderRadius:12, background:C.brand, color:C.onAccent, display:'grid', placeItems:'center', fontSize:17, fontWeight:800, flexShrink:0, boxShadow:'0 8px 20px rgba(124,58,237,.30)' }}>₹</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:700, color:C.ink }}>Automated CTC Calculator</div>
          <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>EPF ceiling ₹{EPF_WAGE_CEILING.toLocaleString('en-IN')} • Gratuity • Statutory bonus • Pan-India minimum wages · only a calculator, nothing here is saved</div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap:12, alignItems:'start' }}>
        {/* ── Inputs & Rules Selection ── */}
        <div style={{ ...T.cardPurple, padding:'12px 14px' }}>
          <div style={{ ...T.section, borderBottom:`1px solid ${C.brandEdge}`, paddingBottom:8, marginBottom:10 }}>Inputs &amp; Rules Selection</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
            <div><label className="rx-label">State / UT</label>
              <select className="rx-input" value={form.state} onChange={e=>F_('state',e.target.value)}>
                {MIN_WAGE_STATES.map(st=><option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div><label className="rx-label">Worker Category</label>
              <select className="rx-input" value={form.category} onChange={e=>F_('category',e.target.value)}>
                {WAGE_CATS.map(ct=><option key={ct} value={ct}>{ct}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:6 }}>
            <div><label className="rx-label">Total CTC (Annual ₹) *</label>
              <input className="rx-input" style={{ fontWeight:700 }} type="number" min={0} value={form.ctc} onChange={e=>F_('ctc',e.target.value)} placeholder="600000" />
            </div>
            <div><label className="rx-label">Variable CTC (Annual ₹)</label><input className="rx-input" style={{ fontWeight:700 }} type="number" min={0} value={form.varAmt} onChange={e=>F_('varAmt',e.target.value)} placeholder="0" /></div>
          </div>
          <div style={{ fontSize:10.5, color:C.faint, margin:'2px 0 10px', lineHeight:1.5 }}>
            Min wage · {form.state} · {form.category}: <b style={{ color:C.ink }}>₹{Math.round(mw.amount).toLocaleString('en-IN')}/mo</b>
            <span style={{ marginLeft:6, fontSize:9.5, padding:'1px 7px', borderRadius:99, background:mw.source==='master'?C.positiveTint:C.sunken, color:mw.source==='master'?C.positive:C.faint }}>{mw.source==='master'?'HR master':mw.source==='default'?'default table':'fallback'}</span>
            {' '}· Basic = higher of 50% of fixed CTC and this floor.
          </div>

          <div style={{ ...T.section, borderTop:`1px solid ${C.brandEdge}`, paddingTop:10, marginBottom:8 }}>Statutory &amp; Benefit Rules</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
            <div><label className="rx-label">Work location city</label>
              <select className="rx-input" value={form.metro} onChange={e=>F_('metro',e.target.value)}>
                <option value="no">Non-metro (HRA 40% of Basic)</option>
                <option value="yes">Metro: Delhi / Mumbai / Kolkata / Chennai (HRA 50%)</option>
              </select>
            </div>
            <div><label className="rx-label">Gratuity in CTC?</label>
              <select className="rx-input" value={form.gratuity} onChange={e=>F_('gratuity',e.target.value)}>
                <option value="yes">Yes (4.81% of Basic)</option>
                <option value="no">No (Over and above)</option>
              </select>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
            <div><label className="rx-label">Bonus Rate</label>
              <select className="rx-input" value={form.bonusPct} onChange={e=>F_('bonusPct',e.target.value)}>
                <option value="8.33">8.33% (Min)</option>
                <option value="20">20% (Max)</option>
                <option value="0">0% (N/A)</option>
              </select>
            </div>
            <div><label className="rx-label">Bonus Mode</label>
              <select className="rx-input" value={form.bonusMode} onChange={e=>F_('bonusMode',e.target.value)}>
                <option value="salary">With Salary</option>
                <option value="ctc">Only in CTC</option>
              </select>
            </div>
          </div>
          <button onClick={()=>setPulse(p=>p+1)} style={{ ...T.btnPrimary, width:'100%', padding:'9px', fontSize:12.5, marginBottom:12 }}>Recalculate Breakdown</button>

          {/* One-time payments, T&C and additional amounts — folded, with a summary line */}
          <details open={extrasOpen} onToggle={e=>setExtrasOpen((e.target as HTMLDetailsElement).open)} style={{ border:`1px solid ${C.brandEdge}`, borderRadius:10, background:C.sunken }}>
            <summary style={{ listStyle:'none', cursor:'pointer', padding:'9px 12px', display:'flex', alignItems:'center', gap:8, userSelect:'none' as const }}>
              <span style={{ display:'inline-block', transform: extrasOpen?'rotate(90deg)':'none', transition:'transform .2s', color:C.brand, fontSize:11 }}>▶</span>
              <span style={{ ...T.section, marginBottom:0, marginTop:0 }}>One-time payments &amp; extras</span>
              <span style={{ marginLeft:'auto', fontSize:10.5, color:C.faint, whiteSpace:'nowrap' as const, overflow:'hidden', textOverflow:'ellipsis' }}>{extrasSummary}</span>
            </summary>
            <div style={{ padding:'4px 12px 12px', borderTop:`1px solid ${C.brandEdge}` }}>
              <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:8, marginTop:8 }}>
                <div><label className="rx-label">Joining Bonus (₹)</label><input className="rx-input" type="number" value={form.joining_bonus} onChange={e=>F_('joining_bonus',e.target.value)} placeholder="100000" /></div>
                <div><label className="rx-label">Paid</label>
                  <select className="rx-input" disabled={!(Number(form.joining_bonus)>0)} style={{ opacity: Number(form.joining_bonus)>0 ? 1 : .45 }} value={form.joining_freq} onChange={e=>F_('joining_freq',e.target.value)}>
                    <option>With Salary</option><option>After 3 Months</option><option>After 6 Months</option><option>As per Policy</option>
                  </select>
                </div>
                <div><label className="rx-label">Retention Bonus (₹)</label><input className="rx-input" type="number" value={form.retention_bonus} onChange={e=>F_('retention_bonus',e.target.value)} placeholder="200000" /></div>
                <div><label className="rx-label">Paid</label>
                  <select className="rx-input" disabled={!(Number(form.retention_bonus)>0)} style={{ opacity: Number(form.retention_bonus)>0 ? 1 : .45 }} value={form.retention_freq} onChange={e=>F_('retention_freq',e.target.value)}>
                    <option>After 3 Months</option><option>After 6 Months</option><option>After 1 Year</option><option>As per Policy</option>
                  </select>
                </div>
                <div><label className="rx-label">ESOP (₹ Grant Value)</label><input className="rx-input" type="number" value={form.esop} onChange={e=>F_('esop',e.target.value)} placeholder="2000000" /></div>
                <div><label className="rx-label">ESOP Plan / Vesting</label><input className="rx-input" value={form.esop_plan} onChange={e=>F_('esop_plan',e.target.value)} placeholder="4 yr, 1 yr cliff" /></div>
              </div>
              <div style={{ marginTop:8 }}>
                <label className="rx-label">Terms &amp; Conditions</label>
                <textarea className="rx-input" style={{ minHeight:52 }} value={form.terms} onChange={e=>F_('terms',e.target.value)} placeholder="e.g. Joining bonus is recoverable if the employee leaves within 12 months…" />
              </div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:10, marginBottom:6 }}>
                <div style={{ ...T.section, marginBottom:0, marginTop:0 }}>Additional Amounts</div>
                <button onClick={addRow} style={{ ...T.btnOutline, padding:'4px 10px', fontSize:11.5 }}>+ Add</button>
              </div>
              {addItems.length===0 && <div style={{ fontSize:10.5, color:C.faint }}>Optional, e.g. a monthly allowance or a quarterly incentive.</div>}
              {addItems.map((r,i)=>(
                <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1.4fr auto', gap:6, alignItems:'end', marginBottom:6 }}>
                  <div><label className="rx-label">Amount (₹)</label><input className="rx-input" type="number" value={r.amount} onChange={e=>setRow(i,'amount',e.target.value)} placeholder="5000" /></div>
                  <div><label className="rx-label">Frequency</label>
                    <select className="rx-input" value={r.freq} onChange={e=>setRow(i,'freq',e.target.value)}>{ADD_FREQS.map(o=><option key={o}>{o}</option>)}</select>
                  </div>
                  <div><label className="rx-label">Remark</label><input className="rx-input" value={r.remark} onChange={e=>setRow(i,'remark',e.target.value)} placeholder="Optional note" /></div>
                  <button onClick={()=>delRow(i)} title="Remove" style={{ padding:'8px 10px', borderRadius:7, border:`1px solid ${C.criticalEdge}`, background:C.criticalTint, color:C.critical, cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700 }}>✕</button>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* ── Salary Breakdown Statement ── */}
        <div style={{ ...T.card }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' as const, borderBottom:`1px solid ${C.brandEdge}`, paddingBottom:10, marginBottom:10 }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.ink }}>Salary Breakdown Statement</div>
              <div style={{ fontSize:10.5, color:C.faint, marginTop:2 }}>Compliant with statutory minimum wage ({form.state} · {form.category}: ₹{Math.round(mw.amount).toLocaleString('en-IN')}/mo) &amp; EPFO regulations</div>
            </div>
            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
              <button onClick={()=>setShowMw(true)} style={{ ...T.btnOutline, background:C.brandTint, borderColor:C.brandEdge, color:C.brandDeep, fontWeight:700, fontSize:11.5 }}>Min wages</button>
              <button onClick={downloadExcel} disabled={!calc} style={{ ...T.btnOutline, background:C.positiveTint, borderColor:C.positiveEdge, color:C.positive, fontWeight:700, fontSize:11.5, opacity:calc?1:.5 }}>Excel</button>
              <button onClick={printPdf} disabled={!calc} style={{ ...T.btnOutline, background:C.criticalTint, borderColor:C.criticalEdge, color:C.critical, fontWeight:700, fontSize:11.5, opacity:calc?1:.5 }}>PDF</button>
            </div>
            {showMw && <MinWagesPopup rates={mwRates} state={form.state} category={form.category} onClose={()=>setShowMw(false)} />}
          </div>

          {calcError && (
            <div style={{ background:C.criticalTint, border:`1px solid ${C.criticalEdge}`, color:C.critical, fontSize:12, lineHeight:1.6, borderRadius:10, padding:'10px 12px', marginBottom:10 }}>
              <b>Given CTC is too low!</b> {calcError}
            </div>
          )}
          {!model && <div style={{ padding:'28px 12px', textAlign:'center' as const, color:C.faint, fontSize:12.5 }}>Enter the Total CTC to see the live breakdown.</div>}

          {calc && (
            <div key={pulse} style={{ animation:'ezFadeUp .3s ease' }}>
              <CtcStatementTable rows={statementRows()} />
              {calc.gratuity==='no' && (
                <div style={{ marginTop:10, background:C.infoTint, border:`1px solid ${C.infoEdge}`, borderRadius:10, padding:'9px 13px', fontSize:12, color:C.info, lineHeight:1.5 }}>
                  <b>Note:</b> Gratuity is Over and Above the mentioned CTC package as per The Payment of Gratuity Act, 1972.
                </div>
              )}
              {(calc.joining_bonus>0 || calc.retention_bonus>0 || calc.esop>0) && (
                <div style={{ marginTop:12 }}>
                  <div style={T.section}>One-time Payments</div>
                  {calc.joining_bonus>0 && (
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom:`1px solid ${C.brandEdge}`, fontSize:12 }}>
                      <span>Joining Bonus <span style={{ fontSize:10, color:C.faint }}>({form.joining_freq})</span></span>
                      <span style={{ fontWeight:600, color:C.positive }}>₹{calc.joining_bonus.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {calc.retention_bonus>0 && (
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom:`1px solid ${C.brandEdge}`, fontSize:12 }}>
                      <span>Retention Bonus <span style={{ fontSize:10, color:C.faint }}>({form.retention_freq})</span></span>
                      <span style={{ fontWeight:600, color:C.positive }}>₹{calc.retention_bonus.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {calc.esop>0 && (
                    <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', fontSize:12 }}>
                      <span>ESOP Grant Value <span style={{ fontSize:10, color:C.faint }}>{form.esop_plan && `(${form.esop_plan})`}</span></span>
                      <span style={{ fontWeight:600, color:C.brand }}>₹{calc.esop.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {calc.terms_conditions && <div style={{ fontSize:11, color:C.muted, padding:'6px 10px', lineHeight:1.5 }}><b style={{ color:C.ink }}>T&amp;C:</b> {calc.terms_conditions}</div>}
                </div>
              )}
              {calc.additional_items.length>0 && (
                <div style={{ marginTop:12 }}>
                  <div style={T.section}>Additional Amounts</div>
                  {calc.additional_items.map((r,i)=>(
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', borderBottom:`1px solid ${C.brandEdge}`, fontSize:12 }}>
                      <span>Additional <span style={{ fontSize:10, color:C.faint }}>({r.freq}{r.remark ? ` · ${r.remark}` : ''})</span></span>
                      <span style={{ fontWeight:600, color:C.positive }}>₹{Number(r.amount).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
