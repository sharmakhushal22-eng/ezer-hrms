// src/features/profile/rules.ts — what a field shows and what pressing it does,
// copied from components/profile/Profile360.tsx (shownValue, fieldMode,
// fixLabel, chainOf). That file is a React component, so it cannot be imported
// through @web; the pure rules it leans on (lib/profile/self-service.ts) are.
//
//   key MISSING from the payload  ->  "Restricted"  (not yours to see)
//   key present but null/empty    ->  "-"           (nobody filled it in)
import { MODEL } from '@web/profile/model'
import { maySee, type ProfileField, type ProfilePayload, type Row } from '@web/profile/types'
import { addressOneLine, FIX_MODE, type FixAction } from '@web/profile/self-service'
import { money, pretty } from './format'

export const NIL = '-'

export const ALL_FIELDS: ProfileField[] = Object.values(MODEL).flatMap(gs => (gs ?? []).flatMap(g => g.fields))
export const fieldByKey = (k: string) => ALL_FIELDS.find(f => f.key === k) ?? null

export const ID_HAS: Record<string, 'has_pan' | 'has_aadhaar' | 'has_uan'> = { pan: 'has_pan', aadhaar: 'has_aadhaar', uan: 'has_uan' }

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** The value as a person should read it. Your own profile carries the full
 *  address (the view flattens it) and a masked PAN (the RPC strips it below HR). */
export function shownValue(f: ProfileField, p: ProfilePayload): { text: string; restricted: boolean } {
  const emp = p.employee
  const present = has(emp, f.key)
  if (f.key === 'pan' && !present && p.self?.ids?.pan_masked) return { text: p.self.ids.pan_masked, restricted: false }
  if (!maySee(p.viewer_role, f.min) || !present) {
    if (f.key === 'pan' && p.self && !p.self.ids.has_pan) return { text: NIL, restricted: false }
    return { text: 'Restricted', restricted: true }
  }
  if ((f.key === 'present_address' || f.key === 'permanent_address') && p.self) {
    const a = p.self.addresses[f.key === 'present_address' ? 'present' : 'permanent']
    if (a) return { text: addressOneLine(a), restricted: false }
  }
  const raw = emp[f.key]
  return { text: /ctc|gross/.test(f.key) ? money(raw) : pretty(raw), restricted: false }
}

export interface Mode { kind: 'none' | 'edit' | 'add' | 'request'; label: string }

export function fieldMode(f: ProfileField, p: ProfilePayload, self: boolean): Mode {
  const none: Mode = { kind: 'none', label: '' }
  if (!self) return none
  const { text, restricted } = shownValue(f, p)
  const empty = text === NIL
  if (f.addable && f.editor) {
    const hasIt = p.self?.ids ? p.self.ids[ID_HAS[f.editor]] : !empty
    return hasIt ? none : { kind: 'add', label: 'Add' }
  }
  if (restricted || f.state === 'locked') return none
  if (f.editor === 'bank') return { kind: 'request', label: p.self?.ids?.has_bank ? 'Request change' : 'Add' }
  if (f.editor === 'present_address' || f.editor === 'permanent_address') {
    return empty ? { kind: 'add', label: 'Add' } : { kind: 'request', label: 'Request change' }
  }
  if (f.state === 'direct') return { kind: empty ? 'add' : 'edit', label: empty ? 'Add' : 'Edit' }
  return { kind: 'request', label: 'Request change' }
}

/** The Fix button's word: Upload for a photo or document, Request for the
 *  salary account (it goes to Payroll), Add for everything else. */
export const fixLabel = (a: FixAction | null) =>
  a === 'photo' || a === 'documents' ? 'Upload' : a && FIX_MODE[a] === 'payroll' ? 'Request' : 'Add'

/** One row per PERSON, not per role (the same person often holds two slots).
 *  Matched on employee code. */
export function chainOf(emp: Row) {
  const slots: [string, string][] = [['rm_l1', 'Reporting manager'], ['rm_l2', 'Second-level manager'],
    ['hod', 'Head of department'], ['md', 'Managing director']]
  const out: { key: string; name: string; roles: string[]; me: boolean }[] = []
  const meCode = String(emp.employee_code ?? '')
  for (const [k, role] of slots) {
    const name = emp[`${k}_name`]
    if (!name) continue
    const code = String(emp[`${k}_code`] ?? '')
    const key = code || String(name)
    const me = !!code && code === meCode
    const hit = out.find(x => x.key === key)
    if (hit) hit.roles.push(role)
    else out.push({ key, name: String(name), roles: [role], me })
  }
  return out
}

/** Editor states the screen can open (Profile360 `Editor`). */
export type Editor =
  | { kind: 'field'; field: ProfileField }
  | { kind: 'identity'; which: 'aadhaar' | 'pan' | 'uan' }
  | { kind: 'address'; which: 'present' | 'permanent' }
  | { kind: 'emergency'; slot: 1 | 2 }
  | { kind: 'nominee'; scheme: 'pf' | 'gratuity' }
  | { kind: 'bank' }
