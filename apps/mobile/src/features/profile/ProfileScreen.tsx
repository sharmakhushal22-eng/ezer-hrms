// src/features/profile/ProfileScreen.tsx — Profile → My Details
// (components/profile/Profile360.tsx, the live screen).
//
// One payload from GET /api/ess/profile; masking is the server's
// (get_employee_profile strips keys) and the client's maySee() on top. The
// screen refetches after every edit, request, withdrawal and photo change —
// and, unlike the website, the change-request list refreshes after a new
// request too (spec §2.6: on the web it only appears after a remount).
import * as React from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { MODEL, TABS } from '@web/profile/model'
import type { ProfileField, TabId } from '@web/profile/types'
import { invalidate } from '@/core/query'
import { Screen } from '@/ui/Screen'
import { useOverlay } from '@/ui/overlays'
import { F, S } from '@/ui/theme'
import { Card, Loading, Notice, Segmented, Txt } from '@/ui/primitives'
import { sectionOf } from '@/core/nav'
import { useProfile } from './api'
import { val } from './format'
import { ProfileSubTabs } from './bits'
import { ChainCard, CompletenessCard, IdentityCard, KpiStrip } from './Identity'
import { IdCard, IdCardDownload, StaticIdCard } from './IdCard'
import { TabPanel } from './TabPanels'
import { ChangeRequests } from './ChangeRequests'
import { ChangeSheet } from './ChangeSheet'
import { PhotoSheet } from './PhotoSheet'

/** Profile360 firstRequestable(): the first `request` field in MODEL order —
 *  always "Spouse name". "Request an update" and every "Fix" open it, as on the web. */
function firstRequestable(): ProfileField | null {
  for (const gs of Object.values(MODEL)) for (const g of gs ?? []) for (const f of g.fields) if (f.state === 'request') return f
  return null
}

function Legend() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: S.md, rowGap: 4, marginTop: S.sm }}>
      <Txt size={F.tiny} tone="muted"><Txt size={F.tiny} w={700} tone="positive">Direct</Txt>: change it yourself</Txt>
      <Txt size={F.tiny} tone="muted"><Txt size={F.tiny} w={700} tone="warning">Request</Txt>: goes for approval</Txt>
      <Txt size={F.tiny} tone="muted"><Txt size={F.tiny} w={700} tone="muted">Locked</Txt>: HR maintains it</Txt>
      <Txt size={F.tiny} tone="muted"><Txt size={F.tiny} w={700} tone="info">Event</Txt>: starts another workflow</Txt>
    </View>
  )
}

export default function ProfileScreen() {
  const s = sectionOf('profile')
  const q = useProfile()
  const { notify } = useOverlay()
  const [tab, setTab] = React.useState<TabId>('overview')
  const [editing, setEditing] = React.useState<ProfileField | null>(null)
  const [photoOpen, setPhotoOpen] = React.useState(false)
  // Held locally so a fresh upload shows at once (Profile360 does the same).
  const [photoOverride, setPhotoOverride] = React.useState<string | null>(null)

  const p = q.data
  const self = p ? (p.isSelf ?? p.viewer_role === 'self') : false
  const photo = photoOverride ?? p?.photoUrl ?? null

  const openRequestable = () => { const f = firstRequestable(); if (f) setEditing(f) }

  let body: React.ReactNode
  if (q.error) body = <Card><Notice tone="critical">{q.error instanceof Error ? q.error.message : 'Could not reach the server.'}</Notice></Card>
  else if (!p) body = <Card><Loading /></Card>
  else {
    const emp = p.employee
    body = (
      <>
        <IdentityCard p={p} self={self} photo={photo}
          onRecords={() => setTab('records')}
          // The website's "Digital ID" only switches to the Statutory tab and never
          // reaches the card; on a phone it opens the card itself.
          onDigitalId={() => (self ? router.push('/profile/id-card') : setTab('statutory'))}
          onEdit={() => setTab('personal')} onRequest={openRequestable} onPhoto={() => setPhotoOpen(true)} />
        <KpiStrip p={p} />

        <View style={{ gap: S.md, marginTop: S.md }}>
          <CompletenessCard p={p} onFix={openRequestable} />
          <ChainCard p={p} self={self} />
          {self ? (
            <>
              <IdCard name={val(emp.full_name)} designation={val(emp.designation)} company={val(emp.company_name)} code={val(emp.employee_code)}
                doj={emp.date_of_joining as string | null} blood={emp.blood_group as string | null} emergency={emp.emergency_contact_1 as string | null} />
              <IdCardDownload />
            </>
          ) : <StaticIdCard name={val(emp.full_name)} designation={val(emp.designation)} company={val(emp.company_name)} />}
        </View>

        <View style={{ marginTop: S.xl }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <Segmented items={TABS.map(t => ({ key: t.id, label: t.label }))} value={tab} onChange={setTab} />
          </ScrollView>
          <Legend />
        </View>

        <TabPanel tab={tab} p={p} self={self} onAct={setEditing} />

        <ChangeRequests canSee={self} />
      </>
    )
  }

  return (
    <Screen title={s?.label || 'Profile'} subtitle={s?.desc} sub={<ProfileSubTabs current="profile" />}
      onRefresh={() => invalidate('profile')}>
      {body}
      <ChangeSheet field={editing} onClose={() => setEditing(null)}
        onDone={m => { setEditing(null); notify(m, 'success'); void invalidate('profile') }} />
      {self && (
        <PhotoSheet open={photoOpen} onClose={() => setPhotoOpen(false)}
          onDone={url => { setPhotoOverride(url); notify('Profile photo updated.', 'success'); void invalidate('profile', 'employee') }} />
      )}
    </Screen>
  )
}
