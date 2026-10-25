// CSV export — RoleTabs.tsx toCsv, byte for byte: a cell is quoted when it holds
// a quote, comma or newline (quotes doubled), lines joined with \n, no BOM,
// numbers raw. File name: the title with every run of non-alphanumerics → '_'.
// The website downloads a Blob; the phone writes the file to the cache and
// opens the share sheet (the browser test build falls back to a Blob download).
import { Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

export function toCsv(columns: string[], rows: any[][]) {
  const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [columns.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
}
export const csvName = (title: string) => `${title.replace(/[^A-Za-z0-9]+/g, '_')}.csv`

export async function shareCsv(title: string, columns: string[], rows: any[][]) {
  const csv = toCsv(columns, rows)
  const name = csvName(title)
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    return
  }
  const f = new File(Paths.cache, name)
  if (f.exists) f.delete()
  f.create()
  f.write(csv)
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.')
  await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: title })
}
