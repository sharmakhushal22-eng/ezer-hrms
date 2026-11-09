// src/features/performance/Pending.tsx — the shared empties (Performance.tsx
// NoPeriod / ModulePending), word for word.
import * as React from 'react'
import { Txt } from '@/ui/primitives'
import { F } from '@/ui/theme'
import { K, PCard } from './ui'

export function NoPeriod() {
  return (
    <PCard title="No period is open">
      <K>Nothing is running right now. A period opens when HR publishes the cycle configuration, and everybody eligible is enrolled at that moment. There is nothing to do here until then.</K>
    </PCard>
  )
}

export function ModulePending() {
  return (
    <PCard title="Waiting on migration 066">
      <K>
        The performance module’s tables do not exist in the database yet. These screens and the whole approval flow are built; they have nothing to read until{' '}
        <Txt size={F.micro} w={600} tone="muted">supabase/migrations/066_pms_module.sql</Txt> is applied. That file creates 15 tables, 9 functions, 10 views and 2 triggers.
        {'\n\n'}It is handed to Nayan rather than run from here. This project does not apply schema changes itself. Nothing on this page is broken; it is waiting.
      </K>
    </PCard>
  )
}
