// Types for te-engine.js, written by hand.
//
// te-engine.js is GENERATED from the prototype's engine (engine/tools/build-engine.js)
// and has about 150 functions. Only what the app and the adapter call is typed
// here; everything else is reachable but untyped through the index signature.
// Routes never use the engine directly: they call te-service.
import type { Snapshot, Uuid, TeEmployee, TePlace, TeTrip, TeLeg, TeExpense, TeClaim, TeVehicleType, TeMode, RcRecord, TeLegStats } from '../types'

export const ENGINE_VERSION: string

export interface Engine {
  /** The loaded state. S.cfg is te_config; S.today is the snapshot's date; S.routeMiss lists the
   *  place pairs whose road distance was not in the snapshot. */
  S: Snapshot & { routesOnly?: boolean; routeMiss?: [Uuid, Uuid][] }
  /** Replace the engine's state with a snapshot. Call once, on a fresh engine. */
  load(snapshot: Snapshot): void
  /** 2-digit GST state code → state name. */
  STATES: Record<string, string>
  emp(id: Uuid): TeEmployee | undefined
  place(id: Uuid): TePlace | undefined
  trip(id: Uuid): TeTrip | undefined
  journey(id: Uuid): TeLeg | undefined
  exp(id: Uuid): TeExpense | undefined
  claim(id: Uuid): TeClaim | undefined
  vtype(code: string): TeVehicleType | undefined
  modeOf(code: string): TeMode | undefined
  /** Straight-line km between two points. */
  hav(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number
  /** 'HR26 dk 4821' → 'HR26DK4821' */
  rcNorm(reg: string): string
  /** State series (HR26DK4821) or BH series (22BH1234AA). */
  rcFmtOk(reg: string): boolean
  rcShow(reg: string): string
  /** RC → te_vehicle_types.code. See lib/te/providers/rc.ts for the exact rule. */
  rcType(rc: Pick<RcRecord, 'cls' | 'fuel' | 'body'>): 'bike' | 'ev' | 'hatch' | 'sedan' | 'suv'
  /** 'match' = first and last word equal, 'partial' = last word equal, else 'no'. Case and punctuation are ignored. */
  nameMatch(owner: string, employee: string): 'match' | 'partial' | 'no'
  maskName(name: string): string
  jStats(leg: TeLeg): TeLegStats
  /** Anything else the engine exports. */
  [fn: string]: unknown
}

/** One engine per request. An engine holds one employee's snapshot and is never shared. */
export function createEngine(): Engine
