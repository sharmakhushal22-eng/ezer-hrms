// The thumb bar: the website's MOBILE_PRIMARY (Home, Payroll, Attendance, Leave) + More.
import { Tabs } from 'expo-router'
import { TabBar } from '@/ui/TabBar'

export default function TabsLayout() {
  return (
    <Tabs tabBar={p => <TabBar {...p} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="payroll" />
      <Tabs.Screen name="attendance" />
      <Tabs.Screen name="leave" />
      <Tabs.Screen name="more" />
    </Tabs>
  )
}
