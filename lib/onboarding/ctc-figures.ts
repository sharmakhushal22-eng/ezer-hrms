// lib/onboarding/ctc-figures.ts — pure: the financial year and the ctc_master figures from a
// salary statement, for lib/onboarding/ctc-master.ts.
import type { StmtRow } from '@/lib/recruitment/ctc-statement'

/** The Indian financial year a date falls in: 2026-10-23 → "2026-27". */
export function fyOf(date: string | null | undefined): string {
  const d = /^\d{4}-\d{2}-\d{2}/.test(String(date || '')) ? new Date(`${String(date).slice(0, 10)}T00:00:00Z`) : new Date()
  const y = d.getUTCFullYear(), start = d.getUTCMonth() >= 3 ? y : y - 1
  return `${start}-${String(start + 1).slice(-2)}`
}

/** Annual CTC, variable, basic and HRA from a salary statement's lines. */
export function ctcFigures(rows: StmtRow[], ctc: number): { annual_ctc: number; annual_variable: number; basic_annual: number; hra_annual: number } {
  const annual = (re: RegExp, kinds: string[]) => {
    const r = rows.find(x => kinds.includes(x.kind) && re.test(x.label))
    return Math.round(Number(r?.annual ?? (Number(r?.monthly) || 0) * 12) || 0)
  }
  const total = rows.find(x => x.kind === 'total')
  return {
    annual_ctc: Math.round(ctc || Number(total?.annual) || 0),
    annual_variable: annual(/variable|performance/i, ['muted']),
    basic_annual: annual(/^basic/i, ['row']),
    hra_annual: annual(/house rent|hra/i, ['row']),
  }
}
