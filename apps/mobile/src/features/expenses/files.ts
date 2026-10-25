// src/features/expenses/files.ts — choosing a bill, ticket or RC photo on the phone.
//
// The website uses <input type="file" accept="image/*,.pdf"> (expense form) /
// "image/*,application/pdf" (journey report, vehicle RC): no capture attribute,
// no compression, no HEIC conversion. A phone browser offers camera, gallery and
// files from that one input; here that is three choices:
//   camera  → expo-image-picker launchCameraAsync
//   photo   → expo-image-picker launchImageLibraryAsync
//   pdf     → expo-document-picker (PDF)
// The server is authoritative (10 MB; JPEG/PNG/WebP/HEIC/HEIF/PDF sniffed from
// the bytes, spec Part 5 "Bill / RC upload"), so nothing else is checked here
// beyond a harmless 10 MB pre-check that uses the server's own sentence.
//
// Usage:
//   const f = await pickFile('camera')          // PickedFile | null (cancelled)
//   const stored = await te.upload(f, 'BILL')   // TeUploadedFile
// usePickFile() wraps the "how do you want to add it?" choice in a sheet.
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import type { PickedFile } from '@/core/api'

export type PickSource = 'camera' | 'photo' | 'pdf'
export const MAX_UPLOAD = 10 * 1024 * 1024

export class PickError extends Error {}

const extOf = (mime: string) =>
  mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/heic' ? 'heic' : mime === 'image/heif' ? 'heif' : 'jpg'

function checkSize(f: PickedFile) {
  if (f.size && f.size > MAX_UPLOAD) {
    // app/api/te/upload/route.ts: "That file is X.X MB. The limit is 10 MB: a photo of the bill is enough."
    throw new PickError(`That file is ${(f.size / 1048576).toFixed(1)} MB. The limit is 10 MB: a photo of the bill is enough.`)
  }
  return f
}

/** Ask for one file. Resolves null when the person cancels; throws PickError with a sentence to show. */
export async function pickFile(source: PickSource): Promise<PickedFile | null> {
  if (source === 'pdf') {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false })
    if (r.canceled || !r.assets?.length) return null
    const a = r.assets[0]
    const type = a.mimeType || 'application/pdf'
    return checkSize({ uri: a.uri, name: a.name || `bill.${extOf(type)}`, type, size: a.size ?? null })
  }
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) throw new PickError('Camera access is off for EZER. Allow it in Settings, or choose a photo or a PDF instead.')
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: false, exif: false }
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
  if (r.canceled || !r.assets?.length) return null
  const a = r.assets[0]
  const type = a.mimeType || 'image/jpeg'
  const name = a.fileName || `bill_${Date.now()}.${extOf(type)}`
  return checkSize({ uri: a.uri, name, type, size: a.fileSize ?? null })
}

/** The three choices, in the words a sheet shows them. */
export const PICK_OPTIONS: { value: PickSource; label: string; note: string }[] = [
  { value: 'camera', label: 'Take a photo', note: 'Use the camera' },
  { value: 'photo', label: 'Choose a photo', note: 'From the gallery' },
  { value: 'pdf', label: 'Choose a PDF or file', note: 'From the phone’s files' },
]
