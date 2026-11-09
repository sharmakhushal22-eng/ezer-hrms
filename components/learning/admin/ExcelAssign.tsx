'use client'
// components/learning/admin/ExcelAssign.tsx — assigning from a spreadsheet. The file is parsed
// here and checked by the server with commit:false, so every row is reported first. A file
// with any error cannot be committed: a half-right sheet never half-applies.
import { useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, C, F, Notice, S, TableWrap, Td, Th } from '@/lib/ui'
import { ActionNotes, FilePick, Hint, NeedCompany, Panel, day, downloadSheets, plural, readSheet, row, safeCell, stack, useAction, type Ctx } from './shared'

const pickRow = (r: Record<string, string>) => ({ emp_code: r.emp_code, course_code: r.course_code, due_date: r.due_date, mandatory: r.mandatory })

function Summary({ rows }: { rows: any[] }) {
  return (
    <TableWrap stagger={false} minWidth={520} style={{ boxShadow: 'none' }}>
      <thead><tr><Th>Course</Th><Th>Code</Th><Th>Due</Th><Th>Mandatory</Th><Th align="right">People</Th></tr></thead>
      <tbody>
        {rows.map((s, i) => <tr key={i}><Td strong>{s.course}</Td><Td mono>{s.code}</Td><Td>{s.due_date ? day(s.due_date) : 'No due date'}</Td><Td>{s.mandatory ? 'Yes' : 'No'}</Td><Td align="right">{s.employees}</Td></tr>)}
      </tbody>
    </TableWrap>
  )
}

export default function ExcelAssign({ ctx, onDone, onCancel }: { ctx: Ctx; onDone: (note: string) => void; onCancel: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null)
  const [check, setCheck] = useState<any>(null)
  const [fileName, setFileName] = useState('')
  const a = useAction()
  if (!ctx.company) return <><NeedCompany doing="import assignments" /><Button onClick={onCancel}>Back</Button></>
  const company = ctx.company

  const template = async () => {
    const r = await a.run(() => lmsApi(`/api/lms/admin/courses?company=${company}`))
    const published = (r?.courses || []).filter((c: any) => c.status === 'PUBLISHED')
    await downloadSheets('learning-assignments-template.xlsx', [
      { name: 'Assign', rows: [['emp_code', 'course_code', 'due_date', 'mandatory']] },
      { name: 'Course codes', rows: [['course_code', 'title'], ...published.map((c: any) => [c.code, safeCell(c.title)])] },
    ])
  }
  const read = async (file: File) => {
    setRows(null); setCheck(null); setFileName(file.name)
    const r = await a.run(async () => {
      const parsed = (await readSheet(file)).map(pickRow)
      if (!parsed.length) throw new Error('The file has no rows.')
      if (!('emp_code' in parsed[0]) || parsed.every(p => p.emp_code === undefined)) throw new Error('The first row must be the headings: emp_code, course_code, due_date, mandatory.')
      const res = await lmsApi('/api/lms/admin/assignments', { mode: 'import', rows: parsed, commit: false, company_id: company })
      return { parsed, res }
    })
    if (r) { setRows(r.parsed); setCheck(r.res) }
  }
  const commit = async () => {
    const r = await a.run(() => lmsApi('/api/lms/admin/assignments', { mode: 'import', rows, commit: true, company_id: company }))
    if (r?.committed) onDone(r.enrolled ? `Imported. ${plural(r.enrolled, 'person', 'people')} enrolled.` : 'Imported. Nobody new was enrolled: everyone on the sheet already had these courses.')
    else if (r) setCheck(r)
  }
  const clean = !!check && !check.error_count
  return (
    <Panel title="Import from Excel" hint="One row for each person and course." actions={<Button size="sm" variant="ghost" onClick={onCancel}>Back</Button>}>
      <div style={stack()}>
        <ActionNotes a={a} />
        <div style={row()}>
          <Button size="sm" disabled={a.busy} onClick={template}>Download template</Button>
          <FilePick accept=".xlsx,.xls,.csv" label="Upload file" disabled={a.busy} onFile={read} />
          {fileName && <span style={{ fontSize: F.tiny, color: C.muted }}>{fileName}</span>}
        </div>
        <Hint>Columns: emp_code, course_code, due_date (YYYY-MM-DD, or blank), mandatory (yes or no, blank means yes). The template has a second sheet listing the course codes. Nothing is applied until you confirm.</Hint>
        {check?.error_count > 0 && (
          <Notice title={`${plural(check.error_count, 'problem')} to fix. Nothing has been applied.`}>
            <TableWrap stagger={false} style={{ boxShadow: 'none', maxHeight: 260, overflowY: 'auto' }}>
              <thead><tr><Th width={70}>Row</Th><Th>What is wrong</Th></tr></thead>
              <tbody>{check.errors.map((e: any, i: number) => <tr key={i}><Td mono>{e.row}</Td><Td>{e.error}</Td></tr>)}</tbody>
            </TableWrap>
            {check.error_count > check.errors.length && <Hint style={{ marginTop: S.xs }}>Showing the first {check.errors.length}.</Hint>}
          </Notice>
        )}
        {check?.summary?.length > 0 && <Summary rows={check.summary} />}
        {clean && <div><Button variant="primary" disabled={a.busy} onClick={commit}>Assign these</Button></div>}
      </div>
    </Panel>
  )
}
