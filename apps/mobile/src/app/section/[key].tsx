// /section/<key> — a multi-tab section's list of screens (Profile, HR Services).
import { useLocalSearchParams } from 'expo-router'
import { Screen } from '@/ui/Screen'
import { sectionOf } from '@/core/nav'
import { SectionHub } from '@/features/shell/SectionHub'

export default function SectionRoute() {
  const { key } = useLocalSearchParams<{ key: string }>()
  const s = sectionOf(String(key))
  return (
    <Screen title={s?.label || ''} subtitle={s?.desc}>
      <SectionHub section={String(key)} />
    </Screen>
  )
}
