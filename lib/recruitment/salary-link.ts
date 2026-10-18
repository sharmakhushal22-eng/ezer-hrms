// lib/recruitment/salary-link.ts — the email that sends a candidate their salary
// break-up link.
//
// Sibling of lib/recruitment/collect-docs.ts: same shape, same voice, same
// sign-off, so the two candidate-facing mails in this flow read as one product.
//
// WHY THIS EXISTS
//
// The negotiation screen has always minted a tokenised /salary-view/<token>
// link and shown it with a Copy button. Nothing ever sent it — the recruiter
// pasted the URL into their own mail client by hand. Everything else in the
// chain (document collection, offer approval, the offer letter) emails the
// candidate directly; this was the one gap.
//
// THE OTP MATTERS IN THE COPY
//
// /salary-view/[token] does not open the offer straight away: the candidate
// enters their email and is sent a one-time code first (app/api/salary-view/otp,
// migration 132). A mail that just says "here is your offer" and then presents a
// login challenge reads as broken, so the message says plainly that a code is
// coming and which address it goes to.

/** Hours a salary link stays open for a response. Mirrors the window the
 *  candidate page enforces from link_sent_at. */
export const SALARY_LINK_TTL_HOURS = 48

export function breakupEmail(opts: {
  candidateName: string
  jobTitle: string
  companyName: string
  link: string
  /** Shown as "valid for N hours" — defaults to SALARY_LINK_TTL_HOURS. */
  ttlHours?: number
  senderName?: string
  senderTitle?: string
  senderContact?: string
}): { subject: string; body: string } {
  const { candidateName, jobTitle, companyName, link, ttlHours, senderName, senderTitle, senderContact } = opts
  const hours = ttlHours ?? SALARY_LINK_TTL_HOURS
  const subject = 'Your compensation details | Please review and confirm'
  const body = `Dear ${candidateName || 'Candidate'},

Thank you for your time through the interview process for the position of ${jobTitle || 'the role'}${companyName ? ` at ${companyName}` : ''}. We are pleased to share the proposed compensation for this role.

Please use the secure link below to view the full break-up — fixed and variable components, statutory deductions, take-home, and any joining or retention payments that apply.

🔗 Compensation Details: ${link}

For your security, opening the link asks for your email address and then sends a one-time code to it. Enter that code to view the break-up. The code is valid for a short period; request a new one from the same page if it lapses.

On that page you can either ACCEPT the proposal or respond with your questions. Please note the link is valid for ${hours} hours. If you need longer, or if anything in the break-up needs discussion, simply reply to this email and we will revise it.

We are keen to move ahead and look forward to your confirmation.

Best regards,
${senderName || 'The Hiring Team'}
${senderTitle || ''}
${companyName || ''}
${senderContact || ''}`.replace(/\n{3,}/g, '\n\n')
  return { subject, body }
}
