'use client'
// components/analytics/OrgAnalytics.tsx — People Analytics for admin, CXO and HR.
//
// One filter row scopes everything beneath it; the tabs are views of the same slice,
// so a number on Pulse and the same number on its own tab always agree. Refetching
// keeps the previous frame at reduced opacity rather than flashing skeletons.
//
// Rendered at /dashboard/analytics and, for HR who live in ESS, inside the portal via
// AdminModules — the page carries no layout context, so both hosts work.

import * as React from 'react'
import { C, F, W, R, S, E, VIZ, seriesColour, eyebrow, numeric, Page, PageHeader, Tabs, Select, Button, Skeleton, Notice } from '@/lib/ui'
import { authHeaders } from '@/lib/auth-headers'
import type { OrgAnalytics as Data, Area } from '@/lib/analytics/types'
import { fmt, inr, clockOf, mLabel, dLabel, dLabelLong } from '@/lib/analytics/format'
import { PERIOD_KEYS, PERIOD_LABEL, type PeriodKey } from '@/lib/analytics/period'
import {
  ChartCard, Grid, KpiRow, Figure, Figures, ColumnChart, LineChart, HBars, Segmented, Funnel, HeatGrid,
  RatingCurve, Meter, MiniTable, Pill, DeltaChip, EmptyChart,
} from './charts'
import { RiskTable } from './RiskTable'
import { AiBriefCard, AiNote, Findings, useAiBrief, useFindingsMode, type AiState } from './AiBrief'
import type { AiBriefResponse } from '@/lib/analytics/ai/types'
import { usePdfExport, DownloadMenu, bylineOf, type DownloadOption } from './export'
import { TAB_LABEL } from '@/lib/analytics/access'
import dynamic from 'next/dynamic'

const AccessManager = dynamic(() => import('./AccessManager'), { ssr: false })

type Tab = 'pulse' | 'workforce' | 'attrition' | 'attendance' | 'performance' | 'hiring' | 'cost'

const TAB_OF: Record<Area, Tab> = {
  workforce: 'workforce', attrition: 'attrition', attendance: 'attendance', leave: 'attendance',
  performance: 'performance', learning: 'performance', hiring: 'hiring', cost: 'cost',
}
const AREA_LABEL: Record<Area, string> = {
  workforce: 'Workforce', attrition: 'Attrition', attendance: 'Attendance', leave: 'Leave',
  performance: 'Performance', learning: 'Learning', hiring: 'Hiring', cost: 'Pay & cost',
}

interface Filters { company: string; department: string; location: string; type: string; period: PeriodKey; cycle: string }

const KEY = 'ezer_analytics_filters'
function loadFilters(): Partial<Filters> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
const queryOf = (fl: Filters) => {
  const qs = new URLSearchParams()
  Object.entries(fl).forEach(([k, v]) => { if (v) qs.set(k, v) })
  return qs
}

