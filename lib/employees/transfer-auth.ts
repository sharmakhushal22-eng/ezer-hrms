// lib/employees/transfer-auth.ts — who may generate a transfer letter and email it. SERVER ONLY.
//
// A location transfer is started from the Transfer screen, an inter-company one from the
// employee's HR action panel (Employees), so edit access to either module is enough.
import type { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'

/** null when allowed; otherwise the 401 / 403 response to return. */
export async function requireTransferEditor(req: NextRequest): Promise<NextResponse | null> {
  const transfer = await requireModule(req, 'Transfer', 'EDIT')
  if (!transfer.error) return null
  const employees = await requireModule(req, 'Employees', 'EDIT')
  return employees.error ? transfer.error : null
}
