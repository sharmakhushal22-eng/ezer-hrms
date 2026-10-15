'use client'
// app/ess/page.tsx — the ESS portal. ONE static route serves every screen's address:
//   /ess · /ess/leave · /ess/approvals · /ess/recruitment/mrf · /ess/recruitment/sendoffer …
// next.config.ts rewrites /ess/:path* to this page, and the portal itself reads the path
// (components/ess/EmployeePortal.tsx via lib/ess/routes.ts). Why a rewrite rather than a
// catch-all segment: the App Router keys its tree on dynamic segment values, so Back /
// Forward across a reload would refetch and REMOUNT the whole portal for every entry. With
// one static page the router tree is identical for every address, so a history move is a
// state change — the tree stays mounted and lands instantly.
import PortalPage from '@/components/ess/PortalPage'

export default function EssRoute() {
  return <PortalPage />
}
