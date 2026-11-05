// lib/pms/authority.ts — what the HR Head may do, read from the policy.
//
// Requested: whether the HR Head can finalise, override the HOD's rating,
// and the rest, should be flexible and changeable from admin configuration.
//
// ── ONE PLACE, BECAUSE THERE WERE FOUR ───────────────────────────────────
//
// These answers were spread across three files and a route: canSettleFinal
// in hrFinal, canActDirect in hrDirect, isHrRole in postFinal reached from
// the admin API, and post_final_owner in mayWritePostFinal. Each was right
// on its own and none of them could be changed without a deploy.
//
// Gathering them is not tidying. A permission you cannot see in one place
// is a permission nobody can audit, and the question "what can the HR Head
// actually do here" had no single answer to give.
//
// ── THE DEFAULTS MATTER MORE THAN THE SWITCHES ───────────────────────────
//
// Every field defaults to TODAY'S BEHAVIOUR when the policy is missing,
// unreadable, or predates 217. A permissions layer that fails closed sounds
// safer and is not: it would stop a cycle the moment a policy row could not
// be read, and the people it stops are the ones with no way to fix it.
// Failing to the status quo is the honest default — nothing silently gains
// a power, and nothing silently loses one either.

import type { Role } from './hierarchy.ts'
import { isHrRole } from './postFinal.ts'

/** The policy fields this file reads. Everything optional: see the note. */
export interface AuthorityPolicy {
  /** 211. Whether a settlement is required before anything can publish. */
  hrHeadFinalRating?: boolean | null
  /** 217. Whether settling may replace the chain's number. */
  hrHeadCanOverride?: boolean | null
  /** 217. Whether an appraisal may be built outside the chain. */
  hrHeadCanDirect?: boolean | null
  /** 217. Who may commit a rating upload. */
  ratingUploadBy?: 'HR_HEAD' | 'HR_ANY' | 'NOBODY' | null
}

export interface Authority {
  /** May settle the final rating — and must, before anything publishes. */
  settle: boolean
  /** May replace the chain's number rather than only keep it. */
  override: boolean
  /** May build an appraisal for somebody the chain never started. */
  direct: boolean
  /** May commit a bulk or single rating upload. */
  upload: boolean
}

const on = (v: boolean | null | undefined) => v !== false

/**
 * What this role may do under this policy.
 *
 * The ROLE comes first and the policy only narrows it. A policy cannot hand
 * the HR Head's powers to somebody else — switching hr_head_can_direct on
 * does not let an RM build an appraisal outside the chain, because the
 * question that setting answers is "may the HR Head", not "who may".
 */
export function authorityOf(
  role: Role,
  policy: AuthorityPolicy | null | undefined,
): Authority {
  const p = policy ?? {}
  const head = role === 'HR_HEAD'

  // The upload is the one power that was never HR Head's alone: HR Manager
  // and Admin have always been able to commit one, and NOBODY closes it to
  // all three rather than narrowing it.
  const uploadMode = p.ratingUploadBy ?? 'HR_ANY'
  const upload = uploadMode === 'NOBODY' ? false
               : uploadMode === 'HR_HEAD' ? head
               : isHrRole(role)

  return {
    settle:   head && on(p.hrHeadFinalRating),
    override: head && on(p.hrHeadFinalRating) && on(p.hrHeadCanOverride),
    direct:   head && on(p.hrHeadCanDirect),
    upload,
  }
}

/**
 * Why a power is unavailable, for a screen that has to explain itself.
 *
 * Two different refusals wear the same disabled button otherwise: "you are
 * not the HR Head" and "the HR Head may not do this here" send somebody to
 * completely different places, and only one of them is worth asking an
 * administrator about.
 */
export function whyNot(
  power: keyof Authority,
  role: Role,
  policy: AuthorityPolicy | null | undefined,
): string | null {
  if (authorityOf(role, policy)[power]) return null
  const p = policy ?? {}

  if (power === 'upload') {
    const mode = p.ratingUploadBy ?? 'HR_ANY'
    if (mode === 'NOBODY') {
      return 'Rating uploads are switched off for this policy. The chain is '
           + 'the only way a rating is set here.'
    }
    if (mode === 'HR_HEAD') {
      return 'Only the HR Head may commit a rating upload under this policy.'
    }
    return 'A rating upload is HR’s to commit, and this account is not an '
         + 'HR Manager, HR Head or Admin.'
  }

  if (role !== 'HR_HEAD') return 'Only the HR Head can do this.'

  // Past here the person IS the HR Head, so the policy is what refused.
  switch (power) {
    case 'settle':
      return 'This policy does not require the HR Head to settle the final '
           + 'rating, so there is nothing to settle — the chain’s rating '
           + 'stands and the result can be published as it is.'
    case 'override':
      return on(p.hrHeadFinalRating)
        ? 'This policy lets you settle the rating but not change it. Keep the '
        + 'chain’s rating, or ask an administrator to allow overrides.'
        : 'This policy does not require the HR Head to settle the final rating.'
    case 'direct':
      return 'Building an appraisal outside the chain is switched off for '
           + 'this policy. An administrator can turn it on in Setup & '
           + 'Controls.'
  }
  return 'Not permitted under this policy.'
}

/** Read the policy row as PostgREST returns it. */
export function authorityFromRow(
  row: Record<string, unknown> | null | undefined,
): AuthorityPolicy {
  const r = row ?? {}
  const b = (v: unknown) => v === undefined ? undefined : v === true
  const mode = r.rating_upload_by
  return {
    hrHeadFinalRating: b(r.hr_head_final_rating),
    hrHeadCanOverride: b(r.hr_head_can_override),
    hrHeadCanDirect: b(r.hr_head_can_direct),
    ratingUploadBy: mode === 'HR_HEAD' || mode === 'NOBODY' || mode === 'HR_ANY'
      ? mode : null,
  }
}
