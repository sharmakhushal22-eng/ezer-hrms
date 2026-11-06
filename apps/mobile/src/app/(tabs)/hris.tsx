// HR Services — Team Directory, Raise a Request, Tasks & Approvals, Exit Process.
import ApprovalsScreen from '@/features/hris/approvals/ApprovalsScreen'
import DirectoryScreen from '@/features/hris/DirectoryScreen'
import ExitScreen from '@/features/hris/ExitScreen'
import RequestsScreen from '@/features/hris/RequestsScreen'
import { SectionTabs } from '@/features/shell/Section'

const PANES = { directory: DirectoryScreen, requests: RequestsScreen, approvals: ApprovalsScreen, exit: ExitScreen }

export default function Hris() { return <SectionTabs section="hris" panes={PANES} /> }
