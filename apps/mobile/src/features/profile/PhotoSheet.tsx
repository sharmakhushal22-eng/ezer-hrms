// src/features/profile/PhotoSheet.tsx — components/profile/PhotoUploader.tsx
// for a phone.
//
// The website builds its own cropper on a canvas (drag, pinch, wheel, rotate,
// flip, straighten) and exports a 768×768 JPEG at q0.92. Here the picker's own
// square crop does the framing (pan and zoom, Android's crop screen), the
// rotate / flip / reset tools are kept, and expo-image-manipulator does the
// export: the same 768×768 JPEG at q0.92, sent as field `file` named
// avatar.jpg to POST /api/ess/profile/photo (the route takes JPG/PNG/WebP up to
// 2 MB). The website's "Straighten" slider has no equivalent here.
import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Notice, ProgressBar, Txt } from '@/ui/primitives'
import { Sheet } from '@/ui/overlays'
import { uploadPhoto } from './api'

const OUT = 768
const MAX_BYTES = 40 * 1024 * 1024
const UNREADABLE = 'That image could not be opened. Try a JPG or PNG.'

interface Src { uri: string; width: number; height: number }

/** Rotate, flip, centre-square, 768², JPEG 0.92. */
async function exportSquare(src: Src, quarter: number, flip: boolean) {
  const ctx = ImageManipulator.manipulate(src.uri)
  if (quarter) ctx.rotate(quarter * 90)
  if (flip) ctx.flip(FlipType.Horizontal)
  const turned = await ctx.renderAsync()
  const w = turned.width, h = turned.height
  const side = Math.min(w, h)
  const ctx2 = ImageManipulator.manipulate(turned)
  if (w !== h) ctx2.crop({ originX: Math.floor((w - side) / 2), originY: Math.floor((h - side) / 2), width: side, height: side })
  ctx2.resize({ width: OUT, height: OUT })
  const out = await (await ctx2.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.92 })
  return out.uri
}

export function PhotoSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (url: string) => void }) {
  return (
    <Sheet visible={open} onClose={onClose} title="Profile photo">
      {/* Mounted only while open, so every open starts fresh — the website's fix for "no second photo". */}
      {open && <PhotoForm onClose={onClose} onDone={onDone} />}
    </Sheet>
  )
}

function Tool({ label, a11y, on, onPress }: { label: string; a11y: string; on?: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}
      style={({ pressed }) => ({ minWidth: 48, height: 44, paddingHorizontal: S.md, borderRadius: R.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
        borderColor: on ? C.brand : C.lineStrong, backgroundColor: on ? C.brand : pressed ? C.brandTint : C.surface })}>
      <Txt size={F.lead} w={600} color={on ? C.onAccent : C.ink}>{label}</Txt>
    </Pressable>
  )
}

function PhotoForm({ onClose, onDone }: { onClose: () => void; onDone: (url: string) => void }) {
  const { C } = useTheme()
  const [src, setSrc] = React.useState<Src | null>(null)
  const [quarter, setQuarter] = React.useState(0)
  const [flip, setFlip] = React.useState(false)
  const [busy, setBusy] = React.useState(0)
  const [err, setErr] = React.useState<string | null>(null)

  const choose = async () => {
    setErr(null)
    let r: ImagePicker.ImagePickerResult
    try {
      r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 1 })
    } catch { setErr(UNREADABLE); return }
    if (r.canceled || !r.assets?.length) return
    const a = r.assets[0]
    if (a.fileSize && a.fileSize > MAX_BYTES) {
      setErr(`That image is ${(a.fileSize / 1048576).toFixed(0)} MB, over the ${MAX_BYTES / 1048576} MB limit.`); return
    }
    if (a.mimeType && !a.mimeType.startsWith('image/')) { setErr('That file is not an image. Use JPG or PNG.'); return }
    setSrc({ uri: a.uri, width: a.width, height: a.height })
    setQuarter(0); setFlip(false)
  }

  const reset = () => { setQuarter(0); setFlip(false) }

  const save = async () => {
    if (!src) { setErr('Choose an image first.'); return }
    setErr(null); setBusy(15)
    let uri: string
    try { uri = await exportSquare(src, quarter, flip) } catch { setBusy(0); setErr(UNREADABLE); return }
    setBusy(55)
    try {
      const j = await uploadPhoto({ uri, name: 'avatar.jpg', type: 'image/jpeg' })
      setBusy(100)
      onDone(j.url ?? uri)
      setTimeout(onClose, 250)
    } catch (e) {
      setBusy(0); setErr(e instanceof Error ? e.message : 'Upload failed.')
    }
  }

  return (
    <View>
      <Txt size={F.small} tone="muted" style={{ marginBottom: S.md }}>
        {Platform.OS === 'web' ? 'Choose a photo; it is cut to a centred square.' : 'Choose a photo, then crop it to a square.'} Saved as a {OUT} by {OUT} square.
      </Txt>

      <View style={{ alignSelf: 'center', width: 240, height: 240, borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
        {src ? (
          <>
            <Image source={{ uri: src.uri }} contentFit="cover"
              style={{ width: '100%', height: '100%', transform: [{ rotate: `${quarter * 90}deg` }, { scaleX: flip ? -1 : 1 }] }} />
            {/* The ring mask: what shows in a round avatar. */}
            <View pointerEvents="none" style={{ position: 'absolute', width: 240, height: 240, borderRadius: 120, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' }} />
          </>
        ) : (
          <Pressable onPress={choose} style={{ padding: S.lg }}>
            <Txt size={F.small} tone="muted" center>No photo chosen yet.{'\n'}<Txt size={F.small} w={600} tone="brand">Choose a file</Txt></Txt>
          </Pressable>
        )}
      </View>

      {src && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: S.sm, marginTop: S.md }}>
          <Tool label="⟲" a11y="Rotate left" onPress={() => setQuarter(q => (q + 3) % 4)} />
          <Tool label="⟳" a11y="Rotate right" onPress={() => setQuarter(q => (q + 1) % 4)} />
          <Tool label="⇋" a11y="Flip horizontally" on={flip} onPress={() => setFlip(f => !f)} />
          <Button title="Reset" variant="outline" size="sm" onPress={reset} style={{ height: 44, justifyContent: 'center' }} />
        </View>
      )}

      {busy > 0 && <View style={{ marginTop: S.md }}><ProgressBar value={busy} max={100} /></View>}
      {!!err && <Notice tone="critical" style={{ marginTop: S.md }}>{err}</Notice>}

      <View style={{ gap: S.sm, marginTop: S.lg }}>
        <Button title={src ? 'Choose a different photo' : 'Choose a file'} variant="outline" full onPress={choose} disabled={busy > 0} />
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <Button title="Cancel" variant="outline" style={{ flex: 1 }} onPress={onClose} />
          <Button title={busy > 0 ? 'Saving…' : 'Save photo'} style={{ flex: 1 }} disabled={busy > 0 || !src} onPress={save} />
        </View>
      </View>
    </View>
  )
}
