// app/learning/[[...path]]/page.tsx — EZER Learn, full screen on its own address.
//
// One page for every screen of the product (/learning, /learning/catalog,
// /learning/course/<id>, /learning/play/<enrolment>, /learning/studio/…). The app moves
// between them with history.pushState, so nothing reloads, and a refresh or a pasted link
// still lands on the right screen. See components/learning/app/router.ts.
import type { Metadata } from 'next'
import LearnApp from '@/components/learning/app/LearnApp'

export const metadata: Metadata = { title: 'EZER Learn' }

export default function LearningPage() {
  return <LearnApp />
}
