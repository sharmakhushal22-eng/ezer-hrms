'use client'
// Everything under /dashboard/payroll sits behind a second password check — the run
// cycle, the flexi approval screen, and anything added later. Putting it in the layout
// rather than the page is what makes that true without anyone having to remember.
import PayrollGate from '@/components/payroll/PayrollGate'

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  return <PayrollGate>{children}</PayrollGate>
}
