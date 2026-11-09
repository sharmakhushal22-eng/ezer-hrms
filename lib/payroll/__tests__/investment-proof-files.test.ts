// lib/payroll/__tests__/investment-proof-files.test.ts — documents behind an investment proof:
// every declared line in ESS takes uploads, HR sees them on the review screen, and the files
// live in a private bucket behind a server route that checks who is asking.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (p: string) => readFileSync(p, 'utf8')

test('ESS → Investment Proofs offers an upload on every declared line', () => {
  const s = src('components/ess/InvestmentProofs.tsx')
  assert.ok(/export function ProofDocuments/.test(s), 'a shared documents block')
  assert.ok(/<ProofDocuments files=\{files\} locked=\{locked\} onUpload=\{onUpload\} onRemove=\{onRemove\}/.test(s), 'rendered inside each proof row')
  assert.ok(/type="file" accept=\{ACCEPT\}/.test(s) && /application\/pdf,image\/jpeg,image\/png,image\/webp/.test(s), 'PDF and image uploads')
  assert.ok(/fetch\('\/api\/ess\/investment-proofs', \{ method: 'POST', headers: await authHeaders\(\), body: fd \}\)/.test(s), 'uploads go through the API with the session')
  assert.ok(/method: 'DELETE', headers: await authHeaders\(\)/.test(s), 'removal goes through the API too')
  assert.ok(!/is-ghost/.test(s), 'uses the existing ezp-ghost class')
})

test('the API hands out signed URLs and checks the caller against the line owner', () => {
  const s = src('app/api/ess/investment-proofs/route.ts')
  assert.ok(/requireSelfOrModule\(req, proof\.employee_id, 'Payroll', 'EDIT'\)/.test(s), 'upload: owner or Payroll staff of their company')
  assert.ok(/requireSelfOrModule\(req, p\.get\('employee_id'\), 'Payroll', 'VIEW'\)/.test(s), 'list: owner or Payroll VIEW')
  assert.ok(/requireAccess\(req, 'Payroll', 'VIEW'\)/.test(s), 'company-wide list needs Payroll')
  assert.ok(/createSignedUrls\(/.test(s) && !/getPublicUrl/.test(s), 'signed, never public')
  assert.ok(/function sniff\(buf: Buffer\)/.test(s) && /'%PDF-'/.test(s), 'file type read from the bytes, not the name')
  assert.ok(/upsert: false/.test(s), 'never overwrites')
  assert.ok(/status === 'APPROVED'\) return refuse\(409/.test(s), 'approved lines are frozen')
  assert.ok(!/^export const PROOF_BUCKET/m.test(s), 'route files export handlers only')
})

test('HR review shows the attached bills per line', () => {
  const s = src('app/dashboard/investment-proofs/page.tsx')
  assert.ok(/\/api\/ess\/investment-proofs\?scope=company&fy=\$\{FY\}/.test(s), 'loads the company’s files')
  assert.ok(/files=\{files\.filter\(f => f\.proof_id === r\.id\)\}/.test(s), 'per proof line')
  assert.ok(/No document attached yet/.test(s), 'says so when there is only a typed reference')
})

test('migration 212 locks the table to the server and keeps the bucket private', () => {
  const s = src('supabase/migrations/212_investment_proof_files.sql')
  assert.ok(/ENABLE ROW LEVEL SECURITY/.test(s))
  assert.ok(/REVOKE ALL ON investment_proof_files FROM anon, authenticated/.test(s))
  assert.ok(/GRANT ALL ON investment_proof_files TO service_role/.test(s))
  assert.ok(/'investment-proofs', 'investment-proofs', false, 10485760/.test(s), 'private bucket, 10 MB')
})
