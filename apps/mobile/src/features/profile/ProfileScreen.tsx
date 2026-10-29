// src/features/profile/ProfileScreen.tsx — Profile → My Details
// (components/profile/Profile360.tsx, the live screen).
//
// One payload from GET /api/ess/profile (plus `self`: what the editors prefill
// and who a request reaches, by name). Layout as on the website's narrow
// view: identity header, then the side column (completeness, reporting chain,
// open requests), then the tabs. Edit profile, Change history, Documents and
// "How editing works" open as sheets; Digital ID opens its own page.
//
// Every Fix opens the editor for THAT item (lib/profile/self-service
// fixActionFor), not Spouse name for all of them as before. After any save
// the payload, the request lists and the portal's avatar are refreshed.
import * as React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { TABS } from '@web/profile/model'
import { FIX_TAB, fixActionFor } from '@web/profile/self-service'
import type { ProfileField, TabId } from '@web/profile/types'
import { invalidate } from '@/core/query'
import { sectionOf } from '@/core/nav'
import { useTheme } from '@/ui/ThemeProvider'
import { Screen } from '@/ui/Screen'
import { Sheet, useOverlay } from '@/ui/overlays'
import { F, S } from '@/ui/theme'
import { Card, Loading, Notice, Segmented, Txt } from '@/ui/primitives'
import { useProfile } from './api'
import { val } from './format'
import { ProfileSubTabs } from './bits'
import { ChainCard, CompletenessCard, HowEditingBody, IdentityCard } from './Identity'
import { TabPanel } from './TabPanels'
import { ChangeRequests, RequestsSummary, useChangeRequests } from './ChangeRequests'
import { EditHub } from './EditHub'
import { DocumentsPanel } from './Documents'
import { EmergencyEditor, FieldEditor, IdentityEditor } from './Editors'
import { AddressEditor, BankEditor, NomineeEditor } from './Editors2'
import { PhotoSheet } from './PhotoSheet'
import { fieldByKey, ID_HAS, type Editor } from './rules'

type DrawerId = 'edit' | 'request' | 'history' | 'docs' | 'how'

function HowBtn({ onPress }: { onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="How editing works" hitSlop={6}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.brandEdge, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.brandTint : C.surface })}>
      <Txt size={F.body} w={700} tone="brand">?</Txt>
    </Pressable>
  )
}

