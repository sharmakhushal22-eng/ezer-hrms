// src/features/profile/StatusPill.tsx — EmployeePortal.tsx StatusPill: the raw
// status text on its tint, 10px, 2×9 padding, pill radius, weight 600.
import * as React from 'react'
import { View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { R } from '@/ui/theme'
import { Txt } from '@/ui/primitives'

export function StatusPill({ status }: { status: string }) {
  const { C } = useTheme()
  const map: Record<string, [string, string]> = {
    PENDING: [C.warningTint, C.warning], IN_REVIEW: [C.infoTint, C.info], APPROVED: [C.positiveTint, C.positive],
    REJECTED: [C.criticalTint, C.critical], COMPLETED: [C.positiveTint, C.positive], REQUESTED: [C.warningTint, C.warning],
    GENERATED: [C.positiveTint, C.positive],
  }
  const [bg, c] = map[status] || [C.brandTint, C.brandDeep]
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 2, borderRadius: R.pill, backgroundColor: bg }}>
      <Txt size={10} w={600} color={c}>{status}</Txt>
    </View>
  )
}
