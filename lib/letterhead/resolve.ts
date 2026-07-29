// ================================================================
// EZER HRMS — Letterhead Module — Data Access & Resolution
// Path: lib/letterhead/resolve.ts
//
// getResolvedLetterheadForBranch() / getResolvedSignatoryForBranch()
// are the ONLY two functions any other part of EZER should call when
// it needs "what letterhead / signatory applies here" — the Branch >
// Company > Group fallback already happened inside the SQL view
// (letterhead_resolved / signatory_resolved), so callers never touch
// the cascade logic directly.
// ================================================================
import { supabase } from '@/lib/supabase'
import type {
  ScopeType, GroupNode, ResolvedLetterhead, ResolvedSignatory,
  LetterheadFileRow, SignatoryRow,
} from './types'

const SIGNED_URL_TTL_SECONDS = 60 * 10 // 10 minutes

// ── Hierarchy tree for the admin sidebar ──────────────────────────
export async function getHierarchyTree(): Promise<GroupNode[]> {
  const { data: groups } = await supabase.from('groups').select('id, group_name').order('group_name')
  const { data: companies } = await supabase.from('companies').select('id, group_id, company_name').order('company_name')
  const { data: branches } = await supabase.from('locations').select('id, company_id, location_name').order('location_name')

  return (groups ?? []).map(g => ({
    id: g.id,
    group_name: g.group_name,
    companies: (companies ?? [])
      .filter(c => c.group_id === g.id)
      .map(c => ({
        id: c.id,
        group_id: c.group_id,
        company_name: c.company_name,
        branches: (branches ?? [])
          .filter(b => b.company_id === c.id)
          .map(b => ({ id: b.id, company_id: b.company_id, location_name: b.location_name })),
      })),
  }))
}

// ── Resolved reads (Branch > Company > Group already applied) ────
export async function getResolvedLetterheadForBranch(locationId: string): Promise<ResolvedLetterhead | null> {
  const { data, error } = await supabase
    .from('letterhead_resolved')
    .select('*')
    .eq('location_id', locationId)
    .maybeSingle()
  if (error || !data) return null

  let signedUrl: string | null = null
  if (data.file_url) {
    const { data: signed } = await supabase.storage.from('letterhead-files').createSignedUrl(data.file_url, SIGNED_URL_TTL_SECONDS)
    signedUrl = signed?.signedUrl ?? null
  }
  return { ...data, file_url: signedUrl } as ResolvedLetterhead
}

export async function getResolvedSignatoryForBranch(locationId: string): Promise<ResolvedSignatory | null> {
  const { data, error } = await supabase
    .from('signatory_resolved')
    .select('*')
    .eq('location_id', locationId)
    .maybeSingle()
  if (error || !data) return null

  let signedUrl: string | null = null
  if (data.signature_url) {
    const { data: signed } = await supabase.storage.from('letterhead-signatures').createSignedUrl(data.signature_url, SIGNED_URL_TTL_SECONDS)
    signedUrl = signed?.signedUrl ?? null
  }
  return { ...data, signature_url: signedUrl } as ResolvedSignatory
}

// ── Raw row lookups — what the "configure at this level" panel edits ──
export async function getLetterheadAtScope(scopeType: ScopeType, scopeKey: string): Promise<LetterheadFileRow | null> {
  const { data } = await supabase
    .from('letterhead_files')
    .select('*')
    .eq('scope_type', scopeType).eq('scope_key', scopeKey).eq('is_active', true)
    .maybeSingle()
  return data as LetterheadFileRow | null
}

export async function getSignatoryAtScope(scopeType: ScopeType, scopeKey: string): Promise<SignatoryRow | null> {
  const { data } = await supabase
    .from('letterhead_signatories')
    .select('*')
    .eq('scope_type', scopeType).eq('scope_key', scopeKey).eq('is_active', true)
    .maybeSingle()
  return data as SignatoryRow | null
}

// A signed URL for whatever is CURRENTLY set at this exact scope (for
// the edit-modal preview) — separate from the resolved (cascaded) URL.
export async function getSignedUrlForPath(bucket: 'letterhead-files' | 'letterhead-signatures', path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  return data?.signedUrl ?? null
}

// ── Writes — upsert-safe via the plain UNIQUE(scope_type, scope_key) ──
export async function saveLetterheadAtScope(row: {
  scope_type: ScopeType
  scope_key: string
  group_id?: string | null
  company_id?: string | null
  location_id?: string | null
  file_url: string
  file_name: string
  file_size_bytes: number
  page_count: number
  page_width_mm: number
  page_height_mm: number
  content_top_mm: number
  content_bottom_mm: number
  content_left_mm: number
  content_right_mm: number
  scale_percent: number
  uploaded_by?: string
}) {
  return supabase.from('letterhead_files').upsert(row, { onConflict: 'scope_type,scope_key' }).select().single()
}

export async function saveSignatoryAtScope(row: {
  scope_type: ScopeType
  scope_key: string
  group_id?: string | null
  company_id?: string | null
  location_id?: string | null
  signatory_name: string
  signatory_designation: string
  signature_url: string
  signature_mime_type: 'image/png' | 'image/jpeg'
  sig_x_pct?: number | null
  sig_y_pct?: number | null
  sig_width_pct?: number | null
  uploaded_by?: string
}) {
  return supabase.from('letterhead_signatories').upsert(row, { onConflict: 'scope_type,scope_key' }).select().single()
}

export async function removeLetterheadAtScope(scopeType: ScopeType, scopeKey: string) {
  return supabase.from('letterhead_files').delete().eq('scope_type', scopeType).eq('scope_key', scopeKey)
}
export async function removeSignatoryAtScope(scopeType: ScopeType, scopeKey: string) {
  return supabase.from('letterhead_signatories').delete().eq('scope_type', scopeType).eq('scope_key', scopeKey)
}
