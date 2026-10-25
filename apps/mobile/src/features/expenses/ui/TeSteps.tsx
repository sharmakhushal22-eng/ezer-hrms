// src/features/expenses/ui/TeSteps.tsx — "What › How › Details" (components/te/TeSteps.tsx).
//
// Three steps from flowSteps(kind, way). A past step shows a check and can be
// tapped (onTo); the current one is highlighted; future ones are disabled.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { flowSteps, type FlowKind, type WayId } from '@web/te/entry-flow'
import { useTheme } from '@/ui/ThemeProvider'
import { Txt } from '@/ui/primitives'
import { TeIcon } from './TeIcon'

export function TeSteps({ on, kind, way, onTo }: { on: 1 | 2 | 3; kind: FlowKind | null; way: WayId | null; onTo: (step: 1 | 2) => void }) {
  const { C } = useTheme()
  const steps = flowSteps(kind, way)
  return (
    <View accessibilityLabel="Progress" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {steps.map((s, i) => {
        const n = i + 1
        const past = n < on
        const cur = n === on
        return (
          <React.Fragment key={s.small}>
            {i > 0 && <View style={{ flex: 1, height: 2, minWidth: 8, backgroundColor: C.line, borderRadius: 2 }} />}
            <Pressable disabled={!past} onPress={past ? () => onTo(n as 1 | 2) : undefined}
              accessibilityRole="button" accessibilityState={{ disabled: !past, selected: cur }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 4, borderRadius: 10, backgroundColor: pressed ? C.sunken : 'transparent', flexShrink: 1, minHeight: 40 })}>
              <View style={{
                width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
                backgroundColor: cur ? C.brand : past ? C.positiveTint : C.sunken,
                borderWidth: cur || past ? 0 : 1, borderColor: C.line,
              }}>
                {past ? <TeIcon name="check" size="sm" color={C.positive} />
                  : <Txt size={12} w={700} color={cur ? C.onAccent : C.muted}>{n}</Txt>}
              </View>
              <View style={{ flexShrink: 1 }}>
                <Txt size={10} w={600} upper color={cur ? C.ink : past ? C.inkSoft : C.muted}>{s.small}</Txt>
                <Txt size={12} w={700} numberOfLines={1} color={cur ? C.ink : past ? C.inkSoft : C.muted} style={{ maxWidth: 96 }}>{s.label}</Txt>
              </View>
            </Pressable>
          </React.Fragment>
        )
      })}
    </View>
  )
}
