// /expenses — Travel & Expenses, its own full-screen module (the website opens
// components/te/TeHome.tsx as the standalone page /ess/travel).
//
// Views are stack screens; the website's drawers ("sheets") are modal screens,
// so Android back closes a sheet and then walks back through the views.
// The route map and TeHome's callback contracts: src/features/expenses/nav.ts.
import { Stack } from 'expo-router'
import { useTheme } from '@/ui/ThemeProvider'

const SHEETS = ['new', 'kind', 'plan', 'start', 'add-leg', 'expense'] as const

export default function ExpensesLayout() {
  const { C } = useTheme()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.canvas }, animation: 'slide_from_right' }}>
      {SHEETS.map(name => (
        <Stack.Screen key={name} name={name} options={{ presentation: 'modal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: C.surface } }} />
      ))}
    </Stack>
  )
}
