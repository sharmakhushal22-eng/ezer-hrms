// lib/recruitment/confidential.ts — client-safe.
//
// CONFIDENTIAL HIRING. An HR Head raises an MRF as confidential when the search itself must
// stay quiet (a replacement nobody knows about yet, a leadership hire). Everything about it is
// then limited to the company's HR Head and HR Manager(s), plus the super admin:
//
//   - the MRF is approved the moment it is raised — no RM2 / HR Head chain, no notification
//   - the requisition and its candidates are invisible to everyone else: not in lists, not
//     in counts, not in job status, not in the pipeline, not in ESS
//   - only the HR Head adds candidates to it; the HR Manager can see them
//   - one interview round, Telephonic, recorded by the HR Head / HR Manager themselves —
//     nobody is invited; a Shortlist decision moves the candidate straight to Negotiation
//   - the candidate's acceptance on the salary link creates an ALREADY-APPROVED offer
//     request (the HR Head would only be approving their own), so the offer letter is sent
//     from Send Offers with no Offer Approval step; the HR Head and HR Manager are told
//   - every notification and mail in the flow goes to the HR Head and HR Manager(s) of that
//     company only
//
// Visibility is enforced in the app, at the point data is loaded (the recruitment page's
// loadAll, the ESS company dashboard) — the database policies are allow_all, so this is
// the layer that keeps a confidential search confidential. Company scope is the existing
// company filter: an HR Head sees only their own company's confidential searches.

export const CONFIDENTIAL_VIEWER_CODES = ['HR_HEAD', 'HR_MANAGER']
export const CONFIDENTIAL_RAISER_CODES = ['HR_HEAD']

type GrantLike = { legacy?: boolean; isSuperAdmin?: boolean; roles?: { role_code: string }[] | null }

const holds = (g: GrantLike | null | undefined, codes: string[]) =>
  !!g && (g.roles || []).some(r => codes.includes(String(r.role_code || '').toUpperCase()))

/** May see confidential MRFs and their candidates (within their company scope). */
export const canSeeConfidential = (g: GrantLike | null | undefined): boolean =>
  !!g && (!!g.legacy || !!g.isSuperAdmin || holds(g, CONFIDENTIAL_VIEWER_CODES))

/** May raise a confidential MRF: the HR Head only (and the super admin). */
export const canRaiseConfidential = (g: GrantLike | null | undefined): boolean =>
  !!g && (!!g.isSuperAdmin || holds(g, CONFIDENTIAL_RAISER_CODES))

/** Same test from an ESS menu's role list (server routes). */
export const rolesCanSeeConfidential = (roles: string[] | null | undefined, isSuperAdmin = false) =>
  isSuperAdmin || (roles || []).some(r => CONFIDENTIAL_VIEWER_CODES.includes(String(r).toUpperCase()))
export const rolesCanRaiseConfidential = (roles: string[] | null | undefined, isSuperAdmin = false) =>
  isSuperAdmin || (roles || []).some(r => CONFIDENTIAL_RAISER_CODES.includes(String(r).toUpperCase()))

export const isConfidentialMrf = (m: any): boolean => !!m?.is_confidential

/**
 * Drop confidential MRFs and their candidates for a viewer who may not see them. Returns the
 * same arrays untouched for an HR Head / HR Manager / super admin.
 */
export function hideConfidential<M extends { id: string; is_confidential?: boolean | null }, C extends { mrf_id?: string | null }>(
  mrfs: M[], candidates: C[], g: GrantLike | null | undefined,
): { mrfs: M[]; candidates: C[]; hidden: number } {
  if (canSeeConfidential(g)) return { mrfs, candidates, hidden: 0 }
  const hidden = new Set(mrfs.filter(isConfidentialMrf).map(m => m.id))
  if (!hidden.size) return { mrfs, candidates, hidden: 0 }
  return {
    mrfs: mrfs.filter(m => !hidden.has(m.id)),
    candidates: candidates.filter(c => !c.mrf_id || !hidden.has(c.mrf_id)),
    hidden: hidden.size,
  }
}

/** The one interview round a confidential search runs. */
export const CONFIDENTIAL_ROUND = 'Telephonic'
export const CONFIDENTIAL_ROUNDS_BEFORE_SHORTLIST = 1

/** The approval-chain step written on a confidential MRF: the HR Head's own, already approved. */
export function selfApprovedChain(hrHead: { id: string; name: string | null; code: string | null }) {
  return [{
    order: 1, role: 'HR_HEAD', approver_id: hrHead.id, approver_name: hrHead.name, approver_code: hrHead.code,
    status: 'APPROVED', acted_at: new Date().toISOString(), comment: 'Confidential hiring — self-approved by the HR Head',
  }]
}
