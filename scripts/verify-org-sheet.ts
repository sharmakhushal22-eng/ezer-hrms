// scripts/verify-org-sheet.ts — read an org-chart workbook the way the importer does and
// print what it would write, without touching the database.
//
//   node --experimental-strip-types scripts/verify-org-sheet.ts <file.xlsx>
//
// Useful before an import: the numbers printed here are exactly what the uploader will
// send, so a surprise shows up now rather than after 800 rows have been written.
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { parseOrgSheet, summarise, relationshipRows } from '../lib/rms/excel.ts'

const path = process.argv[2]
if (!path) { console.error('usage: verify-org-sheet.ts <file.xlsx>'); process.exit(1) }

const wb = XLSX.read(readFileSync(path), { type: 'buffer' })
const ws = wb.Sheets[wb.SheetNames[0]]
const grid = XLSX.utils.sheet_to_json<any>(ws, { header: 1, raw: false, defval: '' })

const parsed = parseOrgSheet(grid as unknown[][])

console.log('sheet   :', wb.SheetNames[0], `(of ${wb.SheetNames.length}: ${wb.SheetNames.join(', ')})`)
console.log('\nblocks detected:')
for (const g of parsed.groups) {
  console.log('   col %s  %s  ->  %s', String(g.startCol).padStart(2), g.label.padEnd(24), g.level ?? g.roleCode ?? g.kind)
}

const s = summarise(parsed)
console.log('\nwould write:')
console.log('   employees seen   :', s.employees)
console.log('   relationships    :', s.relationships, JSON.stringify(s.byLevel))
console.log('   role holders     :', JSON.stringify(s.roles))

const bySev: Record<string, number> = {}
for (const i of parsed.issues) bySev[i.severity] = (bySev[i.severity] || 0) + 1
console.log('\nissues:', JSON.stringify(bySev))
for (const i of parsed.issues.slice(0, 10)) {
  console.log('   [%s] %s — %s', i.severity, i.code, i.message.slice(0, 120))
}

console.log('\nsample relationships:')
for (const r of relationshipRows(parsed).slice(0, 5)) {
  console.log('   ' + r.emp_code.padEnd(10) + r.relationship_type.padEnd(6) + r.manager_code)
}
