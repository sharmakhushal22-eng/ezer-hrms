// app/learning/[[...path]]/page.tsx — EZER Learn, full screen on its own address.
//
// One page for every screen of the product (/learning, /learning/catalog,
// /learning/course/<id>, /learning/play/<enrolment>, /learning/studio/…). The app moves
// between them with history.pushState, so nothing reloads, and a refresh or a pasted link
// still lands on the right screen. See components/learning/app/router.ts.
//
// When Learning has its own domain (NEXT_PUBLIC_LMS_URL, lib/lms/site.ts), HRMS no longer
// renders it here: every /learning address hands the person over to the same screen there,
// signed in. On the LMS domain itself proxy.ts serves this page at the root.
import type { Metadata } from 'next'
import LearnApp from '@/components/learning/app/LearnApp'
import LmsHandoff from '@/components/learning/app/LmsHandoff'
import { LMS_ELSEWHERE } from '@/lib/lms/site'

export const metadata: Metadata = {
  title: 'EZER Learn',
  description: 'Courses, learning paths, live sessions and certificates for your whole company.',
}

export default function LearningPage() {
  return LMS_ELSEWHERE ? <LmsHandoff /> : <LearnApp />
}
