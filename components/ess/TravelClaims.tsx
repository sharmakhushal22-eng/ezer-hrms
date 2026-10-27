'use client'
// components/ess/TravelClaims.tsx — ESS travel reimbursement.
//
// The employee logs each journey or expense as it happens (travel_logs), then
// bundles the unclaimed ones into a claim (travel_claims) when they are ready.
// The claim then walks the approval chain: RM (only if the company has enabled
// that stage) → HR Head → Finance. Nothing here decides the routing; the API
// does, and the status pill just reports where the claim currently sits.
//
// TWO WAYS AN EXPENSE GETS ITS AMOUNT:
//
//   Billed        — cab receipt, hotel, flight. The employee types the amount
//                   and attaches the bill; the figure is verifiable.
//   Recorded (GPS) — own car, cash auto, bike taxi, anything with no receipt.
//                   There is nothing to verify a typed figure against, so the
//                   journey is recorded from the device's location and the
//                   amount is distance × the HR Head's rate. The typed distance
//                   field is not offered for these at all.
//
// Everything goes through /api/travel/* rather than Supabase directly, because
// the write guards — employee still active, expense month open, bill inside the
// 90-day window — live server-side and must not be bypassable from the client.
// The live distance shown while driving is a courtesy readout; the server
// re-measures the submitted trail and that figure is what gets paid.
import { useState, useEffect, useCallback, useRef } from 'react'
import { essAuthHeaders } from '@/lib/ess-session-client';

// This screen renders in two places, and they authenticate differently:
//
//   /ess-portal     the employee, signed in at /ess-login, holding a signed ESS
//                   session token
//   /dashboard/ess  an admin previewing somebody's portal, holding a Supabase
//                   dashboard session and NO ESS token
//
// Sending only the ESS header meant every call from the dashboard preview went
// out unauthenticated and came back 401 — the lists showed empty and nothing
// worked, with no indication why. Fall back to the dashboard session so an
// admin can at least read what the employee sees.
//
// Writes stay refused for the admin: the travel routes mark them selfOnly, so
// only the employee can file their own expense. That is deliberate and this
// does not change it — see the notice on the form.
async function travelAuthHeaders(): Promise<Record<string, string>> {
  const ess = essAuthHeaders()
  if (ess.Authorization) return ess
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token
  return t ? { Authorization: `Bearer ${t}` } : {}
}

/** True when this is an admin preview rather than the employee themselves. */
function isPreview(): boolean {
  return !essAuthHeaders().Authorization
}
import { supabase } from '@/lib/supabase'
import { measureTrail, isValidPoint, type GpsPoint } from '@/lib/travel/gps'
import RouteMap, { type RouteData } from '@/components/travel/RouteMap'
// Local S / Field names exist here, so spacing is imported as SP.
import {
  C, F, W, R, E, S as SP, tone, eyebrow, numeric, inputStyle, type Tone,
  IconTravel, IconReceipt, IconUpload, IconPlus, IconClose, IconCheck, IconAlert,
} from '@/lib/ui'
import {
  SectionCard, KpiGrid, KpiTile, StatusPill, InfoCallout, EmptyState, PButton, IconTile, ProcessStepper, type Step,
  IconFile, IconInfo, IconTimer, IconCheckCircle,
} from '@/components/ess/payroll/kit'
import { Figure, FormStep, FormDivider, fieldLabel } from '@/components/ess/payroll/claimsKit'

// Bound to the design system — see lib/ui/tokens.ts.
const V = {
  navy: C.ink, purple: C.brand, purpleDark: C.brandDeep, border: C.line, muted: C.muted,
  card: C.surface, green: C.positive, greenBg: C.positiveTint, red: C.critical, redBg: C.criticalTint,
  amber: C.warning, amberBg: C.warningTint, purpleBg: C.brandTint, field: C.sunken,
}

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const num = (v: unknown) => Number(v) || 0
const today = () => new Date().toISOString().slice(0, 10)
const dmy = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

// Survives an accidental refresh mid-journey — losing a drive because the
// screen reloaded would mean the employee simply cannot claim it.
const TRACK_KEY = 'ezer.travel.journey'

// ---------------------------------------------------------------------------
interface ExpenseType {
  id: string; type_code: string; type_name: string
  calc_method: 'PER_KM' | 'ACTUAL' | 'ZERO'
  bill_threshold: number; allowed_local: boolean
  requires_vehicle: boolean; requires_gps: boolean; bill_required: boolean
  category: string | null
}
interface Vehicle {
  id: string; vehicle_type: 'CAR' | 'TWO_WHEELER'
  fuel_type: string; cubic_capacity: number | null
  registration_no: string | null; is_verified: boolean
}
interface TravelLog {
  id: string; log_date: string; purpose: string; type_code: string
  city: string | null; distance_claimed: number | null
  computed_fare: number; amount_entered: number
  toll_amount: number; parking_amount: number; total_amount: number
  distance_source: string | null; rate_applied: number | null
  status: string; claim_id: string | null
}
interface Claim {
  id: string; claim_no: string; period_from: string | null; period_to: string | null
  total_claimed: number; total_approved: number; net_payable: number
  status: string; submitted_at: string | null; paid_at: string | null
  line_count: number; flag_count: number
}
interface Flag { flag_type: string; severity: 'WARN' | 'BLOCK'; message: string }
interface Bill {
  id: string; file_name: string | null; mime_type: string | null
  file_size: number | null; url: string | null; attachment_type: string
}

