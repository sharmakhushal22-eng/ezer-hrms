// lib/letters/applicability.ts — which letters an employee's engagement type allows.
//
// The Letter of Appointment is the employment contract: an apprentice (NATS / NAPS) signs a
// Contract of Apprenticeship, an intern an internship letter and a contractor or consultant an
// engagement letter instead, so
// for them it is not offered in People → Letters (the dropdown shows it disabled) and the
// appointment letter route refuses it. The type names follow employees.employment_type and
// the recruitment engagement kinds (lib/recruitment/engagement letterKindOf).
//
// Pure, no imports: the letter picker, the studio and the appointment route share it.

const NO_APPOINTMENT: Record<string, string> = {
  nats: 'NATS apprentice', naps: 'NAPS apprentice',
  intern: 'Intern', internship: 'Intern', 'live project': 'Intern', trainee: 'Intern',
  contract: 'Contract', contractual: 'Contract', 'fixed term': 'Contract', 'fixed-term': 'Contract',
  consultant: 'Consultant', freelancer: 'Consultant', retainer: 'Consultant',
}

/** The engagement label when the type rules out an appointment letter, else null. */
export function noAppointmentFor(employmentType: string | null | undefined): string | null {
  return NO_APPOINTMENT[String(employmentType || '').trim().toLowerCase()] || null
}

/** Why a letter is not available for this employment type (null when it is). */
export function letterBlockedFor(code: string, employmentType: string | null | undefined): string | null {
  if (code !== 'APT') return null
  const kind = noAppointmentFor(employmentType)
  return kind ? `Not applicable to ${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind}: the appointment letter is for employees only.` : null
}
