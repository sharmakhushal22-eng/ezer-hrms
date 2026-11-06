// src/features/expenses/leg/LegHead.tsx — the header card every journey screen opens with
// (TeLegLive / TeLegReport / TeLegMissed): eyebrow, "From → To", a muted line, chips.
import * as React from 'react'
import { View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { TeCard } from '../ui/kit'

export function LegHead({ eyebrow, title, sub, chips, live }: {
  eyebrow: string; title: string; sub?: string; chips?: React.ReactNode; live?: boolean
}) {
  const { C } = useTheme()
  return (
    <TeCard style={live ? { borderColor: C.positive } : undefined}>
      <Txt size={F.micro} w={700} tone="muted" upper>{eyebrow}</Txt>
      <Txt size={F.page} w={700} style={{ marginTop: 2 }}>{title}</Txt>
      {sub ? <Txt size={F.small} tone="muted" style={{ marginTop: 2 }}>{sub}</Txt> : null}
      {chips ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>{chips}</View> : null}
    </TeCard>
  )
}
