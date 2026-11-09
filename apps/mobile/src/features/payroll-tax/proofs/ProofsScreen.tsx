// Payroll › Investment Proofs — components/ess/InvestmentProofs.tsx on the phone.
//
// Prove each declared (Old-regime) line with an amount, a reference and documents
// (receipts, policy statements, rent receipts); HR approves or rejects against the
// documents. Reads, the open-window RPC and the update are the website's, verbatim;
// documents go through /api/ess/investment-proofs (private bucket, signed URLs), as on
// the website. A rejected line goes back to HR on its own when a fresh document arrives.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import * as WebBrowser from 'expo-web-browser'
import { supabase } from '@/core/supabase'
import { ApiError, api, appendFile, type PickedFile } from '@/core/api'
import { useEmployeeId } from '@/core/session'
import { queryClient } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Button, Card, ErrorState, Input, Loading, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { useOverlay } from '@/ui/overlays'
import { FilePickButton } from '@/features/expenses/ui/FilePick'
import { groupIN } from '../tax'
import { B, Box, Pill } from '../ui'

const FY = '2026-27'
const inr = (n: any) => '₹' + groupIN(Math.round(Number(n) || 0))
const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0)
const fmtDate = (d: any) => {
  if (!d) return '-'
  const x = new Date(d)
  return `${String(x.getDate()).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getMonth()]} ${x.getFullYear()}`
}

interface Proof {
  id: string; section: string; declared_item: string
  declared_amount: number; submitted_amount: number
  proof_reference: string | null; status: string; rejection_reason: string | null; deadline: string | null
}

export interface ProofFile {
  id: string; proof_id: string; file_name: string; mime_type: string | null; size_bytes: number | null
  uploaded_at: string; url: string | null
}

