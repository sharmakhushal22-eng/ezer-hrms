'use client'
// components/onboarding/ReviewDrawer.tsx — the HR Manager's review of a submitted onboarding
// form, opened from the onboarding card (Review form / View form).
//
// The form is laid out as one sheet of paper: every detail the candidate typed and every
// document they uploaded, section by section. Nothing has a button on it — the reviewer
// clicks whatever is wrong (a detail, a table row, a document) and it is marked; the marked
// items collect in the bar at the foot of the sheet with ONE remark box. Then:
//   Send to candidate → link reopens 48h, the candidate is mailed the marked items + remark
//                       + link; the card shows Resend link until they resubmit
//   Accept form       → (nothing marked) the HR Manager's team approval; the fourth approval
//                       generates the employee code
// Read-only after acceptance (View form). API: /api/onboarding/review.
import { useEffect, useMemo, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { C as TK, Z, E } from '@/lib/ui'

export type Doc = { doc_code: string; label: string; file_name: string | null; mime_type: string | null; url: string | null; hr_verified: boolean | null; note: string | null; ai_status: string | null; uploaded_at: string | null }
export type Approval = { team: string; status: 'PENDING' | 'APPROVED' | 'RETURNED'; acted_by_name: string | null; remark: string | null }
export type Mark = { key: string; kind: 'doc' | 'detail'; label: string; section?: string; doc_code?: string }
type FieldDef = [string, string]
type Block =
  | { kind: 'fields'; title?: string; fields: FieldDef[] }
  | { kind: 'table'; key: string; title: string; cols: FieldDef[]; fallback?: FieldDef[]; hides?: RegExp }
  | { kind: 'nested'; key: string; title: string; fields: FieldDef[] }
type Section = { step: string; title: string; blocks: Block[] }

export const TEAM: Record<string, string> = { IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', HR_MANAGER: 'HR Manager' }

/** The paper sheet's styling — shared with the heads' approval form (components/ess/OnboardingApprovals.tsx). */
export const SHEET_CSS = `
  .rv-paper{background:${TK.surface};color:${TK.ink};width:min(920px,100%);margin:0 auto;border-radius:6px;box-shadow:${E.overlay};padding:40px 52px 0;font-size:13px;line-height:1.45;position:relative}
  .rv-paper:before{content:'';position:absolute;left:0;right:0;top:0;height:5px;border-radius:6px 6px 0 0;background:${TK.brand}}
  .rv-h{display:flex;align-items:baseline;gap:10px;margin:0;padding-bottom:6px;border-bottom:1px solid ${TK.lineStrong};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${TK.brand}}
  .rv-h span{color:${TK.ink};font-size:14px;font-weight:700;letter-spacing:0;text-transform:none}
  .rv-sub{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${TK.muted};margin-bottom:6px}
  .rv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 18px}
  .rv-cell{padding:7px 9px;border:1px solid transparent;border-radius:7px;min-width:0;transition:background .12s,border-color .12s}
  .rv-cell.pick{cursor:pointer}
  .rv-cell.pick:hover,.rv-cell.pick:focus-visible{background:${TK.brandTint};border-color:${TK.brandEdge};outline:none}
  .rv-cell.on,.rv-cell.on:hover{background:${TK.criticalTint};border-color:${TK.criticalEdge}}
  .rv-lbl{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:${TK.muted};font-weight:600}
  .rv-val{font-size:13px;font-weight:500;word-break:break-word}
  .rv-tag{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:99px;background:${TK.critical};color:${TK.onAccent};font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;vertical-align:1px}
  .rv-table{width:100%;border-collapse:collapse;font-size:12.5px}
  .rv-table th{text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:${TK.muted};font-weight:600;padding:6px 9px;border-bottom:1px solid ${TK.line}}
  .rv-table td{padding:7px 9px;border-bottom:1px solid ${TK.line};vertical-align:top;color:${TK.ink}}
  .rv-row.pick{cursor:pointer}
  .rv-row.pick:hover td{background:${TK.brandTint}}
  .rv-row.on td,.rv-row.on:hover td{background:${TK.criticalTint}}
  .rv-docs{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:8px;margin-top:10px}
  .rv-doc{display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid ${TK.line};border-radius:9px;background:${TK.surface};transition:background .12s,border-color .12s}
  .rv-doc.pick{cursor:pointer}
  .rv-doc.pick:hover,.rv-doc.pick:focus-visible{background:${TK.brandTint};border-color:${TK.brandEdge};outline:none}
  .rv-doc.on,.rv-doc.on:hover{background:${TK.criticalTint};border-color:${TK.critical}}
  .rv-doc-ic{flex:none;width:38px;height:44px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;letter-spacing:.06em}
  .rv-view{flex:none;font-size:11.5px;font-weight:600;color:${TK.brand};text-decoration:none;padding:4px 8px;border-radius:6px;border:1px solid ${TK.brandEdge};background:${TK.surface}}
  .rv-view:hover{background:${TK.brandTint}}
  .rv-stamp{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:700;letter-spacing:.03em;border:1px solid}
  .rv-bar{position:sticky;bottom:0;margin:34px -52px 0;padding:16px 52px 20px;background:${TK.surface};border-top:1px solid ${TK.lineStrong};border-radius:0 0 6px 6px;box-shadow:0 -12px 24px -18px rgba(15,23,42,.35)}
  .rv-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 6px 3px 10px;border-radius:99px;background:${TK.criticalTint};color:${TK.critical};border:1px solid ${TK.criticalEdge};font-size:11.5px;font-weight:600}
  .rv-chip button{all:unset;cursor:pointer;width:16px;height:16px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;line-height:1;background:${TK.critical};color:${TK.onAccent}}
  .rv-btn{padding:10px 18px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;white-space:nowrap;color:${TK.onAccent}}
  .rv-btn:disabled{opacity:.55;cursor:not-allowed}
  .rv-ghost{padding:7px 13px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;background:${TK.surface};color:${TK.brandDeep};border:1px solid ${TK.brandEdge}}
  .rv-ta{width:100%;min-height:76px;padding:10px 12px;border:1px solid ${TK.lineStrong};border-radius:8px;font-size:13px;font-family:inherit;color:${TK.ink};background:${TK.surface};box-sizing:border-box;resize:vertical;line-height:1.5}
  .rv-ta:focus{outline:none;border-color:${TK.brand};box-shadow:0 0 0 3px ${TK.brandTint}}
  .rv-in{width:100%;padding:9px 11px;border:1px solid ${TK.lineStrong};border-radius:8px;font-size:13px;font-family:inherit;color:${TK.ink};background:${TK.surface};box-sizing:border-box}
  .rv-in:focus{outline:none;border-color:${TK.brand};box-shadow:0 0 0 3px ${TK.brandTint}}
  .rv-in:disabled{background:${TK.sunken};color:${TK.inkSoft}}
  .rv-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
  .rv-tile{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid ${TK.line};border-radius:10px;background:${TK.surface};cursor:pointer;transition:background .12s,border-color .12s,transform .12s;user-select:none}
  .rv-tile:hover{border-color:${TK.brandEdge};background:${TK.brandTint}}
  .rv-tile.on{border-color:${TK.positiveEdge};background:${TK.positiveTint}}
  .rv-tile.need{border-color:${TK.warningEdge}}
  .rv-tile.ro{cursor:default}
  .rv-tile.ro:hover{border-color:${TK.line};background:${TK.surface}}
  .rv-tile.ro.on:hover{border-color:${TK.positiveEdge};background:${TK.positiveTint}}
  .rv-tick{flex:none;width:26px;height:26px;border-radius:99px;border:2px solid ${TK.lineStrong};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:${TK.onAccent};background:transparent;transition:background .12s,border-color .12s}
  .rv-tile.on .rv-tick{background:${TK.positive};border-color:${TK.positive}}
  .rv-prog{height:6px;border-radius:99px;background:${TK.sunken};overflow:hidden}
  .rv-prog i{display:block;height:100%;border-radius:99px;background:${TK.positive};transition:width .25s}
  .rv-sal{width:100%;border-collapse:collapse;font-size:12.5px}
  .rv-sal th{text-align:right;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:${TK.muted};font-weight:600;padding:6px 9px;border-bottom:1px solid ${TK.lineStrong}}
  .rv-sal th:first-child{text-align:left}
  .rv-sal td{padding:6px 9px;border-bottom:1px solid ${TK.line};text-align:right;font-variant-numeric:tabular-nums;color:${TK.ink}}
  .rv-sal td:first-child{text-align:left}
  .rv-sal tr.head td{padding-top:14px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${TK.muted};border-bottom:1px solid ${TK.lineStrong}}
  .rv-sal tr.sum td,.rv-sal tr.total td,.rv-sal tr.net td{font-weight:700}
  .rv-sal tr.total td{background:${TK.brandTint};color:${TK.brandDeep}}
  .rv-sal tr.net td{background:${TK.positiveTint};color:${TK.positive}}
  .rv-sal tr.ded td{color:${TK.critical}}
  .rv-sal tr.emp td,.rv-sal tr.grat td,.rv-sal tr.bonus td{color:${TK.inkSoft}}
  .rv-sal tr.muted td{color:${TK.muted}}
  .rv-sal tr.note td{font-size:11px;color:${TK.muted};text-align:left;border-bottom:none;padding-top:8px}
  .rv-sal small{display:block;font-size:10.5px;color:${TK.muted};font-weight:400}
  @media (max-width:640px){.rv-paper{padding:26px 18px 0}.rv-bar{margin:26px -18px 0;padding:14px 18px 16px}}
`
const HIDE = new Set(['bank_confirm', 'docs_uploaded', 'same_address'])

// ── What the paper shows, in order. Keys the schema does not know are appended under “Other”. ──
const ADDR = (p: string): FieldDef[] => [[`${p}line1`, 'Address line'], [`${p}village`, 'Village / locality'], [`${p}po`, 'Post office'], [`${p}thana`, 'Police station'], [`${p}sub_division`, 'Sub-division'], [`${p}city`, 'City'], [`${p}district`, 'District'], [`${p}state`, 'State'], [`${p}pin`, 'PIN code']]
const NOMINEE: FieldDef[] = [['name', 'Name'], ['relation', 'Relation'], ['dob', 'Date of birth'], ['share', 'Share %'], ['address', 'Address']]
export const SCHEMA: Section[] = [
  { step: 'step_3', title: 'Personal details', blocks: [
    { kind: 'fields', fields: [['full_name', 'Full name'], ['dob', 'Date of birth'], ['gender', 'Gender'], ['blood_group', 'Blood group'], ['marital_status', 'Marital status'], ['father_name', "Father's name"], ['mother_name', "Mother's name"], ['spouse_name', "Spouse's name"], ['nationality', 'Nationality'], ['country', 'Country'], ['religion', 'Religion'], ['birth_place', 'Place of birth'], ['aadhaar_number', 'Aadhaar number']] },
  ] },
  { step: 'step_4', title: 'Contact & addresses', blocks: [
    { kind: 'fields', title: 'Contact', fields: [['mobile', 'Mobile'], ['alt_mobile', 'Alternate mobile'], ['personal_email', 'Personal email'], ['whatsapp', 'WhatsApp']] },
    { kind: 'fields', title: 'Permanent address', fields: ADDR('perm_') },
    { kind: 'fields', title: 'Current address', fields: ADDR('curr_') },
  ] },
  { step: 'step_5', title: 'Emergency contacts, experience & education', blocks: [
    { kind: 'fields', title: 'Emergency contact 1', fields: [['emrg1_name', 'Name'], ['emrg1_relation', 'Relation'], ['emrg1_mobile', 'Mobile']] },
    { kind: 'fields', title: 'Emergency contact 2', fields: [['emrg2_name', 'Name'], ['emrg2_relation', 'Relation'], ['emrg2_mobile', 'Mobile']] },
    { kind: 'fields', title: 'Experience', fields: [['is_fresher', 'Fresher (no previous employer)'], ['total_experience', 'Total experience']] },
    { kind: 'table', key: 'prev_employers', title: 'Previous employment', cols: [['company', 'Company'], ['designation', 'Designation'], ['from', 'From'], ['to', 'To'], ['ctc', 'CTC'], ['reason', 'Reason for leaving']], hides: /^(prev_|reason_leaving)/,
      fallback: [['prev_company', 'Company'], ['prev_designation', 'Designation'], ['prev_from', 'From'], ['prev_to', 'To'], ['prev_ctc', 'CTC'], ['reason_leaving', 'Reason for leaving']] },
    { kind: 'table', key: 'education', title: 'Education', cols: [['qualification', 'Qualification'], ['institute', 'Institute / board'], ['year', 'Year'], ['percentage', 'Marks %']] },
  ] },
  { step: 'step_7', title: 'PAN, PF, bank & nominees', blocks: [
    { kind: 'fields', title: 'Statutory', fields: [['pan_number', 'PAN'], ['has_uan', 'Has a UAN'], ['uan_number', 'UAN'], ['prev_pf_id', 'Previous PF member ID'], ['pf_transfer', 'Transfer the PF balance']] },
    { kind: 'fields', title: 'Other IDs', fields: [['passport_no', 'Passport number'], ['voter_id', 'Voter ID'], ['driving_licence', 'Driving licence']] },
    { kind: 'fields', title: 'Bank account (salary)', fields: [['acc_holder', 'Account holder'], ['bank_name', 'Bank'], ['bank_branch', 'Branch'], ['bank_account', 'Account number'], ['bank_ifsc', 'IFSC'], ['account_type', 'Account type']] },
    { kind: 'fields', title: 'ESIC', fields: [['gross_monthly', 'Gross monthly salary'], ['esic_applicable', 'ESIC applicable']] },
    { kind: 'nested', key: 'esic_details', title: 'ESIC details', fields: [['prev_ip', 'Previous IP number'], ['dispensary', 'Dispensary']] },
    { kind: 'table', key: 'pf_nominees', title: 'PF nominees (Form 2)', cols: NOMINEE, hides: /^nominee_/, fallback: [['nominee_name', 'Name'], ['nominee_relation', 'Relation'], ['nominee_dob', 'Date of birth'], ['nominee_share', 'Share %'], ['nominee_address', 'Address']] },
    { kind: 'table', key: 'grat_nominees', title: 'Gratuity nominees (Form F)', cols: NOMINEE, hides: /^grat_nominee_/, fallback: [['grat_nominee_name', 'Name'], ['grat_nominee_relation', 'Relation'], ['grat_nominee_dob', 'Date of birth'], ['grat_nominee_share', 'Share %']] },
    { kind: 'table', key: 'eps_family', title: 'EPS family members', cols: [['name', 'Name'], ['relation', 'Relation'], ['dob', 'Date of birth'], ['address', 'Address']] },
    { kind: 'nested', key: 'eps_fallback', title: 'EPS nominee (when there is no family)', fields: [['name', 'Name'], ['relation', 'Relation'], ['dob', 'Date of birth'], ['address', 'Address']] },
    { kind: 'nested', key: 'insurance', title: 'Family for insurance', fields: [['spouse_name', 'Spouse'], ['spouse_dob', 'Spouse DOB'], ['spouse_residing', 'Spouse residing with you'], ['father_name', 'Father'], ['father_dob', 'Father DOB'], ['father_residing', 'Father residing with you'], ['mother_name', 'Mother'], ['mother_dob', 'Mother DOB'], ['mother_residing', 'Mother residing with you'], ['kid1_name', 'Child 1'], ['kid1_dob', 'Child 1 DOB'], ['kid2_name', 'Child 2'], ['kid2_dob', 'Child 2 DOB']] },
  ] },
]

const pretty = (k: string) => k.replace(/^(fe|emrg|prev|grat|nominee|eps|perm|curr)_/, m => ({ fe_: 'Foreign ', emrg_: 'Emergency ', prev_: 'Previous ', grat_: 'Gratuity ', nominee_: 'Nominee ', eps_: 'EPS ', perm_: 'Permanent ', curr_: 'Current ' }[m] || '')).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const empty = (v: any) => v == null || v === '' || v === false
const show = (v: any): string => v === true ? 'Yes' : v === false ? 'No' : v == null || v === '' ? '' : typeof v === 'object' ? '' : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? day(String(v)) : String(v)
const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v)

/** The schema's blocks for one step plus a block for every key the schema does not list. */
function blocksFor(sec: Section, obj: Record<string, any>): Block[] {
  const out: Block[] = []
  const covered = new Set<string>(HIDE)
  const hides: RegExp[] = []
  for (const b of sec.blocks) {
    if (b.kind === 'fields') { b.fields.forEach(([k]) => covered.add(k)); out.push(b); continue }
    covered.add(b.key)
    if (b.kind === 'table') {
      const rows = Array.isArray(obj[b.key]) ? obj[b.key].filter((r: any) => r && Object.values(r).some(v => !empty(v))) : []
      if (rows.length) { out.push(b); if (b.hides) hides.push(b.hides); b.fallback?.forEach(([k]) => covered.add(k)) }
      else if (b.fallback) { b.fallback.forEach(([k]) => covered.add(k)); out.push({ kind: 'fields', title: b.title, fields: b.fallback }) }
      continue
    }
    out.push(b)
  }
  const rest = Object.keys(obj).filter(k => !covered.has(k) && !hides.some(h => h.test(k)))
  // Keys the schema does not list: only the filled ones, foreign-national ones under their own heading.
  const flat = rest.filter(k => !isObj(obj[k]) && !Array.isArray(obj[k]) && !empty(obj[k]))
  const groups: Record<string, FieldDef[]> = {}
  for (const k of flat) (groups[/^(foreign|fe)_/.test(k) ? 'Foreign national' : 'Other'] ||= []).push([k, pretty(k.replace(/^foreign_/, ''))])
  for (const [t, f] of Object.entries(groups)) out.push({ kind: 'fields', title: t, fields: f })
  for (const k of rest.filter(k => isObj(obj[k]))) out.push({ kind: 'nested', key: k, title: pretty(k), fields: Object.keys(obj[k]).map(f => [f, pretty(f)]) })
  for (const k of rest.filter(k => Array.isArray(obj[k]) && obj[k].length)) out.push({ kind: 'table', key: k, title: pretty(k), cols: Object.keys(obj[k][0] || {}).map(f => [f, pretty(f)]) })
  return out
}

// ── Sub-components live OUTSIDE the drawer so typing in the remark never remounts them. ──

function Cell({ label, value, on, pick, onPick }: { label: string; value: string; on: boolean; pick: boolean; onPick: () => void }) {
  return (
    <div className={`rv-cell${pick ? ' pick' : ''}${on ? ' on' : ''}`} role={pick ? 'button' : undefined} tabIndex={pick ? 0 : undefined} onClick={pick ? onPick : undefined} onKeyDown={pick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick() } } : undefined} title={pick ? (on ? 'Marked — click to clear' : 'Click if this is wrong') : undefined}>
      <div className="rv-lbl">{label}</div>
      <div className="rv-val" style={{ color: value ? TK.ink : TK.faint }}>{value || '—'}{on && <span className="rv-tag">needs correction</span>}</div>
    </div>
  )
}

