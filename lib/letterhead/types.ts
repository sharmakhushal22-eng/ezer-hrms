// ================================================================
// EZER HRMS — Letterhead Module — Shared Types
// Path: lib/letterhead/types.ts
// ================================================================

export type ScopeType = 'GROUP' | 'COMPANY' | 'BRANCH'

export const ACCEPTED_LETTERHEAD_MIME = ['application/pdf'] as const
export const MAX_LETTERHEAD_BYTES = 5 * 1024 * 1024 // 5MB

export const ACCEPTED_SIGNATURE_MIME = ['image/png', 'image/jpeg'] as const
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024 // 2MB

// ── Hierarchy tree (drives the admin sidebar) ─────────────────────
export interface GroupNode {
  id: string
  group_name: string
  companies: CompanyNode[]
}
export interface CompanyNode {
  id: string
  group_id: string
  company_name: string
  branches: BranchNode[]
}
export interface BranchNode {
  id: string
  company_id: string
  location_name: string
}

// Whichever node in the tree is currently selected for configuration —
// could be the Group, a Company, or a Branch. This is what "configure
// at this level" writes to.
export interface ScopeSelection {
  scope_type: ScopeType
  scope_key: string       // group_id, company_id, or location_id
  display_name: string
}

// ── Raw rows — what the upload forms write ────────────────────────
export interface LetterheadFileRow {
  id: string
  scope_type: ScopeType
  scope_key: string
  file_url: string
  file_name: string
  file_size_bytes: number | null
  page_count: number | null
  page_width_mm: number | null
  page_height_mm: number | null
  content_top_mm: number
  content_bottom_mm: number
  content_left_mm: number
  content_right_mm: number
  scale_percent: number
  is_active: boolean
}

export interface SignatoryRow {
  id: string
  scope_type: ScopeType
  scope_key: string
  signatory_name: string
  signatory_designation: string
  signature_url: string
  signature_mime_type: 'image/png' | 'image/jpeg'
  sig_x_pct: number | null
  sig_y_pct: number | null
  sig_width_pct: number | null
  is_active: boolean
}

// ── Resolved (cascaded) result — one row per branch ───────────────
export interface ResolvedLetterhead {
  location_id: string
  company_id: string
  group_id: string
  location_name: string
  file_url: string | null
  file_name: string | null
  page_width_mm: number | null
  page_height_mm: number | null
  content_top_mm: number | null
  content_bottom_mm: number | null
  content_left_mm: number | null
  content_right_mm: number | null
  scale_percent: number | null
  letterhead_resolved_from: ScopeType | null
  letterhead_configured: boolean
}

export interface ResolvedSignatory {
  location_id: string
  company_id: string
  group_id: string
  location_name: string
  signatory_name: string | null
  signatory_designation: string | null
  signature_url: string | null
  sig_x_pct: number | null
  sig_y_pct: number | null
  sig_width_pct: number | null
  signatory_resolved_from: ScopeType | null
  signatory_configured: boolean
}

export interface PdfPageSize {
  widthPt: number
  heightPt: number
}
