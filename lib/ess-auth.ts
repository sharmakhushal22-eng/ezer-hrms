// lib/ess-auth.ts — server-side helpers for ESS employee auth.
// Resolve a login identifier (email OR emp_code) to an employee, and hash/verify passwords.
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const EMP_CODE_RE = /^[A-Za-z]{2,6}-?\d{3,6}$/

export interface AuthEmployee {
  id: string; full_name: string; emp_code: string; employment_status: string | null
  personal_email: string | null; office_email: string | null
}

// Resolve by emp_code first (if it looks like one), else by personal/office email.
// Prefers an Active employee when multiple match.
export async function resolveEmployee(sb: SupabaseClient, identifier: string): Promise<AuthEmployee | null> {
  const id = String(identifier || '').trim()
  if (!id) return null
  const cols = 'id, full_name, emp_code, employment_status, personal_email, office_email'
  let rows: any[] = []

  if (EMP_CODE_RE.test(id)) {
    const { data } = await sb.from('employees').select(cols).ilike('emp_code', id)
    rows = data || []
  }
  if (!rows.length) {
    const em = id.toLowerCase()
    const { data } = await sb.from('employees').select(cols).or(`personal_email.ilike.${em},office_email.ilike.${em}`)
    rows = data || []
  }
  if (!rows.length) return null
  return rows.find((e: any) => (e.employment_status || '').toLowerCase() === 'active') || rows[0]
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  if (!hash || !salt) return false
  const computed = crypto.scryptSync(password, salt, 64).toString('hex')
  const a = Buffer.from(computed, 'hex')
  const b = Buffer.from(hash, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
