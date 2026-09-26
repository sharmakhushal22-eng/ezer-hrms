'use client'
// components/ess/RecruitmentModule.tsx — Recruitment & ATS, as mounted inside ESS.
//
// WHY THIS FILE EXISTS. AdminModules lazy-loads the dashboard pages themselves
// (`@/app/dashboard/recruitment/page`), which works for every other module
// because those pages are self-contained and style themselves inline. The
// recruitment page is not: its redesign lives in a STYLESHEET,
// lib/ui/recruitment.redesign.css, and that sheet is loaded by
// app/dashboard/recruitment/layout.tsx.
//
// A Next route layout only wraps its own route subtree. Mounting the page from
// inside the ESS portal never goes through /dashboard/recruitment, so the
// layout never runs, the sheet never loads, and every rx-* class in the page —
// 163 rx-input, 91 rx-label, the module cards, the tab rail, all of it —
// resolves to nothing. The page renders as unstyled HTML inside ESS while
// looking correct at its own route. Measured: a probe element with
// className="rx-input" reads h42/r11/14px on /dashboard/recruitment and
// h0/r0/16px on /dashboard/ess.
//
// So this wrapper does what the layout does, for the ESS path: load the sheet
// and provide the display font variable. It is imported lazily by
// AdminModules, so the CSS still only downloads for someone who actually opens
// Recruitment inside the portal.
//
// ONE PREREQUISITE, already done: the sheet's frame rule is a BARE `.rx`
// selector that sets flex-direction:column, font-family and position. Social's
// reaction pills used to carry className="rx" too, and `.soc .rx` does not
// override flex-direction — so loading this sheet portal-wide stacked every
// emoji above its count. CSS is never unloaded once fetched, so lazy-loading
// alone would not have contained it. Those pills are `soc-rx` now, which is
// what makes this import safe.
import RecruitmentPage from '@/app/dashboard/recruitment/page'
import '@/lib/ui/recruitment.redesign.css'
import { Bricolage_Grotesque } from 'next/font/google'

// Same face, weights and fallback behaviour as the route layout. The sheet
// resolves --rx-display from --rx-display-font and falls back to DM Sans, so
// the module still renders correctly if the font fails to load.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--rx-display-font',
})

export default function RecruitmentModule() {
  return (
    <div className={display.variable}>
      <RecruitmentPage />
    </div>
  )
}
