// src/features/profile/IdCard.tsx — components/profile/IdCard.tsx: the digital
// ID card with a live gate QR, plus the static card for someone else's profile
// and the printable-PDF entry (IdCardDownload.tsx).
//
// THE ROTATION IS THE POINT (website comment): a token lives 30 s and the card
// asks for a fresh one every 15 s, only while the QR side is showing. The web
// pauses while the tab is hidden and fetches the moment it is visible again;
// the phone does the same with AppState ('active').
import * as React from 'react'
import { AppState, Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Image } from 'expo-image'
import { openWebsite } from '@/core/links'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Txt } from '@/ui/primitives'
import { IconDownload } from '@/ui/icons'
import { fetchIdToken, type Issued } from './api'
import { ini } from './format'
import { QrSvg } from './QrSvg'

const prettyDoj = (v?: string | null) => {
  if (!v) return '-'
  const d = new Date(v)
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** The brand gradient card frame: linear-gradient(140deg, brandDeep, brand 60%, brandEdge). */
function Dig({ company, children }: { company: string; children: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <View style={{ borderRadius: R.card, overflow: 'hidden' }}>
      <LinearGradient colors={[C.brandDeep, C.brand, C.brandEdge]} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 0.85, y: 1 }} style={{ padding: S.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md }}>
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.2)' }}>
            <Txt size={F.micro} w={800} tone="onAccent">EZ</Txt>
          </View>
          <Txt size={F.tiny} w={600} tone="onAccent" numberOfLines={1} style={{ flex: 1 }}>{company}</Txt>
        </View>
        {children}
      </LinearGradient>
    </View>
  )
}

