'use client'
// app/dashboard/learning/page.tsx — People → Learning, the HR and L&D workspace for EZER Learn.
//
// Thin and self-contained on purpose: components/ess/AdminModules.tsx mounts this same default
// export inside the ESS shell, where no dashboard layout runs.
import LearningAdmin from '@/components/learning/admin/LearningAdmin'

export default function LearningPage() {
  return <LearningAdmin />
}
