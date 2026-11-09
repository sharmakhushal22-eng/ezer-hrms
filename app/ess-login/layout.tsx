// app/ess-login/layout.tsx — the same phone viewport as the portal (lib/ess/viewport.ts),
// so the sign-in fields do not zoom the page on iOS.
import { essViewport } from '@/lib/ess/viewport'

export const viewport = essViewport

export default function EssLoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
