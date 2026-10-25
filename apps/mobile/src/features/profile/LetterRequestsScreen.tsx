// src/features/profile/LetterRequestsScreen.tsx — Profile → Letter Requests
// (EmployeePortal.tsx Documents).
//
// Same as the website: the list and the insert go straight to
// ess_letter_requests (lib/supabase-ess.ts), purpose is optional, Custom
// Request has no details field (custom_details is sent as ''), and the toasts
// read "Letter request sent to HR." / "Failed: <message>". rejection_reason is
// not shown, as on the website.
import * as React from 'react'
import { View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Card, ErrorState, Input, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet, useOverlay } from '@/ui/overlays'
import { Screen } from '@/ui/Screen'
import { sectionOf } from '@/core/nav'
import { createLetterRequest, LETTER_TYPES, useLetterRequests } from './api'
import { fmt } from './format'
import { ProfileSubTabs } from './bits'
import { StatusPill } from './StatusPill'

export default function LetterRequestsScreen() {
  const { C } = useTheme()
  const s = sectionOf('profile')
  const employeeId = useEmployeeId()
  const { notify } = useOverlay()
  const q = useLetterRequests()
  const [type, setType] = React.useState(LETTER_TYPES[0])
  const [pick, setPick] = React.useState(false)
  const [purpose, setPurpose] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const rows = q.data ?? []

  async function submit() {
    setBusy(true)
    try {
      await createLetterRequest(employeeId, type, purpose, '')
    } catch (e) {
      setBusy(false)
      notify('Failed: ' + (e instanceof Error ? e.message : String(e)), 'error')
      return
    }
    setBusy(false)
    setPurpose('')
    notify('Letter request sent to HR.')
    void invalidate('profile')
  }

  return (
    <Screen title={s?.label || 'Profile'} subtitle={s?.desc} sub={<ProfileSubTabs current="documents" />} onRefresh={() => q.refetch()}>
      <Card>
        <Txt size={F.micro} w={700} tone="brand" upper style={{ marginBottom: S.md }}>Request a Letter (HR generates on approval)</Txt>
        <PickerField label="Letter type" value={type} onPress={() => setPick(true)} />
        <Input label="Purpose" value={purpose} onChangeText={setPurpose} placeholder="e.g. bank loan, visa…" />
        <Button title={busy ? 'Sending…' : 'Request letter'} onPress={submit} disabled={busy} full />
      </Card>

      <Card style={{ marginTop: S.md }}>
        <Txt size={F.micro} w={700} tone="brand" upper style={{ marginBottom: S.sm }}>My Letter Requests</Txt>
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : rows.length === 0 ? <Txt size={F.tiny} tone="faint">No requests yet.</Txt>
          : rows.map((r, i) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.brandEdge }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={F.small} w={600}>{r.letter_type}</Txt>
                <Txt size={F.micro} tone="faint">{r.purpose || '-'} · {fmt(r.requested_at)}</Txt>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <StatusPill status={r.status} />
                {!!r.letter_url && <Button title="Download" variant="outline" size="sm" onPress={() => void WebBrowser.openBrowserAsync(r.letter_url!)} />}
              </View>
            </View>
          ))}
      </Card>

      <SelectSheet visible={pick} onClose={() => setPick(false)} title="Letter type"
        options={LETTER_TYPES.map(l => ({ value: l, label: l }))} value={type} onPick={setType} searchable={false} />
    </Screen>
  )
}
