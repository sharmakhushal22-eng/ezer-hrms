// ================================================================
// EZER HRMS — Full database export → single Excel workbook.
// Path: app/api/db-export/route.ts
//
// Enumerates every table/view from PostgREST's OpenAPI spec, fetches
// ALL rows from each (paginated, service-role so RLS never hides
// anything), and returns one .xlsx with a sheet per table — headers =
// column names, values as-is (JSON/array columns stringified).
// Best run on localhost (npm run dev) for large databases — a hosted
// serverless response has a size cap.
// ================================================================
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PAGE = 1000

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
  const usingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  const supa = createClient(url, key, { auth: { persistSession: false } })

  try {
    // 1. Enumerate every public base table + its columns via the export_schema() function (sql62).
    const { data: schemaRows, error: schemaErr } = await supa.rpc('export_schema')
    if (schemaErr) return NextResponse.json({ error: 'Schema lookup failed — run sql62-db-export-schema.txt first. (' + schemaErr.message + ')' }, { status: 500 })
    const colsByTable = new Map<string, string[]>()
    for (const r of (schemaRows || []) as any[]) {
      const arr = colsByTable.get(r.table_name) || []
      arr.push(r.column_name)
      colsByTable.set(r.table_name, arr)
    }
    const tables = Array.from(colsByTable.keys()).sort()
    if (!tables.length) return NextResponse.json({ error: 'No tables found — run sql62 first.' }, { status: 500 })

    const wb = XLSX.utils.book_new()
    const used = new Set<string>()
    const summary: any[] = [['Table', 'Rows', 'Columns']]

    const safeSheet = (name: string) => {
      let n = name.replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'sheet'
      let base = n, i = 1
      while (used.has(n.toLowerCase())) n = base.slice(0, 28) + '_' + i++
      used.add(n.toLowerCase())
      return n
    }

    for (const table of tables) {
      // All columns from the schema (so headings are complete even for empty tables).
      const specCols = colsByTable.get(table) || []
      // Fetch all rows, paginated.
      const rows: any[] = []
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await supa.from(table).select('*').range(off, off + PAGE - 1)
        if (error) break
        rows.push(...(data || []))
        if (!data || data.length < PAGE) break
      }
      // Header = spec columns, unioned with any keys actually present in rows.
      const header = Array.from(rows.reduce((s: Set<string>, r) => { Object.keys(r).forEach(k => s.add(k)); return s }, new Set<string>(specCols)))
      const aoa = [header, ...rows.map(r => header.map(h => {
        const v = r[h]
        if (v === null || v === undefined) return ''
        if (typeof v === 'object') return JSON.stringify(v)   // jsonb / arrays → text
        return v
      }))]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      XLSX.utils.book_append_sheet(wb, ws, safeSheet(table))
      summary.push([table, rows.length, header.length])
    }

    // Index sheet first for easy navigation.
    const idx = XLSX.utils.aoa_to_sheet([['EZER HRMS — full export', new Date().toISOString()], [usingServiceRole ? 'service-role (all rows)' : 'anon key (RLS-limited)'], [], ...summary])
    XLSX.utils.book_append_sheet(wb, idx, '_INDEX')
    // move _INDEX to front
    wb.SheetNames.unshift(wb.SheetNames.pop() as string)

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return new NextResponse(buf as any, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="EZER_HRMS_full_export_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Export failed' }, { status: 500 })
  }
}