const fmtSize = (b: number | null | undefined) => {
  const n = Number(b) || 0
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/** The documents on every line, with 30-minute signed URLs. A failure leaves the list empty
 *  rather than failing the page, as the website does. */
async function loadProofFiles(employeeId: string): Promise<ProofFile[]> {
  try {
    const j = await api<{ files?: ProofFile[] }>('/api/ess/investment-proofs', { query: { employee_id: employeeId, fy: FY } })
    return j?.files || []
  } catch { return [] }
}

async function loadProofs(employeeId: string) {
  const { data: emp } = await supabase.from('employees')
    .select('date_of_leaving, last_working_date, relieving_date').eq('id', employeeId).maybeSingle()
  const leaving: string | null = (emp as any)?.date_of_leaving || (emp as any)?.last_working_date || (emp as any)?.relieving_date || null
  const { data: d } = await supabase.from('tds_declarations')
    .select('regime').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
  const { data, error } = await supabase.from('investment_proofs')
    .select('*').eq('employee_id', employeeId).eq('fy', FY).order('section')
  if (error) throw new Error(error.message)
  const files = await loadProofFiles(employeeId)
  return { leaving, hasDecl: !!d, regime: ((d as any)?.regime || '') as string, rows: (data || []) as any as Proof[], files }
}

const TONE = (C: any): Record<string, { bg: string; fg: string; label: string }> => ({
  PENDING: { bg: C.sunken, fg: C.muted, label: 'Proof pending' },
  SUBMITTED: { bg: C.warningTint, fg: C.warning, label: 'Under review' },
  APPROVED: { bg: C.positiveTint, fg: C.positive, label: 'Approved' },
  REJECTED: { bg: C.criticalTint, fg: C.critical, label: 'Rejected' },
})

/** The documents on one line: what is there, a way to add more, and View / Remove. */
function ProofDocuments({ files, locked, onUpload, onRemove, uploading }: {
  files: ProofFile[]; locked: boolean; onUpload: (f: PickedFile) => void; onRemove: (f: ProofFile) => void; uploading: boolean
}) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const open = (f: ProofFile) => {
    if (!f.url) return notify('This document cannot be opened right now. Pull down to refresh and try again.', 'error')
    void WebBrowser.openBrowserAsync(f.url)
  }
  return (
    <View style={{ marginTop: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginBottom: files.length || !locked ? S.sm : 0 }}>
        <Txt size={11} w={700} tone="muted" upper>Documents</Txt>
        <Txt size={12} tone="muted">{files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'none yet'}</Txt>
      </View>
      {files.map(f => (
        <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line, marginBottom: 6 }}>
          <Txt size={16}>{f.mime_type === 'application/pdf' ? '📄' : '🖼️'}</Txt>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={13} w={600}>{f.file_name}</Txt>
            <Txt size={11} tone="muted">{fmtSize(f.size_bytes)} · {fmtDate(f.uploaded_at)}</Txt>
          </View>
          <Pressable onPress={() => open(f)} accessibilityRole="link" accessibilityLabel={`View ${f.file_name}`} hitSlop={8}
            style={({ pressed }) => ({ paddingHorizontal: 10, minHeight: 36, justifyContent: 'center', borderRadius: 8, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
            <Txt size={12.5} w={700} color={C.brandDeep}>View</Txt>
          </Pressable>
          {!locked && (
            <Pressable onPress={() => onRemove(f)} accessibilityRole="button" accessibilityLabel={`Remove ${f.file_name}`} hitSlop={8}
              style={({ pressed }) => ({ paddingHorizontal: 10, minHeight: 36, justifyContent: 'center', borderRadius: 8, backgroundColor: pressed ? C.criticalTint : 'transparent' })}>
              <Txt size={12.5} w={700} color={C.critical}>Remove</Txt>
            </Pressable>
          )}
        </View>
      ))}
      {!locked && (
        <FilePickButton title={uploading ? 'Uploading…' : '＋ Upload document'} sheetTitle="Add a document" size="sm"
          loading={uploading} disabled={uploading} onPicked={onUpload} />
      )}
      {!locked && files.length === 0 && (
        <Txt size={11.5} tone="muted" style={{ marginTop: 6, lineHeight: 17 }}>PDF, JPG, PNG or WEBP, up to 10 MB each. Receipts, policy statements, rent receipts: whatever proves this line.</Txt>
      )}
    </View>
  )
}

function ProofRow({ p, files, draftAmt, draftRef, onAmt, onRef, onSave, onUpload, onRemove, busy, uploading }: {
  p: Proof; files: ProofFile[]; draftAmt: string; draftRef: string
  onAmt: (v: string) => void; onRef: (v: string) => void; onSave: () => void
  onUpload: (f: PickedFile) => void; onRemove: (f: ProofFile) => void; busy: boolean; uploading: boolean
}) {
  const { C } = useTheme()
  const tones = TONE(C)
  const t = tones[p.status] || tones.PENDING
  const locked = p.status === 'APPROVED'
  const shortfall = Math.max(0, num(p.declared_amount) - num(draftAmt || p.submitted_amount))
  return (
    <Card style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: S.sm }}>
        <View style={{ backgroundColor: C.brandTint, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 }}><Txt size={11} w={800} color={C.brandDeep}>{p.section}</Txt></View>
        <Txt size={13} w={600} style={{ flex: 1, minWidth: 140 }}>{p.declared_item}</Txt>
        <Pill label={t.label} bg={t.bg} fg={t.fg} />
      </View>
      <Txt size={11} tone="muted">Declared</Txt>
      <Txt size={15} w={700} style={{ marginBottom: S.sm }}>{inr(p.declared_amount)}</Txt>
      <Input label="Proof amount" value={draftAmt} editable={!locked} keyboardType="number-pad"
        onChangeText={v => onAmt(v.replace(/[^0-9]/g, ''))} />
      <Input label="Bill / policy reference" value={draftRef} editable={!locked} placeholder="Policy no. / receipt no."
        onChangeText={onRef} autoCapitalize="none" style={{ marginBottom: 0 }} />
      <ProofDocuments files={files} locked={locked} onUpload={onUpload} onRemove={onRemove} uploading={uploading} />
      {!locked && shortfall > 0 && (
        <Txt size={11} color={C.warning} style={{ marginTop: S.sm }}>Proof for {inr(shortfall)} is still pending. That much will not stay exempt.</Txt>
      )}
      {p.status === 'REJECTED' && !!p.rejection_reason && (
        <Box bg={C.criticalTint} style={{ marginTop: S.sm }}><Txt size={12} color={C.critical}>Rejected: {p.rejection_reason}</Txt></Box>
      )}
      {!locked && (
        <Button title={p.status === 'PENDING' ? 'Submit proof' : 'Update proof'} onPress={onSave} disabled={busy} loading={busy} full style={{ marginTop: S.md }} />
      )}
      {!locked && files.length === 0 && (
        <Txt size={11.5} tone="muted" style={{ marginTop: 6, lineHeight: 17 }}>Attach the bill or receipt before submitting. HR approves against the document.</Txt>
      )}
    </Card>
  )
}

