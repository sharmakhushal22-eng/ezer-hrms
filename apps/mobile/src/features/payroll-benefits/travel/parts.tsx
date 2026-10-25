// Travel Claims sub-components — components/ess/TravelClaims.tsx Banner,
// JourneyPanel, LogRow and ClaimRow, plus the two pickers a phone needs in place
// of <select>/<optgroup> and <input type="file">. All at module level.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import type { PickedFile } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import type { Palette } from '@/ui/theme'
import { F, R, S } from '@/ui/theme'
import { Button, Checkbox, Eyebrow, ListRow, Txt } from '@/ui/primitives'
import { Sheet } from '@/ui/overlays'
import { IconCheck, IconClose } from '@/ui/icons'
import { dmy, inr, kb } from '../shared'
import { Pill } from '../ui'
import { CATEGORY_LABEL, CATEGORY_ORDER, num, type Bill, type Claim, type ExpenseType, type TravelLog } from './data'
import type { Journey } from './useJourneyRecorder'

export type BannerTone = 'ok' | 'warn' | 'err'
export function Banner({ tone, children }: { tone: BannerTone; children: React.ReactNode }) {
  const { C } = useTheme()
  const [bg, fg, edge] = tone === 'ok' ? [C.positiveTint, C.positive, C.positiveEdge] : tone === 'warn' ? [C.warningTint, C.warning, C.warningEdge] : [C.criticalTint, C.critical, C.criticalEdge]
  return (
    <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: edge, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 13, marginBottom: 12 }}>
      {typeof children === 'string' ? <Txt size={F.tiny} color={fg} style={{ lineHeight: 18 }}>{children}</Txt> : children}
    </View>
  )
}

// ── Journey recorder panel ──────────────────────────────────────────────────
export function JourneyPanel({ journey, liveKm, rate, onStart, onEnd, onReset, typeName }: {
  journey: Journey; liveKm: number; rate: number | null; onStart: () => void; onEnd: () => void; onReset: () => void; typeName: string
}) {
  const { C } = useTheme()
  const tracking = journey.state === 'TRACKING'
  const recorded = journey.state === 'RECORDED'
  const amount = rate != null ? liveKm * rate : null
  return (
    <View style={{ borderWidth: 1, borderColor: tracking ? C.brand : C.line, borderRadius: R.md, paddingVertical: 14, paddingHorizontal: S.lg, marginBottom: 12, backgroundColor: tracking ? C.brandTint : C.sunken }}>
      <Txt size={F.tiny} tone="muted" style={{ marginBottom: 10, lineHeight: 18 }}>
        <Txt size={F.tiny} w={700}>{typeName}</Txt> has no bill to attach, so the journey is recorded and paid on distance. Start before you set off and end when you arrive, and keep this screen open while you travel.
      </Txt>
      {!!journey.error && <Banner tone={journey.state === 'IDLE' ? 'err' : 'warn'}>{journey.error}</Banner>}
      {(tracking || recorded) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 20, paddingTop: 10, paddingBottom: 12 }}>
          <View>
            <Txt size={26} w={700}>{liveKm.toFixed(2)} <Txt size={F.body} tone="muted">km</Txt></Txt>
            <Txt size={F.micro} tone="muted" style={{ marginTop: 3 }}>
              {journey.points.length} location {journey.points.length === 1 ? 'point' : 'points'}{journey.accuracy != null ? ` · ±${Math.round(journey.accuracy)} m` : ''}
            </Txt>
          </View>
          {amount != null && (
            <View>
              <Txt size={20} w={700} color={C.positive}>{inr(amount)}</Txt>
              <Txt size={F.micro} tone="muted" style={{ marginTop: 3 }}>at {inr(rate!)}/km</Txt>
            </View>
          )}
          {tracking && <Txt size={F.micro} w={600} color={C.brandDeep}>Recording</Txt>}
        </View>
      )}
      {journey.state === 'IDLE' && <Button title="Start travel" full onPress={onStart} />}
      {tracking && <Button title="End travel" variant="positive" full onPress={onEnd} />}
      {recorded && (
        <View style={{ gap: S.sm }}>
          <Txt size={F.tiny} w={600} color={C.positive}>Journey recorded. Add the details below and save.</Txt>
          <Button title="Discard" variant="outline" size="sm" onPress={onReset} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}
    </View>
  )
}

// ── One unclaimed expense ───────────────────────────────────────────────────
function XButton({ label, onPress, disabled, size = 17 }: { label: string; onPress: () => void; disabled?: boolean; size?: number }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
      <IconClose size={size - 3} color={C.muted} />
    </Pressable>
  )
}

