// Payroll tab — the section's nine screens (website: Payroll's pill row).
import { useMenu } from '@/core/menu'
import { TabScreen } from '@/features/shell/TabScreen'
import { SectionHub } from '@/features/shell/SectionHub'
import { sectionOf } from '@/core/nav'

export default function PayrollTab() {
  const s = sectionOf('payroll')!
  const { refetch } = useMenu()
  return (
    <TabScreen heading={s.label} desc={s.desc} onRefresh={refetch}>
      <SectionHub section="payroll" />
    </TabScreen>
  )
}
