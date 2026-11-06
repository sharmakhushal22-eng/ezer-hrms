'use client'
// lib/lms/upload-client.ts — sending a file straight from the browser to private storage.
//
// A serverless request body stops at 4.5 MB, so no file travels through our routes. The route
// checks permission and hands back a signed token; the bytes go directly to the bucket; and
// the route then confirms they arrived. Video, audio and SCORM packages use TUS, which resumes
// where it left off after a dropped connection, in the exact 6 MB chunks Supabase requires.
import { Upload } from 'tus-js-client'
import { supabase } from '@/lib/supabase'
import { inspectMp4 } from './mp4-check'
import { lmsApi } from './client'

export type AssetKind = 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'IMAGE' | 'SCORM'

export interface UploadedAsset { id: string; kind: string; original_name: string; mime_type: string; size_bytes: number; duration_s: number | null; status: string }
export interface UploadOptions { kind: AssetKind; companyId?: string | null; onProgress?: (pct: number) => void; purpose?: 'recording' }

const TUS_CHUNK = 6 * 1024 * 1024

/** Duration and a poster frame, read locally. A file the browser cannot decode fails here. */
function probeMedia(file: File, kind: 'VIDEO' | 'AUDIO'): Promise<{ duration: number; poster: Blob | null }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind === 'VIDEO' ? 'video' : 'audio') as HTMLVideoElement
    const url = URL.createObjectURL(file)
    const done = (fn: () => void) => { URL.revokeObjectURL(url); fn() }
    el.preload = 'metadata'; el.muted = true
    if (kind === 'VIDEO') el.playsInline = true
    el.onerror = () => done(() => reject(new Error('This browser cannot read that file. Export it as MP4 with H.264 video and AAC audio.')))
    el.onloadedmetadata = () => {
      const duration = el.duration
      if (!Number.isFinite(duration) || duration <= 0) return done(() => reject(new Error('Could not read the length of that file.')))
      if (kind === 'AUDIO') return done(() => resolve({ duration, poster: null }))
      el.currentTime = Math.min(1, duration * 0.1)
    }
    el.onseeked = () => {
      const c = document.createElement('canvas')
      c.width = Math.min(1280, el.videoWidth || 1280)
      c.height = Math.round(c.width * ((el.videoHeight || 720) / (el.videoWidth || 1280)))
      c.getContext('2d')?.drawImage(el, 0, 0, c.width, c.height)
      const duration = el.duration
      c.toBlob(b => done(() => resolve({ duration, poster: b })), 'image/jpeg', 0.82)
    }
    el.src = url
  })
}

function tusUpload(file: File, start: { tus_endpoint: string; token: string; bucket: string; path: string }, contentType: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    new Upload(file, {
      endpoint: start.tus_endpoint,
      chunkSize: TUS_CHUNK,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { 'x-signature': start.token },
      metadata: { bucketName: start.bucket, objectName: start.path, contentType: contentType || file.type, cacheControl: '31536000' },
      removeFingerprintOnSuccess: true,
      uploadDataDuringCreation: false,
      onError: e => reject(new Error(`The upload stopped: ${e.message || 'connection lost'}. Choose the file again to resume.`)),
      onProgress: (sent, total) => onProgress?.(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    }).start()
  })
}

export async function uploadLmsFile(file: File, o: UploadOptions): Promise<UploadedAsset> {
  let duration: number | null = null, poster: Blob | null = null
  if (o.kind === 'VIDEO') {
    const report = await inspectMp4(file.size, async (s, e) => new Uint8Array(await file.slice(s, e).arrayBuffer()))
    if (!report.ok) throw new Error(report.problem || 'That video cannot be used.')
  }
  if (o.kind === 'VIDEO' || o.kind === 'AUDIO') ({ duration, poster } = await probeMedia(file, o.kind))

  // A .vtt captions file is stored as plain text: the bucket's allowed types (migration 206) do
  // not list text/vtt, and the player reads the words itself rather than trusting the type.
  const lower = file.name.toLowerCase()
  // A zip is application/zip to the bucket whatever the browser calls it (Windows says x-zip-compressed).
  const mime = lower.endsWith('.vtt') ? 'text/plain' : lower.endsWith('.zip') ? 'application/zip' : file.type || (lower.endsWith('.pdf') ? 'application/pdf' : '')
  const start = await lmsApi('/api/lms/admin/assets', { company_id: o.companyId || undefined, kind: o.kind, name: file.name, mime, size: file.size, duration_s: duration, purpose: o.purpose })
  try {
    // Big files resume after a dropped connection: video, audio and SCORM packages.
    if (o.kind === 'VIDEO' || o.kind === 'AUDIO' || o.kind === 'SCORM') await tusUpload(file, start, mime, o.onProgress)
    else {
      const { error } = await supabase.storage.from(start.bucket).uploadToSignedUrl(start.path, start.token, file, { contentType: mime })
      if (error) throw error
      o.onProgress?.(100)
    }
    let posterPath: string | null = null
    if (poster && start.poster) {
      const { error } = await supabase.storage.from(start.bucket).uploadToSignedUrl(start.poster.path, start.poster.token, poster, { contentType: 'image/jpeg' })
      if (!error) posterPath = start.poster.path
    }
    const { asset } = await lmsApi('/api/lms/admin/assets', { asset_id: start.asset_id, duration_s: duration, poster_path: posterPath }, 'PATCH')
    return asset
  } catch (e) {
    await lmsApi('/api/lms/admin/assets', { asset_id: start.asset_id, failed: true }, 'PATCH').catch(() => {})
    throw e
  }
}

export const formatBytes = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