function Table({ title, rows, cols, on, pick, onPick }: { title: string; rows: any[]; cols: FieldDef[]; on: (i: number) => boolean; pick: boolean; onPick: (i: number, row: any) => void }) {
  const used = cols.filter(([k]) => rows.some(r => !empty(r?.[k])))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="rv-table">
        <thead><tr>{used.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`rv-row${pick ? ' pick' : ''}${on(i) ? ' on' : ''}`} onClick={pick ? () => onPick(i, r) : undefined} title={pick ? (on(i) ? 'Marked — click to clear' : `Click if this ${title.toLowerCase()} entry is wrong`) : undefined}>
              {used.map(([k], j) => <td key={k}>{show(r?.[k]) || <span style={{ color: TK.faint }}>—</span>}{j === 0 && on(i) && <span className="rv-tag">needs correction</span>}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SectionView({ n, sec, obj, marks, pick, onToggle }: { n: number; sec: Section; obj: Record<string, any>; marks: Record<string, Mark>; pick: boolean; onToggle: (m: Mark) => void }) {
  const blocks = blocksFor(sec, obj)
  const key = (field: string) => `det:${sec.title}|${field}`
  const toggle = (field: string) => onToggle({ key: key(field), kind: 'detail', label: field, section: sec.title })
  return (
    <section style={{ marginTop: 30 }}>
      <h3 className="rv-h">{String(n).padStart(2, '0')} <span>{sec.title}</span></h3>
      {blocks.map((b, bi) => {
        if (b.kind === 'fields') {
          const fields = b.fields.filter(([k]) => k in obj)
          if (!fields.some(([k]) => !empty(obj[k]))) return null
          const name = (l: string) => b.title ? `${b.title} · ${l}` : l
          return (
            <div key={bi} style={{ marginTop: b.title ? 16 : 10 }}>
              {b.title && <div className="rv-sub">{b.title}{b.title === 'Current address' && obj.same_address ? <span style={{ fontWeight: 400, color: TK.muted }}> · same as permanent</span> : null}</div>}
              <div className="rv-grid">{fields.map(([k, l]) => <Cell key={k} label={l} value={show(obj[k])} on={!!marks[key(name(l))]} pick={pick} onPick={() => toggle(name(l))} />)}</div>
            </div>
          )
        }
        if (b.kind === 'nested') {
          const o = isObj(obj[b.key]) ? obj[b.key] : null
          if (!o || !b.fields.some(([k]) => !empty(o[k]))) return null
          return (
            <div key={bi} style={{ marginTop: 16 }}>
              <div className="rv-sub">{b.title}</div>
              <div className="rv-grid">{b.fields.filter(([k]) => !empty(o[k])).map(([k, l]) => <Cell key={k} label={l} value={show(o[k])} on={!!marks[key(`${b.title} · ${l}`)]} pick={pick} onPick={() => toggle(`${b.title} · ${l}`)} />)}</div>
            </div>
          )
        }
        const rows = (obj[b.key] as any[]).filter(r => r && Object.values(r).some(v => !empty(v)))
        const rowName = (i: number, r: any) => `${b.title} · entry ${i + 1}${show(r?.[b.cols[0][0]]) ? ` (${show(r[b.cols[0][0]])})` : ''}`
        return (
          <div key={bi} style={{ marginTop: 16 }}>
            <div className="rv-sub">{b.title}</div>
            <Table title={b.title} rows={rows} cols={b.cols} on={i => !!marks[key(rowName(i, rows[i]))]} pick={pick} onPick={(i, r) => toggle(rowName(i, r))} />
          </div>
        )
      })}
    </section>
  )
}

export function DocCard({ doc, on, pick, onPick }: { doc: Doc; on: boolean; pick: boolean; onPick: () => void }) {
  const img = /^image\//.test(doc.mime_type || '') || /\.(png|jpe?g|webp)$/i.test(doc.file_name || '')
  return (
    <div className={`rv-doc${pick ? ' pick' : ''}${on ? ' on' : ''}`} role={pick ? 'button' : undefined} tabIndex={pick ? 0 : undefined} onClick={pick ? onPick : undefined} onKeyDown={pick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick() } } : undefined} title={pick ? (on ? 'Marked — click to clear' : 'Click if this document is wrong') : undefined}>
      <div className="rv-doc-ic" style={{ background: on ? TK.criticalTint : TK.sunken, color: on ? TK.critical : TK.brandDeep }}>{img ? 'IMG' : 'PDF'}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: TK.ink }}>{doc.label}{on && <span className="rv-tag">upload again</span>}</div>
        <div style={{ fontSize: 11, color: TK.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {doc.file_name || 'no file'}{doc.uploaded_at ? ` · ${day(doc.uploaded_at)}` : ''}
          {doc.ai_status === 'VERIFIED' && !on && <span style={{ color: TK.positive, fontWeight: 600 }}> · AI verified</span>}
          {!pick && doc.hr_verified === true && <span style={{ color: TK.positive, fontWeight: 600 }}> · accepted</span>}
        </div>
      </div>
      {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="rv-view">Open ↗</a>}
    </div>
  )
}

export default function ReviewDrawer({ onboardingId, readOnly = false, onClose, onDone }: {
  onboardingId: string; readOnly?: boolean; onClose: () => void; onDone: (msg: string, type?: 'ok' | 'err') => void
}) {
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState('')

  /** A filled statutory form in a new tab. The route needs the session header, so it is fetched and shown as a blob. */
  async function openForm(form: string, label: string) {
    setOpening(form)
    try {
      const res = await fetch(`/api/onboarding/forms?form=${form}&onboarding_id=${onboardingId}`, { headers: await authHeaders() })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not open ${label}`)
      const url = URL.createObjectURL(await res.blob())
      if (!window.open(url, '_blank')) onDone('The browser blocked the new tab — allow pop-ups for this site.', 'err')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) { onDone(e.message, 'err') } finally { setOpening('') }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/onboarding/review?onboarding_id=${onboardingId}`, { headers: await authHeaders() })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Could not load the form')
        if (!alive) return
        setData(d)
        // While a return stands, the sheet shows what was marked and the remark that went out.
        if (d.hr_review?.outcome === 'RETURNED') {
          const m: Record<string, Mark> = {}
          for (const x of d.hr_review.documents || []) m[`doc:${x.doc_code}`] = { key: `doc:${x.doc_code}`, kind: 'doc', label: x.label, doc_code: x.doc_code }
          for (const x of d.hr_review.details || []) m[`det:${x.section}|${x.field}`] = { key: `det:${x.section}|${x.field}`, kind: 'detail', label: x.field, section: x.section }
          setMarks(m); setRemark(d.hr_review.note || '')
        }
      } catch (e: any) { if (alive) setErr(e.message) }
    })()
    return () => { alive = false }
  }, [onboardingId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const item = data?.item
  const canDecide = !readOnly && !!item && ['SUBMITTED', 'HR_REVIEW', 'APPROVED'].includes(item.status) && data.approvals?.find((a: Approval) => a.team === 'HR_MANAGER')?.status !== 'APPROVED'
  const docs: Doc[] = data?.documents || []
  const list = useMemo(() => Object.values(marks), [marks])
  const toggle = (m: Mark) => setMarks(s => { const n = { ...s }; if (n[m.key]) delete n[m.key]; else n[m.key] = m; return n })

  async function send(outcome: 'ACCEPTED' | 'RETURNED') {
    if (outcome === 'RETURNED' && !remark.trim()) { onDone('Write a remark for the candidate — it goes in the mail with the marked items.', 'err'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/onboarding/review', {
        method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onboarding_id: onboardingId, outcome, note: remark.trim(),
          documents: docs.map(d => ({ doc_code: d.doc_code, ok: !marks[`doc:${d.doc_code}`], reason: null })),
          details: list.filter(m => m.kind === 'detail').map(m => ({ section: m.section, field: m.label, reason: '' })),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      if (outcome === 'ACCEPTED') onDone('Form accepted. IT, Admin and Payroll have been asked to confirm their checklists and approve; after that, assign the role and generate the code from the card.', 'ok')
      else onDone(`Sent to ${item.full_name}${d.mailed ? ' — they have been emailed the corrections with the link' : ' (no email on file — use Resend link or share it)'}.`, 'ok')
      onClose()
    } catch (e: any) { onDone(e.message, 'err') } finally { setBusy(false) }
  }

  const docMarks = list.filter(m => m.kind === 'doc').length, detMarks = list.length - docMarks

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: Z.modal, overflowY: 'auto', padding: '28px 12px 40px', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
      <style>{SHEET_CSS}</style>

      <div className="rv-paper">
        {err && <div style={{ color: TK.critical, paddingBottom: 30 }}>{err} <button onClick={onClose} className="rv-ghost" style={{ marginLeft: 8 }}>Close</button></div>}
        {!err && !data && <div style={{ color: TK.muted, padding: '20px 0 50px' }}>Opening the form…</div>}
        {item && (
          <>
            {/* ── Letterhead ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: TK.muted }}>Onboarding form · {item.employment_type || 'Employee'}</div>
              <button onClick={onClose} className="rv-ghost" aria-label="Close">✕ Close</button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.15 }}>{item.full_name}</div>
                {(item.designation || item.department) && <div style={{ fontSize: 13, color: TK.inkSoft, marginTop: 4 }}>{[item.designation, item.department].filter(Boolean).join(' · ')}</div>}
                <div style={{ fontSize: 12, color: TK.muted, marginTop: 2 }}>Joining {day(item.date_of_joining)} · submitted {day(item.submitted_at)} · {item.email || 'no email'}{item.mobile ? ` · ${item.mobile}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {(data.approvals as Approval[]).map(a => {
                  const c = a.status === 'APPROVED' ? TK.positive : a.status === 'RETURNED' ? TK.critical : TK.muted
                  return <span key={a.team} className="rv-stamp" style={{ color: c, borderColor: c, background: a.status === 'APPROVED' ? TK.positiveTint : a.status === 'RETURNED' ? TK.criticalTint : TK.sunken }} title={a.remark || ''}>{TEAM[a.team]} {a.status === 'APPROVED' ? '✓' : a.status === 'RETURNED' ? '↩' : '·'} {a.status === 'APPROVED' ? (a.acted_by_name || 'approved') : a.status === 'RETURNED' ? 'returned' : 'pending'}</span>
                })}
              </div>
            </div>
            {data.hr_review && (
              <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: data.hr_review.outcome === 'RETURNED' ? TK.criticalTint : TK.sunken, fontSize: 12, color: data.hr_review.outcome === 'RETURNED' ? TK.critical : TK.inkSoft }}>
                {data.hr_review.outcome === 'ACCEPTED' ? 'Accepted' : data.hr_review.outcome === 'RETURNED' ? 'Sent back to the candidate' : 'Returned, and the candidate has resubmitted since'} · {data.hr_review.by_name || '—'} · {day(data.hr_review.at)}
              </div>
            )}
            {canDecide && <div style={{ marginTop: 14, fontSize: 12.5, color: TK.inkSoft }}>Read through the sheet. <b>Click any detail, table entry or document that is wrong</b> — it gets marked, and you write one remark at the foot of the page. If everything is right, accept the form.</div>}

            {/* ── Documents ── */}
            <section style={{ marginTop: 28 }}>
              <h3 className="rv-h">01 <span>Documents</span><span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: TK.muted, letterSpacing: 0, textTransform: 'none' }}>{docs.length} uploaded</span></h3>
              {docs.length === 0 && <div style={{ fontSize: 12, color: TK.muted, marginTop: 8 }}>No documents uploaded.</div>}
              <div className="rv-docs">{docs.map(doc => <DocCard key={doc.doc_code} doc={doc} on={!!marks[`doc:${doc.doc_code}`]} pick={canDecide} onPick={() => toggle({ key: `doc:${doc.doc_code}`, kind: 'doc', label: doc.label, doc_code: doc.doc_code })} />)}</div>
              {/* The official forms, filled from this sheet — opened in a new tab (the call needs the session header). */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <span className="rv-sub" style={{ marginBottom: 0 }}>Statutory forms, filled</span>
                {([['form11', 'EPF Form 11'], ['form2', 'EPF Form 2'], ['formf', 'Gratuity Form F'], ...(item.esic_applicable ? [['esic1', 'ESIC Form 1']] : [])] as [string, string][]).map(([k, l]) => (
                  <button key={k} type="button" className="rv-view" disabled={!!opening} onClick={() => openForm(k, l)} style={{ cursor: 'pointer', fontFamily: 'inherit' }}>{opening === k ? 'Opening…' : `${l} ↗`}</button>
                ))}
              </div>
            </section>

            {/* ── Details, section by section ── */}
            {SCHEMA.map((sec, i) => item.form_data?.[sec.step] ? <SectionView key={sec.step} n={i + 2} sec={sec} obj={item.form_data[sec.step]} marks={marks} pick={canDecide} onToggle={toggle} /> : null)}

            {/* ── Foot: what is marked, the remark, the decision ── */}
            <div className="rv-bar">
              {canDecide ? (
                list.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <button disabled={busy} onClick={() => send('ACCEPTED')} className="rv-btn" style={{ background: TK.positive }}>{busy ? 'Saving…' : '✓ Accept form'}</button>
                    <span style={{ fontSize: 12, color: TK.muted }}>Nothing is marked. Click a detail or document above if something is wrong.</span>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: TK.critical, marginBottom: 8 }}>Marked for correction · {list.length}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                      {list.map(m => <span key={m.key} className="rv-chip">{m.kind === 'doc' ? '📄 ' : ''}{m.label}<button type="button" onClick={() => toggle(m)} aria-label={`Clear ${m.label}`} title="Clear">×</button></span>)}
                    </div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: TK.brandDeep, marginBottom: 5 }}>REMARK TO THE CANDIDATE</label>
                    <textarea value={remark} onChange={e => setRemark(e.target.value)} className="rv-ta" placeholder="What is wrong and what they should do — e.g. the PIN code of the permanent address does not match the Aadhaar; upload a clear scan of the PAN card." autoFocus />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
                      <button disabled={busy || !remark.trim()} onClick={() => send('RETURNED')} className="rv-btn" style={{ background: TK.brand }}>{busy ? 'Sending…' : `Send to candidate`}</button>
                      <span style={{ fontSize: 12, color: TK.muted }}>{item.full_name} is emailed these {list.length} item{list.length === 1 ? '' : 's'}{docMarks ? ` (${docMarks} document${docMarks === 1 ? '' : 's'} to upload again${detMarks ? `, ${detMarks} detail${detMarks === 1 ? '' : 's'} to correct` : ''})` : ''} with your remark and the form link, valid 48 hours.</span>
                    </div>
                  </>
                )
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 300px', fontSize: 12.5, color: TK.inkSoft }}>
                    {data.hr_review?.outcome === 'RETURNED' && list.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{list.map(m => <span key={m.key} className="rv-chip">{m.label}</span>)}</div>}
                    {data.hr_review?.outcome === 'RETURNED' && remark && <div><b>Remark sent:</b> {remark}</div>}
                    {readOnly && !data.hr_review && 'Read-only.'}
                    {!readOnly && !canDecide && !data.hr_review && (item.status === 'EMPLOYEE_CREATED' ? 'The employee code is already generated.' : item.status === 'IN_PROGRESS' ? 'The candidate has not submitted the form yet.' : 'Already approved by the HR Manager.')}
                  </div>
                  <button onClick={onClose} className="rv-ghost">Close</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