export function LogRow({ log, typeName, checked, onToggle, onDelete, needsBill, bills, billsLoaded, busy, onAttach, onRemoveBill }: {
  log: TravelLog; typeName: string; checked: boolean; onToggle: () => void; onDelete: () => void
  needsBill: number | false; bills: Bill[]; billsLoaded: boolean; busy: boolean
  onAttach: () => void; onRemoveBill: (id: string) => void
}) {
  const { C } = useTheme()
  const gps = log.distance_source === 'GPS_TRACKED' || log.distance_source === 'GPS_SNAPPED'
  return (
    <View style={{ borderWidth: 1, borderColor: checked ? C.brand : C.line, borderRadius: R.md, backgroundColor: checked ? C.brandTint : C.surface, marginBottom: 7, paddingVertical: 6, paddingLeft: 8, paddingRight: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Checkbox checked={checked} onChange={onToggle} />
        <Pressable onPress={onToggle} style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={600} numberOfLines={1}>{log.purpose}</Txt>
          <Txt size={F.micro} tone="muted" style={{ marginTop: 2 }}>
            {typeName} · {dmy(log.log_date)}{log.city ? ` · ${log.city}` : ''}{log.distance_claimed ? ` · ${log.distance_claimed} km` : ''}
            {gps ? <Txt size={F.micro} color={C.brandDeep}> · 📍 recorded</Txt> : null}
            {log.rate_applied ? ` @ ${inr(log.rate_applied)}/km` : ''}
          </Txt>
        </Pressable>
        <Txt size={F.body} w={700}>{inr(log.total_amount)}</Txt>
        <XButton label="Remove this entry" onPress={onDelete} />
      </View>

      {/* A recorded journey is its own proof; a billed one needs the slip. */}
      {!gps && (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingLeft: 36, paddingBottom: 4 }}>
          {bills.map(b => (
            <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.positiveTint, borderWidth: 1, borderColor: C.positiveEdge, borderRadius: 99, paddingLeft: 9 }}>
              <Txt size={F.micro} color={C.positive} style={b.url ? { textDecorationLine: 'underline' } : undefined}
                onPress={b.url ? () => void WebBrowser.openBrowserAsync(b.url!) : undefined} numberOfLines={1}>{b.file_name || 'bill'}</Txt>
              <Txt size={F.micro} tone="muted">{kb(b.file_size)}</Txt>
              <XButton label="Remove this bill" onPress={() => onRemoveBill(b.id)} disabled={busy} size={14} />
            </View>
          ))}
          <Pressable onPress={busy ? undefined : onAttach} hitSlop={6} style={{ minHeight: 36, justifyContent: 'center' }}>
            <Txt size={F.micro} w={600} color={busy ? C.muted : C.brandDeep}>{busy ? 'Uploading…' : bills.length ? '+ another bill' : 'Attach bill slip'}</Txt>
          </Pressable>
          {billsLoaded && bills.length === 0 && needsBill !== false && (
            <Txt size={F.micro} color={C.warning}>Needs a slip: {typeName} above {inr(needsBill)} must show a bill</Txt>
          )}
        </View>
      )}
    </View>
  )
}

// ── One submitted claim ─────────────────────────────────────────────────────
export function claimStatus(C: Palette, s: string): [string, string, string] {
  const map: Record<string, [string, string, string]> = {
    DRAFT: [C.brandTint, C.brandDeep, 'Draft'],
    SUBMITTED: [C.warningTint, C.warning, 'Submitted'],
    PENDING_RM: [C.warningTint, C.warning, 'With your manager'],
    PENDING_HR: [C.warningTint, C.warning, 'With HR Head'],
    PENDING_FINANCE: [C.brandTint, C.brandDeep, 'With Finance'],
    APPROVED: [C.positiveTint, C.positive, 'Approved'],
    SENT_BACK: [C.criticalTint, C.critical, 'Sent back to you'],
    REJECTED: [C.criticalTint, C.critical, 'Rejected'],
    PAID: [C.positiveTint, C.positive, 'Paid'],
  }
  return map[s] ?? [C.brandTint, C.brandDeep, s]
}

