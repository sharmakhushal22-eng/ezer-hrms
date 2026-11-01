// The app's shell: the top bar and the thumb bar stay on screen, and every section
// (the website's MOBILE_PRIMARY, Home, Payroll, Attendance, Leave, and those opened
// from More) swaps in between them with no page transition. Back steps through the
// sections you visited.
import * as React from 'react'
import { View } from 'react-native'
import { Tabs } from 'expo-router'
import { TabBar } from '@/ui/TabBar'
import { useTheme } from '@/ui/ThemeProvider'
import { TopBar } from '@/features/shell/TopBar'

const HIDDEN = ['profile', 'team', 'orgchart', 'inbox', 'hris', 'company', 'reports', 'performance', 'social', 'rnr', 'funzone']

export default function TabsLayout() {
  const { C } = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <TopBar />
      <Tabs tabBar={p => <TabBar {...p} />} backBehavior="history"
        screenOptions={{ headerShown: false, animation: 'none', sceneStyle: { backgroundColor: C.canvas } }}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="payroll" />
        <Tabs.Screen name="attendance" />
        <Tabs.Screen name="leave" />
        {HIDDEN.map(name => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
      </Tabs>
    </View>
  )
}
