// src/features/shell/FeatureSearch.tsx — "Search a feature (Leave, Payslip, Approvals…)".
//
// The website's FeatureSearch (EmployeePortal.tsx): entries are every item of every
// visible, built section; the keywords and the scoring are copied verbatim, so the
// same query finds the same screen on both.
import * as React from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useMenu } from '@/core/menu'
import { SECTION_ICON, visibleSections } from '@/core/nav'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Txt, webNoOutline } from '@/ui/primitives'
import { IconClose, IconSearch } from '@/ui/icons'

const ESS_KEYWORDS: Record<string, string> = {
  home: 'dashboard today landing', profile: 'my details personal info bank address', documents: 'letter request certificate',
  letters: 'my letters offer letter appointment', 'to-sign': 'esign e-sign sign signature documents pending', team: 'reportees manager my team', orgchart: 'org chart hierarchy reporting tree',
  flexi: 'flexi benefits tax', declaration: 'investment declaration 80c tax', proofs: 'investment proofs tax',
  flexiclaims: 'flexi claims bills reimbursement', vpf: 'voluntary pf provident fund', nps: 'corporate nps pension', loans: 'loan advance',
  claims: 'travel claims expense reimbursement', attendance: 'attendance punch regularise regularize', leave: 'leave apply holiday time off',
  inbox: 'messages notifications mail', directory: 'team directory people colleagues employees', requests: 'raise request helpdesk ticket',
  approvals: 'tasks approvals pending approve leave travel resignation offers interviews', exit: 'resign resignation exit separation',
  company: 'company headcount attrition', reports: 'reports export', performance: 'pms performance goals kra appraisal review',
  social: 'social wall fame appreciate', funzone: 'games fun zone',
}

interface Entry { id: string; label: string; crumb: string; icon: string; keywords: string; route: string }

/** The website's scoreEntry. */
function score(e: Entry, q: string) {
  const hay = `${e.label} ${e.crumb} ${e.keywords}`.toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  if (!words.every(w => hay.includes(w))) return 0
  const label = e.label.toLowerCase()
  if (label === q) return 100
  if (label.startsWith(q)) return 80
  if (label.split(/[\s&/-]+/).some(w => w.startsWith(words[0]))) return 60
  if (label.includes(q)) return 45
  if (e.keywords.split(/\s+/).some(w => w.startsWith(words[0]))) return 30
  return 15
}

export function FeatureSearch() {
  const { C } = useTheme()
  const { menu } = useMenu()
  const [q, setQ] = React.useState('')
  const entries = React.useMemo<Entry[]>(() => visibleSections(menu).filter(s => s.status !== 'soon').flatMap(s =>
    s.items.filter(i => !i.needs).map(i => ({
      id: i.k, label: i.label, crumb: s.items.length > 1 ? `${s.label} › ${i.label}` : 'My portal', icon: s.k,
      keywords: `${s.label.toLowerCase()} ${ESS_KEYWORDS[i.k] || ''}`, route: i.route,
    }))), [menu])
  const qq = q.trim().toLowerCase()
  const hits = qq ? entries.map(e => ({ e, s: score(e, qq) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.e.label.localeCompare(b.e.label)).slice(0, 8) : []

  return (
    <View style={{ marginBottom: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: R.md, paddingHorizontal: S.md }}>
        <IconSearch size={16} color={C.faint} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search a feature (Leave, Payslip, Approvals…)" placeholderTextColor={C.faint}
          style={[{ flex: 1, height: 44, fontFamily: FONT[400], fontSize: F.small + 1, color: C.ink }, webNoOutline]} returnKeyType="search"
          onSubmitEditing={() => { if (hits[0]) { setQ(''); router.push(hits[0].e.route as any) } }} />
        {!!q && <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear"><IconClose size={16} color={C.faint} /></Pressable>}
      </View>
      {!!qq && (
        <View style={{ marginTop: 6, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: R.md, overflow: 'hidden' }}>
          {hits.length ? hits.map(({ e }) => {
            const I = SECTION_ICON[e.icon]
            return (
              <Pressable key={e.id} onPress={() => { setQ(''); router.push(e.route as any) }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md, backgroundColor: pressed ? C.brandTint : 'transparent', borderBottomWidth: 1, borderBottomColor: C.line })}>
                <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' }}>{I && <I size={16} color={C.chipInk} />}</View>
                <View style={{ flex: 1 }}>
                  <Txt size={F.small} w={600}>{e.label}</Txt>
                  <Txt size={F.tiny} tone="muted">{e.crumb}</Txt>
                </View>
              </Pressable>
            )
          }) : <Txt size={F.small} tone="muted" style={{ padding: S.md }}>No feature matches “{q.trim()}”, or it isn’t part of your access.</Txt>}
        </View>
      )}
    </View>
  )
}
