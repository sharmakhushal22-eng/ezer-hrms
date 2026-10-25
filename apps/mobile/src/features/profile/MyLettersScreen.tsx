// src/features/profile/MyLettersScreen.tsx — Profile → My Letters
// (EmployeePortal.tsx MyLetters).
//
// HR-issued letters published to ESS, read from the my_generated_letters view.
// Download signs the stored path in the private `generated-letters` bucket for
// five minutes at the moment of the tap and opens it; if signing fails nothing
// happens, as on the website.
import * as React from 'react'
import { View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Card, ErrorState, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { sectionOf } from '@/core/nav'
import { signLetter, useMyLetters } from './api'
import { ProfileSubTabs } from './bits'

export default function MyLettersScreen() {
  const { C } = useTheme()
  const s = sectionOf('profile')
  const q = useMyLetters()
  const rows = q.data ?? []
  const [busy, setBusy] = React.useState<string | null>(null)

  async function download(id: string, fileUrl: string) {
    setBusy(id)
    try {
      const url = await signLetter(fileUrl)
      if (url) await WebBrowser.openBrowserAsync(url)
    } finally { setBusy(null) }
  }

  return (
    <Screen title={s?.label || 'Profile'} subtitle={s?.desc} sub={<ProfileSubTabs current="letters" />} onRefresh={() => q.refetch()}>
      <Card>
        <Txt size={F.micro} w={700} tone="brand" upper style={{ marginBottom: S.sm }}>My Letters</Txt>
        {q.isLoading ? <Txt size={F.tiny} tone="faint">Loading…</Txt>
          : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : rows.length === 0 ? <Txt size={F.tiny} tone="faint">No letters have been shared with you yet. HR-issued letters (offer, confirmation, etc.) will appear here.</Txt>
          : rows.map((r, i) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.brandEdge }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={F.small} w={600}>{r.letter_name}</Txt>
                <Txt size={F.micro} tone="faint">{new Date(r.letter_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</Txt>
              </View>
              <Button title="⬇ Download" variant="outline" size="sm" loading={busy === r.id} disabled={!!busy} onPress={() => download(r.id, r.file_url)} />
            </View>
          ))}
      </Card>
    </Screen>
  )
}
