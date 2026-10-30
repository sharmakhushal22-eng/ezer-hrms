// ExitFnf.tsx openPdf — a PDF route that needs the session header, opened for reading.
//
// Website: fetch with the bearer token → blob → a new tab. Here:
//   web     → the same (blob URL in a new tab)
//   native  → download to the cache with the header, then the share sheet (open / save / send)
// A refused download (403 / 409 …) is re-asked through api() so the server's own
// sentence ("Your F&F statement is available once it is approved.") is what shows.
import { Platform } from 'react-native'
import * as Sharing from 'expo-sharing'
import { api, apiUrl, currentToken } from '@/core/api'

export async function openAuthedPdf(path: string, query: Record<string, string>, employeeId: string, name: string) {
  const url = apiUrl(path, query, employeeId)
  const token = currentToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  if (Platform.OS === 'web') {
    const r = await fetch(url, { headers, cache: 'no-store' })
    if (!r.ok) { const j = await r.json().catch(() => ({} as any)); throw new Error(j.error || `HTTP ${r.status}`) }
    const blobUrl = URL.createObjectURL(await r.blob())
    window.open(blobUrl, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    return
  }
  const { File, Paths } = await import('expo-file-system')
  const safe = name.replace(/[^\w.-]+/g, '_')
  let file: InstanceType<typeof File>
  try {
    file = await File.downloadFileAsync(url, new File(Paths.cache, safe), { headers, idempotent: true })
  } catch (e) {
    // The JSON error behind the failed download — api() throws it as an ApiError.
    await api(path, { query, employeeId })
    throw e
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name })
}
