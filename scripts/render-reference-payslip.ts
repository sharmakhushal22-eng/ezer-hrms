// scripts/render-reference-payslip.ts — draw the Rahul Nair reference payslip from
// the fixture so the layout can be eyeballed against the approved PDF before any
// database is wired to it (EZER-PAYSLIP-ANSWERS.md, "split step 4").
//
//   node --experimental-strip-types scripts/render-reference-payslip.ts [out.pdf]
import { writeFileSync } from 'node:fs'
import { assemblePayslip } from '../lib/payroll/payslip.ts'
import { renderPayslipPdf } from '../lib/payroll/payslip-pdf.ts'
import { RAHUL_NAIR } from '../lib/payroll/__tests__/fixtures/rahul-nair.ts'

const out = process.argv[2] || 'Reference-Payslip-RahulNair-EZER-render.pdf'
const data = assemblePayslip(RAHUL_NAIR)
if (data.issues.length) console.error('issues:', data.issues)
const bytes = await renderPayslipPdf(data)
writeFileSync(out, bytes)
console.log(`wrote ${out} (${bytes.length} bytes)`)