export default function ProofsScreen() {
  const { C } = useTheme()
  const employeeId = useEmployeeId()
  const q = useQuery({ queryKey: ['payroll-tax', 'proofs', employeeId], queryFn: () => loadProofs(employeeId), enabled: !!employeeId })
  const [draft, setDraft] = React.useState<Record<string, { amt: string; ref: string }>>({})
  const [busy, setBusy] = React.useState('')
  const [uploading, setUploading] = React.useState('')
  const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState('')
  // The website's inline ✓/error boxes sit at the end of the page; a phone user who
  // tapped a button further up would not see them, so they are also toasted.
  const { notify, confirm } = useOverlay()
  React.useEffect(() => { if (msg) notify(msg) }, [msg, notify])
  React.useEffect(() => { if (err) notify(err, 'error') }, [err, notify])

  // The draft boxes are reset from every fresh load, as the website's load() does.
  const [seen, setSeen] = React.useState<typeof q.data>(undefined)
  if (q.data && q.data !== seen) {
    setSeen(q.data)
    const dr: Record<string, { amt: string; ref: string }> = {}
    q.data.rows.forEach(p => { dr[p.id] = { amt: num(p.submitted_amount) ? String(num(p.submitted_amount)) : '', ref: p.proof_reference || '' } })
    setDraft(dr)
  }

  const reload = () => queryClient.invalidateQueries({ queryKey: ['payroll-tax', 'proofs', employeeId] })

  async function openWindow() {
    setErr(''); setMsg(''); setBusy('open')
    const { data, error } = await supabase.rpc('open_investment_proof_window', { p_employee_id: employeeId, p_fy: FY })
    setBusy('')
    if (error) { setErr(error.message); return }
    if (!Number(data)) { setErr('No declared line found. Fill in and submit the Investment Declaration first.'); return }
    setMsg(`Proof window opened for ${data} line${Number(data) === 1 ? '' : 's'}.`)
    void reload()
  }

  async function saveProof(p: Proof) {
    setErr(''); setMsg(''); setBusy(p.id)
    const d = draft[p.id] || { amt: '', ref: '' }
    const { error } = await supabase.from('investment_proofs').update({
      submitted_amount: num(d.amt), proof_reference: d.ref.trim() || null,
      status: 'SUBMITTED', rejection_reason: null, updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    setBusy('')
    if (error) { setErr(error.message); return }
    setMsg(`${p.section} proof submitted. HR will review it.`)
    void reload()
  }

  async function uploadFile(p: Proof, file: PickedFile) {
    setErr(''); setMsg(''); setUploading(p.id)
    try {
      const form = new FormData()
      form.append('proof_id', p.id)
      await appendFile(form, 'file', file)
      const j = await api<{ file: ProofFile; resubmitted?: boolean }>('/api/ess/investment-proofs', { method: 'POST', form })
      setMsg(j.resubmitted ? `${j.file?.file_name || file.name} attached to ${p.section}; the line has gone back to HR for review.` : `${j.file?.file_name || file.name} attached to ${p.section}.`)
      void reload()
    } catch (e) { setErr(errText(e, 'The document could not be uploaded. Check your connection and try again.')) }
    finally { setUploading('') }
  }

  async function removeFile(p: Proof, f: ProofFile) {
    const ok = await confirm({ title: 'Remove this document?', message: `Remove ${f.file_name} from ${p.section}?`, confirm: 'Remove', destructive: true })
    if (!ok) return
    setErr(''); setMsg('')
    try {
      await api('/api/ess/investment-proofs', { method: 'DELETE', query: { id: f.id } })
      void reload()
    } catch (e) { setErr(errText(e, 'The document could not be removed.')) }
  }

  const data = q.data
  const rows = data?.rows || []
  const files = data?.files || []
  const deadline = rows[0]?.deadline || null
  const overdue = deadline ? new Date(deadline) < new Date() : false
  const declared = rows.reduce((a, p) => a + num(p.declared_amount), 0)
  const proven = rows.filter(p => p.status === 'APPROVED').reduce((a, p) => a + num(p.submitted_amount), 0)

  return (
    <Screen title="Investment Proofs" subtitle="Payroll" onRefresh={() => q.refetch()}>
      {q.isLoading ? <Loading /> : q.error && !data ? (
        // The website shows the load error in its red box under an empty page.
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : data && (
        <View>
          <View style={{ marginBottom: S.md }}>
            <Txt size={20} w={800}>Investment Proofs</Txt>
            <Txt size={12} tone="muted" style={{ marginTop: 3 }}>FY {FY}: bills for what you declared</Txt>
          </View>

          {!!data.leaving && (
            <Box bg={C.warningTint} edge={C.warningEdge} style={{ padding: S.md, marginBottom: S.md }}>
              <Txt size={13} w={700} color={C.warning}>Your proof window is open now</Txt>
              <Txt size={12} color={C.warning} style={{ marginTop: 3, lineHeight: 18 }}>Your last working day is <B>{fmtDate(data.leaving)}</B>, so the deadline is not the end of the year, it is <B>that day</B>. Anything not proved by then will not stay exempt and will be taxed in the final settlement.</Txt>
            </Box>
          )}

          {!data.hasDecl ? (
            <Card><Txt size={13} tone="muted" style={{ lineHeight: 20 }}>No <B>Investment Declaration</B> found for this FY. Proofs are submitted against it. Fill in and submit the declaration first.</Txt></Card>
          ) : data.regime === 'NEW' ? (
            <Box bg={C.positiveTint} edge={C.positiveEdge} style={{ padding: S.xl - 4, borderRadius: 14 }}>
              <Txt size={13} color={C.positive} style={{ lineHeight: 20 }}>You are on the <B>New regime</B>: the 80C/80D/HRA exemptions do not apply, so no proof is needed.</Txt>
            </Box>
          ) : (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: S.md }}>
                {([['Declared', inr(declared), C.ink], ['Proven', inr(proven), C.positive], ['Not yet proven', inr(Math.max(0, declared - proven)), declared - proven > 0 ? C.warning : C.muted], ['Documents', String(files.length), C.ink]] as const).map(([l, v, col]) => (
                  <View key={l} style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 }}>
                    <Txt size={10} w={700} tone="muted" upper>{l}</Txt>
                    <Txt size={17} w={800} color={col}>{v}</Txt>
                  </View>
                ))}
                {!!deadline && (
                  <View style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: overdue ? C.criticalTint : C.sunken, borderWidth: 1, borderColor: overdue ? C.critical : C.line, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 }}>
                    <Txt size={10} w={700} tone="muted" upper>Deadline</Txt>
                    <Txt size={15} w={800} color={overdue ? C.critical : C.ink}>{fmtDate(deadline)}</Txt>
                  </View>
                )}
              </View>

              {rows.length === 0 ? (
                <Card>
                  <Txt size={13} tone="muted" style={{ lineHeight: 20, marginBottom: S.md }}>The proof window is not open yet. Use the button below to open a window for each line of your declaration.</Txt>
                  <Button full title={busy === 'open' ? 'Opening…' : 'Proof window kholein'} disabled={busy === 'open'} onPress={openWindow} />
                </Card>
              ) : rows.map(p => (
                <ProofRow key={p.id} p={p} files={files.filter(f => f.proof_id === p.id)}
                  draftAmt={draft[p.id]?.amt ?? ''} draftRef={draft[p.id]?.ref ?? ''}
                  onAmt={v => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], amt: v } }))}
                  onRef={v => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], ref: v } }))}
                  onSave={() => saveProof(p)} busy={busy === p.id}
                  onUpload={f => uploadFile(p, f)} onRemove={f => removeFile(p, f)} uploading={uploading === p.id} />
              ))}
            </>
          )}

          {!!msg && <Box bg={C.positiveTint} edge={C.positiveEdge} style={{ marginTop: S.md, padding: S.md }}><Txt size={13} w={700} color={C.positive}>✓ {msg}</Txt></Box>}
          {!!err && <Box bg={C.criticalTint} style={{ marginTop: S.md, padding: S.md }}><Txt size={12} color={C.critical}>{err}</Txt></Box>}
        </View>
      )}
    </Screen>
  )
}
