// Profile — My Details, Letter Requests, My Letters, Documents to sign.
import DocumentsToSignScreen from '@/features/esign/DocumentsToSignScreen'
import LetterRequestsScreen from '@/features/profile/LetterRequestsScreen'
import MyLettersScreen from '@/features/profile/MyLettersScreen'
import ProfileScreen from '@/features/profile/ProfileScreen'
import { SectionTabs } from '@/features/shell/Section'

const PANES = { profile: ProfileScreen, documents: LetterRequestsScreen, letters: MyLettersScreen, 'to-sign': DocumentsToSignScreen }

export default function Profile() { return <SectionTabs section="profile" panes={PANES} /> }
