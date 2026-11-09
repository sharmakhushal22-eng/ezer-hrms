// src/features/profile/files.ts — choosing a card, a cheque or a document.
//
// The website's FileField / DocRow take <input type="file"
// accept=".pdf,image/jpeg,image/png,image/webp"> and check, before uploading,
// size (DOC_MAX_BYTES, 5 MB) and type (DOC_TYPES_OK), with its own sentences.
// A phone offers the same through three sources: camera, gallery, files.
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { DOC_MAX_BYTES, DOC_TYPES_OK } from '@web/profile/self-service'
import type { PickedFile } from '@/core/api'

export type DocSource = 'camera' | 'photo' | 'file'

export const DOC_SOURCES: { value: DocSource; label: string }[] = [
  { value: 'camera', label: 'Take a photo' },
  { value: 'photo', label: 'Choose a photo' },
  { value: 'file', label: 'Choose a file' },
]

export class PickError extends Error {}

const ext = (t: string) => (t === 'application/pdf' ? 'pdf' : t === 'image/png' ? 'png' : t === 'image/webp' ? 'webp' : 'jpg')

function check(f: PickedFile): PickedFile {
  if (f.size && f.size > DOC_MAX_BYTES) throw new PickError('That file is over 5 MB.')
  if (f.type && !DOC_TYPES_OK.includes(f.type)) throw new PickError('Use a PDF, JPG, PNG or WebP.')
  return f
}

/** One file, or null when the person cancels. Throws PickError with the website's sentence. */
export async function pickDoc(source: DocSource): Promise<PickedFile | null> {
  if (source === 'file') {
    const r = await DocumentPicker.getDocumentAsync({ type: DOC_TYPES_OK, copyToCacheDirectory: true, multiple: false })
    if (r.canceled || !r.assets?.length) return null
    const a = r.assets[0]
    const type = a.mimeType || 'application/pdf'
    return check({ uri: a.uri, name: a.name || `document.${ext(type)}`, type, size: a.size ?? null })
  }
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) throw new PickError('Camera access is off for EZER. Allow it in Settings, or choose a photo or a file instead.')
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, allowsEditing: false, exif: false }
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
  if (r.canceled || !r.assets?.length) return null
  const a = r.assets[0]
  const type = a.mimeType || 'image/jpeg'
  return check({ uri: a.uri, name: a.fileName || `scan_${Date.now()}.${ext(type)}`, type, size: a.fileSize ?? null })
}
