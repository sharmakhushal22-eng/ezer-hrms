/**
 * Route layout for Recruitment & ATS.
 *
 * Two jobs, both required by the redesign kit:
 *
 *  1. Load `lib/ui/recruitment.redesign.css` exactly once for this route.
 *     Everything in that sheet is scoped under `.rx`, so it cannot leak into
 *     other modules, and it deliberately does NOT edit the runtime stylesheet
 *     in lib/ui/index.tsx — it restores its own button radii over the runtime's
 *     global `button{border-radius:10px !important}` instead.
 *
 *  2. Provide the display font as a CSS variable. The stylesheet resolves
 *     `--rx-display` from `--rx-display-font` when this layout sets it and
 *     falls back to DM Sans when it does not, so the route still renders
 *     correctly if the font fails to load.
 *
 * theme.css loads globally and before this file, which is what lets every
 * colour here resolve through var(--ez-*) and follow the light/dark theme.
 */
import '@/lib/ui/recruitment.redesign.css'
import { Bricolage_Grotesque } from 'next/font/google'

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--rx-display-font',
})

export default function RecruitmentLayout({ children }: { children: React.ReactNode }) {
  return <div className={display.variable}>{children}</div>
}