const kb = (n: number | null) => n == null ? '' : n < 1024 ? `${n} B`
  : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`

/** Upload one slip against a journey. Content-Type is left unset on purpose —
 *  the browser must add the multipart boundary itself. */
async function uploadBill(logId: string, file: File): Promise<{ ok: boolean; message: string }> {
  const fd = new FormData()
  fd.append('travel_log_id', logId)
  fd.append('file', file)
  fd.append('attachment_type', 'BILL')
  const r = await fetch('/api/travel/upload-bill', {
    method: 'POST', headers: await travelAuthHeaders(), body: fd,
  })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, message: j.error || j.message || (r.ok ? 'Bill attached.' : 'Upload failed.') }
}

const CATEGORY_LABEL: Record<string, string> = {
  CONVEYANCE: 'Local conveyance',
  OUTSTATION: 'Outstation travel',
  STAY: 'Stay',
  ALLOWANCE: 'Allowances',
  COMMUNICATION: 'Communication',
  DOCUMENTATION: 'Travel documents',
  CLIENT: 'Client facing',
  OTHER: 'Other',
}
const CATEGORY_ORDER = ['CONVEYANCE', 'OUTSTATION', 'STAY', 'ALLOWANCE',
                        'COMMUNICATION', 'DOCUMENTATION', 'CLIENT', 'OTHER']

// Where the claim is, in the employee's language. The chain is
// RM → HR Head → Finance, and any stage with nobody mapped is skipped.
const CLAIM_STATUS: Record<string, [Tone, string]> = {
  DRAFT:           ['brand',    'Draft'],
  SUBMITTED:       ['warning',  'Submitted'],
  PENDING_RM:      ['warning',  'With your manager'],
  PENDING_HR:      ['warning',  'With HR Head'],
  PENDING_FINANCE: ['info',     'With Finance'],
  APPROVED:        ['positive', 'Approved'],
  SENT_BACK:       ['critical', 'Sent back to you'],
  REJECTED:        ['critical', 'Rejected'],
  PAID:            ['positive', 'Paid'],
}

// ---------------------------------------------------------------------------
// Journey recorder.
//
// watchPosition rather than repeated getCurrentPosition: the browser delivers a
// fix whenever the device has one, which is both more accurate and much kinder
// to the battery than polling. Points are appended to a ref as well as state —
// the ref is what gets read when the journey ends, so a render batching delay
// cannot drop the last few fixes.
// ---------------------------------------------------------------------------
type TrackState = 'IDLE' | 'TRACKING' | 'RECORDED'

interface Journey {
  state: TrackState
  points: GpsPoint[]
  startedAt: string | null
  endedAt: string | null
  error: string | null
  accuracy: number | null
}

function useJourneyRecorder() {
  const [journey, setJourney] = useState<Journey>({
    state: 'IDLE', points: [], startedAt: null, endedAt: null, error: null, accuracy: null,
  })
  const pointsRef = useRef<GpsPoint[]>([])
  const watchRef = useRef<number | null>(null)

  // Recover an in-progress journey after a refresh.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TRACK_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as Journey
      if (saved?.state === 'RECORDED' && saved.points?.length) {
        pointsRef.current = saved.points
        setJourney(saved)
      }
    } catch { /* corrupt entry — start clean */ }
  }, [])

  const persist = (j: Journey) => {
    try { sessionStorage.setItem(TRACK_KEY, JSON.stringify(j)) } catch { /* quota */ }
  }

  const stopWatch = () => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
  }

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setJourney(j => ({ ...j, error: 'This device cannot report its location, so a journey cannot be recorded here.' }))
      return
    }

    pointsRef.current = []
    const started = new Date().toISOString()
    setJourney({ state: 'TRACKING', points: [], startedAt: started, endedAt: null, error: null, accuracy: null })

    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const p: GpsPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          t: pos.timestamp,
          acc: pos.coords.accuracy ?? null,
        }
        if (!isValidPoint(p)) return
        pointsRef.current = [...pointsRef.current, p]
        setJourney(j => ({ ...j, points: pointsRef.current, accuracy: p.acc ?? null, error: null }))
      },
      err => {
        // A denied permission is terminal; a single timeout is not, so the
        // watch is left running and only the message is surfaced.
        const fatal = err.code === err.PERMISSION_DENIED
        setJourney(j => ({
          ...j,
          error: fatal
            ? 'Location permission is blocked. Allow location for this site, then start the journey again.'
            : 'Waiting for a location fix. Move somewhere with a clearer view of the sky.',
          ...(fatal ? { state: 'IDLE' as TrackState } : {}),
        }))
        if (fatal) stopWatch()
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    )
  }, [])

  const end = useCallback(() => {
    stopWatch()
    setJourney(j => {
      const next: Journey = {
        ...j, state: 'RECORDED', points: pointsRef.current, endedAt: new Date().toISOString(),
      }
      persist(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    stopWatch()
    pointsRef.current = []
    try { sessionStorage.removeItem(TRACK_KEY) } catch { /* ignore */ }
    setJourney({ state: 'IDLE', points: [], startedAt: null, endedAt: null, error: null, accuracy: null })
  }, [])

  // Never leave a watch running after the screen goes away.
  useEffect(() => stopWatch, [])

  return { journey, start, end, reset }
}

// ---------------------------------------------------------------------------
// Sub-components live outside the parent — defined inside, they remount on
// every keystroke and the form loses focus mid-word.
// ---------------------------------------------------------------------------
const lbl: React.CSSProperties = fieldLabel
const inp: React.CSSProperties = { ...inputStyle() }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ minWidth: 0 }}><label style={lbl}>{label}</label>{children}</div>
}

const BANNER_TONE: Record<'ok' | 'warn' | 'err', Tone> = { ok: 'positive', warn: 'warning', err: 'critical' }
function Banner({ tone: t, children }: { tone: 'ok' | 'warn' | 'err'; children: React.ReactNode }) {
  return <InfoCallout compact t={BANNER_TONE[t]} style={{ marginBottom: SP.md }}>{children}</InfoCallout>
}

function Empty({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return <EmptyState compact t="neutral" icon={icon} title={text} />
}

/** The recorder panel shown for bill-less modes. */
function JourneyPanel({ journey, liveKm, rate, onStart, onEnd, onReset, typeName }: {
  journey: Journey; liveKm: number; rate: number | null
  onStart: () => void; onEnd: () => void; onReset: () => void; typeName: string
}) {
  const tracking = journey.state === 'TRACKING'
  const recorded = journey.state === 'RECORDED'
  const amount = rate != null ? liveKm * rate : null

  return (
    <div style={{ border: `1px solid ${tracking ? C.brandEdge : recorded ? C.positiveEdge : V.border}`, borderRadius: R.lg,
                  padding: '14px 16px', marginBottom: SP.md,
                  background: tracking ? V.purpleBg : recorded ? C.positiveTint : V.field }}>
      <div style={{ display: 'flex', gap: SP.md, alignItems: 'flex-start', marginBottom: SP.md }}>
        <IconTile icon={<IconTravel size={16} />} t={tracking ? 'brand' : recorded ? 'positive' : 'neutral'} size={32} solid={tracking} />
        <div style={{ fontSize: F.tiny, color: C.inkSoft, lineHeight: 1.55, flex: 1, minWidth: 0 }}>
          <b style={{ color: V.navy }}>{typeName}</b> has no bill to attach, so the journey is
          recorded and paid on distance. Start before you set off and end when you arrive,
          and keep this screen open while you travel.
        </div>
      </div>

      {journey.error && <Banner tone={journey.state === 'IDLE' ? 'err' : 'warn'}>{journey.error}</Banner>}

      {(tracking || recorded) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))', gap: SP.sm + 2,
                      marginBottom: SP.md }}>
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, padding: '10px 12px' }}>
            <div style={{ ...eyebrow, marginBottom: 4 }}>Distance</div>
            <div style={{ fontSize: 26, fontWeight: W.bold, color: V.navy, lineHeight: 1, ...numeric }}>
              {liveKm.toFixed(2)} <span style={{ fontSize: 14, color: V.muted }}>km</span>
            </div>
            <div style={{ fontSize: 11, color: V.muted, marginTop: 4, ...numeric }}>
              {journey.points.length} location {journey.points.length === 1 ? 'point' : 'points'}
              {journey.accuracy != null && ` · ±${Math.round(journey.accuracy)} m`}
            </div>
          </div>
          {amount != null && (
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, padding: '10px 12px' }}>
              <div style={{ ...eyebrow, marginBottom: 4 }}>Fare so far</div>
              <div style={{ fontSize: 22, fontWeight: W.bold, color: V.green, lineHeight: 1.1, ...numeric }}>
                {inr(amount)}
              </div>
              <div style={{ fontSize: 11, color: V.muted, marginTop: 4, ...numeric }}>
                at {inr(rate!)}/km
              </div>
            </div>
          )}
          {tracking && (
            <div style={{ alignSelf: 'center' }}>
              <StatusPill t="brand" dot solid>Recording</StatusPill>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {journey.state === 'IDLE' && (
          <PButton variant="primary" icon={<IconTravel size={15} />} onClick={onStart}>
            Start travel
          </PButton>
        )}
        {tracking && (
          <PButton variant="positive" icon={<IconCheck size={15} />} onClick={onEnd}>
            End travel
          </PButton>
        )}
        {recorded && (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: V.green, fontWeight: 600 }}><IconCheck size={14} /> Journey recorded. Add the details below and save.
            </span>
            <PButton size="sm" variant="secondary" onClick={onReset}>
              Discard
            </PButton>
          </>
        )}
      </div>
    </div>
  )
}

// A single logged-but-unclaimed expense, with its selection checkbox.
function LogRow({ log, typeName, checked, onToggle, onDelete, needsBill, onAttached, notify }: {
  log: TravelLog; typeName: string; checked: boolean
  onToggle: () => void; onDelete: () => void
  needsBill: number | false   // the threshold in rupees, or false
  onAttached: () => void
  notify: (tone: 'ok' | 'warn' | 'err', text: string) => void
}) {
  const [bills, setBills] = useState<Bill[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Loaded per row rather than for the whole list — most rows never get opened,
  // and each bill needs its own signed URL minted server-side.
  const loadBills = useCallback(async () => {
    const r = await fetch(`/api/travel/upload-bill?travel_log_id=${log.id}`, { headers: await travelAuthHeaders() })
    if (r.ok) setBills(((await r.json()).attachments ?? []) as Bill[])
    setLoaded(true)
  }, [log.id])

  useEffect(() => { loadBills() }, [loadBills])

  const pick = async (f: File | null) => {
    if (!f) return
    setBusy(true)
    const res = await uploadBill(log.id, f)
    notify(res.ok ? (res.message.includes('same file') ? 'warn' : 'ok') : 'err', res.message)
    if (res.ok) { await loadBills(); onAttached() }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const removeBill = async (id: string) => {
    setBusy(true)
    const r = await fetch(`/api/travel/upload-bill?id=${id}`, { method: 'DELETE', headers: await travelAuthHeaders() })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) notify('err', j.error || 'Could not remove that bill.')
    else { await loadBills(); onAttached() }
    setBusy(false)
  }

  const gps = log.distance_source === 'GPS_TRACKED' || log.distance_source === 'GPS_SNAPPED'
  return (
    <div className="ez-rise" style={{ border: `1px solid ${checked ? C.brandEdge : V.border}`, borderRadius: R.lg,
                  background: checked ? V.purpleBg : V.card, marginBottom: SP.sm,
                  padding: '11px 13px', boxShadow: checked ? 'none' : E.flat, transition: 'background .15s, border-color .15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${log.purpose}`}
             style={{ width: 16, height: 16, accentColor: V.purple, cursor: 'pointer', flexShrink: 0 }} />
      <IconTile icon={gps ? <IconTravel size={14} /> : <IconReceipt size={14} />} t={gps ? 'info' : 'brand'} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: V.navy,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {log.purpose}
        </div>
        <div style={{ fontSize: 11, color: V.muted, marginTop: 2, ...numeric }}>
          {typeName} · {dmy(log.log_date)}
          {log.city ? ` · ${log.city}` : ''}
          {log.distance_claimed ? ` · ${log.distance_claimed} km` : ''}
          {gps && <span style={{ color: V.purpleDark }}> · recorded</span>}
          {log.rate_applied ? ` @ ${inr(log.rate_applied)}/km` : ''}
        </div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: V.navy, flexShrink: 0, ...numeric }}>
        {inr(log.total_amount)}
      </div>
      <button onClick={onDelete} title="Remove this entry" aria-label="Remove this entry" className="ez-press"
              style={{ background: 'none', border: `1px solid transparent`, borderRadius: R.sm, color: V.muted, cursor: 'pointer',
                       width: 26, height: 26, padding: 0, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><IconClose size={14} /></button>
      </div>

      {/* A recorded journey is its own proof; a billed one needs the slip. */}
      {!gps && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      paddingLeft: 68, marginTop: 6 }}>
          {bills.map(b => (
            <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
                                      fontSize: 11, background: V.greenBg, color: V.green,
                                      border: `1px solid ${C.positiveEdge}`, borderRadius: 99,
                                      padding: '3px 9px' }}>
              <IconFile size={12} />
              {b.url
                ? <a href={b.url} target="_blank" rel="noreferrer"
                     style={{ color: V.green, textDecoration: 'underline' }}>
                    {b.file_name || 'bill'}
                  </a>
                : (b.file_name || 'bill')}
              <span style={{ color: V.muted }}>{kb(b.file_size)}</span>
              <button onClick={() => removeBill(b.id)} disabled={busy} title="Remove this bill" aria-label="Remove this bill"
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                               color: V.muted, lineHeight: 1, padding: 0, display: 'inline-flex' }}><IconClose size={12} /></button>
            </span>
          ))}

          <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden
                 onChange={e => pick(e.target.files?.[0] ?? null)} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
                           fontSize: 11, fontWeight: 600, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4,
                           color: busy ? V.muted : V.purpleDark }}>
            {!busy && <IconUpload size={12} />}{busy ? 'Uploading…' : bills.length ? '+ another bill' : 'Attach bill slip'}
          </button>

          {loaded && bills.length === 0 && needsBill !== false && (
            <StatusPill size="sm" t="warning" icon={<IconAlert size={11} />}>
              Needs a slip: {typeName} above {inr(needsBill)} must show a bill
            </StatusPill>
          )}
        </div>
      )}
    </div>
  )
}

