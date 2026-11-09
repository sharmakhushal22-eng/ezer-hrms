// lib/letters/record-save.ts — "Save the details I filled in to the employee record".
//
// A letter is filled from the employee record; what the record lacks, HR types in. When they
// tick the box on send, those typed values are written back to the employee — but only into a
// column that is still empty: a letter never overwrites what the record already holds.
//
// RECORD_FIELDS maps a letter field (People → Letters catalog keys and the appointment letter's
// keys share these names) to its employee column. Department and place are names in the letter
// and ids on the employee, so they are looked up in the company's masters; a name that matches
// none is not saved. Pure map + one server helper that takes the Supabase client.

export interface RecordField { label: string; column: string; kind?: 'date' | 'department' | 'location' }

export const RECORD_FIELDS: Record<string, RecordField> = {
  father_name: { label: "Father's / husband's name", column: 'father_name' },
  designation: { label: 'Designation', column: 'designation' },
  grade: { label: 'Grade / band', column: 'grade' },
  doj: { label: 'Date of joining', column: 'company_doj', kind: 'date' },
  reporting_manager: { label: 'Reporting manager', column: 'reporting_manager' },
  perm_address: { label: 'Permanent address', column: 'perm_address1' },
  uan: { label: 'UAN', column: 'uan_number' },
  pf_number: { label: 'PF number', column: 'pf_number' },
  department: { label: 'Department', column: 'department_id', kind: 'department' },
  place: { label: 'Place of posting', column: 'location_id', kind: 'location' },
  location: { label: 'Location', column: 'location_id', kind: 'location' },
}

/** A value, trimmed; a placeholder of dots or dashes ("........", "N/A") is no value. */
const v = (x: any) => { const t = x == null ? '' : String(x).trim(); return /^[.\-_\s]*$/.test(t) || /^n\/?a$/i.test(t) ? '' : t }

/** The fields HR filled in that the record did not have: what the checkbox would save. */
export function filledMissing(original: Record<string, any>, current: Record<string, any>): string[] {
  return Object.keys(RECORD_FIELDS).filter(k => k in current && !v(original[k]) && !!v(current[k]))
}

/** Write the filled-in values to the employee, column by column, never over a value already
 *  there. Returns the labels saved and the ones that could not be. */
export async function saveFilledToRecord(sb: any, employeeId: string, original: Record<string, any>, current: Record<string, any>): Promise<{ saved: string[]; skipped: string[] }> {
  const keys = filledMissing(original, current)
  if (!keys.length) return { saved: [], skipped: [] }
  const cols = [...new Set(keys.map(k => RECORD_FIELDS[k].column))]
  const { data: emp } = await sb.from('employees').select(['company_id', ...cols].join(', ')).eq('id', employeeId).maybeSingle()
  if (!emp) return { saved: [], skipped: keys.map(k => RECORD_FIELDS[k].label) }
  const patch: Record<string, any> = {}
  const saved: string[] = [], skipped: string[] = []
  for (const k of keys) {
    const f = RECORD_FIELDS[k], val = v(current[k])
    if (v(emp[f.column]) || f.column in patch) { skipped.push(`${f.label} (already on record)`); continue }
    if (f.kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) { skipped.push(`${f.label} (not a date)`); continue }
      patch[f.column] = val
    } else if (f.kind === 'department') {
      const { data } = await sb.from('departments').select('id, dept_name').eq('company_id', emp.company_id).ilike('dept_name', val).limit(1)
      if (!data?.[0]) { skipped.push(`${f.label} (“${val}” is not a department of the company)`); continue }
      patch[f.column] = data[0].id
    } else if (f.kind === 'location') {
      // "Jaipur Office, Jaipur" → the location named in it.
      const name = val.split(',')[0].trim()
      const { data } = await sb.from('locations').select('id').eq('company_id', emp.company_id).or(`location_name.ilike.${name.replace(/[,()]/g, ' ')},city.ilike.${name.replace(/[,()]/g, ' ')}`).limit(1)
      if (!data?.[0]) { skipped.push(`${f.label} (“${val}” is not a location of the company)`); continue }
      patch[f.column] = data[0].id
    } else patch[f.column] = val.slice(0, 400)
    saved.push(f.label)
  }
  if (Object.keys(patch).length) {
    const { error } = await sb.from('employees').update(patch).eq('id', employeeId)
    if (error) return { saved: [], skipped: [...skipped, ...saved.map(l => `${l} (${error.message})`)] }
  }
  return { saved, skipped }
}
