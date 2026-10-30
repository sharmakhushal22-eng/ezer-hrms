// src/features/esign/DocumentsToSignScreen.tsx — Profile → Documents to sign
// (components/esign/MyDocumentsToSign.tsx, EmployeePortal view 'to-sign').
//
// Everything sent to this employee through EZER Sign: what waits for them now, what is
// queued behind someone else, and what they have signed. "Review & sign" asks the server for
// a fresh link and opens the website's signing page in an in-app browser tab, exactly as the
// website opens it in a new tab. That page does the e-mail OTP, shows the PDF with the
// "Sign here" boxes, takes the drawn/typed/uploaded signature and the consent line.
//
// Why not a native signing screen: the app has no PDF renderer (no WebView / pdf.js /
// react-native-pdf installed) and the server only accepts the signature as a PNG data URL,
// which the app cannot rasterise without a new native module (view-shot / Skia). Reusing the
// page also keeps one audited signing flow (OTP, consent, certificate) instead of two.
import * as React from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Badge, Button, Card, Notice, Segmented, Txt } from '@/ui/primitives'
import { IconAlert, IconCheck, IconClock } from '@/ui/icons'
import { Screen } from '@/ui/Screen'
import { sectionOf } from '@/core/nav'
import { invalidate } from '@/core/query'
import { ApiError } from '@/core/api'
import { categoryLabel, day, isMine, isQueued, isSigned, requestSigningUrl, rowStatus, useMyDocuments, type SignItem } from './api'

/** components/esign/ui.tsx IconPen — the quill used for "sign" actions. */
function IconPen({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M13.6 3.4a1.9 1.9 0 0 1 2.7 2.7L7.2 15.2l-3.6.9.9-3.6 9.1-9.1Z" /><Path d="M12.3 4.7l2.9 2.9" /><Path d="M3 18.2h14" />
    </Svg>
  )
}

/** The Profile section's sub-tabs, with this view selected. */
function ProfileTabs() {
  const s = sectionOf('profile')
  const items = (s?.items || []).map(i => ({ key: i.k, label: i.label }))
  if (!items.some(i => i.key === 'to-sign')) items.push({ key: 'to-sign', label: 'Documents to sign' })
  const ref = React.useRef<ScrollView>(null)
  // This tab is last in the row: keep it in view on a narrow phone.
  return (
    <ScrollView ref={ref} onContentSizeChange={() => ref.current?.scrollToEnd({ animated: false })} horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: S.lg, paddingVertical: S.sm }}>
      <Segmented items={items} value="to-sign" onChange={k => {
        const to = s?.items.find(i => i.k === k)?.route
        if (k !== 'to-sign' && to) router.replace(to as any)
      }} />
    </ScrollView>
  )
}

function Row({ it, onOpen, busy }: { it: SignItem; onOpen: () => void; busy: boolean }) {
  const { C } = useTheme()
  const e = it.envelope
  const mine = isMine(it), queued = isQueued(it), signed = isSigned(it)
  const st = rowStatus(it)
  const fg = mine ? C.warning : signed ? C.positive : C.muted
  const meta = `${categoryLabel(e.category)} · from ${e.created_by_name || 'HR'} · ${day(e.created_at)} · ${e.envelope_no}`
    + (mine && e.expires_at ? ` · sign by ${day(e.expires_at)}` : '')
    + (signed ? ` · signed ${day(it.signed_at)}` : '')
  return (
    <View style={{ flexDirection: 'row', gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md + 2, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ width: 40, height: 40, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? C.warningTint : signed ? C.positiveTint : C.sunken }}>
        {signed ? <IconCheck size={18} color={fg} /> : mine ? <IconPen size={18} color={fg} /> : queued ? <IconClock size={18} color={fg} /> : <IconAlert size={18} color={fg} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt size={F.body} w={600}>{e.title}</Txt>
        <Txt size={F.tiny} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>{meta}</Txt>
        {(st || mine) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.sm, marginTop: S.sm }}>
            {st && <Badge label={st.label} tone={st.t} style={{ alignSelf: 'center' }} />}
            {mine && <Button title="Review & sign" size="sm" onPress={onOpen} disabled={busy} loading={busy} icon={<IconPen size={14} color={C.onAccent} />} />}
          </View>
        )}
      </View>
    </View>
  )
}

function Group({ title, rows, empty, loading, busy, onOpen }: { title: string; rows: SignItem[]; empty: string; loading: boolean; busy: boolean; onOpen: (id: string) => void }) {
  const { C } = useTheme()
  return (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      <Txt size={F.body} w={700} style={{ paddingHorizontal: S.lg, paddingVertical: S.md }}>{title}</Txt>
      {loading ? <Txt size={F.small} tone="muted" style={{ padding: S.lg, borderTopWidth: 1, borderTopColor: C.line }}>Loading…</Txt>
        : rows.length ? rows.map(it => <Row key={it.signer_id} it={it} busy={busy} onOpen={() => onOpen(it.signer_id)} />)
        : <Txt size={F.small} tone="faint" style={{ padding: S.lg, borderTopWidth: 1, borderTopColor: C.line }}>{empty}</Txt>}
    </Card>
  )
}

export default function DocumentsToSignScreen() {
  const { C } = useTheme()
  const s = sectionOf('profile')
  const q = useMyDocuments()
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')

  const open = async (id: string) => {
    setBusy(true); setErr('')
    try {
      const url = await requestSigningUrl(id)
      await WebBrowser.openBrowserAsync(url)
      // Back from the signing tab: the status may have moved (viewed / signed / declined).
      invalidate('esign')
    } catch (e) { setErr(e instanceof ApiError || e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const list = q.data || []
  const todo = list.filter(isMine)
  const rest = list.filter(i => !todo.includes(i))
  const loadErr = q.error ? (q.error as Error).message : ''

  return (
    <Screen title={s?.label || 'Profile'} subtitle={s?.desc} sub={<ProfileTabs />} onRefresh={() => q.refetch()}>
      <View style={{ gap: S.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <View style={{ width: 38, height: 38, borderRadius: R.md, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' }}><IconPen size={18} color={C.brand} /></View>
          <View style={{ flex: 1 }}>
            <Txt size={17} w={700}>Documents to sign</Txt>
            <Txt size={F.small} tone="muted">Letters, policies and agreements HR has sent you for e-signature.</Txt>
          </View>
        </View>
        {!!(err || loadErr) && <Notice tone="critical">{err || loadErr}</Notice>}
        <Group title={`Waiting for you${todo.length ? ` · ${todo.length}` : ''}`} rows={todo} empty="Nothing to sign right now." loading={q.isLoading} busy={busy} onOpen={open} />
        <Group title="Everything else" rows={rest} empty="No signed or queued documents yet." loading={q.isLoading} busy={busy} onOpen={open} />
      </View>
    </Screen>
  )
}
