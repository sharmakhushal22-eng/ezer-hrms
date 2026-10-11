'use client'
// app/dashboard/expenses/page.tsx — Travel and Expenses in the dashboard.
// (The address is the one migration 149 registers for the module in
// finance_modules: /dashboard/expenses.)
//
// The page is only a mount. The component imports its own stylesheet, so it
// also works when this page is hosted inside ESS (components/ess/AdminModules.tsx),
// where a route layout would not run.
import TeStaffHome from '@/components/te/TeStaffHome'

export default function TravelExpensesPage() {
  return <TeStaffHome />
}
