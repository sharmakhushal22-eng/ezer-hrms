// lib/pms/postFinal.ts — who runs the appraisal once the rating is settled.
//
// WHY THIS IS A MODULE AND NOT AN `if` IN TWO SCREENS
//
// The question "may this person write the appreciation remark" is asked by
// the HOD's department surface, by HR's admin surface, and by the tab lists
// that decide whether either of those screens appears at all. Answered
// separately in each, the three drift — and the failure mode is not a blank
// tab, it is two people both believing the recognition is theirs to award,
// or neither doing it because each thinks the other will.
//
// WHAT IT IS FOR
//
// Requested: once the HOD finalises, publishing the result, awarding
// recognition and writing the feedback the employee reads all move to HR.
// The HOD's part ends at the rating.
//
// THAT DIVERGES FROM THE DOCX, which is why pms_policies.post_final_owner
// exists rather than this being hardcoded. Stage 6: "The designated finaliser
// conducts a comprehensive wrap-up 1-on-1 ... The finaliser submits: (a) Final
// Rating, (b) Appreciation Remark, (c) Improvement Feedback ... and
// (d) Recognition Awards." The spec gives all four to the finaliser; the
// instruction moves (b), (c) and (d) to HR. Both are defensible, so it is
// configuration — see migration 202's header.

import type { Role } from './hierarchy.ts'

export const POST_FINAL_OWNERS = ['HR', 'FINALISER'] as const
export type PostFinalOwner = typeof POST_FINAL_OWNERS[number]

export const POST_FINAL_OWNER_LABEL: Record<PostFinalOwner, string> = {
  HR:        'HR writes the feedback, awards recognition and publishes',
  FINALISER: 'Whoever finalised does all of it (docx Stage 6)',
}

/**
 * HR Manager, HR Head and Admin.
 *
 * ALL THREE, not HR Head alone. §2's matrix gives HR_MGR and HR_HEAD
 * identical rights on every action except configure_policy — give_feedback
 * and upload_benefit are ✅ for both — so an HR_HEAD-only rule would mean
 * inventing a distinction the matrix does not make and editing the roles
 * module to enforce it. ADMIN is included for the reason 188 exempts it from
 * the finalise identity checks: it is the escalation path when something is
 * stuck.
 */
const HR_ROLES: Role[] = ['HR_MGR', 'HR_HEAD', 'ADMIN']

/** The line roles that can hold a finaliser's seat. */
const LINE_ROLES: Role[] = ['RM_L1', 'RM_L2', 'HOD']

export function isHrRole(role: Role): boolean {
  return HR_ROLES.includes(role)
}

/**
 * May this role write the appreciation remark, the improvement feedback and
 * the recognition awards?
 *
 * Under FINALISER, HR is ALSO allowed — §2 gives HR give_feedback and
 * upload_benefit regardless, and HR correcting a remark on a stuck record is
 * the same escalation path everything else grants them. Under HR, the line
 * roles are not: that is the whole point of the setting.
 */
export function mayWritePostFinal(owner: PostFinalOwner, role: Role): boolean {
  if (isHrRole(role)) return true
  return owner === 'FINALISER' && LINE_ROLES.includes(role)
}

/**
 * May this role release the result to the employee?
 *
 * Same answer as writing, deliberately: splitting them would let somebody
 * compose feedback they cannot send, or send feedback they cannot read. The
 * DATABASE still has the last word — 200's trg_pms_publish_needs_signoff
 * refuses any publish before the final-review one-to-one is acknowledged by
 * both parties, whoever presses the button.
 */
export function mayPublish(owner: PostFinalOwner, role: Role): boolean {
  return mayWritePostFinal(owner, role)
}

/**
 * What to tell somebody who is looking at a surface they cannot act on.
 *
 * A sentence, not a boolean, because "you cannot do this" on its own leaves a
 * HOD wondering whether it is broken or whether it moved. It moved, and this
 * says where.
 */
