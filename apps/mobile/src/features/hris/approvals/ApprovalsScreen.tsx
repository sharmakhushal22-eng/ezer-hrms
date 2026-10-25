// Tasks & Approvals — components/ess/hris/TasksApprovals.tsx.
//
// Top to bottom, each block fetching its own data, as on the website: MRF
// hiring requests, offer approvals (HR Head / HR Manager), interviews to conduct,
// onboarding sign-off (IT / Admin / Payroll), then the KPI strip and the core
// leave / cancellation / attendance-correction / travel / resignation queue.
//
// Gate: /api/ess/menu can.approvals, exactly as HrisShell. A login without it
// gets what the website gives a deep link to /ess/approvals: the HR Services
// frame and an empty main area (spec §0.2 QUIRK).
import * as React from 'react'
import { useEmployeeId } from '@/core/session'
import { useMenu } from '@/core/menu'
import { Loading } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { invalidate } from '@/core/query'
import { MrfBlock } from './MrfBlock'
import { OfferBlock } from './OfferBlock'
import { InterviewBlock } from './InterviewBlock'
import { OnboardingBlock } from './OnboardingBlock'
import { PendingQueue } from './PendingQueue'

export default function ApprovalsScreen() {
  const employeeId = useEmployeeId()
  const { menu, loaded, error } = useMenu()
  const canApprove = menu.can.approvals
  return (
    <Screen title="Tasks & Approvals" subtitle="HR Services" onRefresh={canApprove ? () => invalidate('approvals') : undefined}>
      {!loaded && !error ? <Loading /> : canApprove ? (
        <>
          <MrfBlock employeeId={employeeId} />
          <OfferBlock employeeId={employeeId} />
          <InterviewBlock employeeId={employeeId} />
          <OnboardingBlock employeeId={employeeId} />
          <PendingQueue employeeId={employeeId} />
        </>
      ) : null}
    </Screen>
  )
}
