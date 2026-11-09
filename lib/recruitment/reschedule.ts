// lib/recruitment/reschedule.ts — pure. The rules for editing a scheduled interview round
// (change / remove interviewers, move the time, replace the meeting link), shared by the
// candidate popup (components/recruitment/CandidateInterviewModal.tsx) and the server
// (POST /api/recruitment/interview-invite { action:'reschedule' }).
//
// Any change re-sends the invite: the candidate and every interviewer get a new mail and the
// interviewers must acknowledge again. Because the old details have already gone out, the
// meeting link AND passcode must be replaced on every edit — an edit that keeps either is
// refused, so nobody can join with what was sent before.

export interface RoundSchedule {
  mainId: string | null
  panelIds: string[]
  scheduledAt: string | null   // ISO
  link: string
  passcode: string
}

const norm = (s: string | null | undefined) => String(s ?? '').trim()
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))

/** What changed between the round as scheduled and the edit. */
export function changesOf(prev: RoundSchedule, next: RoundSchedule) {
  const t = (v: string | null) => (v ? new Date(v).getTime() : null)
  return {
    main: prev.mainId !== next.mainId,
    panel: !sameSet(prev.panelIds, next.panelIds),
    time: t(prev.scheduledAt) !== t(next.scheduledAt),
    link: norm(prev.link) !== norm(next.link),
    passcode: norm(prev.passcode) !== norm(next.passcode),
  }
}

/** Why this edit cannot be submitted (empty = it can). */
export function rescheduleProblems(prev: RoundSchedule, next: RoundSchedule, now = Date.now()): string[] {
  const out: string[] = []
  const c = changesOf(prev, next)
  if (!c.main && !c.panel && !c.time && !c.link && !c.passcode) out.push('Nothing has changed.')
  if (!next.mainId) out.push('Select the main interviewer.')
  if (!next.scheduledAt || Number.isNaN(new Date(next.scheduledAt).getTime())) out.push('Pick the interview date and time.')
  else if (new Date(next.scheduledAt).getTime() < now - 5 * 60_000) out.push('The interview time is in the past.')
  if (!norm(next.link)) out.push('Enter the new meeting link.')
  else if (!c.link) out.push('Replace the meeting link: the old one has already been sent.')
  else if (!/^https?:\/\/\S+\.\S+/i.test(norm(next.link))) out.push('The meeting link must start with https://')
  if (!norm(next.passcode)) out.push('Enter the new meeting passcode.')
  else if (!c.passcode) out.push('Replace the meeting passcode: the old one has already been sent.')
  return out
}

/** Who stays, who is added and who is removed, across main + panel. */
export function peopleDiff(prev: RoundSchedule, next: RoundSchedule) {
  const before = [prev.mainId, ...prev.panelIds].filter(Boolean) as string[]
  const after = [next.mainId, ...next.panelIds].filter(Boolean) as string[]
  return {
    kept: after.filter(id => before.includes(id)),
    added: after.filter(id => !before.includes(id)),
    removed: before.filter(id => !after.includes(id)),
  }
}
