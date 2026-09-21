// lib/ui/__tests__/theme-audit-baseline.ts — GENERATED, then hand-maintained.
//
// Hardcoded colours that cannot follow the theme, per file, as they stood when
// the ratchet went in. See theme-audit.ts for what counts and what does not.
//
// THIS LIST ONLY EVER GOES DOWN.
//
// The test fails if a file exceeds its number (a regression) AND if a file is
// below it (fix landed — lower the number here). A file not listed must be at
// zero, so new screens cannot add frozen colours at all.
//
// The remainder is NOT a to-do list. Much of it is deliberate and must stay:
//   * FlexiTdsCalculator ~15   a generated print document. Printed output is on
//                              white paper and has no --ez-* variables in scope.
//   * LeaveSection 7           white and pastel meter colours on the saturated
//                              hero fill, which is coloured in BOTH themes.
//   * EmployeePortal 6         two fixed brand gradients, a progress bar, a
//                              status tint and one on-dark ink. NOTE: "it is a
//                              gradient, so it is deliberate" was wrong once
//                              already. The attendance month band was built
//                              from C.ink/C.inkSoft — TEXT tokens — so in dark
//                              mode it inverted to near-white and became the
//                              brightest thing on the screen. It contained no
//                              hex, so this scanner never saw it.
//
// THIS TOOL FINDS FROZEN LITERALS, NOT WRONG TOKENS. A file at zero can still
// render badly in dark mode: a text token used as a surface, a hairline token
// used as ink, a tint used where a colour belongs. Those need eyes on a screen.
//   * PunchDial / Toast        SVG colours inside deliberately-coloured shapes.
// Before 'fixing' an entry, check it is actually frozen rather than intended.
export const THEME_AUDIT_BASELINE: Record<string, number> = {
  'app/board/[pairCode]/page.tsx': 1,
  'app/dashboard/admin/page.tsx': 5,
  'app/dashboard/bulk-upload/page.tsx': 6,
  'app/dashboard/employees/page.tsx': 2,
  'app/dashboard/ess/page.tsx': 2,
  'app/dashboard/flexi-claims/page.tsx': 8,
  'app/dashboard/flexi-invoices/page.tsx': 17,
  'app/dashboard/holidays/page.tsx': 1,
  'app/dashboard/layout.tsx': 11,
  'app/dashboard/leave-upload/page.tsx': 2,
  'app/dashboard/onboarding/page.tsx': 7,
  'app/dashboard/org-chart/page.tsx': 14,
  'app/dashboard/page.tsx': 2,
  'app/dashboard/recruitment/offer-flow-components.tsx': 6,
  'app/dashboard/recruitment/page.tsx': 18,
  'app/dashboard/roles/page.tsx': 2,
  'app/ess-login/page.tsx': 1,
  'app/joining/[token]/client.tsx': 6,
  'app/onboarding/[token]/client.tsx': 8,
  'app/onboarding/[token]/page.tsx': 1,
  'app/page.tsx': 7,
  'app/salary-view/[token]/client.tsx': 4,
  'app/verify/[token]/page.tsx': 2,
  'components/company/GroupEditor.tsx': 3,
  'components/company/GroupHeader.tsx': 1,
  'components/company/Sections.tsx': 1,
  'components/employees/EmployeeProfileView.tsx': 7,
  'components/ess/EmployeePortal.tsx': 6,
  'components/ess/FlexiTdsCalculator.tsx': 21,
  'components/ess/LeaveSection.tsx': 7,
  'components/ess/RoleTabs.tsx': 4,
  'components/ess/today/PunchDial.tsx': 1,
  'components/ess/today/Toast.tsx': 1,
  'components/letters/LetterheadConfig.tsx': 2,
  'components/payroll/Appraisal.tsx': 2,
  'components/payroll/ArrearPayments.tsx': 2,
  'components/payroll/AttendanceEdit.tsx': 1,
  'components/payroll/AttendanceEditTab.tsx': 2,
  'components/payroll/attendanceShared.tsx': 4,
  'components/payroll/AttendanceUpload.tsx': 2,
  'components/payroll/BankDetailsTab.tsx': 2,
  'components/payroll/BonusConfig.tsx': 1,
  'components/payroll/LockUnlock.tsx': 2,
  'components/payroll/LwfConfig.tsx': 2,
  'components/payroll/ManualVoucher.tsx': 3,
  'components/payroll/MonthSync.tsx': 2,
  'components/payroll/NpsReport.tsx': 2,
  'components/payroll/OtUpload.tsx': 1,
  'components/payroll/PayslipDownload.tsx': 4,
  'components/payroll/PerquisitesConfig.tsx': 1,
  'components/payroll/PtConfig.tsx': 2,
  'components/profile/IdCard.tsx': 2,
  'components/profile/PhotoUploader.tsx': 1,
  'components/profile/ProfileShell.tsx': 4,
  'components/recruitment/CandidateInterviewModal.tsx': 6,
  'components/recruitment/InterviewFeedbackForm.tsx': 5,
  'components/recruitment/InterviewPipeline.tsx': 1,
  'components/rms/EmployeeOrgFlow.tsx': 4,
  'components/wall/Badge.tsx': 6,
};

/** Total at the time of generation: 253. */
export const THEME_AUDIT_TOTAL = 251;
