'use client'
// components/te/admin/TeReports.tsx — the claim register and the flag report.
// Screen d3.
//
// Two reports with different jobs. The register is the money: one line per
// claim, for reconciling against payroll or a bank statement. The flag report
// is the controls: every flag raised, which answers a question nothing else
// can — are the checks earning their keep?
//
// A check that fires constantly and is dismissed every time is noise, and
// noise trains people to click past the ones that matter. So the flag report
// leads with a count per check and how often each was dismissed.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { te, type ClaimSummaryRow, type FlagReportRow } from '@/lib/te/client'
import { approverWatchEmpty, fastApproverText, pairedApproverText } from '@/lib/te/checks'
import { rangeLabel } from '@/lib/te/dashboard'
import { errorText, rs, when } from '@/lib/te/format'
import type { TeApproverWatch } from '@/lib/te/types'
import TeIcon from '../TeIcon'

const PAGE = 50
type Which = 'claims' | 'flags' | 'approvers'

export default function TeReports({ onToast }: { onToast: (message: string) => void }) {
  const [which, setWhich] = useState<Which>('claims')
  const [claims, setClaims] = useState<ClaimSummaryRow[] | null>(null)
  const [flags, setFlags] = useState<FlagReportRow[] | null>(null)
  /** F2 and F3. A report about approvers rather than about claims, which is
   *  why it lives here and raises nothing on any claim. */
  const [watch, setWatch] = useState<TeApproverWatch | null>(null)
  const [total, setTotal] = useState(0)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const filters = useMemo(() => ({ ...(from ? { from } : {}), ...(to ? { to } : {}) }), [from, to])

  const load = useCallback(() => {
    let current = true
    // The error is cleared when the answer arrives, not here: clearing it in
    // the effect body is a setState before the first paint.
    if (which === 'claims') {
      te.admin.claimsReport({ limit: PAGE, ...filters })
        .then(p => { if (current) { setClaims(p.rows ?? []); setTotal(p.total ?? 0); setError('') } })
        .catch(e => { if (current) { setClaims([]); setError(errorText(e)) } })
    } else if (which === 'flags') {
      te.admin.flagsReport({ limit: 500, ...filters })
        .then(p => { if (current) { setFlags(p.rows ?? []); setTotal(p.total ?? 0); setError('') } })
        .catch(e => { if (current) { setFlags([]); setError(errorText(e)) } })
    } else {
      te.admin.approverWatch(filters)
        .then(p => { if (current) { setWatch(p); setTotal(0); setError('') } })
        .catch(e => { if (current) { setWatch(null); setError(errorText(e)) } })
    }
    return () => { current = false }
  }, [which, filters])

  useEffect(load, [load])

  /** Straight to a file; a report can be thousands of rows. */
  async function download() {
    // The approver report has no CSV: see the note beside the button.
    if (which === 'approvers') return
    setBusy(true); setError('')
    try {
      const blob = await te.admin.reportCsv(which, filters as Record<string, string>)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${which}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      onToast('Downloaded.')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  // Which checks are earning their keep. Counted here because it is a view of
  // the rows already fetched, not a different question for the server.
  const byCheck = useMemo(() => {
    const m = new Map<string, { code: string; title: string; total: number; dismissed: number; blocking: number }>()
    for (const f of flags ?? []) {
      const e = m.get(f.check_code) ?? { code: f.check_code, title: f.title, total: 0, dismissed: 0, blocking: 0 }
      e.total++
      if (f.status === 'dismissed') e.dismissed++
      if (f.is_blocking) e.blocking++
      m.set(f.check_code, e)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [flags])

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Reports</h1>
          <p>The claim register for reconciling, every flag raised for seeing how the checks behave, and how approvals are being done.</p>
        </div>
      </div>

      <div className="seg scopes" role="group" aria-label="Which report">
        <button type="button" aria-pressed={which === 'claims'} onClick={() => setWhich('claims')}>Claim register</button>
        <button type="button" aria-pressed={which === 'flags'} onClick={() => setWhich('flags')}>Flags</button>
        <button type="button" aria-pressed={which === 'approvers'} onClick={() => setWhich('approvers')}>Approvers</button>
      </div>

      <div className="card">
        <div className="form">
          <label className="fld sm"><span>From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="fld sm"><span>To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>
        {which === 'approvers' ? (
          // No CSV for this one on purpose. It is a handful of rows about
          // people, not a register to reconcile, and a spreadsheet of names
          // with "fast" against them is the wrong thing to leave lying around.
          <p className="small muted">
            {/* rangeLabel, not `when`: these are dates, and `when` would add an
                IST-shifted 05:30 to a date that never carried a time. */}
            {watch ? `Decisions in ${rangeLabel(watch.from, watch.to).text}.` : 'The last 90 days unless you narrow the dates.'}
          </p>
        ) : (
          <>
            <button type="button" className="btn" disabled={busy} onClick={download}>
              <TeIcon name="file" size="sm" />{busy ? 'Preparing…' : 'Download as CSV'}
            </button>
            <p className="small muted">A download holds up to 5,000 rows. Narrow the dates for a bigger period.</p>
          </>
        )}
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      {which === 'claims' ? (
        <div className="card pad0">
          <div className="day"><span>Claims</span><span>{total}</span></div>
          {claims === null ? <div className="empty"><b>Loading…</b></div> : null}
          {claims !== null && !claims.length ? <div className="empty"><b>No claims in this period</b></div> : null}
          {(claims ?? []).map(c => (
            <div key={c.id} className="li">
              <div className="grow">
                <div className="b"><span className="mono">{c.claim_no}</span> · {c.employee_name}</div>
                <div className="small muted">
                  {[c.trip_name || 'Other expenses', c.period_label, c.status.replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ')}
                  {c.open_flags ? ` · ${c.open_flags} open flag${c.open_flags === 1 ? '' : 's'}` : ''}
                </div>
              </div>
              <div className="amt">
                <b>{rs(c.net_amount ?? c.approved_total)}</b>
                <span className="small muted">net</span>
              </div>
            </div>
          ))}
          {total > PAGE ? <div className="li"><span className="small muted">Showing the first {PAGE}. Download the CSV for the rest.</span></div> : null}
        </div>
      ) : which === 'approvers' ? (
        <>
          {watch === null && !error ? <div className="card pad0"><div className="empty"><b>Loading…</b></div></div> : null}

          {watch ? (
            <div className="card pad0">
              <div className="day">
                <span>Cleared within seconds</span>
                <span>{watch.f2.rows.length}</span>
              </div>
              {!watch.f2.on ? (
                <div className="li"><span className="small muted">F2 is switched off. This list is still shown, but nothing acts on it.</span></div>
              ) : null}
              {!watch.f2.rows.length ? (
                <div className="empty">
                  <b>Nothing to look at</b>
                  {approverWatchEmpty('f2', watch.f2.seconds, watch.f3.pct)}
                </div>
              ) : null}
              {watch.f2.rows.map(r => (
                <div key={r.who} className="li">
                  <div className="grow">
                    <div className="b">{r.name}</div>
                    <div className="small muted">{fastApproverText(r, watch.f2.seconds)}</div>
                  </div>
                  <div className="amt"><b>{r.fast}</b><span className="small muted">fast</span></div>
                </div>
              ))}
              <div className="li">
                <span className="small muted">
                  Counted only on claims that carried a flag, and only from {watch.f2.minClaims} such decisions.
                  A flag exists to be read; deciding faster than it can be read is the thing worth a question.
                  There are ordinary answers — somebody who read it on their phone before the claim reached their desk.
                </span>
              </div>
            </div>
          ) : null}

          {watch ? (
            <div className="card pad0">
              <div className="day">
                <span>Nearly always the same approver</span>
                <span>{watch.f3.rows.length}</span>
              </div>
              {!watch.f3.on ? (
                <div className="li"><span className="small muted">F3 is switched off. This list is still shown, but nothing acts on it.</span></div>
              ) : null}
              {!watch.f3.rows.length ? (
                <div className="empty">
                  <b>Nothing to look at</b>
                  {approverWatchEmpty('f3', watch.f2.seconds, watch.f3.pct)}
                </div>
              ) : null}
              {watch.f3.rows.map(r => (
                <div key={`${r.who}-${r.employee}`} className="li">
                  <div className="grow">
                    <div className="b">{r.name} <span className="muted">and</span> {r.employeeName}</div>
                    <div className="small muted">{pairedApproverText(r)}</div>
                  </div>
                  <div className="amt"><b>{r.pct}%</b><span className="small muted">of theirs</span></div>
                </div>
              ))}
              <div className="li">
                <span className="small muted">
                  A share, not a count: shown from {watch.f3.minClaims} flagged claims and {watch.f3.pct}% upward.
                  A small team with one approver looks exactly like this, which is why it is a report and not a flag.
                </span>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="card pad0">
            <div className="day"><span>By check</span><span>{byCheck.length}</span></div>
            {flags === null ? <div className="empty"><b>Loading…</b></div> : null}
            {flags !== null && !byCheck.length ? <div className="empty"><b>No flags in this period</b>Either nothing went wrong, or the checks are switched off.</div> : null}
            {byCheck.map(c => {
              // The number worth looking at: a check dismissed nearly every
              // time it fires is teaching people to ignore flags.
              const noisy = c.total >= 5 && c.dismissed / c.total >= 0.8
              return (
                <div key={c.code} className={noisy ? 'li bad' : 'li'}>
                  <div className="grow">
                    <div className="b"><span className="code">{c.code}</span> {c.title}</div>
                    <div className="small muted">
                      {c.dismissed} of {c.total} dismissed{c.blocking ? ` · ${c.blocking} blocked a line` : ''}
                    </div>
                    {noisy ? <div className="small">Dismissed almost every time it fires. Worth asking whether it is set right.</div> : null}
                  </div>
                  <div className="amt"><b>{c.total}</b><span className="small muted">raised</span></div>
                </div>
              )
            })}
          </div>

          <div className="card pad0">
            <div className="day"><span>Every flag</span><span>{total}</span></div>
            {(flags ?? []).slice(0, PAGE).map(f => (
              <div key={f.id} className="li">
                <div className="grow">
                  <div className="b"><span className="code">{f.check_code}</span> {f.title}</div>
                  <div className="small muted">
                    <span className="mono">{f.claim_no}</span> · {f.employee_name} · {when(f.raised_at)}
                  </div>
                  {f.resolve_reason ? <div className="small muted">Dismissed: {f.resolve_reason}</div> : null}
                </div>
                <div className="amt">
                  <span className={f.status === 'open' ? 'chip t-warn' : f.status === 'confirmed' ? 'chip t-crit' : 'chip plain'}>{f.status}</span>
                </div>
              </div>
            ))}
            {total > PAGE ? <div className="li"><span className="small muted">Showing the first {PAGE}. Download the CSV for the rest.</span></div> : null}
          </div>
        </>
      )}
    </div>
  )
}