export function postFinalNote(owner: PostFinalOwner, role: Role): string | null {
  if (mayWritePostFinal(owner, role)) return null
  if (owner === 'HR' && LINE_ROLES.includes(role)) {
    return 'Once you have settled the rating, HR writes the feedback, awards '
         + 'any recognition and publishes the result. You can see what went '
         + 'out on Published Results.'
  }
  return 'This is not yours to write under the current policy.'
}

/**
 * Does the HOD surface still need its Feedback & Recognition tab?
 *
 * Hidden rather than shown-disabled when HR owns the step. A tab that exists
 * only to say "not yours" is clutter, and the HOD already has Published
 * Results, which shows the same feedback read-only once it is out.
 */
export function showFinaliserFeedbackTab(owner: PostFinalOwner): boolean {
  return owner === 'FINALISER'
}

// ── who the viewer actually is, from the roles module ────────────────────

/**
 * THE PMS ROLE OF WHOEVER IS LOOKING, read from the roles they hold.
 *
 * Requested: "it will be good if there is the option to give permissions of
 * pms and finalization, result publish from roles and access."
 *
 * The first half of that was already possible and simply not used. The admin
 * dashboard computed its PMS role as:
 *
 *     const myHrRole = grant.isSuperAdmin ? 'ADMIN' : 'HR_MGR'
 *
 * — so EVERYBODY who reached the page was HR Manager, and mayWritePostFinal
 * therefore said yes to all of them. Combined with the Publish Results tab
 * borrowing the seeded 'pms.upload' key, which L1_MANAGER, L2_MANAGER and
 * HOD all hold in role_screen_access, a line manager could open HR's publish
 * workspace, write the feedback an employee reads and release the result.
 *
 * Nothing here changes the roles module. It reads role_code off the grant
 * that module already produces and answers in the PMS's own vocabulary.
 *
 * UNKNOWN ROLES ARE NOT HR. The fallback used to be HR_MGR — the most
 * privileged answer available — for anyone the code could not place. It is
 * EMPLOYEE now: a role nobody mapped should get the least authority, not the
 * most, and the PMS's gates are all written as "is this role allowed",
 * never "is this role forbidden".
 */
const RMS_TO_PMS: Record<string, Role> = {
  // HR, who own the post-finalisation controls under the default policy.
  HR_HEAD: 'HR_HEAD',
  HR_MANAGER: 'HR_MGR',
  HR_MGR: 'HR_MGR',
  CHRO: 'HR_HEAD',
  // The escalation path, as 188 exempts it from the finalise identity checks.
  ADMIN: 'ADMIN',
  ADMIN_SUPER: 'ADMIN',
  SUPER_ADMIN: 'ADMIN',
  // The line. Named so a FINALISER-owned policy can hand these controls back
  // to them, which is the whole point of that setting.
  HOD: 'HOD',
  L1_MANAGER: 'RM_L1',
  L2_MANAGER: 'RM_L2',
}

/**
 * The strongest PMS role among those held.
 *
 * Strongest, because roles are additive: somebody holding both HR_MANAGER
 * and L1_MANAGER is an HR Manager who also has reportees, and taking the
 * first match in an arbitrary array order would make their authority depend
 * on how the grant happened to be sorted.
 */
const RANK: Role[] = ['EMPLOYEE', 'RM_L1', 'RM_L2', 'HOD', 'HR_MGR', 'HR_HEAD', 'ADMIN']

export function pmsRoleOf(
  roles: { role_code?: string | null }[] | null | undefined,
  isSuperAdmin = false,
): Role {
  // A super admin is ADMIN whatever else they hold: the roles module already
  // treats them as seeing everything, and disagreeing with it here would
  // produce a screen that renders and then refuses.
  if (isSuperAdmin) return 'ADMIN'
  let best: Role = 'EMPLOYEE'
  for (const r of roles ?? []) {
    const mapped = RMS_TO_PMS[String(r?.role_code ?? '').toUpperCase()]
    if (mapped && RANK.indexOf(mapped) > RANK.indexOf(best)) best = mapped
  }
  return best
}
