// What the candidate filled in, section by section — the read-only half of
// components/onboarding/ReviewDrawer.tsx (SCHEMA, blocksFor, SectionView, DocCard),
// copied because it lives in a DOM file. Nothing here is pickable: the heads'
// approval form shows the sheet without the HR Manager's "mark as wrong".
import * as React from 'react'
import { Pressable, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R } from '@/ui/theme'
import { Txt } from '@/ui/primitives'

type FieldDef = [string, string]
type Block =
  | { kind: 'fields'; title?: string; fields: FieldDef[] }
  | { kind: 'table'; key: string; title: string; cols: FieldDef[]; fallback?: FieldDef[]; hides?: RegExp }
  | { kind: 'nested'; key: string; title: string; fields: FieldDef[] }
export type Section = { step: string; title: string; blocks: Block[] }
export type Doc = { doc_code: string; label: string; file_name: string | null; mime_type: string | null; url: string | null; hr_verified: boolean | null; note: string | null; ai_status: string | null; uploaded_at: string | null }

export const TEAM: Record<string, string> = { IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', HR_MANAGER: 'HR Manager' }
const HIDE = new Set(['bank_confirm', 'docs_uploaded', 'same_address'])
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

const pretty = (k: string) => k.replace(/^(fe|emrg|prev|grat|nominee|eps|perm|curr)_/, m => ({ fe_: 'Foreign ', emrg_: 'Emergency ', prev_: 'Previous ', grat_: 'Gratuity ', nominee_: 'Nominee ', eps_: 'EPS ', perm_: 'Permanent ', curr_: 'Current ' } as Record<string, string>)[m] || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
export const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const empty = (v: any) => v == null || v === '' || v === false
const show = (v: any): string => v === true ? 'Yes' : v === false ? 'No' : v == null || v === '' ? '' : typeof v === 'object' ? '' : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? day(String(v)) : String(v)
const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v)

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
  const flat = rest.filter(k => !isObj(obj[k]) && !Array.isArray(obj[k]) && !empty(obj[k]))
  const groups: Record<string, FieldDef[]> = {}
  for (const k of flat) (groups[/^(foreign|fe)_/.test(k) ? 'Foreign national' : 'Other'] ||= []).push([k, pretty(k.replace(/^foreign_/, ''))])
  for (const [t, f] of Object.entries(groups)) out.push({ kind: 'fields', title: t, fields: f })
  for (const k of rest.filter(k => isObj(obj[k]))) out.push({ kind: 'nested', key: k, title: pretty(k), fields: Object.keys(obj[k]).map(f => [f, pretty(f)] as FieldDef) })
  for (const k of rest.filter(k => Array.isArray(obj[k]) && obj[k].length)) out.push({ kind: 'table', key: k, title: pretty(k), cols: Object.keys(obj[k][0] || {}).map(f => [f, pretty(f)] as FieldDef) })
  return out
}

export function SheetHeading({ n, title, right }: { n: number; title: string; right?: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.lineStrong, marginTop: 24 }}>
      <Txt size={11} w={700} tone="brand">{String(n).padStart(2, '0')}</Txt>
      <Txt size={14} w={700} style={{ flex: 1 }}>{title}</Txt>
      {!!right && <Txt size={11} w={600} tone="muted">{right}</Txt>}
    </View>
  )
}
function Sub({ children }: { children: React.ReactNode }) {
  return <Txt size={10.5} w={700} tone="muted" upper style={{ marginTop: 16, marginBottom: 6 }}>{children}</Txt>
}
function Cell({ label, value }: { label: string; value: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, paddingVertical: 6 }}>
      <Txt size={10} w={600} tone="muted" upper>{label}</Txt>
      <Txt size={F.small} w={500} color={value ? C.ink : C.faint} selectable>{value || '—'}</Txt>
    </View>
  )
}

export function SectionView({ n, sec, obj }: { n: number; sec: Section; obj: Record<string, any> }) {
  const { C } = useTheme()
  const blocks = blocksFor(sec, obj)
  return (
    <View>
      <SheetHeading n={n} title={sec.title} />
      {blocks.map((b, bi) => {
        if (b.kind === 'fields') {
          const fields = b.fields.filter(([k]) => k in obj)
          if (!fields.some(([k]) => !empty(obj[k]))) return null
          return (
            <View key={bi} style={{ marginTop: b.title ? 0 : 10 }}>
              {!!b.title && <Sub>{b.title}{b.title === 'Current address' && obj.same_address ? <Txt size={10.5} tone="muted"> · same as permanent</Txt> : null}</Sub>}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14 }}>{fields.map(([k, l]) => <Cell key={k} label={l} value={show(obj[k])} />)}</View>
            </View>
          )
        }
        if (b.kind === 'nested') {
          const o = isObj(obj[b.key]) ? obj[b.key] : null
          if (!o || !b.fields.some(([k]) => !empty(o[k]))) return null
          return (
            <View key={bi}>
              <Sub>{b.title}</Sub>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14 }}>{b.fields.filter(([k]) => !empty(o[k])).map(([k, l]) => <Cell key={k} label={l} value={show(o[k])} />)}</View>
            </View>
          )
        }
        const rows = (obj[b.key] as any[]).filter(r => r && Object.values(r).some(v => !empty(v)))
        const used = b.cols.filter(([k]) => rows.some(r => !empty(r?.[k])))
        return (
          <View key={bi}>
            <Sub>{b.title}</Sub>
            {rows.map((r, i) => (
              <View key={i} style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.sm, padding: 10, marginBottom: 6, flexDirection: 'row', flexWrap: 'wrap', columnGap: 14 }}>
                {used.map(([k, l]) => <Cell key={k} label={l} value={show(r?.[k])} />)}
              </View>
            ))}
          </View>
        )
      })}
    </View>
  )
}

export function DocCard({ doc, onOpen }: { doc: Doc; onOpen?: (d: Doc) => void }) {
  const { C } = useTheme()
  const img = /^image\//.test(doc.mime_type || '') || /\.(png|jpe?g|webp)$/i.test(doc.file_name || '')
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderColor: C.line, borderRadius: 9, backgroundColor: C.surface, marginTop: 8 }}>
      <View style={{ width: 38, height: 44, borderRadius: 5, backgroundColor: C.sunken, alignItems: 'center', justifyContent: 'center' }}>
        <Txt size={10} w={800} color={C.brandDeep}>{img ? 'IMG' : 'PDF'}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={12.5} w={600}>{doc.label}</Txt>
        <Txt size={11} tone="muted" numberOfLines={2}>
          {doc.file_name || 'no file'}{doc.uploaded_at ? ` · ${day(doc.uploaded_at)}` : ''}
          {doc.ai_status === 'VERIFIED' ? <Txt size={11} w={600} tone="positive"> · AI verified</Txt> : null}
          {doc.hr_verified === true ? <Txt size={11} w={600} tone="positive"> · accepted</Txt> : null}
        </Txt>
      </View>
      {!!doc.url && (
        <Pressable onPress={() => (onOpen ? onOpen(doc) : void WebBrowser.openBrowserAsync(doc.url!))} accessibilityRole="link"
          style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: C.brandEdge, backgroundColor: pressed ? C.brandTint : C.surface })}>
          <Txt size={11.5} w={600} tone="brand">Open ↗</Txt>
        </Pressable>
      )}
    </View>
  )
}

