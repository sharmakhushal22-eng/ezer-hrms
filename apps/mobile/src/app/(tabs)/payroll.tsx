// Payroll — the website's pill row of nine screens, plus Investment Declaration,
// which has no pill and is reached by its 'declaration' view key (core/links.ts).
import DeclarationScreen from '@/features/payroll-tax/declaration/DeclarationScreen'
import FlexiClaimsScreen from '@/features/payroll-tax/claims/FlexiClaimsScreen'
import FlexiScreen from '@/features/payroll-tax/flexi/FlexiScreen'
import ProofsScreen from '@/features/payroll-tax/proofs/ProofsScreen'
import LoansScreen from '@/features/payroll-benefits/LoansScreen'
import NpsScreen from '@/features/payroll-benefits/NpsScreen'
import VpfScreen from '@/features/payroll-benefits/VpfScreen'
import TravelClaimsScreen from '@/features/payroll-benefits/travel/TravelClaimsScreen'
import { PlaceholderScreen } from '@/features/shell/Placeholders'
import { SectionTabs } from '@/features/shell/Section'

// On the website these two are placeholders (needs: 'Payslip generation' / 'Payroll').
function Payslip() { return <PlaceholderScreen label="Salary Slip" section="payroll" /> }
function Statutory() { return <PlaceholderScreen label="Statutory" section="payroll" /> }

const PANES = {
  payslip: Payslip, flexi: FlexiScreen, proofs: ProofsScreen, flexiclaims: FlexiClaimsScreen, vpf: VpfScreen,
  nps: NpsScreen, loans: LoansScreen, claims: TravelClaimsScreen, statutory: Statutory, declaration: DeclarationScreen,
}

export default function Payroll() { return <SectionTabs section="payroll" panes={PANES} /> }
