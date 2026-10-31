'use client'
// app/dashboard/employee-letters/page.tsx — People → Letters: pending appointment letters and the
// twenty HR letters (components/letters/LettersStudio). Guarded by the HR Letters module.
import LettersStudio from '@/components/letters/LettersStudio'

export default function EmployeeLettersPage() {
  return <LettersStudio />
}
