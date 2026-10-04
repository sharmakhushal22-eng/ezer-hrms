'use client'

/**
 * The two popups of the Negotiation stage, restyled:
 *
 *  - MinWagesDialogView  replaces the look of `MinWagesPopup` (read-only)
 *  - ConfirmDialogView   one look for the three confirms of this stage:
 *      re-send to a candidate who already answered, move to Rejected, and any
 *      other yes/no the stage asks
 *
 * PRESENTATIONAL ONLY. Neither reads or writes anything.
 */

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { formatInr, type MinWageRow } from '../logic/negotiationView'

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
}

function CloseIcon() {
  return (
    <svg className="rxn-ico s16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Minimum wages                                                       */
/* ------------------------------------------------------------------ */

export interface MinWagesDialogViewProps {
  /** Current `minimum_wage_config` rows (`effective_to IS NULL`), as loaded today. */
  rows: MinWageRow[]
  /** The state and category in use, so the matching row can be marked. */
  activeState: string
  activeCategory: string
  onClose: () => void
}

export function MinWagesDialogView({ rows, activeState, activeCategory, onClose }: MinWagesDialogViewProps) {
  const [q, setQ] = useState('')
  useEscape(onClose)

  const needle = q.trim().toLowerCase()
  const shown = needle === '' ? rows : rows.filter((r) => `${r.state} ${r.zone} ${r.category}`.toLowerCase().includes(needle))
  const isActive = (r: MinWageRow) => r.state.toLowerCase() === activeState.toLowerCase() && r.category.toLowerCase() === activeCategory.toLowerCase()

  const onScrim = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="rxn rxn-layer dialog" onMouseDown={onScrim}>
      <div className="rxn-dialog wide" role="dialog" aria-modal="true" aria-label="Minimum wages">
        <div className="rxn-dialog-h">
          <div className="rxn-row-b">
            <h2 className="rxn-dialog-t">Minimum wages</h2>
            <div className="rxn-hint">Current rates from the HR master. Reference only; rates are maintained in the master, not here.</div>
          </div>
          <button type="button" className="rxn-btn ghost sm icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <label className="rxn-field">
          <span className="rxn-sr">Filter rates</span>
          <input className="rxn-input" type="search" value={q} placeholder="Filter by state, zone or category" onChange={(e) => setQ(e.target.value)} />
        </label>

        <div className="rxn-table-wrap tall">
          <table className="rxn-grid">
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col">Zone</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">
                  Basic
                </th>
                <th scope="col" className="num">
                  VDA
                </th>
                <th scope="col" className="num">
                  Total
                </th>
                <th scope="col">Effective from</th>
                <th scope="col">Notification</th>
              </tr>
            </thead>
            <tbody className="rxn-tb">
              {shown.map((r) => (
                <tr key={r.id} className={isActive(r) ? 'rxn-tr active' : 'rxn-tr'}>
                  <td>
                    {r.state}
                    {isActive(r) && <span className="rxn-chip brand sm">In use</span>}
                  </td>
                  <td>{r.zone}</td>
                  <td>{r.category}</td>
                  <td className="num">{formatInr(r.basic)}</td>
                  <td className="num">{formatInr(r.vda)}</td>
                  <td className="num strong">{formatInr(r.total)}</td>
                  <td>{r.effectiveFrom}</td>
                  <td>{r.reference}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr className="rxn-tr">
                  <td colSpan={8}>No rate matches that filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rxn-actions end">
          <button type="button" className="rxn-btn p" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Confirm                                                             */
/* ------------------------------------------------------------------ */

export interface ConfirmDialogViewProps {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** `danger` for Move to Rejected, `primary` for a re-send. */
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialogView({ title, children, confirmLabel, cancelLabel = 'Cancel', tone = 'primary', busy = false, onConfirm, onCancel }: ConfirmDialogViewProps) {
  useEscape(onCancel)

  const onScrim = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel()
  }

  return (
    <div className="rxn rxn-layer dialog" onMouseDown={onScrim}>
      <div className="rxn-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className={tone === 'danger' ? 'rxn-dialog-dot danger' : 'rxn-dialog-dot'}>
          <svg className="rxn-ico s18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 8v5M12 16.5v.5M12 21a9 9 0 100-18 9 9 0 000 18z" />
          </svg>
        </div>
        <h2 className="rxn-dialog-t">{title}</h2>
        <div className="rxn-dialog-s">{children}</div>
        <div className="rxn-actions end">
          <button type="button" className="rxn-btn ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={tone === 'danger' ? 'rxn-btn danger solid' : 'rxn-btn p'} disabled={busy} autoFocus onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
