'use client'
/**
 * Raise a Request — redesigned.
 *
 * The eight request types, their order, their routing and every line of copy are
 * unchanged; only the picker's shape is (tiles instead of a <select>). The write
 * is still createServiceRequest(), with the same confidential flag and the same
 * assignee, so nothing about who a POSH complaint reaches has moved.
 *
 * The red panel is a promise the database does not yet keep — is_confidential
 * and assigned_to are set by the client, and ess_service_requests carries 021's
 * blanket policy. See docs/ESS-HRIS-HOW-IT-WORKS.md §6. Deliberately unchanged
 * here: fixing it is a data-flow change, which this redesign is not.
 */
import { useCallback, useEffect, useState } from 'react'
import { createServiceRequest, loadServiceRequests } from '@/lib/supabase-ess'
import type { ServiceRequestRow } from './types'
import { Ic, type IconKey } from './icons'
import { fmtDate, riseStyle, useToast } from './ui'

/** The catalogue, in the order the live screen lists it. */
const REQ_TYPES: { k: string; label: string; ic: IconKey; confidential?: boolean; assigned?: string }[] = [
  { k: 'LOAN', label: 'Loan / Advance Salary', ic: 'cash' },
  { k: 'RESIGNATION', label: 'Exit / Resignation', ic: 'door' },
  { k: 'NOMINEE', label: 'Nominee Update', ic: 'user' },
  { k: 'INSURANCE_CHANGE', label: 'Insurance Family Change', ic: 'shield' },
  { k: 'MARRIAGE', label: 'Marriage Detail Update', ic: 'ring' },
  { k: 'EMERGENCY', label: 'Emergency / SOS', ic: 'sos' },
  { k: 'BLOOD_DONATION', label: 'Blood Donation Request', ic: 'heart' },
  { k: 'POSH', label: 'POSH Complaint (Confidential)', ic: 'lock', confidential: true, assigned: 'IC' },
]
const LABEL = Object.fromEntries(REQ_TYPES.map(r => [r.k, r.label]))

const TONE: Record<string, string> = { PENDING: 'warn', IN_REVIEW: 'info', APPROVED: 'ok', COMPLETED: 'ok', REJECTED: 'dang' }
const STATUS: Record<string, string> = { PENDING: 'Pending', IN_REVIEW: 'In review', APPROVED: 'Approved', COMPLETED: 'Completed', REJECTED: 'Rejected' }

export function RaiseRequest({ employeeId, onCount }: { employeeId: string; onCount: (n: number) => void }) {
  const [rows, setRows] = useState<ServiceRequestRow[]>([])
  const [type, setType] = useState(REQ_TYPES[0].k)
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const def = REQ_TYPES.find(r => r.k === type)!

  const load = useCallback(
    () => loadServiceRequests(employeeId).then(r => setRows(r as unknown as ServiceRequestRow[])),
    [employeeId],
  )
  useEffect(() => { void load() }, [load])
  useEffect(() => { onCount(rows.length) }, [rows.length, onCount])

  async function submit() {
    if (!detail.trim()) { toast('Please add details', 'error'); return }
    setBusy(true)
    const { error } = await createServiceRequest(
      employeeId, type, { detail: detail.trim() },
      { is_confidential: def.confidential, assigned_to: def.assigned || 'HR' },
    )
    setBusy(false)
    if (error) { toast('Failed: ' + error.message, 'error'); return }
    setDetail('')
    toast(def.confidential ? 'Confidential request sent to the Internal Committee.' : 'Request submitted.')
    void load()
  }

  return (
    <>
      <div className="hx-card pad" style={{ marginBottom: 14 }}>
        <div className="hx-sec"><h2>Raise a request</h2></div>

        <span className="hx-label">Pick a request type</span>
        <div className="hx-types">
          {REQ_TYPES.map((r, i) => (
            <button key={r.k} className="hx-type hx-rise" style={riseStyle(i)}
              data-posh={r.confidential ? 1 : 0} aria-pressed={type === r.k}
              onClick={() => setType(r.k)}>
              <span className="ic"><Ic k={r.ic} /></span>
              <span>
                <span className="lb">{r.label}</span>
                <span className="sub">Routed to {r.assigned || 'HR'}</span>
              </span>
            </button>
          ))}
        </div>

        <div className={`hx-reveal${def.confidential ? ' show' : ''}`}>
          <div className="hx-note d">
            <Ic k="lock" /> This is confidential and routes only to the Internal Committee — not regular HR.
          </div>
        </div>

        <label className="hx-label" htmlFor="hxReqDetail">Details</label>
        <textarea id="hxReqDetail" className="hx-area" value={detail}
          placeholder="Describe your request…" onChange={e => setDetail(e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <button className="hx-btn" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </div>

      <div className="hx-card pad">
        <div className="hx-sec">
          <h2>My requests</h2><span className="grow" />
          <span className="hx-pill mut">{rows.length} filed</span>
        </div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--ez-faint)' }}>No requests yet.</div>
        ) : rows.map(r => (
          <div className="hx-req-row" key={r.id}>
            <div>
              <div className="ty">
                {LABEL[r.request_type] || r.request_type}
                {r.is_confidential && <span className="hx-lock" title="Confidential">🔒</span>}
              </div>
              <div className="mt">
                {(r.request_data?.detail || '').slice(0, 60) || '—'} · {fmtDate(r.submitted_at)}
              </div>
            </div>
            <span className={`hx-pill ${TONE[r.status] || 'mut'}`}>{STATUS[r.status] || r.status}</span>
          </div>
        ))}
      </div>
    </>
  )
}