export function ClaimRow({ claim }: { claim: Claim }) {
  const { C } = useTheme()
  const [bg, fg, text] = claimStatus(C, claim.status)
  const settled = claim.status === 'PAID' || claim.status === 'APPROVED'
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: fg, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <Txt size={F.small} w={700}>{claim.claim_no}</Txt>
        <Pill bg={bg} fg={fg} text={text} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 2 }}>
        <Txt size={F.tiny} tone="muted">{claim.line_count} {claim.line_count === 1 ? 'expense' : 'expenses'}</Txt>
        <Txt size={F.tiny} tone="muted">{dmy(claim.period_from)} – {dmy(claim.period_to)}</Txt>
        <Txt size={F.tiny} tone="muted">Claimed <Txt size={F.tiny} w={700}>{inr(claim.total_claimed)}</Txt></Txt>
        {settled && <Txt size={F.tiny} tone="muted">Approved <Txt size={F.tiny} w={700} color={C.positive}>{inr(claim.total_approved)}</Txt></Txt>}
        {claim.flag_count > 0 && <Txt size={F.tiny} color={C.warning}>⚑ {claim.flag_count} to review</Txt>}
      </View>
      {settled && num(claim.total_approved) < num(claim.total_claimed) && (
        <Txt size={F.micro} color={C.warning} style={{ marginTop: 6 }}>{inr(num(claim.total_claimed) - num(claim.total_approved))} was not approved. Open the claim with Finance if you need the reason.</Txt>
      )}
    </View>
  )
}

// ── Expense type picker, grouped like the website's <optgroup>s ─────────────
export function TypeSheet({ visible, onClose, types, value, onPick }: { visible: boolean; onClose: () => void; types: ExpenseType[]; value: string; onPick: (code: string) => void }) {
  const { C } = useTheme()
  const grouped = CATEGORY_ORDER.map(cat => ({ cat, items: types.filter(t => (t.category ?? 'OTHER') === cat) })).filter(g => g.items.length > 0)
  return (
    <Sheet visible={visible} onClose={onClose} title="Expense type">
      {types.length === 0 && <Txt tone="muted" style={{ padding: S.md }}>No expense types configured</Txt>}
      {grouped.map(g => (
        <View key={g.cat} style={{ marginTop: S.md }}>
          <Eyebrow>{CATEGORY_LABEL[g.cat] ?? g.cat}</Eyebrow>
          {g.items.map(t => {
            const on = t.type_code === value
            return (
              <Pressable key={t.type_code} onPress={() => { onPick(t.type_code); onClose() }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
                <Txt size={F.body} w={on ? 600 : 400} color={on ? C.brandDeep : C.ink} style={{ flex: 1 }}>{t.type_name}{t.requires_gps ? ' (recorded)' : ''}</Txt>
                {on && <IconCheck size={16} color={C.brand} />}
              </Pressable>
            )
          })}
        </View>
      ))}
    </Sheet>
  )
}

// ── Bill picker: camera, gallery, or a PDF (the website's accept="image/*,application/pdf") ──
const extOf = (mime: string) => mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime.includes('hei') ? 'heic' : 'jpg'
function fromImage(a: ImagePicker.ImagePickerAsset): PickedFile {
  const type = a.mimeType || 'image/jpeg'
  return { uri: a.uri, name: a.fileName || `bill_${Date.now()}.${extOf(type)}`, type, size: a.fileSize ?? null }
}

export function BillSourceSheet({ visible, onClose, onPicked, onError }: { visible: boolean; onClose: () => void; onPicked: (f: PickedFile) => void; onError: (msg: string) => void }) {
  const { C } = useTheme()
  const camera = async () => {
    onClose()
    const p = await ImagePicker.requestCameraPermissionsAsync().catch(() => null)
    if (!p?.granted) { onError('Camera permission is blocked. Allow the camera for this app, or choose a photo instead.'); return }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 }).catch(() => null)
    if (r && !r.canceled && r.assets?.[0]) onPicked(fromImage(r.assets[0]))
  }
  const gallery = async () => {
    onClose()
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 }).catch(() => null)
    if (r && !r.canceled && r.assets?.[0]) onPicked(fromImage(r.assets[0]))
  }
  const pdf = async () => {
    onClose()
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: false, copyToCacheDirectory: true }).catch(() => null)
    const a = r && !r.canceled ? r.assets?.[0] : null
    if (a) onPicked({ uri: a.uri, name: a.name, type: a.mimeType || 'application/pdf', size: a.size ?? null })
  }
  return (
    <Sheet visible={visible} onClose={onClose} title="Bill slip">
      <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.sm }}>A photo or the PDF the app emails you. Up to 10 MB.</Txt>
      {[['Take a photo of the bill', camera], ['Choose a photo', gallery], ['Choose a PDF or file', pdf]].map(([label, fn], i) => (
        <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
          <ListRow title={label as string} onPress={fn as () => void} />
        </View>
      ))}
    </Sheet>
  )
}
