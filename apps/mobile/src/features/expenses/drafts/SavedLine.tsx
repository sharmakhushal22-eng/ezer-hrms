// src/features/expenses/drafts/SavedLine.tsx — the "Saved just now" line beside a
// form's buttons (TePlanner / TeExpenseForm footer, div.savedline).
import * as React from 'react'
import { View } from 'react-native'
import { savedAgo } from '@web/te/autosave'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { TeIcon } from '../ui/TeIcon'
import type { DraftAutosave } from './useDraftAutosave'

/** Re-renders every 30 s so "Saved just now" ages without a keystroke. */
function useNow(ms = 30000) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function SavedLine({ autosave }: { autosave: Pick<DraftAutosave, 'state' | 'savedAt'> }) {
  const { C } = useTheme()
  const now = useNow()
  if (autosave.state === 'saving') return <Txt size={F.tiny} tone="muted">Saving…</Txt>
  if (autosave.state === 'saved' && autosave.savedAt) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <TeIcon name="check" size="sm" color={C.muted} />
        <Txt size={F.tiny} tone="muted">{savedAgo(autosave.savedAt, Math.max(now, autosave.savedAt))}</Txt>
      </View>
    )
  }
  if (autosave.state === 'error') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <TeIcon name="warn" size="sm" color={C.warning} />
        <Txt size={F.tiny} tone="warning">Not saved yet — we will keep trying.</Txt>
      </View>
    )
  }
  return null
}
