// The website's LoanAgreementPanel (components/ess/EmployeePortal.tsx ~2664):
// the repayment schedule of an approved loan request, a link to the printable
// agreement the server renders, and the e-sign / signed-PDF-URL submission.
import * as React from 'react'
import { Platform, ScrollView, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { openWebsite } from '@/core/links'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { QK, call, errMsg, inr } from './shared'
import { Box, Choice, SmallAction } from './ui'

/** The website's `"Segoe Script","Brush Script MT",cursive`, per platform. */
const SCRIPT_FONT = Platform.select({ android: 'cursive', ios: 'Snell Roundhand', default: '"Segoe Script","Brush Script MT",cursive' })
const COLS: { k: string; label: string; w: number; left?: boolean }[] = [
  { k: '#', label: '#', w: 40, left: true }, { k: 'due', label: 'Due', w: 100 }, { k: 'emi', label: 'EMI', w: 90 },
  { k: 'p', label: 'Principal', w: 100 }, { k: 'i', label: 'Interest', w: 90 }, { k: 'c', label: 'Closing', w: 100 },
]

function parseSchedule(s: unknown): any[] {
  if (Array.isArray(s)) return s
  if (typeof s === 'string') { try { return JSON.parse(s) } catch { return [] } }
  return []
}

function ScheduleTable({ rows }: { rows: any[] }) {
  const { C } = useTheme()
  const cell = (text: string | number, i: number, head?: boolean) => (
    <View key={i} style={{ width: COLS[i].w, paddingVertical: 6, paddingHorizontal: 8, alignItems: COLS[i].left ? 'flex-start' : 'flex-end' }}>
      {head
        ? <Txt size={10} w={600} tone="muted" upper numberOfLines={1}>{text}</Txt>
        : <Txt size={F.micro} numberOfLines={1}>{text}</Txt>}
    </View>
  )
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, overflow: 'hidden', marginBottom: 14 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ minWidth: 520 }}>
          <View style={{ flexDirection: 'row', backgroundColor: C.brandTint }}>{COLS.map((c, i) => cell(c.label, i, true))}</View>
          {rows.map((s, r) => (
            <View key={r} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line }}>
              {[s.installment_number, s.due_date || s.month || '-', inr(s.emi_amount), inr(s.principal_component), inr(s.interest_component), inr(s.closing_balance)].map((v, i) => cell(v, i))}
            </View>
          ))}
          {rows.length === 0 && (
            <View style={{ borderTopWidth: 1, borderTopColor: C.line, padding: 8, alignItems: 'center' }}>
              <Txt size={F.micro} tone="muted">No schedule rows.</Txt>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  )
}

export function LoanAgreementPanel({ requestId, employeeId, onClose, onDone }: { requestId: string; employeeId: string; onClose: () => void; onDone: () => void }) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const q = useQuery({
    queryKey: [QK, 'loan-agreement', requestId],
    // Any failure (404 "No agreement", a network error) reads as "no agreement yet", as on the website.
    queryFn: async () => { try { return (await call('/api/ess/loans/agreement', { query: { request_id: requestId } })).body?.agreement || null } catch { return null } },
  })
  const [mode, setMode] = React.useState<'ESIGN' | 'UPLOAD'>('ESIGN')
  const [esignName, setEsignName] = React.useState('')
  const [pdfUrl, setPdfUrl] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const agr = q.data

  const submit = async () => {
    if (!agr) return
    if (mode === 'ESIGN' && !esignName.trim()) { notify('Type your full name to e-sign', 'error'); return }
    if (mode === 'UPLOAD' && !pdfUrl.trim()) { notify('Paste the signed PDF URL', 'error'); return }
    setSaving(true)
    const body = mode === 'ESIGN'
      ? { agreement_id: agr.id, employee_id: employeeId, signature_type: 'ESIGN', esign_name: esignName.trim(), esign_image_url: 'data:text/plain,' + encodeURIComponent(esignName.trim()) }
      : { agreement_id: agr.id, employee_id: employeeId, signature_type: 'UPLOAD', signed_pdf_url: pdfUrl.trim() }
    try {
      const r = await call('/api/ess/loans/agreement', { method: 'POST', body })
      if (r.ok) { notify('Agreement submitted for review'); onDone() }
      else notify('Failed: ' + (r.body.error || ''), 'error')
    } catch (err) { notify('Failed: ' + errMsg(err), 'error') }
    finally { setSaving(false) }
  }

  if (q.isLoading) return <Box><Txt size={F.small} tone="muted">Loading agreement…</Txt></Box>
  if (!agr) return (
    <Box>
      <Txt size={F.small} tone="critical" style={{ marginBottom: 8 }}>No agreement found yet. Please check back shortly.</Txt>
      <View style={{ alignSelf: 'flex-start' }}><SmallAction title="Close" color={C.brandDeep} onPress={onClose} /></View>
    </Box>
  )
  const schedule = parseSchedule(agr.schedule_snapshot)

  return (
    <Box edge={C.brand}>
      <Txt size={F.body} w={600} style={{ marginBottom: 8 }}>Sign agreement: {agr.agreement_number}</Txt>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <SmallAction title="View / print" color={C.brandDeep} onPress={() => void openWebsite(`/api/ess/loans/agreement?request_id=${encodeURIComponent(requestId)}&format=html`)} />
        <SmallAction title="Close" color={C.brandDeep} onPress={onClose} />
      </View>
      <ScheduleTable rows={schedule} />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <Choice selected={mode === 'ESIGN'} label="E-sign" onPress={() => setMode('ESIGN')} />
        <Choice selected={mode === 'UPLOAD'} label="Upload signed PDF" onPress={() => setMode('UPLOAD')} />
      </View>
      {mode === 'ESIGN' ? (
        <View style={{ marginBottom: 12 }}>
          <Input label="Type your full legal name to sign" value={esignName} onChangeText={setEsignName} placeholder="e.g. Rahul Sharma" autoCapitalize="words" style={{ marginBottom: 0 }} />
          {!!esignName.trim() && (
            <View style={{ marginTop: 8, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: C.brand, borderRadius: R.md }}>
              <Txt size={22} color={C.brandDeep} style={{ fontFamily: SCRIPT_FONT }}>{esignName}</Txt>
            </View>
          )}
        </View>
      ) : (
        <Input label="URL of your signed agreement PDF" value={pdfUrl} onChangeText={setPdfUrl} placeholder="https://…/signed-agreement.pdf"
          autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      )}
      <Button full title={saving ? 'Submitting…' : 'Submit signed agreement'} disabled={saving} onPress={submit} />
      <View style={{ height: S.xs }} />
    </Box>
  )
}
