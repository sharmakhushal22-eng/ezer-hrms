// One bill in the Flexi Claims uploader, its file thumbnails, and the claim-history
// sheet — FlexiClaims.tsx BillFrame / FileThumb / HistoryDrawer (lines 30–182).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Input, Txt } from '@/ui/primitives'
import { Sheet, useOverlay } from '@/ui/overlays'
import type { PickedFile } from '@/core/api'
import { groupIN } from '../tax'
import { DateField, SelectField } from '../ui'
import { ACCEPTED_MIME, type HistItem } from './data'

export const inr = (n: number) => '₹' + groupIN(Math.round(Number(n) || 0))
const uid = () => Math.random().toString(36).slice(2, 9)
const today = () => new Date().toISOString().slice(0, 10)

export interface Frame { id: string; code: string; amount: string; billNo: string; billDate: string; vendor: string; files: PickedFile[] }
export const blankFrame = (code = ''): Frame => ({ id: uid(), code, amount: '', billNo: '', billDate: '', vendor: '', files: [] })

const fmtD = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

function HistCard({ cl }: { cl: HistItem }) {
  const { C } = useTheme()
  const HIST: Record<string, [string, string]> = {
    PENDING: [C.warningTint, C.warning], APPROVED: [C.positiveTint, C.positive], REJECTED: [C.criticalTint, C.critical], PAYROLL_PROCESSED: [C.brandTint, C.brandDeep],
  }
  const [bg, fg] = HIST[cl.status] || [C.brandTint, C.brandDeep]
  return (
    <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: fg, borderRadius: 10, padding: S.md, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Txt size={15} w={700}>{inr(cl.claim_amount)}</Txt>
        <View style={{ paddingHorizontal: 9, paddingVertical: 2, borderRadius: 99, backgroundColor: bg }}><Txt size={10} w={600} color={fg}>{String(cl.status || '').replace(/_/g, ' ')}</Txt></View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 3 }}>
        {!!cl.bill_date && <Txt size={11} tone="muted">📅 {fmtD(cl.bill_date)}</Txt>}
        {!!cl.bill_no && <Txt size={11} tone="muted">🧾 {cl.bill_no}</Txt>}
        {!!(cl.agency_name || cl.vendor_desc) && <Txt size={11} tone="muted">🏪 {cl.agency_name || cl.vendor_desc}</Txt>}
      </View>
      {!!cl.remark && <Txt size={11} tone="muted" style={{ marginTop: 4, fontStyle: 'italic' }}>“{cl.remark}”</Txt>}
      {cl.status === 'REJECTED' && !!cl.rejection_reason && (
        <View style={{ marginTop: 6, paddingVertical: 5, paddingHorizontal: 8, backgroundColor: C.criticalTint, borderRadius: 7 }}><Txt size={11} color={C.critical}>⚠ {cl.rejection_reason}</Txt></View>
      )}
      <Txt size={10} tone="faint" style={{ marginTop: 5 }}>Submitted {fmtD(cl.submitted_at)}</Txt>
    </View>
  )
}

export function HistorySheet({ label, items, visible, onClose }: { label: string; items: HistItem[]; visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={`${label}: Claim history`} full>
      {items.length === 0
        ? <Txt tone="muted" center style={{ paddingVertical: 40 }}>No claims submitted yet</Txt>
        : items.map(cl => <HistCard key={cl.id} cl={cl} />)}
    </Sheet>
  )
}

function FileThumb({ file, onRemove }: { file: PickedFile; onRemove: () => void }) {
  const { C } = useTheme()
  const EXT_COL: Record<string, string> = { PDF: C.critical, JPG: C.warning, JPEG: C.warning, PNG: C.positive, ZIP: C.brand, DOC: C.info, DOCX: C.info, XLS: C.positive, XLSX: C.positive }
  const ext = file.name.split('.').pop()?.toUpperCase() || '?'
  const isImg = (file.type || '').startsWith('image/')
  return (
    <View style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: C.sunken }} accessibilityLabel={file.name}>
      {isImg ? <Image source={{ uri: file.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 4 }}>
          <Txt size={11} w={800} color={EXT_COL[ext] || C.muted}>{ext}</Txt>
          <Txt size={8} tone="muted" numberOfLines={1}>{file.name}</Txt>
        </View>
      )}
      <Pressable onPress={onRemove} accessibilityLabel="Remove" hitSlop={10}
        style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: C.scrim, alignItems: 'center', justifyContent: 'center' }}>
        <Txt size={12} w={700} color={C.onDark}>×</Txt>
      </Pressable>
    </View>
  )
}

