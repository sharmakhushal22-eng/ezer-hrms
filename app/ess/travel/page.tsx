'use client'
// app/ess/travel/page.tsx — Travel and Expenses, full screen, on its own address.
//
// WHY ITS OWN PAGE. The module is about 135 screens: a trip planner, live GPS leg
// recording, claims, approvals. Inside the ESS portal it was a tab in a tab — the
// portal's rail, the Payroll header and the pill row all stayed on screen, leaving
// it a panel inside someone else's chrome. It needs the whole viewport and its own
// navigation, so ESS -> Payroll -> Travel & Expenses now comes here instead of
// rendering it inline (components/ess/EmployeePortal.tsx, the `href` on its nav
// item). The admin half is unaffected and stays at /dashboard/expenses.
//
// WHO IS LOOKING is not read here. Every /api/te call carries the session token
// from lib/auth-headers.ts and the server resolves the employee from it, so this
// page only has to prove somebody is signed in before it mounts the module.
import { useEffect } from 'react'
import TeHome from '@/components/te/TeHome'

export default function EssTravelPage() {
  // Sending someone who is not signed in to the login page is the whole job here,
  // and it is a side effect, not state: the module renders either way. Were the
  // session gated behind a `ready` flag instead, this effect would have to call
  // setState in its own body — which cascades a second render and is the one lint
  // rule this module's screens are held to.
  //
  // Nothing is lost by not gating. Every /api/te call carries the session token
  // and the server resolves the employee from it, so an unauthenticated visitor
  // gets a 401 that TeHome words as "Sign in to continue." for the moment before
  // the browser leaves.
  useEffect(() => {
    let signedIn = false
    try {
      const raw = localStorage.getItem('ezer_ess_session')
      signedIn = !!(raw && JSON.parse(raw)?.employee_id)
    } catch { signedIn = false }
    if (!signedIn) window.location.href = '/ess-login'
  }, [])

  // Back to the Payroll section the module sits under, not to wherever the browser
  // came from: the person may have arrived from a notification link with no history.
  // 'payslip' is Payroll's first tab, which is where clicking Payroll itself lands.
  return <TeHome onExit={() => { window.location.href = '/ess-portal?tab=payslip' }} />
}
