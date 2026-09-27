// app/ess/page.tsx — every ESS notification links to "/ess?tab=<view>" (approvals,
// funzone, …), while the portal itself lives at /ess-portal. Forward there with the
// query intact (server-side, so it works before any client JS runs). The portal reads
// ?tab= (and ?module=) on mount.
import { redirect } from 'next/navigation'

export default async function EssRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp || {})) {
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x)); else if (v != null) qs.set(k, v)
  }
  const q = qs.toString()
  redirect(`/ess-portal${q ? `?${q}` : ''}`)
}
