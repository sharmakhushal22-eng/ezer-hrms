// app/ess/layout.tsx — exists for the viewport only (lib/ess/viewport.ts). The pages
// under /ess are client components, and a viewport can only be exported from a server one.
import { essViewport } from '@/lib/ess/viewport'

export const viewport = essViewport

export default function EssLayout({ children }: { children: React.ReactNode }) {
  return children
}