/** Choose photos (camera / gallery) or files — the website's single <input type=file multiple>. */
function usePickFiles(onFiles: (f: PickedFile[]) => void) {
  const { notify } = useOverlay()
  const [open, setOpen] = React.useState(false)
  const fromAssets = (as: { uri: string; fileName?: string | null; name?: string; mimeType?: string | null; fileSize?: number | null; size?: number | null }[]) =>
    as.map((a, i) => ({ uri: a.uri, name: a.name || a.fileName || `photo_${Date.now()}_${i}.jpg`, type: a.mimeType || 'image/jpeg', size: a.size ?? a.fileSize ?? null }))
  const run = async (how: 'camera' | 'photos' | 'files') => {
    setOpen(false)
    try {
      if (how === 'files') {
        const r = await DocumentPicker.getDocumentAsync({ type: ACCEPTED_MIME, multiple: true, copyToCacheDirectory: true })
        if (!r.canceled) onFiles(r.assets.map(a => ({ uri: a.uri, name: a.name, type: a.mimeType || 'application/octet-stream', size: a.size ?? null })))
        return
      }
      if (how === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync()
        if (!p.granted) { notify('Camera permission is needed to photograph a bill.', 'error'); return }
        const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        if (!r.canceled) onFiles(fromAssets(r.assets))
        return
      }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.8 })
      if (!r.canceled) onFiles(fromAssets(r.assets))
    } catch (e: any) { notify(e?.message || 'Could not open the picker.', 'error') }
  }
  return { open, setOpen, run }
}

type How = 'camera' | 'photos' | 'files'
function PickItem({ label, h, run }: { label: string; h: How; run: (h: How) => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={() => run(h)} style={({ pressed }) => ({ paddingVertical: 15, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
      <Txt size={15} w={500}>{label}</Txt>
    </Pressable>
  )
}

function PickSheet({ visible, onClose, run }: { visible: boolean; onClose: () => void; run: (h: How) => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Upload bills">
      <PickItem label="Take a photo" h="camera" run={run} />
      <PickItem label="Choose photos" h="photos" run={run} />
      <PickItem label="Choose files (PDF, Word, Excel, ZIP…)" h="files" run={run} />
    </Sheet>
  )
}

export function BillFrame({ frame, index, options, remaining, canRemove, onChange, onFiles, onRemoveFile, onRemove }: {
  frame: Frame; index: number; options: { code: string; name: string; remaining: number }[]; remaining: number; canRemove: boolean
  onChange: (patch: Partial<Frame>) => void; onFiles: (f: PickedFile[]) => void; onRemoveFile: (i: number) => void; onRemove: () => void
}) {
  const { C } = useTheme()
  const pick = usePickFiles(onFiles)
  const over = frame.amount !== '' && remaining >= 0 && Number(frame.amount) > remaining
  const has = frame.files.length > 0
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: S.lg, backgroundColor: C.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' }}><Txt size={11} w={800} color={C.brandDeep}>{index + 1}</Txt></View>
        <Txt size={12} w={700}>Bill {index + 1}</Txt>
        <View style={{ flex: 1 }} />
        {!!frame.code && remaining >= 0 && <Txt size={10} tone="muted">Remaining limit <Txt size={10} w={700}>{inr(remaining)}</Txt></Txt>}
        {canRemove && (
          <Pressable onPress={onRemove} accessibilityLabel="Remove this bill" hitSlop={8}
            style={{ width: 30, height: 30, borderRadius: 7, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginLeft: S.sm }}>
            <Txt size={15} color={C.critical}>×</Txt>
          </Pressable>
        )}
      </View>

      <SelectField label="Bill type" value={frame.code} onChange={v => onChange({ code: String(v) })}
        options={[{ value: '', label: 'Select a bill type…' }, ...options.map(o => ({ value: o.code, label: o.name }))]} />
      <Input label="Amount (₹)" value={frame.amount} onChangeText={v => onChange({ amount: v })} keyboardType="numeric" placeholder="0"
        error={over ? `⚠ Exceeds the remaining limit (${inr(remaining)})` : null} />

      <Pressable onPress={() => pick.setOpen(true)} accessibilityRole="button"
        style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: has ? C.brand : C.line, borderRadius: 12, padding: has ? S.md : 20, backgroundColor: has ? C.brandTint : C.sunken }}>
        {!has ? (
          <View style={{ alignItems: 'center' }}>
            <Txt size={22} style={{ marginBottom: 4 }}>📎</Txt>
            <Txt size={12.5} w={600} color={C.brandDeep} center>Upload bills: tap to choose photos or files</Txt>
            <Txt size={10.5} tone="muted" center style={{ marginTop: 2 }}>Multiple allowed · JPG PNG PDF WORD EXCEL ZIP</Txt>
          </View>
        ) : (
          <View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {frame.files.map((f, i) => <FileThumb key={i} file={f} onRemove={() => onRemoveFile(i)} />)}
              <Pressable onPress={() => pick.setOpen(true)} accessibilityLabel="Add more files"
                style={{ width: 64, height: 64, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Txt size={22} color={C.brand}>+</Txt>
              </Pressable>
            </View>
            <Txt size={10.5} w={600} color={C.brandDeep} style={{ marginTop: S.sm }}>{frame.files.length} file{frame.files.length > 1 ? 's' : ''} attached</Txt>
          </View>
        )}
      </Pressable>

      <View style={{ marginTop: S.md }}>
        <Input label="Bill no. (optional)" value={frame.billNo} onChangeText={v => onChange({ billNo: v })} placeholder="INV-2026-001" autoCapitalize="characters" />
        <DateField label="Bill date" value={frame.billDate} onChange={v => onChange({ billDate: v })} max={today()} placeholder="dd-mm-yyyy" />
        <Input label="Vendor" value={frame.vendor} onChangeText={v => onChange({ vendor: v })} placeholder="HPCL, Airtel…" style={{ marginBottom: 0 }} />
      </View>
      <PickSheet visible={pick.open} onClose={() => pick.setOpen(false)} run={pick.run} />
    </View>
  )
}