export default function ProfileScreen() {
  const s = sectionOf('profile')
  const q = useProfile()
  const { notify } = useOverlay()
  const [tab, setTab] = React.useState<TabId>('overview')
  const [editor, setEditor] = React.useState<Editor | null>(null)
  const [drawer, setDrawer] = React.useState<DrawerId | null>(null)
  const [photoOpen, setPhotoOpen] = React.useState(false)
  // Held locally so a fresh upload shows at once (Profile360 does the same).
  const [photoOverride, setPhotoOverride] = React.useState<string | null>(null)

  const p = q.data
  const self = p ? (p.isSelf ?? p.viewer_role === 'self') : false
  const photo = photoOverride ?? p?.photoUrl ?? null
  const req = useChangeRequests(self)

  /** Every save lands here: say so, reload what the page shows and the request lists. */
  const afterSave = React.useCallback((msg: string) => {
    setEditor(null)
    notify(msg, 'success')
    void invalidate('profile', 'employee')
  }, [notify])
  const closeEditor = React.useCallback(() => setEditor(null), [])
  const closeDrawer = React.useCallback(() => setDrawer(null), [])

  /** One switchboard for Fix, the Edit sheet and the field cards. */
  const openAction = (a: string) => {
    switch (a) {
      case 'photo': setPhotoOpen(true); return
      case 'aadhaar': case 'pan': case 'uan': setEditor({ kind: 'identity', which: a }); return
      case 'bank': setEditor({ kind: 'bank' }); return
      case 'present_address': setEditor({ kind: 'address', which: 'present' }); return
      case 'permanent_address': setEditor({ kind: 'address', which: 'permanent' }); return
      case 'emergency': setEditor({ kind: 'emergency', slot: p?.self?.emergency?.[1] ? 2 : 1 }); return
      case 'emergency1': setEditor({ kind: 'emergency', slot: 1 }); return
      case 'emergency2': setEditor({ kind: 'emergency', slot: 2 }); return
      case 'nominee_pf': setEditor({ kind: 'nominee', scheme: 'pf' }); return
      case 'nominee_gratuity': setEditor({ kind: 'nominee', scheme: 'gratuity' }); return
      case 'documents': setDrawer('docs'); return
      case 'blood_group': { const f = fieldByKey('blood_group'); if (f) setEditor({ kind: 'field', field: f }); return }
    }
  }
  const onFix = (sentence: string) => {
    const a = fixActionFor(sentence)
    // A sentence this screen does not know yet: land on the tab that holds it.
    if (!a) { setDrawer(null); setTab('personal'); return }
    if (a === 'documents') { setDrawer('docs'); return }
    setDrawer(null)
    openAction(a)
    if (a !== 'photo') setTab(FIX_TAB[a] as TabId)
  }
  const onField = (f: ProfileField) => {
    if (f.editor) { openAction(f.editor); return }
    setEditor({ kind: 'field', field: f })
  }

  let body: React.ReactNode
  if (q.error) body = <Card><Notice tone="critical">{q.error instanceof Error ? q.error.message : 'Could not reach the server.'}</Notice></Card>
  else if (!p) body = <Card><Loading /></Card>
  else {
    const pendingReqs = req.mine.filter(r => r.status.startsWith('pending')).length
    body = (
      <>
        <IdentityCard p={p} self={self} photo={photo} pendingReqs={pendingReqs}
          onEdit={() => setDrawer('edit')} onRequest={() => setDrawer('request')}
          onDigitalId={() => router.push('/profile/id-card')} onHistory={() => setDrawer('history')}
          onPhoto={() => setPhotoOpen(true)} />

        <View style={{ gap: S.md, marginTop: S.md }}>
          <CompletenessCard p={p} self={self} onFix={onFix} />
          <ChainCard p={p} self={self} />
          {self && <RequestsSummary req={req} onOpen={() => setDrawer('history')} />}
        </View>

        <View style={{ marginTop: S.xl, flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }}>
            <Segmented items={TABS.map(t => ({ key: t.id, label: t.label }))} value={tab} onChange={setTab} />
          </ScrollView>
          {self && <HowBtn onPress={() => setDrawer('how')} />}
        </View>

        <TabPanel tab={tab} p={p} self={self} onAct={onField} onAction={openAction} openTab={setTab}
          onDocsChanged={m => { notify(m, 'success'); void invalidate('profile') }} />
      </>
    )
  }

  const emp = p?.employee
  return (
    <Screen title={s?.label || 'Profile'} subtitle={s?.desc} sub={<ProfileSubTabs current="profile" />}
      onRefresh={() => invalidate('profile')}>
      {body}

      {p && self && (drawer === 'edit' || drawer === 'request') && (
        <Sheet visible onClose={closeDrawer} title="Edit profile" full>
          <Txt size={F.small} tone="muted" style={{ marginBottom: S.md }}>Pick what to change. Each item says whether it saves at once or goes for approval.</Txt>
          <EditHub payload={p} focus={drawer} onFix={onFix}
            onField={f => { setDrawer(null); onField(f) }}
            onAction={a => { if (a !== 'documents') setDrawer(null); openAction(a) }} />
        </Sheet>
      )}
      {self && drawer === 'history' && (
        <Sheet visible onClose={closeDrawer} title="Change history" full>
          <Txt size={F.small} tone="muted" style={{ marginBottom: S.md }}>Everything you have asked to change, and who has it now.</Txt>
          <ChangeRequests req={req} />
        </Sheet>
      )}
      {self && drawer === 'docs' && (
        <Sheet visible onClose={closeDrawer} title="Documents" full>
          <Txt size={F.small} tone="muted" style={{ marginBottom: S.md }}>Uploads save straight away. HR verifies each one.</Txt>
          <DocumentsPanel onChanged={m => { notify(m, 'success'); void invalidate('profile') }} />
        </Sheet>
      )}
      {drawer === 'how' && (
        <Sheet visible onClose={closeDrawer} title="How editing works"><HowEditingBody /></Sheet>
      )}

      {p && emp && editor?.kind === 'field' && (
        <FieldEditor field={editor.field} current={emp[editor.field.key]} approvers={p.self?.approvers} onClose={closeEditor} onDone={afterSave} />
      )}
      {p && emp && editor?.kind === 'identity' && (
        <IdentityEditor which={editor.which} onFile={!!p.self?.ids?.[ID_HAS[editor.which]]}
          masked={editor.which === 'pan' ? p.self?.ids?.pan_masked
            : editor.which === 'aadhaar' && emp.aadhar_last4 ? `•••• •••• ${String(emp.aadhar_last4)}` : val(emp.uan)}
          onClose={closeEditor} onDone={afterSave} />
      )}
      {p && emp && editor?.kind === 'address' && (
        <AddressEditor which={editor.which} self={p.self}
          onFile={!!p.self?.addresses?.[editor.which] || !!emp[`${editor.which}_address`]} onClose={closeEditor} onDone={afterSave} />
      )}
      {p && editor?.kind === 'emergency' && <EmergencyEditor slot={editor.slot} self={p.self} onClose={closeEditor} onDone={afterSave} />}
      {p && editor?.kind === 'nominee' && (
        <NomineeEditor scheme={editor.scheme} nominations={p.nominations} family={p.family} onClose={closeEditor} onDone={afterSave} />
      )}
      {p && emp && editor?.kind === 'bank' && (
        <BankEditor self={p.self} current={{ bank_name: emp.bank_name, ifsc: emp.ifsc }} onClose={closeEditor} onDone={afterSave} />
      )}

      {self && (
        <PhotoSheet open={photoOpen} onClose={() => setPhotoOpen(false)}
          onDone={url => { setPhotoOverride(url); afterSave('Profile photo updated.') }} />
      )}
    </Screen>
  )
}
