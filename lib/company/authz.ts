// lib/company/authz.ts — who may edit the company master.
//
// ── WHY THIS EXISTS SERVER-SIDE ─────────────────────────────────────────────
// The company profile has been written from the browser through the anon
// Supabase client (lib/supabase-company-profile.ts calls supabase.from(...)
// .update directly). That means the write is authorised by the anon key, which
// every visitor has — so hiding an Edit button would have changed exactly
// nothing. Anyone who could open the app could already PATCH `companies`.
//
// Putting the rule in the client is not putting the rule anywhere. This module
// is the rule; app/api/company/profile enforces it before touching a row.
//
// ── WHO ─────────────────────────────────────────────────────────────────────
// The brief: the admin, the owner, EZER customer support, or an authorised
// EZER person. Mapped onto the roles that actually exist in ess_roles:
//
//   ADMIN_SUPER / SUPER_ADMIN   the EZER side — full access by definition
//   IMPL_MANAGER                EZER implementation / customer support
//   ADMIN_COMPANY               the customer's own admin — REMOVED, see below
//
// HR_HEAD and CHRO are deliberately NOT here. They run HR; the company master
// carries the PAN, the bank account and the statutory registrations, and the
// blast radius of a wrong edit there is a failed payroll run or a compliance
// breach rather than a bad leave balance.

import type { Grant } from '@/lib/rms/resolve'

/** Roles that may edit the company master. */
export const COMPANY_EDIT_ROLES = [
  'ADMIN_SUPER', 'SUPER_ADMIN',   // EZER platform owner — the master admin
  'IMPL_MANAGER',                 // EZER implementation / customer support
] as const

// ADMIN_COMPANY WAS HERE AND HAS BEEN REMOVED, on instruction: nobody from
// the customer's own organisation may change their company profile — they
// ask EZER. That is a real reduction in what the customer can do, and it is
// deliberate: the profile carries the PAN, the statutory registrations and
// now the certificates themselves, and the brief is that only EZER touches
// them.
//
// A company admin keeps every other admin power they had; this list governs
// the company master alone. They can still READ the whole profile — the
// restriction is on writing, not on seeing.

export interface EditRight {
  canEdit: boolean
  /** Why, in words — shown to the user and written to the audit trail, so a
   *  refusal is explainable rather than a silent disabled button. */
  reason: string
  /** The label recorded as `changed_by`. A named person where we have one. */
  actor: string
}

export function companyEditRight(g: Grant | null | undefined): EditRight {
  if (!g) return { canEdit: false, reason: 'Not signed in.', actor: 'unknown' }

  const actor = g.name || g.empCode || (g.legacy ? 'Dashboard login' : 'Unknown')

  if (g.isSuperAdmin) {
    return { canEdit: true, reason: 'Super admin', actor }
  }

  // The legacy shared dashboard login holds FULL on every module. It predates
  // named accounts, and locking it out here would lock out the people running
  // the system today — but it is flagged in the grant, so the audit row can
  // say the edit came from a shared login rather than from a person.
  if (g.legacy) {
    return { canEdit: true, reason: 'Dashboard login (shared, legacy)', actor }
  }

  const held = g.roles?.map(r => r.role_code).filter(Boolean) ?? []
  const match = held.find((c: string) => (COMPANY_EDIT_ROLES as readonly string[]).includes(c))
  if (match) return { canEdit: true, reason: `Role: ${match}`, actor }

  return {
    canEdit: false,
    actor,
    reason: held.length
      ? `Your roles (${held.join(', ')}) do not include company administration.`
      : 'You hold no role that permits editing the company profile.',
  }
}

/** Tables this module is allowed to write, and the audit entity each maps to.
 *  An allow-list rather than a pass-through: the route takes a table name from
 *  the client, and without this that parameter would let a caller edit any
 *  table in the database through an endpoint they are already authorised for. */
export const EDITABLE: Record<string, { table: string; entity: string }> = {
  COMPANY:      { table: 'companies',             entity: 'COMPANY' },
  GROUP:        { table: 'groups',                entity: 'GROUP' },
  LOCATION:     { table: 'locations',             entity: 'LOCATION' },
  REGISTRATION: { table: 'registrations',         entity: 'REGISTRATION' },
  BANK:         { table: 'company_bank_accounts', entity: 'BANK' },
  CONTACT:      { table: 'company_contacts',      entity: 'CONTACT' },
  DIRECTOR:     { table: 'company_directors',     entity: 'DIRECTOR' },
  DOCUMENT:     { table: 'company_documents',     entity: 'DOCUMENT' },
}

/** Columns the route refuses to write on any table. Identity and audit columns
 *  are set by the database, and letting a form post them is how a row ends up
 *  reparented to another company. */
export const IMMUTABLE = new Set(['id', 'created_at', 'updated_at', 'company_id', 'group_id'])
