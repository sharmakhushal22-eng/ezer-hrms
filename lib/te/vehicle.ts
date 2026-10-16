// lib/te/vehicle.ts — adding a vehicle, and what its RC says about it.
//
// Ported from the prototype's rcNorm / rcFmtOk / rcShow / rcValidity / vehForm
// (ui-10-vehicles-rc.js, engine.js 736-790). Pure, so the number format and the
// "can this be added" gating are tested rather than eyeballed.
//
// WHY THE RC MATTERS. The vehicle's type sets the rate a km, and the type comes
// from the registration certificate, not from what the employee says. A
// hatchback declared as an SUV is paid as a hatchback. That decision is the
// server's — GET /api/te/vehicles/lookup answers it — and this file only words
// the answer and works out which buttons are live.
import type { RcChecked, TeVehicle, TeVehicleType } from './types.ts'
import { day } from './format.ts'

/** The company's vehicle rules (cfg.vehx), read not invented. */
export interface VehicleRules {
  /** Who may own a vehicle the company pays for. */
  owner?: 'self' | 'family' | 'any' | string
  /** 'block' refuses a vehicle whose insurance has lapsed; anything else warns. */
  insurance?: string
  [k: string]: unknown
}

export const WHOSE_LABEL: Record<string, string> = {
  self: 'Mine',
  family: 'A family member’s',
  other: 'Someone else’s',
}

/** The message the engine itself uses, kept word for word. */
export const REG_FORMAT_MESSAGE = 'Enter the vehicle number as on the RC, like HR26 DK 4821, or 22 BH 1234 AA.'

/** 'hr26 dk 4821' -> 'HR26DK4821'. What goes to the server and to Vahan. */
export function normaliseReg(input: string): string {
  return (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** What the person typed, tidied: upper case, single spaces. */
export function showReg(input: string): string {
  return (input || '').toUpperCase().replace(/\s+/g, ' ').trim()
}

/**
 * Is this a registration number at all?
 *   HR26DK4821  — state, district, series, number (the usual one)
 *   22BH1234AA  — the Bharat series, for a vehicle moved between states
 * Checked before asking Vahan, so a typo costs nothing.
 */
export function isRegValid(input: string): boolean {
  const k = normaliseReg(input)
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(k) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(k)
}

export type MarkTone = 'ok' | 'bad' | 'mute'
export interface RcMark { label: string; tone: MarkTone; text: string }

/** The three small marks under a found RC: registration, insurance, pollution. */
export function rcMarks(rc: Pick<RcChecked, 'rcValid' | 'insValid' | 'pucValid'> | null, today: string): RcMark[] {
  if (!rc) return []
  const one = (label: string, until: string | '' | null | undefined, required: boolean): RcMark | null => {
    // A PUC is not needed for an electric vehicle, and the RC comes back with
    // an empty date rather than a missing one. Saying "not needed" is kinder
    // than leaving a gap the person has to interpret.
    if (!until) return required ? null : { label, tone: 'mute', text: `${label}: not needed` }
    const expired = until < today
    return { label, tone: expired ? 'bad' : 'ok', text: `${label} ${expired ? 'expired' : 'till'} ${longDay(until)}` }
  }
  return [one('RC', rc.rcValid, true), one('Insurance', rc.insValid, true), one('PUC', rc.pucValid, false)]
    .filter((m): m is RcMark => m !== null)
}

/** '7 Dec 2026' — the RC dates carry a year, unlike everything else here. */
export function longDay(iso: string): string {
  return iso ? `${day(iso)} ${iso.slice(0, 4)}` : ''
}

export interface SaveGate {
  /** false when the vehicle cannot be added at all. */
  canSave: boolean
  /** The sentence to show, blocking or not. '' when there is nothing to say. */
  message: string
  /** true when the message is a refusal rather than a caution. */
  blocking: boolean
}

/**
 * May this vehicle be added, and what should the person be told?
 *
 * Every input is the company's own setting or the RC the server returned; none
 * of it is decided here. The server refuses independently at POST /vehicles —
 * this only avoids offering a button that is going to be refused.
 */
export function saveGate(o: { rc: RcChecked | null; rules: VehicleRules; today: string }): SaveGate {
  const { rc, rules, today } = o
  if (!rc) return { canSave: true, message: '', blocking: false }

  // An expired registration is the end of it: the vehicle is not road legal, so
  // no distance on it can be paid.
  if (rc.rcValid && rc.rcValid < today) {
    return { canSave: false, blocking: true, message: `The RC expired on ${longDay(rc.rcValid)}. This vehicle cannot be used for paid travel.` }
  }
  if (rc.insValid && rc.insValid < today) {
    return rules.insurance === 'block'
      ? { canSave: false, blocking: true, message: `The insurance expired on ${longDay(rc.insValid)}. Renew it, then add the vehicle.` }
      : { canSave: true, blocking: false, message: `The insurance expired on ${longDay(rc.insValid)}. You can add it; your approver will see this on every claim.` }
  }
  return { canSave: true, message: '', blocking: false }
}

/** What the company says about whose vehicle it may be. */
export function ownerNote(rules: VehicleRules): string {
  if (rules.owner === 'self') return 'Your company pays only for a vehicle in your name.'
  if (rules.owner === 'family') return 'Your company pays for your own or a family member’s vehicle.'
  return 'Allowed. Your approver sees whose vehicle it is.'
}

/** The rate a kilometre for a vehicle type. 'fixed' is a flat rate; 'fuel'
 *  works out from the fuel price and the mileage, plus wear. */
export function ratePerKm(vt: TeVehicleType | undefined, fuelPrice: Record<string, number>): number {
  if (!vt) return 0
  if (vt.method === 'fixed') return vt.rate
  const price = vt.fuel ? fuelPrice[vt.fuel] ?? 0 : 0
  const kmpl = vt.kmpl || 0
  return kmpl ? Math.round((price / kmpl + (vt.wear || 0)) * 100) / 100 : vt.rate
}

/** The line under a vehicle in a list: what it is and what it pays. */
export function vehicleSubtitle(v: TeVehicle, types: TeVehicleType[], fuelPrice: Record<string, number>): string {
  const vt = types.find(t => t.id === v.type)
  const bits = [
    vt?.name ?? 'Vehicle',
    `₹${ratePerKm(vt, fuelPrice)} a km`,
    v.rc ? `${v.rc.maker} ${v.rc.model}, ${v.rc.fuel}` : 'RC photo with HR',
  ]
  // When the RC disagreed with what the person said, say so plainly rather than
  // quietly paying a different rate.
  if (v.declared && v.declared !== v.type) {
    bits.push(`you said ${types.find(t => t.id === v.declared)?.name ?? v.declared}`)
  }
  return bits.join(' · ')
}
