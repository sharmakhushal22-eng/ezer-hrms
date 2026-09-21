// lib/ui/__tests__/zindex-baseline.ts — GENERATED, then hand-maintained.
//
// Regenerate: node scripts/gen-zindex-baseline.mjs (or the scratchpad copy).
//
// Raw z-index numbers per file, as they stood when the ratchet went in. See
// zindex-audit.ts for what counts, and Z in lib/ui/tokens.ts for the scale
// that replaces them.
//
// THIS LIST ONLY EVER GOES DOWN. The test fails if a file exceeds its number,
// if a file drops below it (converted — lower it here), and if a file not
// listed has any at all, so a new screen cannot add one.
//
// NOT EVERY ENTRY IS A BUG. A small value used for local layering inside one
// component is usually fine. The rule enforced is "use the scale", not
// "values above N are wrong" — a NEW raw number is always a guess, and
// guessing is what produced 37 distinct values across this repo.
//
// Known-deliberate remainders:
//   * EmployeePortal 4000    a modal with no matching tier; dropping it to
//                            Z.modal would reorder it against RoleTabs and
//                            FlexiClaims modals also sitting at 4000.
//   * EyeComfort 2147483000  the full-screen colour filter — Z.screenFilter
//                            conceptually, left at its literal value.
export const ZINDEX_BASELINE: Record<string, number> = {
  'app/(dev)/podium-preview/preview.tsx': 1,
  'app/(dev)/social-preview/preview.tsx': 1,
  'app/dashboard/admin/page.tsx': 4,
  'app/dashboard/attendance/page.tsx': 2,
  'app/dashboard/bulk-upload/page.tsx': 1,
  'app/dashboard/company-profile/page.tsx': 3,
  'app/dashboard/employees/page.tsx': 7,
  'app/dashboard/ess/page.tsx': 5,
  'app/dashboard/flexi-claims/page.tsx': 3,
  'app/dashboard/holidays/page.tsx': 2,
  'app/dashboard/layout.tsx': 2,
  'app/dashboard/leave-upload/page.tsx': 4,
  'app/dashboard/loans/page.tsx': 2,
  'app/dashboard/onboarding/page.tsx': 4,
  'app/dashboard/org-chart/page.tsx': 1,
  'app/dashboard/payroll/page.tsx': 4,
  'app/dashboard/policies/page.tsx': 2,
  'app/dashboard/recruitment/page.tsx': 13,
  'app/dashboard/reports/page.tsx': 1,
  'app/dashboard/roles/page.tsx': 3,
  'app/dashboard/statutory-leave/page.tsx': 4,
  'app/dashboard/transfer/page.tsx': 3,
  'app/ess-portal/page.tsx': 1,
  'app/layout.tsx': 1,
  'app/onboarding/[token]/client.tsx': 1,
  'app/page.tsx': 4,
  'components/company/Compliance.tsx': 1,
  'components/company/GroupEditor.tsx': 1,
  'components/employees/BulkUploadModal.tsx': 1,
  'components/employees/HRActionPanel.tsx': 1,
  'components/ess/EmployeePortal.tsx': 3,
  'components/ess/FlexiClaims.tsx': 2,
  'components/ess/hris/hris.css': 4,
  'components/ess/Inbox.tsx': 1,
  'components/ess/inbox/inbox.css': 7,
  'components/ess/LeaveSection.tsx': 1,
  'components/ess/MrfForm.tsx': 1,
  'components/ess/RoleTabs.tsx': 2,
  'components/ess/social/social.css': 1,
  'components/ess/team/team.css': 2,
  'components/ess/today/today.css': 7,
  'components/funzone/fzStyles.ts': 1,
  'components/letters/LetterheadConfig.tsx': 2,
  'components/onboarding/ActivationWizard.tsx': 1,
  'components/payroll/AttendanceEditTab.tsx': 2,
  'components/payroll/attendanceShared.tsx': 2,
  'components/payroll/BonusConfig.tsx': 1,
  'components/payroll/LwfConfig.tsx': 2,
  'components/payroll/ManualVoucher.tsx': 1,
  'components/payroll/MinimumWageConfig.tsx': 2,
  'components/payroll/MonthSync.tsx': 1,
  'components/payroll/NpsReport.tsx': 1,
  'components/payroll/PerquisitesConfig.tsx': 2,
  'components/payroll/PtConfig.tsx': 2,
  'components/payroll/SubSectionDropdown.tsx': 1,
  'components/pms/CycleStepper.tsx': 3,
  'components/pms/pms.css': 2,
  'components/profile/profile.css': 2,
  'components/recruitment/CandidateInterviewModal.tsx': 3,
  'components/wall/PersonPicker.tsx': 1,
  'components/wall/ui.tsx': 2,
  'lib/ui/EyeComfort.tsx': 1,
  'lib/ui/index.tsx': 1,
  'lib/ui/PageTransition.tsx': 1,
};

/** Total at generation time. */
export const ZINDEX_TOTAL = 151;