// The approval rail a claim walks: submitted → manager → HR Head → Finance → paid.
// Read-only: derived from the status the API already returns.
const RAIL = ['Submitted', 'Manager', 'HR Head', 'Finance', 'Paid'] as const
function claimSteps(status: string): Step[] {
  const at: Record<string, number> = {
    DRAFT: 0, SUBMITTED: 1, PENDING_RM: 1, PENDING_HR: 2, PENDING_FINANCE: 3, APPROVED: 4, PAID: 5,
  }
  if (status === 'SENT_BACK') {
    return RAIL.map((l, i) => ({ key: l, label: i === 0 ? 'Sent back' : l, state: i === 0 ? 'blocked' : 'todo' }))
  }
  if (status === 'REJECTED') {
    return RAIL.map((l, i) => ({
      key: l, label: i === RAIL.length - 1 ? 'Rejected' : l,
      state: i === 0 ? 'done' : i === RAIL.length - 1 ? 'blocked' : 'todo',
    }))
  }
  const cur = at[status] ?? 0
  return RAIL.map((l, i) => ({
    key: l, label: l,
    state: i < cur ? 'done' : i === cur ? 'current' : 'todo',
  }))
}

function ClaimRow({ claim }: { claim: Claim }) {
  const [t, text] = CLAIM_STATUS[claim.status] ?? (['brand', claim.status] as [Tone, string])
  const settled = claim.status === 'PAID' || claim.status === 'APPROVED'
  return (
    <div className="ez-rise" style={{ border: `1px solid ${V.border}`, borderLeft: `3px solid ${tone(t).fg}`,
                  borderRadius: R.lg, padding: '14px 16px', marginBottom: SP.md, background: C.surface, boxShadow: E.flat }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 10, marginBottom: SP.md, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm + 2, minWidth: 0 }}>
          <IconTile icon={<IconReceipt size={15} />} t={t} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: V.navy, ...numeric }}>{claim.claim_no}</div>
            <div style={{ fontSize: 11, color: V.muted, marginTop: 1, ...numeric }}>
              {claim.line_count} {claim.line_count === 1 ? 'expense' : 'expenses'} · {dmy(claim.period_from)} – {dmy(claim.period_to)}
            </div>
          </div>
        </div>
        <StatusPill t={t} dot>{text}</StatusPill>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(140px,100%),1fr))', gap: SP.sm, marginBottom: SP.md }}>
        <Figure label="Claimed" value={inr(claim.total_claimed)} />
        {settled && <Figure label="Approved" value={inr(claim.total_approved)} t="positive" />}
        {claim.flag_count > 0 && <Figure label="To review" value={`${claim.flag_count} flag${claim.flag_count === 1 ? '' : 's'}`} t="warning" />}
      </div>

      <ProcessStepper compact steps={claimSteps(claim.status)} />

      {settled && num(claim.total_approved) < num(claim.total_claimed) && (
        <InfoCallout compact t="warning" style={{ marginTop: SP.md, marginBottom: 0 }}>
          {inr(num(claim.total_claimed) - num(claim.total_approved))} was not approved. Open the
          claim with Finance if you need the reason.
        </InfoCallout>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
export default function TravelClaims({ employeeId }: { employeeId: string }) {
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null)

  const [types, setTypes] = useState<ExpenseType[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [rates, setRates] = useState<{ type_code: string | null; rate_per_km: number }[]>([])
  const [logs, setLogs] = useState<TravelLog[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [flags, setFlags] = useState<Flag[]>([])

  // entry form
  const [date, setDate] = useState(today())
  const [typeCode, setTypeCode] = useState('')
  const [purpose, setPurpose] = useState('')
  const [city, setCity] = useState('')
  const [amount, setAmount] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [roundTrip, setRoundTrip] = useState(false)
  const [toll, setToll] = useState('')
  const [parking, setParking] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // A bill can only be attached to a journey that exists, so one picked on the
  // entry form is held here and uploaded the moment the log is created.
  const [pendingBill, setPendingBill] = useState<File | null>(null)
  const newBillRef = useRef<HTMLInputElement | null>(null)

  const { journey, start, end, reset } = useJourneyRecorder()
  // Admin preview vs the employee themselves. Read once — localStorage does not
  // change under a mounted component.
  const [preview] = useState(isPreview)
  // The route as the server measures it — shown once the journey ends, so the
  // employee sees the same figure the approver will.
  const [route, setRoute] = useState<RouteData | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)

  const selectedType = types.find(t => t.type_code === typeCode) ?? null
  const needsGps = !!selectedType?.requires_gps

  // Live readout only — the server re-measures the trail on save.
  const liveKm = measureTrail(journey.points).distance_km
  const liveRate = rates.find(r => r.type_code === typeCode)?.rate_per_km ?? null

  // -------------------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: emp } = await supabase
        .from('employees').select('company_id').eq('id', employeeId).maybeSingle()
      const companyId = (emp as any)?.company_id
      if (!companyId) { setBlocked('Your employee record has no company mapped.'); return }

      const [{ data: ts }, { data: vs }] = await Promise.all([
        supabase.from('travel_expense_types').select('*')
          .eq('company_id', companyId).eq('is_active', true).order('sort_order'),
        supabase.from('travel_employee_vehicles').select('*')
          .eq('employee_id', employeeId).eq('is_active', true),
      ])
      const typeList = (ts ?? []) as ExpenseType[]
      setTypes(typeList)
      setVehicles((vs ?? []) as Vehicle[])
      if (!typeCode && typeList.length) setTypeCode(typeList[0].type_code)

      // The rate card, so the running fare can be shown while driving. Only the
      // rate in force today is needed here; the server picks the correct
      // historic rate when the log is actually saved.
      const { data: pol } = await supabase.from('travel_policies')
        .select('id').eq('company_id', companyId).eq('is_active', true)
        .order('effective_from', { ascending: false }).limit(1)
      if (pol?.[0]) {
        const { data: rs } = await supabase.from('travel_mileage_rates')
          .select('type_code, rate_per_km, effective_from')
          .eq('policy_id', pol[0].id).lte('effective_from', today())
          .order('effective_from', { ascending: false })
        // First row per type_code wins — the list is newest-first.
        const seen = new Set<string>()
        const latest = (rs ?? []).filter(r => {
          const k = r.type_code ?? ''
          if (!k || seen.has(k)) return false
          seen.add(k); return true
        })
        setRates(latest as any)
      }

      const monthStart = today().slice(0, 8) + '01'
      const [logRes, claimRes] = await Promise.all([
        fetch(`/api/travel/logs?employee_id=${employeeId}&from=${monthStart}&to=${today()}`, { headers: await travelAuthHeaders() }),
        fetch(`/api/travel/claims?employee_id=${employeeId}`, { headers: await travelAuthHeaders() }),
      ])

      if (logRes.status === 403) {
        const b = await logRes.json().catch(() => ({}))
        setBlocked(b.error || 'Your access to the travel module has ended.')
        return
      }

      const logJson = await logRes.json().catch(() => ({}))
      const claimJson = await claimRes.json().catch(() => ({}))
      setLogs((logJson.logs ?? []) as TravelLog[])
      setClaims((claimJson.claims ?? []) as Claim[])
      setBlocked(null)
    } catch {
      setBlocked('Could not load your travel claims. Please try again.')
    } finally {
      setLoading(false)
    }
  // typeCode seeds once and then belongs to the user; re-running on every
  // change would reset their selection mid-entry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId])

  useEffect(() => { load() }, [load])

  // Build the route as soon as recording stops. Doing it here rather than at
  // save means the employee can see the path and distance before committing —
  // and can discard a journey the phone clearly mis-recorded.
  useEffect(() => {
    if (journey.state !== 'RECORDED' || journey.points.length < 2) { setRoute(null); return }
    let live = true
    setRouteLoading(true)
    // Wrapped rather than awaited inline — useEffect's callback cannot be async.
    ;(async () => {
      try {
        const r = await fetch('/api/travel/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await travelAuthHeaders()) },
          body: JSON.stringify({ points: journey.points }),
        })
        if (live && r.ok) setRoute((await r.json()) as RouteData)
      } catch {
        // the map is a bonus; saving must still work without it
      } finally {
        if (live) setRouteLoading(false)
      }
    })()
    return () => { live = false }
  }, [journey.state, journey.points])

  // -------------------------------------------------------------------------
  const resetForm = () => {
    setPurpose(''); setCity(''); setAmount('')
    setToll(''); setParking(''); setRoundTrip(false)
    reset()
    setRoute(null)
    setPendingBill(null)
    if (newBillRef.current) newBillRef.current.value = ''
  }

  const addExpense = async () => {
    if (preview) {
      setMsg({ tone: 'warn', text:
        'You are previewing this portal as an admin, so you cannot file an expense here. ' +
        'The employee has to log in and add it themselves.' })
      return
    }
    if (!purpose.trim()) { setMsg({ tone: 'err', text: 'Say what the journey was for.' }); return }
    if (!typeCode) { setMsg({ tone: 'err', text: 'Pick an expense type.' }); return }
    if (needsGps && journey.state !== 'RECORDED') {
      setMsg({ tone: 'err', text: 'Record the journey first. Start before you set off and end when you arrive.' })
      return
    }
    if (!needsGps && !num(amount)) { setMsg({ tone: 'err', text: 'Enter the amount you spent.' }); return }

    setSaving(true); setMsg(null); setFlags([])
    try {
      // For a recorded journey, ask the server for the road distance first. The
      // reply also carries the rate, so the employee sees what they will be paid
      // before the log is written.
      let snapped: number | null = null
      if (needsGps) {
        const g = await fetch('/api/travel/gps-distance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await travelAuthHeaders()) },
          body: JSON.stringify({
            points: journey.points, type_code: typeCode,
            employee_id: employeeId, log_date: date, vehicle_id: vehicleId || null,
          }),
        }).then(r => r.json()).catch(() => null)
        snapped = g?.snapped_km ?? null
      }

      const res = await fetch('/api/travel/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await travelAuthHeaders()) },
        body: JSON.stringify({
          employee_id: employeeId,
          log_date: date,
          purpose: purpose.trim(),
          type_code: typeCode,
          city: city.trim() || null,
          vehicle_id: selectedType?.requires_vehicle ? (vehicleId || null) : null,
          is_round_trip: needsGps ? roundTrip : false,
          amount_entered: needsGps ? 0 : num(amount),
          toll_amount: num(toll),
          parking_amount: num(parking),
          ...(needsGps ? {
            gps_track: journey.points,
            distance_snapped: snapped,
            gps_started_at: journey.startedAt,
            gps_ended_at: journey.endedAt,
            from_lat: journey.points[0]?.lat ?? null,
            from_lng: journey.points[0]?.lng ?? null,
            to_lat: journey.points[journey.points.length - 1]?.lat ?? null,
            to_lng: journey.points[journey.points.length - 1]?.lng ?? null,
          } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setMsg({ tone: 'err', text: json.error || 'Could not save this expense.' })
        return
      }

      setFlags((json.flags ?? []) as Flag[])

      // The expense exists now, so the slip picked on the form can be attached.
      // A failure here is reported but does not undo the expense — the bill can
      // still be added from the list below.
      let billNote = ''
      if (pendingBill && json.log?.id) {
        const up = await uploadBill(json.log.id, pendingBill)
        billNote = up.ok ? ' Bill attached.' : ` The expense saved, but the bill did not: ${up.message}`
      }

      setMsg({
        tone: (json.flags ?? []).length ? 'warn' : 'ok',
        text: (json.message || 'Expense logged.') + billNote,
      })
      resetForm()
      await load()
    } catch {
      setMsg({ tone: 'err', text: 'Could not reach the server. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const removeLog = async (id: string) => {
    const res = await fetch(`/api/travel/logs?id=${id}&employee_id=${employeeId}`, { method: 'DELETE', headers: await travelAuthHeaders() })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setMsg({ tone: 'err', text: j.error || 'Could not remove that entry.' })
      return
    }
    setPicked(prev => { const n = new Set(prev); n.delete(id); return n })
    await load()
  }

  const submitClaim = async () => {
    if (picked.size === 0) return
    setSubmitting(true); setMsg(null)
    try {
      const res = await fetch('/api/travel/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await travelAuthHeaders()) },
        body: JSON.stringify({ employee_id: employeeId, log_ids: Array.from(picked) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg({ tone: 'err', text: json.error || 'Could not submit this claim.' })
        return
      }
      setPicked(new Set())
      setMsg({ tone: 'ok', text: json.message || 'Claim submitted.' })
      await load()
    } catch {
      setMsg({ tone: 'err', text: 'Could not reach the server. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  // -------------------------------------------------------------------------
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: V.purple, fontSize: 13 }}>
      Loading your travel claims…
    </div>
  }

  if (blocked) {
    return (
      <SectionCard>
        <EmptyState t="warning" icon={<IconTravel size={20} />}
          title="Travel claims are not available" hint={blocked} />
      </SectionCard>
    )
  }

  const unclaimed = logs.filter(l => !l.claim_id && l.status !== 'CANCELLED')
  const pickedTotal = unclaimed.filter(l => picked.has(l.id)).reduce((s, l) => s + num(l.total_amount), 0)
  const inFlight = claims.filter(c => c.status.startsWith('PENDING') || c.status === 'SUBMITTED')
  const nameOf = (code: string) => types.find(t => t.type_code === code)?.type_name ?? code

  // Mirrors the server's rule in logs/route.ts: a bill is required once the
  // amount passes the type's threshold. Shown here so the employee finds out
  // while they can still act on it, not at approval.
  const billNeededFor = (l: TravelLog): number | false => {
    const t = types.find(x => x.type_code === l.type_code)
    if (!t || !t.bill_required || t.requires_gps) return false
    const th = num(t.bill_threshold)
    return th > 0 && num(l.total_amount) > th ? th : false
  }

  // Grouped so a 30-entry list stays navigable.
  const grouped = CATEGORY_ORDER
    .map(cat => ({ cat, items: types.filter(t => (t.category ?? 'OTHER') === cat) }))
    .filter(g => g.items.length > 0)

  // Display-only running total for the entry form. For a recorded journey this is
  // the live estimate; the server re-measures the trail and that figure is paid.
  const formTotal = needsGps
    ? (liveRate != null ? liveKm * liveRate * (roundTrip ? 2 : 1) : 0) + num(toll) + num(parking)
    : num(amount) + num(toll) + num(parking)
  const awaiting = inFlight.reduce((s, c) => s + num(c.total_claimed), 0)
  const readyTotal = unclaimed.reduce((s, l) => s + num(l.total_amount), 0)
  const paidTotal = claims.filter(c => c.status === 'PAID').reduce((s, c) => s + num(c.net_payable), 0)

  return (
    <div style={{ fontFamily: F.family, color: C.ink }}>
      {/* ---- header ---- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, marginBottom: SP.lg, flexWrap: 'wrap' }}>
        <IconTile icon={<IconTravel size={18} />} t="brand" size={40} />
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontSize: F.title, fontWeight: W.bold, letterSpacing: '-.01em' }}>Travel Claims</div>
          <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
            Log each journey or expense as it happens, then bundle them into one claim.
          </div>
        </div>
      </div>

      {/* ---- summary strip ---- */}
      <KpiGrid min={150}>
        <KpiTile label="Ready to claim" value={inr(readyTotal)} emphasis icon={<IconReceipt size={15} />}
          sub={`${unclaimed.length} ${unclaimed.length === 1 ? 'expense' : 'expenses'} not yet claimed`} />
        <KpiTile label="Awaiting approval" value={inr(awaiting)} t="warning" icon={<IconTimer size={15} />}
          sub={`${inFlight.length} ${inFlight.length === 1 ? 'claim' : 'claims'} in review`} />
        <KpiTile label="Paid this year" value={inr(paidTotal)} t="positive" icon={<IconCheckCircle size={15} />}
          sub="Credited with salary" />
      </KpiGrid>

      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

      {/* Flags are notes for the approver, not errors — the expense saved. */}
      {flags.length > 0 && (
        <InfoCallout t="warning" title={`Saved, with ${flags.length === 1 ? 'a note' : 'notes'} for your approver:`}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {flags.map((f, i) => <li key={i} style={{ marginBottom: 2 }}>{f.message}</li>)}
          </ul>
        </InfoCallout>
      )}

      {/* ---- log an expense ---- */}
      <SectionCard title="Log a travel expense" icon={<IconPlus size={16} />}
        hint="What and when, how much, and the bill if the expense has one.">
        {preview && (
          <InfoCallout compact t="warning" title="Admin preview." style={{ marginBottom: SP.lg }}>
            You are seeing this employee&apos;s portal from the dashboard,
            so their claims are visible but nothing can be filed from here. An expense is
            always entered by the employee themselves. To add one, sign in at{' '}
            <a href="/ess-login" style={{ color: 'inherit', textDecoration: 'underline' }}>/ess-login</a>{' '}
            as them.
          </InfoCallout>
        )}

        <FormStep n={1} title="Journey details" hint="When it happened, what kind of expense, and why." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(180px,100%),1fr))',
                      gap: 11, marginBottom: 11 }}>
          <Field label="Date">
            <input type="date" value={date} max={today()}
                   onChange={e => setDate(e.target.value)} style={inp} />
          </Field>
          <Field label="Expense type">
            <select value={typeCode}
                    onChange={e => { setTypeCode(e.target.value); reset() }}
                    style={inp}>
              {types.length === 0 && <option value="">No expense types configured</option>}
              {grouped.map(g => (
                <optgroup key={g.cat} label={CATEGORY_LABEL[g.cat] ?? g.cat}>
                  {g.items.map(t => (
                    <option key={t.type_code} value={t.type_code}>
                      {t.type_name}{t.requires_gps ? ' (recorded)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="City">
            <input value={city} onChange={e => setCity(e.target.value)}
                   placeholder="e.g. Mumbai" style={inp} />
          </Field>
        </div>

        <div>
          <Field label="What was it for">
            <input value={purpose} onChange={e => setPurpose(e.target.value)}
                   placeholder="e.g. Client meeting at Andheri" style={inp} />
          </Field>
        </div>

        <FormDivider />

        {/* Recorded modes get the tracker and no distance field at all —
            offering one would imply a typed figure is acceptable. */}
        {needsGps ? (
          <>
            <FormStep n={2} title="Record the journey"
              hint="Paid on distance at the rate HR has set. Toll and parking are added on top."
              right={<StatusPill size="sm" t="info" icon={<IconTravel size={11} />}>Recorded</StatusPill>} />
            {selectedType?.requires_vehicle && vehicles.length === 0 && (
              <Banner tone="warn">
                No vehicle is registered against your record, so mileage cannot be priced.
                Ask HR to add your vehicle before claiming {selectedType?.type_name}.
              </Banner>
            )}
            {liveRate == null && !selectedType?.requires_vehicle && (
              <Banner tone="warn">
                No rate per kilometre has been set for {selectedType?.type_name} yet.
                You can still record the journey. Ask HR to set the rate before you submit.
              </Banner>
            )}

            <JourneyPanel journey={journey} liveKm={liveKm} rate={liveRate}
                          typeName={selectedType?.type_name ?? ''}
                          onStart={start} onEnd={end} onReset={reset} />

            {routeLoading && (
              <div style={{ fontSize: 12, color: V.muted, padding: '4px 0 12px' }}>
                Working out the route you took…
              </div>
            )}
            {route && <RouteMap route={route} title="Your route" height={260} />}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))',
                          gap: 11, marginBottom: 11 }}>
              {selectedType?.requires_vehicle && (
                <Field label="Vehicle">
                  <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={inp}>
                    <option value="">Use my default</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.registration_no || v.vehicle_type} · {v.fuel_type}
                        {v.is_verified ? '' : ' (unverified)'}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Toll (₹)">
                <input type="number" min="0" value={toll}
                       onChange={e => setToll(e.target.value)} placeholder="0" style={{ ...inp, ...numeric }} />
              </Field>
              <Field label="Parking (₹)">
                <input type="number" min="0" value={parking}
                       onChange={e => setParking(e.target.value)} placeholder="0" style={{ ...inp, ...numeric }} />
              </Field>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                            color: V.navy, cursor: 'pointer' }}>
              <input type="checkbox" checked={roundTrip} onChange={e => setRoundTrip(e.target.checked)}
                     style={{ width: 15, height: 15, accentColor: V.purple, cursor: 'pointer' }} />
              Return journey (double the recorded distance)
            </label>
          </>
        ) : (
          <>
            <FormStep n={2} title="Amount" hint="What you actually spent, as on the bill." />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))',
                          gap: 11 }}>
              <Field label="Amount (₹)">
                <input type="number" min="0" value={amount}
                       onChange={e => setAmount(e.target.value)} placeholder="0" style={{ ...inp, ...numeric }} />
              </Field>
              {num(selectedType?.bill_threshold) > 0 && (
                <div style={{ alignSelf: 'end', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: V.muted, paddingBottom: 10 }}>
                  <IconInfo size={14} /> A bill is required above {inr(num(selectedType?.bill_threshold))}.
                </div>
              )}
            </div>
          </>
        )}

        {/* Attach the receipt here, with the expense, rather than having to
            find the entry again afterwards. A recorded journey is its own
            proof and gets no picker. */}
        {!needsGps && selectedType?.bill_required !== false && (
          <>
            <FormDivider />
            <FormStep n={3} title="Bill slip" hint="A photo or the PDF the app emails you. Up to 10 MB." />
            <input ref={newBillRef} type="file" accept="image/*,application/pdf" hidden
                   onChange={e => setPendingBill(e.target.files?.[0] ?? null)} />
            {pendingBill ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, flexWrap: 'wrap',
                            border: `1px solid ${C.positiveEdge}`, background: V.greenBg, borderRadius: R.lg, padding: '10px 14px' }}>
                <IconTile icon={<IconFile size={15} />} t="positive" size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: V.green, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{'✓ ' + pendingBill.name}</div>
                  <div style={{ fontSize: 11, color: V.muted, ...numeric }}>{kb(pendingBill.size)} · attaches when you add the expense</div>
                </div>
                <PButton size="sm" variant="secondary" onClick={() => newBillRef.current?.click()}>Change</PButton>
                <PButton size="sm" variant="ghost"
                        onClick={() => { setPendingBill(null); if (newBillRef.current) newBillRef.current.value = '' }}>
                  remove
                </PButton>
              </div>
            ) : (
              <button type="button" onClick={() => newBillRef.current?.click()} className="ez-press"
                      style={{ width: '100%', padding: '18px 14px', borderRadius: R.lg,
                               border: `1.5px dashed ${C.lineStrong}`, background: V.field,
                               color: V.purpleDark, fontFamily: 'inherit', cursor: 'pointer',
                               display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <IconTile icon={<IconUpload size={16} />} t="brand" size={34} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Choose Uber / Ola / taxi bill</span>
                <span style={{ fontSize: 11, color: V.muted }}>JPG, PNG or PDF</span>
              </button>
            )}

            {!pendingBill && num(selectedType?.bill_threshold) > 0
              && num(amount) > num(selectedType?.bill_threshold) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: V.amber, marginTop: SP.sm }}>
                <IconAlert size={14} /> This amount needs a bill. Attach it now or from the list below.
              </div>
            )}
          </>
        )}

        {/* ---- live total + primary action ---- */}
        <div style={{ marginTop: SP.lg, display: 'flex', alignItems: 'center', gap: SP.md, flexWrap: 'wrap',
                      background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: '12px 16px' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div style={{ ...eyebrow }}>{needsGps ? 'Estimated total' : 'Total'}</div>
            <div style={{ fontSize: 22, fontWeight: W.bold, color: C.ink, letterSpacing: '-.01em', ...numeric }}>{inr(formTotal)}</div>
            <div style={{ fontSize: 11, color: C.muted, ...numeric }}>
              {needsGps
                ? (liveRate != null ? `${(liveKm * (roundTrip ? 2 : 1)).toFixed(2)} km × ${inr(liveRate)}/km` : 'Rate not set yet') + (num(toll) + num(parking) > 0 ? ` + ${inr(num(toll) + num(parking))} toll & parking` : '') + ' · final figure from the server'
                : `${inr(num(amount))} amount${num(toll) + num(parking) > 0 ? ` + ${inr(num(toll) + num(parking))} toll & parking` : ''}`}
            </div>
          </div>
          <PButton variant="primary" size="lg" onClick={addExpense} disabled={saving || preview} icon={<IconPlus size={16} />}
                  title={preview ? 'Only the employee can file their own expense' : undefined}>
            {saving ? 'Saving…' : preview ? 'Add expense (employee only)' : 'Add expense'}
          </PButton>
        </div>
      </SectionCard>

      {/* ---- unclaimed, ready to submit ---- */}
      <SectionCard
        title={<>Ready to claim{unclaimed.length > 0 && <span style={{ color: V.muted, fontWeight: 500 }}> · {unclaimed.length}</span>}</>}
        icon={<IconReceipt size={16} />}
        hint="Expenses logged this month that are not in a claim yet. Tick the ones to bundle."
        actions={unclaimed.length > 0 ? (
          <PButton size="sm" variant="secondary"
            onClick={() => setPicked(picked.size === unclaimed.length
              ? new Set()
              : new Set(unclaimed.map(l => l.id)))}>
            {picked.size === unclaimed.length ? 'Clear selection' : 'Select all'}
          </PButton>
        ) : undefined}>
        {unclaimed.length === 0 ? (
          <Empty text="Nothing logged yet this month. Add an expense above." icon={<IconReceipt size={18} />} />
        ) : (
          <>
            {unclaimed.map(l => (
              <LogRow key={l.id} log={l} typeName={nameOf(l.type_code)}
                      checked={picked.has(l.id)}
                      needsBill={billNeededFor(l)}
                      onAttached={load}
                      notify={(tone, text) => setMsg({ tone, text })}
                      onToggle={() => setPicked(prev => {
                        const n = new Set(prev)
                        n.has(l.id) ? n.delete(l.id) : n.add(l.id)
                        return n
                      })}
                      onDelete={() => removeLog(l.id)} />
            ))}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          gap: 12, marginTop: 13, paddingTop: 13,
                          borderTop: `1px solid ${V.border}`, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, color: V.muted, ...numeric }}>
                {picked.size === 0
                  ? 'Select the expenses you want to claim.'
                  : <>Claiming <b style={{ color: V.navy, fontSize: 16 }}>{inr(pickedTotal)}</b> across {picked.size}
                     {picked.size === 1 ? ' expense' : ' expenses'}</>}
              </div>
              <PButton variant="primary" onClick={submitClaim} disabled={picked.size === 0 || submitting}>
                {submitting ? 'Submitting…' : 'Submit claim'}
              </PButton>
            </div>
          </>
        )}
      </SectionCard>

      {/* ---- history ---- */}
      <SectionCard title="My claims" icon={<IconCheckCircle size={16} />}
        hint="Each claim goes to your manager (if your company uses that stage), then HR Head, then Finance. Stages with nobody mapped are skipped.">
        {claims.length === 0
          ? <Empty text="You have not submitted a travel claim yet." icon={<IconCheckCircle size={18} />} />
          : claims.map(c => <ClaimRow key={c.id} claim={c} />)}
      </SectionCard>
    </div>
  )
}
