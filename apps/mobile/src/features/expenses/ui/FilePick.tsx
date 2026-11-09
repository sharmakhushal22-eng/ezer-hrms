// src/features/expenses/ui/FilePick.tsx — the phone's <input type="file">, and TeFileLink.
//
// FilePickButton: a button that offers camera / gallery / PDF in a sheet, then
// hands the picked file to `onPicked` (which uploads it with te.upload). The
// caller owns the label and the busy state, as the website's forms do.
//
// FileLink (components/te/TeFileLink.tsx): opens a stored bill or RC photo.
//   · no path → nothing (a Travel Desk booked line carries no file);
//   · an http(s) path → a link out, "Open the booking page" (a requested stay);
//   · otherwise "Open the bill" / "Open the RC photo": GET /api/te/upload?path=
//     [&claim_id=] mints a one-hour signed URL, fresh on every tap, opened in
//     the in-app browser. On failure the error sentence shows under the button.
import * as React from 'react'
import { View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import type { PickedFile } from '@/core/api'
import type { Uuid } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { SelectSheet, useOverlay } from '@/ui/overlays'
import { errorText, te } from '../api'
import { PICK_OPTIONS, PickError, pickFile, type PickSource } from '../files'
import { TeIcon } from './TeIcon'

export function FilePickButton({ title, onPicked, disabled, loading, variant = 'outline', size = 'md', full = true, sheetTitle = 'Add the bill' }: {
  title: string
  onPicked: (f: PickedFile) => void | Promise<void>
  disabled?: boolean
  loading?: boolean
  variant?: 'outline' | 'primary' | 'soft'
  size?: 'sm' | 'md'
  full?: boolean
  sheetTitle?: string
}) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const [open, setOpen] = React.useState(false)
  const choose = async (src: PickSource) => {
    try {
      const f = await pickFile(src)
      if (f) await onPicked(f)
    } catch (e) {
      notify(e instanceof PickError ? e.message : errorText(e), 'error')
    }
  }
  return (
    <>
      <Button title={title} variant={variant} size={size} full={full} disabled={disabled} loading={loading}
        icon={<TeIcon name="file" size="sm" color={variant === 'primary' ? C.onAccent : C.brandDeep} />}
        onPress={() => setOpen(true)} />
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={sheetTitle} searchable={false}
        options={PICK_OPTIONS} onPick={v => { setOpen(false); setTimeout(() => void choose(v), 250) }} />
    </>
  )
}

export function FileLink({ path, name, claimId, kind, small }: {
  path: string | null | undefined
  name?: string | null
  claimId?: Uuid
  kind?: string | null
  small?: boolean
}) {
  const { C } = useTheme()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  if (!path) return null
  const size = small ? 'sm' : 'md'

  if (/^https?:\/\//i.test(path)) {
    return (
      <Button title={name || 'Open the booking page'} variant="outline" size={size}
        icon={<TeIcon name="go" size="sm" color={C.brandDeep} />}
        onPress={() => void WebBrowser.openBrowserAsync(path)} />
    )
  }

  const openIt = async () => {
    setBusy(true); setError('')
    try {
      const r = await te.fileUrl(path, claimId)
      await WebBrowser.openBrowserAsync(r.url)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ alignSelf: 'flex-start', gap: 4 }}>
      <Button title={busy ? 'Opening…' : name || (kind === 'RC' ? 'Open the RC photo' : 'Open the bill')} variant="outline" size={size}
        disabled={busy} icon={<TeIcon name="file" size="sm" color={C.brandDeep} />} onPress={() => void openIt()} />
      {!!error && <Txt size={F.tiny} tone="muted">{error}</Txt>}
    </View>
  )
}
