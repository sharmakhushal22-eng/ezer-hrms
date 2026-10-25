// TEMPORARY test harness for the mind games — delete before finishing.
import * as React from 'react'
import { ScrollView } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Screen } from '@/ui/Screen'
import { FzScrollCtx } from '@/features/funzone/kit'
import { MindGame } from '@/features/funzone/mind'

export default function MindTest() {
  const { g } = useLocalSearchParams<{ g?: string }>()
  const [on, setOn] = React.useState(true)
  const ctx = React.useMemo(() => ({ setScrollEnabled: setOn }), [])
  return (
    <Screen title="Mind test" scroll={false} padded={false}>
      <FzScrollCtx.Provider value={ctx}>
        <ScrollView scrollEnabled={on} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <MindGame code={g || 'tiles'} onBack={() => {}} />
        </ScrollView>
      </FzScrollCtx.Provider>
    </Screen>
  )
}