function Face({ name, designation, photoUrl }: { name: string; designation: string; photoUrl?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
      <View style={{ width: 52, height: 52, borderRadius: R.lg, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
        {photoUrl ? <Image source={{ uri: photoUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          : <Txt size={F.lead + 1} w={700} tone="onAccent">{ini(name)}</Txt>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.lead} w={700} tone="onAccent" numberOfLines={2}>{name}</Txt>
        <Txt size={F.tiny} tone="onAccent" style={{ opacity: 0.85 }} numberOfLines={2}>{designation}</Txt>
      </View>
    </View>
  )
}

function Cell({ lb, vv }: { lb: string; vv: string }) {
  return (
    <View style={{ width: '50%', paddingVertical: 6, paddingRight: S.sm }}>
      <Txt size={10} w={600} tone="onAccent" upper style={{ opacity: 0.75 }}>{lb}</Txt>
      <Txt size={F.small} w={700} tone="onAccent">{vv}</Txt>
    </View>
  )
}

/** Fetch now and every 15 s while `on` and the app is in the foreground. */
function useGateToken(on: boolean) {
  const [tok, setTok] = React.useState<Issued | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [left, setLeft] = React.useState(0)

  const fetchToken = React.useCallback(async () => {
    try { const t = await fetchIdToken(); setErr(null); setTok(t) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not reach the server.') }
  }, [])

  React.useEffect(() => {
    if (!on) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const cycle = async () => {
      if (!live) return
      if (AppState.currentState === 'active') await fetchToken()
      if (live) timer = setTimeout(cycle, 15_000)
    }
    void cycle()
    const sub = AppState.addEventListener('change', s => { if (s === 'active' && live) void fetchToken() })
    return () => { live = false; sub.remove(); if (timer) clearTimeout(timer) }
  }, [on, fetchToken])

  React.useEffect(() => {
    if (!tok) return
    const tick = () => setLeft(Math.max(0, Math.ceil((tok.expiresAt - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [tok])

  return { tok, err, left }
}

export function IdCard({ name, designation, company, code, doj, blood, emergency, photoUrl, startOnQr }: {
  name: string; designation: string; company: string
  code: string; doj?: string | null; blood?: string | null; emergency?: string | null
  /** The signed avatar URL the profile already holds; initials when there is none. */
  photoUrl?: string | null
  /** The full-screen Digital ID page opens straight on the QR. */
  startOnQr?: boolean
}) {
  const [back, setBack] = React.useState(!!startOnQr)
  const { tok, err, left } = useGateToken(back)

  return (
    <Dig company={company}>
      {!back ? (
        <>
          <Face name={name} designation={designation} photoUrl={photoUrl} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: S.md }}>
            <Cell lb="Employee code" vv={code} />
            <Cell lb="Date of joining" vv={prettyDoj(doj)} />
            <Cell lb="Blood group" vv={blood || '-'} />
            <Cell lb="Emergency" vv={(emergency || '').split('·').pop()?.trim() || '-'} />
          </View>
        </>
      ) : (
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 4, paddingBottom: 2 }}>
          {err ? (
            <View style={{ padding: S.md, borderRadius: R.md, backgroundColor: 'rgba(255,255,255,0.16)' }}>
              <Txt size={F.small} tone="onAccent" center>{err}</Txt>
            </View>
          ) : tok ? (
            <>
              <View style={{ padding: 6, borderRadius: 10, backgroundColor: '#FFFFFF' /* QR needs a light ground in both themes (IdCard.tsx) */ }}>
                <QrSvg value={tok.url} size={208} />
              </View>
              <Txt size={F.micro} tone="onAccent" center style={{ opacity: 0.9 }}>
                {left > 0 ? <>Valid for <Txt size={F.micro} w={700} tone="onAccent">{left}s</Txt> · single use</> : 'Refreshing…'}
              </Txt>
              <Txt size={10} tone="onAccent" center style={{ opacity: 0.75 }}>
                Card {tok.cardNo}{tok.accessZones?.length ? ` · ${tok.accessZones.join(', ')}` : ''}
              </Txt>
            </>
          ) : (
            <Txt size={F.micro} tone="onAccent" style={{ opacity: 0.85, paddingVertical: 28 }}>Getting a code…</Txt>
          )}
        </View>
      )}
      <Pressable onPress={() => setBack(b => !b)} accessibilityRole="button"
        style={({ pressed }) => ({ marginTop: S.md, minHeight: 44, borderRadius: R.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' })}>
        <Txt size={F.small} w={600} tone="onAccent">{back ? 'Show card' : 'Show QR'}</Txt>
      </Pressable>
    </Dig>
  )
}

/** Profile360's card for a colleague's profile: a face and nothing more. */
export function StaticIdCard({ name, designation, company, photoUrl }: { name: string; designation: string; company: string; photoUrl?: string | null }) {
  return (
    <Dig company={company}>
      <Face name={name} designation={designation} photoUrl={photoUrl} />
      <Txt size={F.tiny} tone="onAccent" style={{ marginTop: S.md, opacity: 0.9 }}>A gate code can only be issued for your own card.</Txt>
    </Dig>
  )
}

/** IdCardDownload.tsx. The PDF is drawn on a browser canvas with pdf-lib, which
 *  React Native cannot run, so the button opens My Details on the website,
 *  where the same button builds the same two-page PDF. */
export function IdCardDownload() {
  const { C } = useTheme()
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  return (
    <Card>
      <Button title={busy ? 'Preparing…' : 'Download ID card (PDF)'} variant="outline" full loading={busy}
        icon={<IconDownload size={16} color={C.brandDeep} />}
        onPress={async () => {
          setBusy(true); setErr(null)
          try { await openWebsite('/ess/profile') } catch (e) { setErr(e instanceof Error ? e.message : 'Could not build the PDF.') }
          finally { setBusy(false) }
        }} />
      <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>
        Two pages, front and back. Print at 100% and cut the rounded outline for a 54 × 85.6 mm card. For identification only. Scan at the gate from your digital ID above.
      </Txt>
      <Txt size={F.tiny} tone="faint" style={{ marginTop: 4 }}>Opens My Details on the EZER website, where the PDF is built.</Txt>
      {!!err && <Txt size={F.tiny} tone="critical" style={{ marginTop: 4 }}>{err}</Txt>}
    </Card>
  )
}
