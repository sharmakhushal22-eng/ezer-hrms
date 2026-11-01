// lib/lms/caps.ts — what a person may do in the learning admin, as one object.
//
// Pure. The three modules are ordinary rows in role_permissions, so HR changes them in
// Roles → Module Access. Screens and routes both read this rather than comparing levels
// themselves, so a tab cannot offer what its API would refuse.
//
// atLeast() rather than hasLevel(): hasLevel waves everyone through while
// rms_config.enforce_module_access is off, which suits a sidebar during roll-out and is
// wrong for a route that can publish a course.
import { atLeast, type AccessLevel, type Module } from '../rms/modules.ts'
import type { Grant } from '../rms/resolve.ts'

export const LMS_CONTENT: Module = 'Learning Content'
export const LMS_ASSIGNMENT: Module = 'Learning Assignment'
export const LMS_REPORTS: Module = 'Learning Reports'
export const LMS_MODULES: Module[] = [LMS_CONTENT, LMS_ASSIGNMENT, LMS_REPORTS]

export interface LmsCaps {
  /** See every course, drafts included. */
  viewContent: boolean
  /** Create and edit courses, upload files, build quizzes, submit for review. */
  editContent: boolean
  /** Review, publish, archive, manage categories and LMS settings. */
  publish: boolean
  /** See assignments and who is enrolled. */
  viewAssignments: boolean
  /** Assign to people and groups, invite candidates, manage enrolments. */
  assign: boolean
  /** Organisation-wide assignment, automation rules, onboarding templates. */
  automate: boolean
  /** Dashboards, reports and exports. */
  reports: boolean
}

export type LmsCap = keyof LmsCaps

export function lmsCaps(g: Pick<Grant, 'modules' | 'isSuperAdmin' | 'legacy'>): LmsCaps {
  const at = (m: Module, need: AccessLevel) => g.isSuperAdmin || g.legacy || atLeast(g.modules?.[m], need)
  return {
    viewContent: at(LMS_CONTENT, 'VIEW'),
    editContent: at(LMS_CONTENT, 'EDIT'),
    publish: at(LMS_CONTENT, 'FULL'),
    viewAssignments: at(LMS_ASSIGNMENT, 'VIEW'),
    assign: at(LMS_ASSIGNMENT, 'EDIT'),
    automate: at(LMS_ASSIGNMENT, 'FULL'),
    reports: at(LMS_REPORTS, 'VIEW'),
  }
}

export const hasAnyLmsCap = (c: LmsCaps) => Object.values(c).some(Boolean)

/** The module whose company scope a capability is judged by. */
export function moduleOfCap(cap: LmsCap): Module {
  if (cap === 'viewContent' || cap === 'editContent' || cap === 'publish') return LMS_CONTENT
  if (cap === 'reports') return LMS_REPORTS
  return LMS_ASSIGNMENT
}
