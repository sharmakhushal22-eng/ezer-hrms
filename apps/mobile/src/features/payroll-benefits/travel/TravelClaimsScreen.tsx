// Travel Claims — the website's legacy ESS travel screen (components/ess/TravelClaims.tsx).
//
// Log an expense (billed, or a GPS-recorded journey), attach bill slips, bundle
// unclaimed logs into a claim (RM → HR Head → Finance), and see claim history.
// Endpoints, bodies, validation order and every message are the website's.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { measureTrail } from '@web/travel/gps'
import type { PickedFile } from '@/core/api'
import { useEmployeeId } from '@/core/session'
import { invalidate, queryClient } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Checkbox, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet, useOverlay } from '@/ui/overlays'
import { Screen } from '@/ui/Screen'
import { QK, call, dmy, inr, isNetwork, kb } from '../shared'
import { loadBills, loadTravel, num, today, uploadBill, type Flag, type RouteData, type TravelLog } from './data'
import { useJourneyRecorder } from './useJourneyRecorder'
import { Banner, BillSourceSheet, ClaimRow, JourneyPanel, LogRow, TypeSheet, type BannerTone } from './parts'
import { RouteTrace } from './RouteTrace'

const billsKey = (logId: string) => [QK, 'travel-bills', logId]
const NONE: never[] = []

function Tile({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 100, paddingVertical: 13, paddingHorizontal: 13 }} padded={false}>
      <Txt size={F.micro} w={600} tone="muted" upper numberOfLines={2}>{label}</Txt>
      <Txt size={19} w={700} color={colour} style={{ marginTop: 3 }} numberOfLines={1}>{value}</Txt>
    </Card>
  )
}