export default function OrgAnalytics() {
  const [f, setF] = React.useState<Filters>({ company: '', department: '', location: '', type: '', period: 'last_12', cycle: '' })
  const [tab, setTab] = React.useState<Tab>('pulse')
  const [data, setData] = React.useState<Data | null>(null)
  const [busy, setBusy] = React.useState(true)
  const [err, setErr] = React.useState('')
  const seq = React.useRef(0)

  React.useEffect(() => {
    const saved = loadFilters()
    if (saved.period && (PERIOD_KEYS as string[]).includes(saved.period)) setF(x => ({ ...x, period: saved.period as PeriodKey }))
    try { const t = sessionStorage.getItem(KEY + ':tab'); if (t) setTab(t as Tab) } catch { /* private mode */ }
  }, [])

  const load = React.useCallback(async (fl: Filters, fresh = false) => {
    const my = ++seq.current
    setBusy(true); setErr('')
    try {
      const qs = queryOf(fl)
      if (fresh) qs.set('fresh', '1')
      const res = await fetch(`/api/analytics/org?${qs}`, { headers: await authHeaders(), cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (my !== seq.current) return
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setData(body as Data)
    } catch (e: any) {
      if (my === seq.current) setErr(e?.message || 'Could not load analytics.')
    } finally {
      if (my === seq.current) setBusy(false)
    }
  }, [])

  React.useEffect(() => { load(f) }, [f, load])

  // The AI read follows the figures: asked for once they have loaded, never before,
  // so the page is never held up by the model.
  const ai = useAiBrief(async (refresh: boolean) => {
    const qs = queryOf(f)
    if (refresh) qs.set('refresh', '1')
    const res = await fetch(`/api/analytics/org/ai?${qs}`, { headers: await authHeaders(), cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
    return body as AiBriefResponse
  }, data ? `${queryOf(f)}|${data.generatedAt}` : '')
  const pdf = usePdfExport()
  const [managing, setManaging] = React.useState(false)
  // Tabs this reader may open (an analytics grant can limit them). Pulse always.
  const allowed = React.useCallback((t: Tab) => t === 'pulse' || !data?.access.tabs || data.access.tabs.includes(t), [data])
  const view: Tab = allowed(tab) ? tab : 'pulse'

  const set = (patch: Partial<Filters>) => setF(x => {
    const next = { ...x, ...patch }
    try { localStorage.setItem(KEY, JSON.stringify({ period: next.period })) } catch { /* ignore */ }
    return next
  })
  const pick = (t: Tab) => { setTab(t); try { sessionStorage.setItem(KEY + ':tab', t) } catch { /* ignore */ } }

  const tabs = ([
    { key: 'pulse', label: 'Pulse', count: data ? data.pulse.insights.filter(i => i.severity === 'critical' || i.severity === 'warning').length || undefined : undefined },
    { key: 'workforce', label: 'Workforce' },
    { key: 'attrition', label: 'Attrition & retention' },
    { key: 'attendance', label: 'Attendance & leave' },
    { key: 'performance', label: 'Performance & learning' },
    { key: 'hiring', label: 'Hiring' },
    ...(data?.access.cost !== false ? [{ key: 'cost' as Tab, label: 'Pay & cost' }] : []),
  ] as { key: Tab; label: string; count?: number }[]).filter(t => allowed(t.key))

  const pdfJob = (which: Tab[], name: string) => {
    if (!data) return Promise.resolve()
    const sc = data.scope
    const parts = [sc.companyLabel, data.access.limitLabel, sc.department, sc.location, sc.type, `${sc.period.label} (${dLabel(sc.period.from)} – ${dLabelLong(sc.period.to)})`].filter(Boolean)
    return pdf.run({
      title: 'People Analytics', subtitle: parts.join(' · '), byline: bylineOf(data.access.viewer),
      filename: `EZER-People-Analytics-${name}-${sc.today}.pdf`,
      sections: which.map(t => ({
        key: t, title: t === 'pulse' ? 'Pulse' : TAB_LABEL[t as keyof typeof TAB_LABEL],
        node: <TabBody t={t} d={data} ai={ai} go={() => {}} cycle={f.cycle} setCycle={() => {}} />,
      })),
    })
  }
  const downloads: DownloadOption[] = data ? [
    { key: 'pdf-tab', label: `PDF — ${tabs.find(t => t.key === view)?.label || 'this tab'}`, hint: 'This tab, the way it looks here', run: () => pdfJob([view], view) },
    { key: 'pdf-all', label: 'PDF — full report', hint: `Every tab you can open (${tabs.length}), one after another`, run: () => pdfJob(tabs.map(t => t.key), 'full-report') },
    { key: 'xlsx', label: 'Excel workbook', hint: 'The figures and full lists, one sheet each', run: () => exportWorkbook(data, ai.res) },
  ] : []

  return (
    <Page>
      <PageHeader
        title="People Analytics"
        context={data ? <>{data.scope.companyLabel} · {data.scope.period.label} ({dLabel(data.scope.period.from)} – {dLabelLong(data.scope.period.to)}) · updated {new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</> : 'Workforce, attrition, attendance, performance, hiring and cost — in one place'}
        actions={<>
          {data?.access.manage && <Button size="sm" onClick={() => setManaging(true)}>Manage access</Button>}
          <Button size="sm" onClick={() => load(f, true)} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</Button>
          {data?.access.export !== false && <DownloadMenu options={downloads} step={pdf.step} disabled={!data || busy} />}
        </>}
      />

      {data?.access.via === 'grant' && (
        <div style={{ marginTop: S.md }}>
          <Notice t="info" title="Your view of People Analytics">
            {data.access.limitLabel ? <>You see <strong>{data.access.limitLabel}</strong>. </> : 'You see every company, location and department. '}
            {data.access.people ? '' : 'Lists of named people are hidden. '}
            {data.access.until ? `This access ends on ${dLabelLong(data.access.until)}. ` : ''}
            HR set this; ask them if you need more.
          </Notice>
        </div>
      )}

      <FilterBar f={f} set={set} data={data} />

      <Tabs tabs={tabs} value={view} onChange={pick} />

      {err && <div style={{ marginBottom: S.lg }}><Notice t="critical" title="Analytics could not load">{err}</Notice></div>}

      {!data && busy && <Loading />}

      {data && (
        <div style={{ opacity: busy ? 0.55 : 1, transition: 'opacity .2s', pointerEvents: busy ? 'none' : undefined }} className="ez-fade" key={view}>
          <TabBody t={view} d={data} ai={ai} go={pick} cycle={f.cycle} setCycle={c => set({ cycle: c })} />
        </div>
      )}
      {pdf.stage}
      {managing && <AccessManager onClose={() => setManaging(false)} />}
    </Page>
  )
}

/** One tab, with its AI note on top — the same on the page and in the PDF. */
function TabBody({ t, d, ai, go, cycle, setCycle }: { t: Tab; d: Data; ai: AiState; go: (t: Tab) => void; cycle: string; setCycle: (c: string) => void }) {
  const note = t !== 'pulse' ? ai.res?.brief?.notes.find(n => n.area === t) : undefined
  return (
    <>
      {note && <AiNote note={note} />}
      {t === 'pulse' && <PulseTab d={d} go={go} ai={ai} />}
      {t === 'workforce' && <WorkforceTab d={d} />}
      {t === 'attrition' && <AttritionTab d={d} />}
      {t === 'attendance' && <AttendanceTab d={d} />}
      {t === 'performance' && <PerformanceTab d={d} cycle={cycle} setCycle={setCycle} />}
      {t === 'hiring' && <HiringTab d={d} />}
      {t === 'cost' && <CostTab d={d} />}
    </>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Filters
// ───────────────────────────────────────────────────────────────────────────

function FilterBar({ f, set, data }: { f: Filters; set: (p: Partial<Filters>) => void; data: Data | null }) {
  const opt = data?.filters
  const sel: React.CSSProperties = { height: 34, padding: '0 10px', fontSize: F.small, width: 'auto', minWidth: 140, maxWidth: 220 }
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: S.sm, alignItems: 'center', margin: `${S.lg}px 0 ${S.md}px`,
      padding: S.sm, background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat,
    }}>
      <div role="group" aria-label="Period" style={{ display: 'flex', gap: 2, padding: 2, background: C.sunken, borderRadius: R.md, flexWrap: 'wrap' }}>
        {PERIOD_KEYS.map(k => {
          const on = f.period === k
          return (
            <button key={k} onClick={() => set({ period: k })} className="ez-press" style={{
              border: 'none', borderRadius: R.sm, padding: '6px 10px', fontSize: F.tiny, fontFamily: 'inherit', cursor: 'pointer',
              background: on ? C.surface : 'transparent', color: on ? C.brandDeep : C.muted, fontWeight: on ? W.semi : W.medium,
              boxShadow: on ? E.flat : 'none', whiteSpace: 'nowrap',
            }}>{PERIOD_LABEL[k]}</button>
          )
        })}
      </div>
      <span style={{ width: 1, height: 24, background: C.line, margin: '0 4px' }} />
      {opt && (opt.companies.length > 1 || opt.canPickGroup) && (
        <Select aria-label="Company" value={f.company} onChange={e => set({ company: e.target.value, department: '', location: '' })} style={sel}>
          {opt.canPickGroup && <option value="">{opt.groupLabel || 'All group companies'}</option>}
          {opt.companies.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      )}
      <Select aria-label="Department" value={f.department} onChange={e => set({ department: e.target.value })} style={sel}>
        <option value="">All departments</option>
        {opt?.departments.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
      </Select>
      <Select aria-label="Location" value={f.location} onChange={e => set({ location: e.target.value })} style={sel}>
        <option value="">All locations</option>
        {opt?.locations.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
      </Select>
      <Select aria-label="Employment type" value={f.type} onChange={e => set({ type: e.target.value })} style={sel}>
        <option value="">All employment types</option>
        {opt?.types.map(t => <option key={t} value={t}>{t}</option>)}
      </Select>
      {(f.department || f.location || f.type || f.company) && (
        <button onClick={() => set({ company: '', department: '', location: '', type: '' })} style={{ background: 'none', border: 'none', color: C.brand, fontSize: F.tiny, fontWeight: W.semi, cursor: 'pointer', fontFamily: 'inherit' }}>Clear filters</button>
      )}
    </div>
  )
}

function Loading() {
  return (
    <div>
      <div style={{ display: 'grid', gap: S.md, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginBottom: S.lg }}>
        {Array.from({ length: 8 }, (_, i) => <div key={i} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: 16 }}><Skeleton w="50%" h={10} /><div style={{ height: 10 }} /><Skeleton w="70%" h={26} /></div>)}
      </div>
      <div style={{ display: 'grid', gap: S.lg, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {Array.from({ length: 4 }, (_, i) => <div key={i} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: 16, height: 240 }}><Skeleton w="40%" h={12} /></div>)}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Pulse
// ───────────────────────────────────────────────────────────────────────────

const KPI_TAB: Record<string, Tab> = { headcount: 'workforce', joiners: 'attrition', exits: 'attrition', attrition: 'attrition', ontime: 'attendance', leave: 'attendance', open: 'hiring', cost: 'cost', pms: 'performance' }

function PulseTab({ d, go, ai }: { d: Data; go: (t: Tab) => void; ai: AiState }) {
  const aiFindings = ai.res?.brief?.findings ?? []
  const [mode, setMode] = useFindingsMode(aiFindings.length > 0)
  const ins: { severity: string }[] = mode === 'ai' && aiFindings.length ? aiFindings : d.pulse.insights
  const flow = d.pulse.flow
  return (
    <>
      <KpiRow items={d.pulse.kpis} onPick={k => KPI_TAB[k] && go(KPI_TAB[k])} />
      <AiBriefCard state={ai} audience="org" />
      <Grid min={380}>
        <ChartCard title="What needs attention" sub="Click one to open its detail."
                   right={<Pill t={ins.some(i => i.severity === 'critical') ? 'critical' : ins.some(i => i.severity === 'warning') ? 'warning' : 'positive'}>{ins.length} finding{ins.length === 1 ? '' : 's'}</Pill>}>
          <Findings state={ai} rules={d.pulse.insights} mode={mode} setMode={setMode} limit={7}
            onOpen={a => go(TAB_OF[a as Area] || 'pulse')} areaLabel={a => AREA_LABEL[a as Area]}
            empty="Nothing stands out for this selection — every measure is inside its normal range." />
        </ChartCard>
        <div style={{ display: 'grid', gap: S.lg, alignContent: 'start' }}>
          <ChartCard title="This month against last month" sub="Month to date, compared with the same days last month where the figure is a flow.">
            <MiniTable head={['Measure', 'Last month', 'This month', 'Change']} align={['left', 'right', 'right', 'right']}
              rows={d.pulse.changes.map(c => [c.label, fmt(c.before, c.fmt), <strong key="n" style={{ color: C.ink }}>{fmt(c.now, c.fmt)}</strong>, <DeltaChip key="d" now={c.now} before={c.before} f={c.fmt} good={c.good} />])} />
          </ChartCard>
          {flow.length > 0 && (
            <ChartCard title="Headcount, last 12 months" sub="People on the books at each month end.">
              <LineChart labels={flow.map(x => mLabel(x.month))} series={[{ key: 'hc', label: 'Headcount', values: flow.map(x => x.closing) }]} area height={170} zeroBase={false} />
            </ChartCard>
          )}
        </div>
      </Grid>
      <Grid min={380}>
        {flow.length > 0 && (
          <ChartCard title="Joiners and exits" sub="Each month's movement in and out.">
            <ColumnChart labels={flow.map(x => mLabel(x.month))} series={[
              { key: 'j', label: 'Joiners', values: flow.map(x => x.joiners) },
              { key: 'x', label: 'Exits', values: flow.map(x => x.exits) },
            ]} emptyText="No joiners or exits in the last 12 months." />
          </ChartCard>
        )}
        <ModuleSnapshot d={d} go={go} />
      </Grid>
    </>
  )
}

function ModuleSnapshot({ d, go }: { d: Data; go: (t: Tab) => void }) {
  const rows = ([
    { label: 'On-time punch-ins', value: fmt(d.attendance.summary.onTimeRate, 'pct'), note: `${d.attendance.coverage.tracked} of ${d.attendance.coverage.headcount} people tracked`, meter: d.attendance.summary.onTimeRate, tab: 'attendance' },
    { label: 'Review cycle complete', value: fmt(d.performance.completion, 'pct'), note: d.performance.cycle ? `${d.performance.cycle} · ${d.performance.enrolled} enrolled` : 'No cycle running', meter: d.performance.completion, tab: 'performance' },
    { label: 'Learning completion', value: fmt(d.learning.completion, 'pct'), note: `${d.learning.completed} of ${d.learning.enrolments} enrolments · ${d.learning.overdue} overdue`, meter: d.learning.completion, tab: 'performance' },
    { label: 'Offer acceptance', value: fmt(d.hiring.offers.acceptance, 'pct'), note: `${d.hiring.offers.accepted} accepted of ${d.hiring.offers.accepted + d.hiring.offers.backout + d.hiring.offers.declined} decided`, meter: d.hiring.offers.acceptance, tab: 'hiring' },
    { label: 'Regularisations approved', value: fmt(d.attendance.regularisation.approvalRate, 'pct'), note: `${d.attendance.regularisation.pending} pending of ${d.attendance.regularisation.total}`, meter: d.attendance.regularisation.approvalRate, tab: 'attendance' },
  ] as { label: string; value: string; note: string; meter: number | null; tab: Tab }[]).filter(r => !d.access.tabs || d.access.tabs.includes(r.tab))
  if (!rows.length) return null
  return (
    <ChartCard title="Across the modules" sub="One line per module — click to open it.">
      <div style={{ display: 'grid', gap: S.md }}>
        {rows.map(r => (
          <div key={r.label} onClick={() => go(r.tab)} className="ez-row" style={{ cursor: 'pointer', padding: '4px 6px', borderRadius: R.sm }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: F.small, color: C.ink, fontWeight: W.medium }}>{r.label}</span>
              <strong style={{ fontSize: F.small, color: C.ink, ...numeric }}>{r.value}</strong>
            </div>
            <Meter value={r.meter} />
            <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4 }}>{r.note}</div>
          </div>
        ))}
      </div>
    </ChartCard>
  )
}

const SHORT_TENURE: Record<string, string> = { t0: '< 6 mo', t1: '6–12 mo', t2: '1–2 yr', t3: '2–5 yr', t4: '5–10 yr', t5: '10+ yr' }

// ───────────────────────────────────────────────────────────────────────────
// Workforce
// ───────────────────────────────────────────────────────────────────────────

function WorkforceTab({ d }: { d: Data }) {
  const w = d.workforce
  const gTotal = w.gender.reduce((s, g) => s + g.value, 0)
  const fem = w.gender.find(g => g.key === 'Female')?.value || 0
  return (
    <>
      <Figures min={150}>
        <Figure label="Headcount" value={fmt(w.headcount, 'count')} sub="on the books today" />
        <Figure label="Average tenure" value={w.avgTenure != null ? `${w.avgTenure} yrs` : '—'} />
        <Figure label="Women" value={fmt(gTotal ? (fem / gTotal) * 100 : null, 'pct')} sub={`${fem} of ${gTotal}`} />
        <Figure label="Managers" value={w.span.managers} sub={w.span.avgSpan != null ? `${w.span.avgSpan} reports each on average` : undefined} />
        <Figure label="On probation" value={w.probation.onProbation} sub={w.probation.overdueCount ? `${w.probation.overdueCount} past the end date` : 'none overdue'} t={w.probation.overdueCount ? 'warning' : 'neutral'} />
        <Figure label="No manager" value={w.noManager} sub="nobody to approve for them" t={w.noManager ? 'warning' : 'neutral'} />
      </Figures>
      <Grid>
        <ChartCard title="Headcount by department"><HBars items={w.byDepartment.map(b => ({ ...b }))} total={w.headcount} limit={12} /></ChartCard>
        <ChartCard title="Headcount by location"><HBars items={w.byLocation} total={w.headcount} /></ChartCard>
      </Grid>
      <Grid>
        <ChartCard title="Gender" sub="Across the selection, then by department.">
          <Segmented parts={w.gender} />
          <div style={{ marginTop: S.lg, display: 'grid', gap: 7 }}>
            {w.genderByDepartment.map(g => {
              const t = g.male + g.female + g.other
              return (
                <div key={g.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,150px) 1fr 52px', gap: 10, alignItems: 'center' }}
                     title={`${g.label}: ${g.female} women, ${g.male} men${g.other ? `, ${g.other} other / not recorded` : ''}`}>
                  <span style={{ fontSize: F.tiny, color: C.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
                  <div style={{ display: 'flex', gap: 2, height: 10 }}>
                    {[g.male, g.female, g.other].map((v, i) => v > 0 && <div key={i} style={{ flex: `${v} 0 0`, background: seriesColour(i), borderRadius: 3 }} />)}
                  </div>
                  <span style={{ fontSize: F.micro, color: C.muted, textAlign: 'right', ...numeric }}>{t ? Math.round((g.female / t) * 100) : 0}% F</span>
                </div>
              )
            })}
          </div>
        </ChartCard>
        <ChartCard title="Employment type and company">
          <div style={{ ...eyebrow, marginBottom: 6 }}>Employment type</div>
          <Segmented parts={w.byType} />
          {w.byCompany.length > 1 && <>
            <div style={{ ...eyebrow, margin: `${S.lg}px 0 6px` }}>Company</div>
            <Segmented parts={w.byCompany} />
          </>}
          <div style={{ ...eyebrow, margin: `${S.lg}px 0 6px` }}>Grade</div>
          <HBars items={w.byGrade} total={w.headcount} limit={8} labelWidth={110} />
        </ChartCard>
      </Grid>
      <Grid>
        <ChartCard title="Tenure" sub="How long people have been with the company.">
          <ColumnChart labels={w.tenure.map(t => SHORT_TENURE[t.key] || t.label)} series={[{ key: 't', label: 'People', values: w.tenure.map(t => t.value) }]} height={190} />
        </ChartCard>
        <ChartCard title="Age" sub="From date of birth; placeholder dates are left out.">
          <ColumnChart labels={w.age.map(t => t.label)} series={[{ key: 'a', label: 'People', values: w.age.map(t => t.value) }]} height={190} />
        </ChartCard>
        <ChartCard title="Span of control" sub={`${w.span.managers} managers · median ${w.span.medianSpan ?? '—'} direct reports. ${w.span.narrow} have one or two; ${w.span.wide} have more than twelve.`}>
          <ColumnChart labels={w.span.distribution.map(t => t.key)} series={[{ key: 's', label: 'Managers', values: w.span.distribution.map(t => t.value) }]} height={190} />
        </ChartCard>
      </Grid>
      {d.access.people && (w.probation.overdue.length > 0 || w.probation.dueSoon.length > 0) && (
        <Grid>
          <ChartCard title="Probation past its end date" sub="Still on probation after the period ended — confirm, extend or close.">
            <PeopleTable rows={w.probation.overdue} />
          </ChartCard>
          <ChartCard title="Confirmations due in 30 days"><PeopleTable rows={w.probation.dueSoon} empty="None due in the next 30 days." /></ChartCard>
        </Grid>
      )}
    </>
  )
}

function PeopleTable({ rows, empty }: { rows: { id: string; code: string | null; name: string; designation: string | null; department: string | null }[]; empty?: string }) {
  return <MiniTable head={['Employee', 'Code', 'Designation', 'Department']} empty={empty}
    rows={rows.map(r => [r.name, r.code || '—', r.designation || '—', r.department || '—'])} />
}

// ───────────────────────────────────────────────────────────────────────────
// Attrition
// ───────────────────────────────────────────────────────────────────────────

function AttritionTab({ d }: { d: Data }) {
  const a = d.attrition
  return (
    <>
      <Figures min={150}>
        <Figure label="Exits" value={a.exits} sub={d.scope.period.label.toLowerCase()} />
        <Figure label="Attrition (annualised)" value={fmt(a.annualised, 'pct')} sub={<>{a.prevAnnualised != null && <DeltaChip now={a.annualised} before={a.prevAnnualised} f="pct" good="down" />} India 2025 ≈ 16%</>} t={(a.annualised || 0) >= 18 ? 'warning' : 'neutral'} />
        <Figure label="Voluntary / company" value={`${a.voluntary} / ${a.involuntary}`} sub={a.unclassified ? `${a.unclassified} unclassified` : 'resigned / company-initiated'} />
        <Figure label="Regretted exits" value={a.regretted} sub="marked regrettable" t={a.regretted ? 'warning' : 'neutral'} />
        <Figure label="Left within 90 days" value={fmt(a.early90.rate, 'pct')} sub={`${a.early90.left} of ${a.early90.cohort} joiners`} />
        <Figure label="Left within 180 days" value={fmt(a.early180.rate, 'pct')} sub={`${a.early180.left} of ${a.early180.cohort} joiners`} />
        <Figure label="Serving notice" value={a.pipelineCount} sub="open resignations" />
      </Figures>
      <Grid min={380}>
        <ChartCard title="Monthly attrition rate" sub="Exits ÷ average headcount each month (not annualised).">
          <LineChart labels={a.flow.map(x => mLabel(x.month))} series={[{ key: 'r', label: 'Attrition', values: a.flow.map(x => x.attrition) }]} f="pct" area height={190} />
        </ChartCard>
        <ChartCard title="Headcount bridge" sub="Opening + joiners − exits = closing, month by month.">
          <MiniTable head={['Month', 'Opening', 'Joiners', 'Exits', 'Closing']} align={['left', 'right', 'right', 'right', 'right']}
            rows={a.flow.slice().reverse().slice(0, 6).map(x => [mLabel(x.month), x.opening, x.joiners ? `+${x.joiners}` : '0', x.exits ? `−${x.exits}` : '0', <strong key="c" style={{ color: C.ink }}>{x.closing}</strong>])} />
        </ChartCard>
      </Grid>
      <Grid>
        <ChartCard title="Why people left" sub="Reason recorded on the resignation or the HR exit.">
          {a.categories.length > 0 && <div style={{ marginBottom: S.md }}><Segmented parts={a.categories} height={22} /></div>}
          <HBars items={a.reasons.map(r => ({ key: r.key, label: r.label, value: r.value }))} emptyText="No exits in this period." />
        </ChartCard>
        <ChartCard title="Tenure when they left" sub="Short tenures point at hiring fit and onboarding.">
          <ColumnChart labels={a.tenureAtExit.map(t => SHORT_TENURE[t.key] || t.label)} series={[{ key: 'x', label: 'Exits', values: a.tenureAtExit.map(t => t.value) }]} height={200} emptyText="No exits in this period." />
        </ChartCard>
        <ChartCard title="By department" sub="Period attrition rate, not annualised.">
          <MiniTable head={['Department', 'Exits', 'Headcount', 'Rate']} align={['left', 'right', 'right', 'right']} empty="No exits in this period."
            rows={a.byDepartment.map(x => [x.label, x.exits, x.headcount, fmt(x.rate, 'pct')])} />
        </ChartCard>
      </Grid>
      {d.access.people && (
        <>
          <ChartCard title="Flight-risk watchlist" style={{ marginBottom: S.lg }}
                     sub="People on the books showing two or more warning signs from attendance, leave, ratings, pay revisions and their reporting line. A prompt for a conversation, not a verdict — every reason is listed.">
            <RiskTable rows={a.risk} />
          </ChartCard>
          <Grid min={380}>
            <ChartCard title="Serving notice">
              <MiniTable head={['Employee', 'Department', 'Stage', 'Last day', '']} empty="No open resignations."
                rows={a.pipeline.map(p => [p.name, p.department || '—', p.stage, p.lwd ? dLabelLong(p.lwd) : '—', p.regrettable ? <Pill key="r" t="warning">Regrettable</Pill> : ''])} />
            </ChartCard>
            <ChartCard title="Recent exits">
              <MiniTable head={['Employee', 'Last day', 'Tenure', 'Type', 'Reason']} empty="No exits in this period."
                rows={a.recentExits.map(x => [x.name, dLabelLong(x.lwd), x.tenureYears != null ? `${x.tenureYears} yrs` : '—', <Pill key="k" t={x.kind === 'Voluntary' ? 'info' : x.kind === 'Involuntary' ? 'warning' : 'neutral'}>{x.kind}</Pill>, x.reason || '—'])} />
            </ChartCard>
          </Grid>
        </>
      )}
    </>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Attendance & leave
// ───────────────────────────────────────────────────────────────────────────

function AttendanceTab({ d }: { d: Data }) {
  const a = d.attendance, s = a.summary, l = d.leave
  return (
    <>
      <div style={{ marginBottom: S.md }}>
        <Notice t="info" title={`Attendance covers ${a.coverage.tracked} of ${a.coverage.headcount} people`}>
          Measured over {dLabelLong(a.window.from)} – {dLabelLong(a.window.to)}{a.window.capped ? ' (the last three months of the period, which is enough to show a pattern)' : ''}. People with no punches in the window are not counted as late or absent here.
        </Notice>
      </div>
      <Figures min={140}>
        <Figure label="On time" value={fmt(s.onTimeRate, 'pct')} sub={<>{a.prevOnTime != null && <DeltaChip now={s.onTimeRate} before={a.prevOnTime} f="pct" good="up" />} of {s.punchedIn} punch-ins</>} />
        <Figure label="Late marks" value={s.late} sub={`${fmt(s.lateRate, 'pct')} of punch-ins`} t={(s.lateRate || 0) > 20 ? 'warning' : 'neutral'} />
        <Figure label="Missing a punch" value={s.missPunch} sub={`${fmt(s.missPunchRate, 'pct')} of days`} t={(s.missPunchRate || 0) >= 8 ? 'warning' : 'neutral'} />
        <Figure label="Half days" value={s.halfDays} />
        <Figure label="Average hours" value={s.avgHours != null ? `${s.avgHours} h` : '—'} sub="on complete days" />
        <Figure label="Typical first punch" value={clockOf(s.medianIn)} sub="median" />
        <Figure label="Corrections filed" value={a.regularisation.total} sub={`${a.regularisation.pending} pending · ${fmt(a.regularisation.approvalRate, 'pct')} approved`} />
      </Figures>
      <Grid min={380}>
        <ChartCard title="Punctuality by month" sub="Share of punch-ins with no late minutes.">
          <LineChart labels={a.monthly.map(x => mLabel(x.month))} series={[{ key: 'o', label: 'On time', values: a.monthly.map(x => x.onTimeRate) }]} f="pct" yMax={100} height={190} emptyText="No punches in this window." />
        </ChartCard>
        <ChartCard title="Late marks by weekday" sub="Share of that weekday's punch-ins that were late.">
          <ColumnChart labels={a.weekday.map(x => x.label)} series={[{ key: 'r', label: 'Late rate', values: a.weekday.map(x => x.rate) }]} f="pct" height={190} emptyText="No late marks in this window." />
        </ChartCard>
      </Grid>
      <Grid min={380}>
        <ChartCard title="Where and when people are late" sub="Late-mark rate by department and weekday. Darker = later more often.">
          <HeatGrid rows={a.heat.rows.map(r => ({ key: r.key, label: r.label, cells: r.cells, counts: r.days }))} cols={a.heat.cols} note="Hover a cell for the day count" emptyText="No punches in this window." />
        </ChartCard>
        <ChartCard title="By department">
          <MiniTable head={['Department', 'Tracked', 'On time', 'Avg hours', 'Missed punches']} align={['left', 'right', 'right', 'right', 'right']} empty="No punches in this window."
            rows={a.byDepartment.map(x => [x.label, x.tracked, fmt(x.onTimeRate, 'pct'), x.avgHours != null ? `${x.avgHours} h` : '—', x.missPunch])} />
        </ChartCard>
      </Grid>
      {d.access.people && a.lateList.length > 0 && (
        <ChartCard title="Most late marks" sub="Three or more in the window." style={{ marginBottom: S.lg }}>
          <MiniTable head={['Employee', 'Department', 'Late marks', 'Days punched', 'Late share']} align={['left', 'left', 'right', 'right', 'right']}
            rows={a.lateList.map(x => [x.name, x.department || '—', x.late, x.days, fmt(x.days ? (x.late / x.days) * 100 : null, 'pct')])} />
        </ChartCard>
      )}

      <h2 style={{ fontSize: F.title, fontWeight: W.semi, color: C.ink, margin: `${S.xl}px 0 ${S.md}px` }}>Leave</h2>
      <Figures min={140}>
        <Figure label="Leave days taken" value={fmt(l.days, 'days')} sub={d.scope.period.label.toLowerCase()} />
        <Figure label="Per person" value={fmt(l.perHead, 'days')} sub="days, on current headcount" />
        <Figure label="Unplanned" value={fmt(l.unplannedShare, 'pct')} sub="sick, casual or same-day" />
        <Figure label="Next to a weekend" value={fmt(l.bridge.share, 'pct')} sub={`${l.bridge.bridging} of ${l.bridge.spells} short leaves · ~40% by chance`} t={(l.bridge.share || 0) >= 55 && l.bridge.spells >= 10 ? 'warning' : 'neutral'} />
        <Figure label="Awaiting approval" value={l.pending.count} sub={l.pending.olderThan3 ? `${l.pending.olderThan3} older than 3 days` : 'none older than 3 days'} t={l.pending.olderThan3 ? 'warning' : 'neutral'} />
        <Figure label="No leave in 90 days" value={`${l.noLeave90.count}`} sub={`of ${l.noLeave90.of} people here 4+ months`} />
      </Figures>
      <Grid min={380}>
        <ChartCard title="Planned and unplanned leave by month" sub="Approved leave days.">
          <ColumnChart stacked labels={l.monthly.map(x => mLabel(x.month))} series={[
            { key: 'p', label: 'Planned', values: l.monthly.map(x => x.planned) },
            { key: 'u', label: 'Unplanned', values: l.monthly.map(x => x.unplanned) },
          ]} f="days" emptyText="No approved leave in this period." />
        </ChartCard>
        <ChartCard title="By leave type">
          <HBars items={l.byType.map(t => ({ key: t.key, label: t.label, value: t.days, sub: `· ${t.spells} spell${t.spells === 1 ? '' : 's'}` }))} f="days" emptyText="No approved leave in this period." />
          <div style={{ ...eyebrow, margin: `${S.lg}px 0 6px` }}>Day the leave starts</div>
          <ColumnChart labels={l.weekdayStarts.map(x => x.label)} series={[{ key: 'w', label: 'Leaves starting', values: l.weekdayStarts.map(x => x.value) }]} height={140} />
        </ChartCard>
      </Grid>
      <Grid min={380}>
        <ChartCard title="Balances on the books" sub="Available days across current employees, this leave year.">
          <MiniTable head={['Leave type', 'Days available', 'Per person']} align={['left', 'right', 'right']} empty="No balances recorded."
            rows={l.balances.map(b => [b.label, fmt(b.available, 'days'), fmt(b.perHead, 'days')])} />
          <div style={{ fontSize: F.micro, color: C.faint, marginTop: 6 }}>Large earned-leave balances are a liability at encashment and a sign people are not resting.</div>
        </ChartCard>
        {d.access.people ? (
          <ChartCard title="Short-absence pattern (Bradford factor)" sub="S² × D over 52 weeks from unplanned spells. A pattern to discuss, never a disciplinary score.">
            <MiniTable head={['Employee', 'Spells', 'Days', 'Score']} align={['left', 'right', 'right', 'right']} empty="No one scores 50 or more."
              rows={l.bradford.map(b => [b.name, b.spells, b.days, <strong key="s" style={{ color: C.ink }}>{b.score}</strong>])} />
          </ChartCard>
        ) : <div />}
      </Grid>
      {d.access.people && l.noLeave90.people.length > 0 && (
        <ChartCard title="Longest without a break" sub="No approved leave in 90 days; largest earned-leave balance first." style={{ marginBottom: S.lg }}>
          <MiniTable head={['Employee', 'Department', 'Earned leave available']} align={['left', 'left', 'right']}
            rows={l.noLeave90.people.map(p => [p.name, p.department || '—', fmt(p.balance, 'days')])} />
        </ChartCard>
      )}
    </>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Performance & learning
// ───────────────────────────────────────────────────────────────────────────

function PerformanceTab({ d, cycle, setCycle }: { d: Data; cycle: string; setCycle: (c: string) => void }) {
  const p = d.performance, ln = d.learning
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, marginBottom: S.md, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.small, color: C.muted }}>Review cycle</span>
        <Select value={cycle || p.cycle || ''} onChange={e => setCycle(e.target.value)} style={{ height: 34, width: 'auto', minWidth: 180, fontSize: F.small }} aria-label="Review cycle">
          {p.cycles.length === 0 && <option value="">No cycles yet</option>}
          {p.cycles.map(c => <option key={c.code} value={c.code}>{c.name} · {c.enrolled} enrolled</option>)}
        </Select>
      </div>
      <Figures min={140}>
        <Figure label="Enrolled" value={p.enrolled} sub={p.cycle || 'no cycle'} />
        <Figure label="Complete" value={fmt(p.completion, 'pct')} sub="finalised or published" />
        <Figure label="Rated" value={p.rated} />
        <Figure label="Top two bands" value={fmt(p.topShare, 'pct')} sub="Outstanding + Exceeds" t={(p.topShare || 0) >= 50 && p.rated >= 10 ? 'warning' : 'neutral'} />
        <Figure label="Self vs final" value={p.avgGap != null ? (p.avgGap > 0 ? `+${p.avgGap}` : String(p.avgGap)) : '—'} sub="average gap, points" />
        <Figure label="PIPs active" value={p.pip.active} sub={p.pip.requested ? `${p.pip.requested} requested` : undefined} />
        <Figure label="Recognitions" value={p.recognitions} sub="recommended this cycle" />
      </Figures>
      <Grid min={380}>
        <ChartCard title="Where the cycle stands" sub="Everyone enrolled, by the stage they have reached.">
          <HBars items={p.stages.map((s, i) => ({ key: s.key, label: s.label, value: s.value, colour: i === 0 ? VIZ.other : VIZ.series[0] }))} total={p.enrolled} emptyText="Nobody is enrolled in this cycle." />
        </ChartCard>
        <ChartCard title="Rating distribution" sub="Final ratings against a common calibration guideline. The guideline is a reference, not a quota.">
          <RatingCurve dist={p.distribution} />
        </ChartCard>
      </Grid>
      <Grid min={380}>
        <ChartCard title="By department">
          <MiniTable head={['Department', 'Rated', 'Average (1–5)', 'O · EE · ME · NI · U']} align={['left', 'right', 'right', 'left']} empty="No ratings yet."
            rows={p.byDepartment.map(x => [x.label, x.rated, x.avg != null ? x.avg.toFixed(2) : '—', <MiniDist key="d" dist={x.dist} />])} />
        </ChartCard>
        {d.access.people ? (
          <ChartCard title="How managers rate" sub="Managers with three or more rated reports, furthest from the company average first.">
            <MiniTable head={['Manager', 'Rated', 'Average', 'Against company']} align={['left', 'right', 'right', 'right']} empty="No manager has three rated reports yet."
              rows={p.managerSkew.slice(0, 12).map(m => [m.name, m.rated, m.avg.toFixed(2), <Pill key="s" t={Math.abs(m.diff) >= 0.6 ? 'warning' : 'neutral'}>{m.diff > 0 ? '+' : ''}{m.diff.toFixed(2)}</Pill>])} />
          </ChartCard>
        ) : <div />}
      </Grid>
      {p.trainingAsks.length > 0 && (
        <ChartCard title="Training managers asked for" style={{ marginBottom: S.lg }}>
          <HBars items={p.trainingAsks} />
        </ChartCard>
      )}

      <h2 style={{ fontSize: F.title, fontWeight: W.semi, color: C.ink, margin: `${S.xl}px 0 ${S.md}px` }}>Learning</h2>
      <Figures min={140}>
        <Figure label="Enrolments" value={ln.enrolments} />
        <Figure label="Completed" value={fmt(ln.completion, 'pct')} sub={`${ln.completed} courses`} />
        <Figure label="Mandatory done" value={fmt(ln.mandatoryCompletion, 'pct')} t={ln.mandatoryCompletion != null && ln.mandatoryCompletion < 80 ? 'warning' : 'neutral'} />
        <Figure label="Overdue" value={ln.overdue} t={ln.overdue ? 'warning' : 'neutral'} />
        <Figure label="Average score" value={ln.avgScore != null ? `${ln.avgScore}%` : '—'} />
      </Figures>
      <Grid min={380}>
        <ChartCard title="Status of every enrolment">
          <Segmented parts={[
            { key: 'c', label: 'Completed', value: ln.completed },
            { key: 'i', label: 'In progress', value: ln.inProgress },
            { key: 'n', label: 'Not started', value: ln.notStarted },
            { key: 'o', label: 'Other (failed, expired)', value: Math.max(0, ln.enrolments - ln.completed - ln.inProgress - ln.notStarted) },
          ]} />
        </ChartCard>
        <ChartCard title="Learning by department">
          <MiniTable head={['Department', 'Enrolments', 'Completed', 'Overdue']} align={['left', 'right', 'right', 'right']} empty="No enrolments yet."
            rows={ln.byDepartment.map(x => [x.label, x.enrolments, fmt(x.completion, 'pct'), x.overdue])} />
        </ChartCard>
      </Grid>
    </>
  )
}

function MiniDist({ dist }: { dist: number[] }) {
  const t = dist.reduce((a, b) => a + b, 0)
  if (!t) return <span style={{ color: C.faint }}>—</span>
  return (
    <span title={dist.map((v, i) => `${['O', 'EE', 'ME', 'NI', 'U'][i]} ${v}`).join(' · ')} style={{ display: 'inline-flex', gap: 2, width: 120, height: 10, verticalAlign: 'middle' }}>
      {dist.map((v, i) => v > 0 && <span key={i} style={{ flex: `${v} 0 0`, background: seriesColour(i), borderRadius: 2 }} />)}
    </span>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Hiring
// ───────────────────────────────────────────────────────────────────────────

function HiringTab({ d }: { d: Data }) {
  const h = d.hiring
  return (
    <>
      <Figures min={140}>
        <Figure label="Open requisitions" value={h.openMrfs} sub={`${h.openPositions} positions`} />
        <Figure label="Candidates" value={h.candidates} sub={d.scope.period.label.toLowerCase()} />
        <Figure label="Offers made" value={h.offers.made} />
        <Figure label="Offer acceptance" value={fmt(h.offers.acceptance, 'pct')} sub={`${h.offers.backout} backed out · ${h.offers.declined} declined`} t={h.offers.acceptance != null && h.offers.acceptance < 70 ? 'warning' : 'neutral'} />
        <Figure label="Days to offer" value={h.timeToOffer != null ? Math.round(h.timeToOffer) : '—'} sub="median, application → offer" />
        <Figure label="Joining in 30 days" value={h.joiningSoon.length} />
      </Figures>
      <Grid min={380}>
        <ChartCard title="Hiring funnel" sub="Candidates who applied in the period, by the furthest stage reached.">
          <Funnel steps={h.funnel} />
          {h.rejected > 0 && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 8 }}>{h.rejected} rejected along the way.</div>}
        </ChartCard>
        <ChartCard title="Which sources work" sub="Candidates and how many reached an offer.">
          <MiniTable head={['Source', 'Candidates', 'Offers', 'Offer rate']} align={['left', 'right', 'right', 'right']} empty="No candidates in this period."
            rows={h.sources.map(s => [s.label, s.candidates, s.offers, fmt(s.rate, 'pct')])} />
        </ChartCard>
      </Grid>
      <Grid min={380}>
        <ChartCard title="Applicants per month">
          <ColumnChart labels={h.monthlyApplicants.map(x => mLabel(x.month))} series={[{ key: 'a', label: 'Applicants', values: h.monthlyApplicants.map(x => x.value) }]} emptyText="No applicants in the last 12 months." />
        </ChartCard>
        <ChartCard title="How long requisitions stay open" sub="Approved MRFs, by days since approval.">
          <ColumnChart labels={h.mrfAge.map(x => x.label)} series={[{ key: 'm', label: 'Open MRFs', values: h.mrfAge.map(x => x.value) }]} height={170} emptyText="No open requisitions." />
        </ChartCard>
      </Grid>
      <Grid min={380}>
        <ChartCard title="Oldest open requisitions">
          <MiniTable head={['Role', 'MRF', 'Department', 'Openings', 'Days open']} align={['left', 'left', 'left', 'right', 'right']} empty="No open requisitions."
            rows={h.oldestMrfs.map(m => [m.title, m.number || '—', m.department || '—', m.openings, <Pill key="d" t={m.days > 60 ? 'warning' : 'neutral'}>{m.days}</Pill>])} />
        </ChartCard>
        <ChartCard title="Joining in the next 30 days">
          <MiniTable head={['Name', 'Designation', 'Department', 'Joins']} empty="Nobody is due to join in the next 30 days."
            rows={h.joiningSoon.map(j => [j.name, j.designation || '—', j.department || '—', dLabelLong(j.doj)])} />
        </ChartCard>
      </Grid>
    </>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Pay & cost
// ───────────────────────────────────────────────────────────────────────────

const RUN_LABEL: Record<string, string> = {
  OPEN: 'Open', SYNCED: 'Synced', ATTENDANCE_LOCKED: 'Attendance locked', CALCULATED: 'Calculated — not yet approved',
  AI_CHECKED: 'Checked — not yet approved', APPROVED: 'Approved', DISBURSED: 'Disbursed', LOCKED: 'Locked',
}

function CostTab({ d }: { d: Data }) {
  const c = d.cost
  if (!c) return <EmptyChart text="Pay and cost figures need the Payroll, Finance or Reports permission." />
  const L = c.latest
  return (
    <>
      {L ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, marginBottom: S.md, flexWrap: 'wrap' }}>
            <span style={{ fontSize: F.small, color: C.muted }}>Latest payroll month: <strong style={{ color: C.ink }}>{mLabel(L.month)}</strong></span>
            <Pill t={['APPROVED', 'DISBURSED', 'LOCKED'].includes(L.status) ? 'positive' : 'warning'}>{RUN_LABEL[L.status] || L.status}</Pill>
          </div>
          <Figures min={150}>
            <Figure label="Cost to company" value={inr(L.costToCompany)} sub="gross + employer statutory" />
            <Figure label="Gross pay" value={inr(L.gross)} />
            <Figure label="Net pay" value={inr(L.net)} sub={`${L.gross ? Math.round((L.net / L.gross) * 100) : 0}% of gross`} />
            <Figure label="Employer statutory" value={inr(L.employerStatutory)} sub={`${L.gross ? ((L.employerStatutory / L.gross) * 100).toFixed(1) : 0}% on top of gross`} />
            <Figure label="Cost per employee" value={L.perHead != null ? inr(L.perHead) : '—'} sub={`${L.employees} on payroll`} />
          </Figures>
          <Grid min={380}>
            <ChartCard title="Payroll cost by month" sub="Cost to company for each processed month.">
              <ColumnChart labels={c.runs.map(r => mLabel(r.month))} series={[{ key: 'c', label: 'Cost to company', values: c.runs.map(r => r.cost) }]} f="money" height={200} />
            </ChartCard>
            <ChartCard title="What the gross is made of">
              <Segmented parts={L.earnings} f="money" />
              <div style={{ ...eyebrow, margin: `${S.lg}px 0 6px` }}>Employer contributions</div>
              <HBars items={L.employer} f="money" />
            </ChartCard>
          </Grid>
          <Grid min={380}>
            <ChartCard title="Deductions from pay"><HBars items={L.deductions} f="money" /></ChartCard>
            <ChartCard title="Gross pay by department">
              <HBars items={L.byDepartment.map(x => ({ key: x.key, label: x.label, value: x.gross, sub: `· ${x.employees}` }))} f="money" limit={10} />
            </ChartCard>
          </Grid>
        </>
      ) : <div style={{ marginBottom: S.lg }}><EmptyChart text="No payroll has been processed for this selection yet." /></div>}

      <h2 style={{ fontSize: F.title, fontWeight: W.semi, color: C.ink, margin: `${S.xl}px 0 ${S.md}px` }}>Annual CTC</h2>
      <Figures min={150}>
        <Figure label="Total annual CTC" value={inr(c.ctc.total)} sub={`${c.ctc.employees} people with a CTC on record`} />
        <Figure label="Median CTC" value={c.ctc.median != null ? inr(c.ctc.median) : '—'} />
      </Figures>
      <Grid min={380}>
        <ChartCard title="Median CTC by grade" sub="Grades with fewer than three people are not shown, to protect individual pay.">
          <MiniTable head={['Grade', 'People', 'Median CTC']} align={['left', 'right', 'right']} empty="No CTC records."
            rows={c.ctc.byGrade.map(g => [g.label, g.n, g.median != null ? inr(g.median) : <span key="h" style={{ color: C.faint }}>hidden</span>])} />
        </ChartCard>
        <ChartCard title="Pay equity by grade" sub="Median CTC of women ÷ median CTC of men. Compared only where both have five or more people.">
          <MiniTable head={['Grade', 'Women', 'Men', 'Women\'s pay as % of men\'s']} align={['left', 'right', 'right', 'right']} empty="No grade has five or more of each."
            rows={c.ctc.genderRatio.map(g => [g.label, g.female, g.male, g.ratio == null ? <span key="n" style={{ color: C.faint }}>too few to compare</span> : <Pill key="r" t={g.ratio < 0.9 ? 'warning' : g.ratio > 1.1 ? 'info' : 'positive'}>{Math.round(g.ratio * 100)}%</Pill>])} />
        </ChartCard>
      </Grid>
      <ChartCard title="Annual CTC by department" style={{ marginBottom: S.lg }}>
        <HBars items={c.ctc.byDepartment.map(x => ({ key: x.key, label: x.label, value: x.total, sub: `· ${x.n} people` }))} f="money" limit={10} />
      </ChartCard>
    </>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Excel download
// ───────────────────────────────────────────────────────────────────────────

async function exportWorkbook(d: Data, ai: AiBriefResponse | null) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const add = (name: string, rows: Record<string, unknown>[]) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31)) }
  const sc = d.scope
  add('About', [
    { Item: 'Report', Value: 'People Analytics' },
    { Item: 'Scope', Value: [sc.companyLabel, d.access.limitLabel, sc.department, sc.location, sc.type].filter(Boolean).join(' · ') },
    { Item: 'Period', Value: `${sc.period.label} (${sc.period.from} to ${sc.period.to})` },
    { Item: 'Downloaded', Value: bylineOf(d.access.viewer) },
    { Item: 'Note', Value: 'Contains employee information — share only with people who may see it.' },
  ])
  add('Summary', d.pulse.kpis.map(k => ({ Measure: k.label, Value: k.value, Previous: k.prev ?? '', Note: k.sub || '' })))
  const b = ai?.brief
  if (b) {
    add('AI briefing', [
      ...(b.headline ? [{ Kind: 'Headline', Area: '', Text: b.headline, 'Next step': '', 'Based on': '' }] : []),
      ...(b.summary ? [{ Kind: 'Summary', Area: '', Text: b.summary, 'Next step': '', 'Based on': '' }] : []),
      ...b.findings.map(f => ({ Kind: f.severity, Area: AREA_LABEL[f.area as Area] || f.area, Text: `${f.title}. ${f.detail}`, 'Next step': f.action || '', 'Based on': f.evidence.join(' | ') })),
      ...b.notes.map(n => ({ Kind: 'Tab note', Area: n.area, Text: n.text, 'Next step': '', 'Based on': n.evidence.join(' | ') })),
      { Kind: 'About', Area: '', Text: `Written by AI (${b.model}) at ${b.generatedAt}; every number checked against the figures.`, 'Next step': '', 'Based on': '' },
    ])
  }
  add('Findings', d.pulse.insights.map(i => ({ Severity: i.severity, Area: AREA_LABEL[i.area], Finding: i.title, Detail: i.detail })))
  add('Headcount flow', d.attrition.flow.map(f => ({ Month: f.month, Opening: f.opening, Joiners: f.joiners, Exits: f.exits, Closing: f.closing, 'Attrition %': f.attrition })))
  add('By department', d.workforce.byDepartment.map(b => ({ Department: b.label, Headcount: b.value })))
  add('Exits by department', d.attrition.byDepartment.map(b => ({ Department: b.label, Exits: b.exits, Headcount: b.headcount, 'Rate %': b.rate })))
  add('Exit reasons', d.attrition.reasons.map(r => ({ Reason: r.label, Category: r.category, Exits: r.value })))
  if (d.access.people) {
    add('Flight risk', d.attrition.risk.map(r => ({ Employee: r.name, Code: r.code, Department: r.department, Level: r.level, Score: r.score, Reasons: r.signals.map(s => s.label).join('; ') })))
    add('Probation overdue', d.workforce.probation.overdue.map(p => ({ Employee: p.name, Code: p.code, Designation: p.designation, Department: p.department })))
    add('Confirmations due', d.workforce.probation.dueSoon.map(p => ({ Employee: p.name, Code: p.code, Designation: p.designation, Department: p.department })))
    add('Serving notice', d.attrition.pipeline.map(p => ({ Employee: p.name, Department: p.department, Stage: p.stage, 'Last day': p.lwd, Regrettable: p.regrettable ? 'Yes' : '' })))
    add('Recent exits', d.attrition.recentExits.map(x => ({ Employee: x.name, 'Last day': x.lwd, 'Tenure (yrs)': x.tenureYears, Type: x.kind, Reason: x.reason })))
    add('Late marks', d.attendance.lateList.map(x => ({ Employee: x.name, Code: x.code, Department: x.department, 'Late marks': x.late, 'Days punched': x.days })))
    add('Short absences', d.leave.bradford.map(b => ({ Employee: b.name, Code: b.code, Department: b.department, Spells: b.spells, Days: b.days, 'Bradford score': b.score })))
    add('No leave 90 days', d.leave.noLeave90.people.map(p => ({ Employee: p.name, Code: p.code, Department: p.department, 'Earned leave available': p.balance })))
    add('Manager ratings', d.performance.managerSkew.map(m => ({ Manager: m.name, Rated: m.rated, Average: m.avg, 'Against company': m.diff })))
  }
  add('Oldest MRFs', d.hiring.oldestMrfs.map(m => ({ Role: m.title, MRF: m.number, Department: m.department, Openings: m.openings, 'Days open': m.days })))
  add('Joining in 30 days', d.hiring.joiningSoon.map(j => ({ Name: j.name, Designation: j.designation, Department: j.department, Joins: j.doj })))
  add('Attendance by dept', d.attendance.byDepartment.map(x => ({ Department: x.label, Tracked: x.tracked, 'On time %': x.onTimeRate, 'Avg hours': x.avgHours, 'Missed punches': x.missPunch })))
  add('Leave by type', d.leave.byType.map(x => ({ 'Leave type': x.label, Days: x.days, Spells: x.spells })))
  add('Ratings', d.performance.distribution.map(x => ({ Rating: x.label, People: x.value, 'Share %': x.share, 'Reference %': x.reference })))
  add('Hiring funnel', d.hiring.funnel.map(x => ({ Stage: x.label, Candidates: x.value, 'Conversion %': x.conversion })))
  add('Sources', d.hiring.sources.map(x => ({ Source: x.label, Candidates: x.candidates, Offers: x.offers, 'Offer rate %': x.rate })))
  if (d.cost?.latest) add('Payroll by dept', d.cost.latest.byDepartment.map(x => ({ Department: x.label, Employees: x.employees, Gross: x.gross })))
  const name = `EZER-analytics-${d.scope.period.key}-${d.scope.today}.xlsx`
  XLSX.writeFile(wb, name)
}