function Section({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card style={{ marginBottom: S.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {typeof title === 'string' ? <Txt size={F.small} w={700}>{title}</Txt> : title}
        {right}
      </View>
      {children}
    </Card>
  )
}

function EmptyLine({ text }: { text: string }) {
  return <Txt size={F.small} tone="muted" center style={{ paddingVertical: 28 }}>{text}</Txt>
}

/** A LogRow with its own bill list, loaded per row as on the website. */
function LogRowWithBills(p: Omit<React.ComponentProps<typeof LogRow>, 'bills' | 'billsLoaded'>) {
  const gps = p.log.distance_source === 'GPS_TRACKED' || p.log.distance_source === 'GPS_SNAPPED'
  const q = useQuery({ queryKey: billsKey(p.log.id), queryFn: () => loadBills(p.log.id), enabled: !gps })
  return <LogRow {...p} bills={q.data || []} billsLoaded={q.isFetched} />
}

export default function TravelClaimsScreen() {
  const employeeId = useEmployeeId()
  const { C } = useTheme()
  const { notify } = useOverlay()
  const q = useQuery({ queryKey: [QK, 'travel', employeeId], queryFn: () => loadTravel(employeeId), enabled: !!employeeId })
  const data = q.data

  const [msg, setMsgState] = React.useState<{ tone: BannerTone; text: string } | null>(null)
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [flags, setFlags] = React.useState<Flag[]>([])
  const [date, setDate] = React.useState(today())
  const [typeChoice, setTypeCode] = React.useState('')
  const [purpose, setPurpose] = React.useState('')
  const [city, setCity] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [vehicleId, setVehicleId] = React.useState('')
  const [roundTrip, setRoundTrip] = React.useState(false)
  const [toll, setToll] = React.useState('')
  const [parking, setParking] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [pendingBill, setPendingBill] = React.useState<PickedFile | null>(null)
  const [sheet, setSheet] = React.useState<null | 'date' | 'type' | 'vehicle'>(null)
  /** Who the bill picker is choosing for: the entry form, or an existing log. */
  const billFor = React.useRef<'new' | string | null>(null)
  const [billSheet, setBillSheet] = React.useState(false)
  const pickBill = (target: 'new' | string) => { billFor.current = target; setBillSheet(true) }
  const [uploading, setUploading] = React.useState<string | null>(null)
  const [route, setRoute] = React.useState<RouteData | null>(null)
  const [routeLoading, setRouteLoading] = React.useState(false)
  const { journey, start, end, reset } = useJourneyRecorder()

  // The banner is where the website reports; on a long phone form it may be off
  // screen, so the same words also go up as a toast.
  const setMsg = React.useCallback((m: { tone: BannerTone; text: string } | null) => {
    setMsgState(m)
    if (m) notify(m.text, m.tone === 'err' ? 'error' : m.tone === 'warn' ? 'info' : 'success')
  }, [notify])

  const types = data?.types ?? NONE
  const vehicles = data?.vehicles ?? NONE
  const rates = data?.rates ?? NONE
  const logs = data?.logs ?? NONE
  const claims = data?.claims ?? NONE

  // The website seeds the type with the first one, then it belongs to the user.
  const typeCode = typeChoice || types[0]?.type_code || ''

  const selectedType = types.find(t => t.type_code === typeCode) ?? null
  const needsGps = !!selectedType?.requires_gps
  const liveKm = measureTrail(journey.points).distance_km
  const rateRow = rates.find(r => r.type_code === typeCode)
  const liveRate = rateRow?.rate_per_km != null ? Number(rateRow.rate_per_km) : null

  const load = React.useCallback(async () => { await q.refetch() }, [q])
  const afterWrite = React.useCallback(async () => { void invalidate('today', 'notifications'); await load() }, [load])

  // Build the route as soon as recording stops ("the map is a bonus").
  const routable = journey.state === 'RECORDED' && journey.points.length >= 2
  React.useEffect(() => {
    if (!routable) return
    let live = true
    ;(async () => {
      setRoute(null)
      setRouteLoading(true)
      try {
        const r = await call<RouteData>('/api/travel/route', { method: 'POST', body: { points: journey.points } })
        if (live && r.ok) setRoute(r.body)
      } catch { /* saving must still work without it */ }
      finally { if (live) setRouteLoading(false) }
    })()
    return () => { live = false }
  }, [routable, journey.points])

  const resetForm = () => {
    setPurpose(''); setCity(''); setAmount(''); setToll(''); setParking(''); setRoundTrip(false)
    reset(); setRoute(null); setPendingBill(null)
  }

  const addExpense = async () => {
    if (!purpose.trim()) { setMsg({ tone: 'err', text: 'Say what the journey was for.' }); return }
    if (!typeCode) { setMsg({ tone: 'err', text: 'Pick an expense type.' }); return }
    if (needsGps && journey.state !== 'RECORDED') { setMsg({ tone: 'err', text: 'Record the journey first. Start before you set off and end when you arrive.' }); return }
    if (!needsGps && !num(amount)) { setMsg({ tone: 'err', text: 'Enter the amount you spent.' }); return }

    setSaving(true); setMsgState(null); setFlags([])
    try {
      let snapped: number | null = null
      if (needsGps) {
        const g = await call('/api/travel/gps-distance', { method: 'POST', body: { points: journey.points, type_code: typeCode, employee_id: employeeId, log_date: date, vehicle_id: vehicleId || null } })
          .then(r => r.body).catch(() => null)
        snapped = g?.snapped_km ?? null
      }
      const pts = journey.points
      const res = await call('/api/travel/logs', {
        method: 'POST',
        body: {
          employee_id: employeeId, log_date: date, purpose: purpose.trim(), type_code: typeCode,
          city: city.trim() || null,
          vehicle_id: selectedType?.requires_vehicle ? (vehicleId || null) : null,
          is_round_trip: needsGps ? roundTrip : false,
          amount_entered: needsGps ? 0 : num(amount),
          toll_amount: num(toll), parking_amount: num(parking),
          ...(needsGps ? {
            gps_track: pts, distance_snapped: snapped, gps_started_at: journey.startedAt, gps_ended_at: journey.endedAt,
            from_lat: pts[0]?.lat ?? null, from_lng: pts[0]?.lng ?? null,
            to_lat: pts[pts.length - 1]?.lat ?? null, to_lng: pts[pts.length - 1]?.lng ?? null,
          } : {}),
        },
      })
      const json = res.body
      if (!res.ok) { setMsg({ tone: 'err', text: json.error || 'Could not save this expense.' }); return }
      setFlags((json.flags ?? []) as Flag[])
      let billNote = ''
      if (pendingBill && json.log?.id) {
        const up = await uploadBill(json.log.id, pendingBill)
        billNote = up.ok ? ' Bill attached.' : ` The expense saved, but the bill did not: ${up.message}`
      }
      setMsg({ tone: (json.flags ?? []).length ? 'warn' : 'ok', text: (json.message || 'Expense logged.') + billNote })
      resetForm()
      await afterWrite()
    } catch {
      setMsg({ tone: 'err', text: 'Could not reach the server. Please try again.' })
    } finally { setSaving(false) }
  }

  const removeLog = async (id: string) => {
    try {
      const res = await call('/api/travel/logs', { method: 'DELETE', query: { id, employee_id: employeeId } })
      if (!res.ok) { setMsg({ tone: 'err', text: res.body.error || 'Could not remove that entry.' }); return }
      setPicked(prev => { const n = new Set(prev); n.delete(id); return n })
      await afterWrite()
    } catch { setMsg({ tone: 'err', text: 'Could not remove that entry.' }) }
  }

  const submitClaim = async () => {
    if (picked.size === 0) return
    setSubmitting(true); setMsgState(null)
    try {
      const res = await call('/api/travel/claims', { method: 'POST', body: { employee_id: employeeId, log_ids: Array.from(picked) } })
      if (!res.ok) { setMsg({ tone: 'err', text: res.body.error || 'Could not submit this claim.' }); return }
      setPicked(new Set())
      setMsg({ tone: 'ok', text: res.body.message || 'Claim submitted.' })
      await afterWrite()
    } catch { setMsg({ tone: 'err', text: 'Could not reach the server. Please try again.' }) }
    finally { setSubmitting(false) }
  }

  const attachToLog = async (logId: string, f: PickedFile) => {
    setUploading(logId)
    const res = await uploadBill(logId, f)
    setMsg({ tone: res.ok ? (res.message.includes('same file') ? 'warn' : 'ok') : 'err', text: res.message })
    if (res.ok) { await queryClient.invalidateQueries({ queryKey: billsKey(logId) }); await load() }
    setUploading(null)
  }
  const removeBill = async (logId: string, id: string) => {
    setUploading(logId)
    try {
      const r = await call('/api/travel/upload-bill', { method: 'DELETE', query: { id } })
      if (!r.ok) setMsg({ tone: 'err', text: r.body.error || 'Could not remove that bill.' })
      else { await queryClient.invalidateQueries({ queryKey: billsKey(logId) }); await load() }
    } catch (e) { setMsg({ tone: 'err', text: isNetwork(e) ? 'Could not reach the server. Please try again.' : 'Could not remove that bill.' }) }
    setUploading(null)
  }
  const onBillPicked = (f: PickedFile) => {
    const target = billFor.current
    billFor.current = null
    if (target === 'new') setPendingBill(f)
    else if (target) void attachToLog(target, f)
  }

  const refresh = () => Promise.all([q.refetch(), queryClient.invalidateQueries({ queryKey: [QK, 'travel-bills'] })])
  const frame = (body: React.ReactNode) => <Screen title="Travel Claims" subtitle="Payroll" onRefresh={refresh}>{body}</Screen>

  if (q.isLoading || !data) return frame(<Txt size={F.small} tone="brand" center style={{ padding: 40 }}>Loading your travel claims…</Txt>)
  if (data.blocked) {
    return frame(
      <Card style={{ alignItems: 'center', paddingVertical: 38, paddingHorizontal: 22 }}>
        <Txt size={F.body} w={700} center style={{ marginBottom: 6 }}>Travel claims are not available</Txt>
        <Txt size={F.small} tone="muted" center style={{ lineHeight: 20 }}>{data.blocked}</Txt>
      </Card>,
    )
  }

  const unclaimed = logs.filter(l => !l.claim_id && l.status !== 'CANCELLED')
  const pickedTotal = unclaimed.filter(l => picked.has(l.id)).reduce((s, l) => s + num(l.total_amount), 0)
  const inFlight = claims.filter(c => c.status.startsWith('PENDING') || c.status === 'SUBMITTED')
  const nameOf = (code: string) => types.find(t => t.type_code === code)?.type_name ?? code
  const billNeededFor = (l: TravelLog): number | false => {
    const t = types.find(x => x.type_code === l.type_code)
    if (!t || !t.bill_required || t.requires_gps) return false
    const th = num(t.bill_threshold)
    return th > 0 && num(l.total_amount) > th ? th : false
  }
  const threshold = num(selectedType?.bill_threshold)
  const vehicleLabel = (id: string) => {
    const v = vehicles.find(x => x.id === id)
    return v ? `${v.registration_no || v.vehicle_type} · ${v.fuel_type}${v.is_verified ? '' : ' (unverified)'}` : 'Use my default'
  }
  const allPicked = picked.size === unclaimed.length

  return frame(
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <Tile label="Ready to claim" value={inr(unclaimed.reduce((s, l) => s + num(l.total_amount), 0))} colour={C.brandDeep} />
        <Tile label="Awaiting approval" value={inr(inFlight.reduce((s, c) => s + num(c.total_claimed), 0))} colour={C.warning} />
        <Tile label="Paid this year" value={inr(claims.filter(c => c.status === 'PAID').reduce((s, c) => s + num(c.net_payable), 0))} colour={C.positive} />
      </View>

      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {flags.length > 0 && (
        <Banner tone="warn">
          <Txt size={F.tiny} w={700} color={C.warning}>Saved, with {flags.length === 1 ? 'a note' : 'notes'} for your approver:</Txt>
          {flags.map((f, i) => <Txt key={i} size={F.tiny} color={C.warning} style={{ marginTop: 4 }}>• {f.message}</Txt>)}
        </Banner>
      )}

      <Section title="Log a travel expense">
        <PickerField label="Date" value={dmy(date)} onPress={() => setSheet('date')} />
        <PickerField label="Expense type" onPress={() => setSheet('type')}
          value={types.length === 0 ? 'No expense types configured' : selectedType ? `${selectedType.type_name}${selectedType.requires_gps ? ' (recorded)' : ''}` : ''} />
        <Input label="City" value={city} onChangeText={setCity} placeholder="e.g. Mumbai" />
        <Input label="What was it for" value={purpose} onChangeText={setPurpose} placeholder="e.g. Client meeting at Andheri" />

        {needsGps ? (
          <>
            {selectedType?.requires_vehicle && vehicles.length === 0 && (
              <Banner tone="warn">{`No vehicle is registered against your record, so mileage cannot be priced. Ask HR to add your vehicle before claiming ${selectedType?.type_name}.`}</Banner>
            )}
            {liveRate == null && !selectedType?.requires_vehicle && (
              <Banner tone="warn">{`No rate per kilometre has been set for ${selectedType?.type_name} yet. You can still record the journey. Ask HR to set the rate before you submit.`}</Banner>
            )}
            <JourneyPanel journey={journey} liveKm={liveKm} rate={liveRate} typeName={selectedType?.type_name ?? ''}
              onStart={() => void start()} onEnd={end} onReset={reset} />
            {routable && routeLoading && <Txt size={F.tiny} tone="muted" style={{ paddingTop: 4, paddingBottom: 12 }}>Working out the route you took…</Txt>}
            {routable && route && <RouteTrace route={route} title="Your route" height={260} />}
            {selectedType?.requires_vehicle && <PickerField label="Vehicle" value={vehicleLabel(vehicleId)} onPress={() => setSheet('vehicle')} />}
            <Input label="Toll (₹)" value={toll} onChangeText={setToll} keyboardType="numeric" placeholder="0" />
            <Input label="Parking (₹)" value={parking} onChangeText={setParking} keyboardType="numeric" placeholder="0" />
            <Checkbox checked={roundTrip} onChange={setRoundTrip} label="Return journey (double the recorded distance)" />
            <View style={{ height: 12 }} />
          </>
        ) : (
          <>
            <Input label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0"
              help={threshold > 0 ? `A bill is required above ${inr(threshold)}.` : undefined} />
          </>
        )}

        {!needsGps && selectedType?.bill_required !== false && (
          <View style={{ marginBottom: 12 }}>
            <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>Bill slip</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <Button variant="outline" onPress={() => pickBill('new')} title={pendingBill ? '✓ ' + pendingBill.name : 'Choose Uber / Ola / taxi bill'}
                style={{ borderStyle: 'dashed', borderColor: pendingBill ? C.positive : C.line, backgroundColor: pendingBill ? C.positiveTint : C.sunken, maxWidth: '100%' }} />
              {pendingBill && (
                <>
                  <Txt size={F.micro} tone="muted">{kb(pendingBill.size ?? null)}</Txt>
                  <Txt size={F.tiny} tone="muted" onPress={() => setPendingBill(null)} style={{ paddingVertical: 10 }}>remove</Txt>
                </>
              )}
              {!pendingBill && threshold > 0 && num(amount) > threshold && (
                <Txt size={F.tiny} color={C.warning}>This amount needs a bill. Attach it now or from the list below.</Txt>
              )}
            </View>
            <Txt size={F.micro} tone="muted" style={{ marginTop: 5 }}>A photo or the PDF the app emails you. Up to 10 MB.</Txt>
          </View>
        )}

        <Button full title={saving ? 'Saving…' : 'Add expense'} disabled={saving} onPress={addExpense} />
      </Section>

      <Section
        title={<Txt size={F.small} w={700}>Ready to claim{unclaimed.length > 0 ? <Txt size={F.small} w={500} tone="muted"> · {unclaimed.length}</Txt> : null}</Txt>}
        right={unclaimed.length > 0 ? <Button size="sm" variant="outline" title={allPicked ? 'Clear selection' : 'Select all'} onPress={() => setPicked(allPicked ? new Set() : new Set(unclaimed.map(l => l.id)))} /> : undefined}>
        {unclaimed.length === 0 ? <EmptyLine text="Nothing logged yet this month. Add an expense above." /> : (
          <>
            {unclaimed.map(l => (
              <LogRowWithBills key={l.id} log={l} typeName={nameOf(l.type_code)} checked={picked.has(l.id)} needsBill={billNeededFor(l)}
                busy={uploading === l.id} onAttach={() => pickBill(l.id)} onRemoveBill={id => void removeBill(l.id, id)}
                onToggle={() => setPicked(prev => { const n = new Set(prev); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n })}
                onDelete={() => void removeLog(l.id)} />
            ))}
            <View style={{ marginTop: 13, paddingTop: 13, borderTopWidth: 1, borderTopColor: C.line, gap: 10 }}>
              <Txt size={F.small} tone="muted">
                {picked.size === 0 ? 'Select the expenses you want to claim.'
                  : <>Claiming <Txt size={F.small} w={700}>{inr(pickedTotal)}</Txt> across {picked.size}{picked.size === 1 ? ' expense' : ' expenses'}</>}
              </Txt>
              <Button full variant="positive" title={submitting ? 'Submitting…' : 'Submit claim'} disabled={picked.size === 0 || submitting} onPress={submitClaim} />
            </View>
          </>
        )}
      </Section>

      <Section title="My claims">
        {claims.length === 0 ? <EmptyLine text="You have not submitted a travel claim yet." /> : claims.map(c => <ClaimRow key={c.id} claim={c} />)}
      </Section>

      <DateSheet visible={sheet === 'date'} onClose={() => setSheet(null)} value={date} max={today()} onPick={setDate} title="Date" />
      <TypeSheet visible={sheet === 'type'} onClose={() => setSheet(null)} types={types} value={typeCode} onPick={c => { setTypeCode(c); reset() }} />
      <SelectSheet visible={sheet === 'vehicle'} onClose={() => setSheet(null)} title="Vehicle" value={vehicleId} onPick={setVehicleId}
        options={[{ value: '', label: 'Use my default' }, ...vehicles.map(v => ({ value: v.id, label: vehicleLabel(v.id) }))]} />
      <BillSourceSheet visible={billSheet} onClose={() => setBillSheet(false)} onPicked={onBillPicked}
        onError={text => setMsg({ tone: 'err', text })} />
      <View style={{ height: R.sm }} />
    </>,
  )
}
