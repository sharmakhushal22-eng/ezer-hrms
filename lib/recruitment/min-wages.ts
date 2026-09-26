// lib/recruitment/min-wages.ts — Pan-India minimum wages for the CTC / stipend / fees
// calculators (from the "Automated CTC Calculator Studio" reference).
//
// The HR-maintained `minimum_wage_config` table WINS whenever it holds a current rate for
// the state + category. These defaults (28 states + 8 UTs) fill the states it does not
// cover yet, so the calculator always resolves a floor and never silently skips the rule.

export type WageCat = 'Unskilled' | 'Semi Skilled' | 'Skilled' | 'Highly Skilled'
export const WAGE_CATS: WageCat[] = ['Unskilled', 'Semi Skilled', 'Skilled', 'Highly Skilled']

/** Calculator label → the enum the minimum_wage_config table stores. */
export const CAT_TO_DB: Record<WageCat, string> = {
  'Unskilled': 'UNSKILLED', 'Semi Skilled': 'SEMI_SKILLED', 'Skilled': 'SKILLED', 'Highly Skilled': 'HIGHLY_SKILLED',
}

export const DEFAULT_MIN_WAGES: Record<string, Record<WageCat, number>> = {
  'Andaman & Nicobar Islands':            { 'Unskilled': 14200, 'Semi Skilled': 15600, 'Skilled': 17100, 'Highly Skilled': 18800 },
  'Andhra Pradesh':                       { 'Unskilled': 12500, 'Semi Skilled': 13800, 'Skilled': 15200, 'Highly Skilled': 16900 },
  'Arunachal Pradesh':                    { 'Unskilled': 11800, 'Semi Skilled': 12900, 'Skilled': 14200, 'Highly Skilled': 15800 },
  'Assam':                                { 'Unskilled': 11200, 'Semi Skilled': 12400, 'Skilled': 13800, 'Highly Skilled': 15300 },
  'Bihar':                                { 'Unskilled': 11600, 'Semi Skilled': 12700, 'Skilled': 14000, 'Highly Skilled': 15600 },
  'Chandigarh':                           { 'Unskilled': 15800, 'Semi Skilled': 17200, 'Skilled': 18900, 'Highly Skilled': 20800 },
  'Chhattisgarh':                         { 'Unskilled': 12100, 'Semi Skilled': 13300, 'Skilled': 14700, 'Highly Skilled': 16300 },
  'Dadra & Nagar Haveli and Daman & Diu': { 'Unskilled': 12900, 'Semi Skilled': 14100, 'Skilled': 15500, 'Highly Skilled': 17100 },
  'Delhi':                                { 'Unskilled': 18066, 'Semi Skilled': 19473, 'Skilled': 22411, 'Highly Skilled': 24356 },
  'Goa':                                  { 'Unskilled': 14500, 'Semi Skilled': 15900, 'Skilled': 17400, 'Highly Skilled': 19200 },
  'Gujarat':                              { 'Unskilled': 13400, 'Semi Skilled': 14600, 'Skilled': 15900, 'Highly Skilled': 17200 },
  'Haryana':                              { 'Unskilled': 15220, 'Semi Skilled': 16500, 'Skilled': 18000, 'Highly Skilled': 19500 },
  'Himachal Pradesh':                     { 'Unskilled': 12700, 'Semi Skilled': 13900, 'Skilled': 15300, 'Highly Skilled': 16900 },
  'Jammu & Kashmir':                      { 'Unskilled': 12300, 'Semi Skilled': 13500, 'Skilled': 14900, 'Highly Skilled': 16500 },
  'Jharkhand':                            { 'Unskilled': 11900, 'Semi Skilled': 13100, 'Skilled': 14500, 'Highly Skilled': 16100 },
  'Karnataka':                            { 'Unskilled': 15489, 'Semi Skilled': 17699, 'Skilled': 19537, 'Highly Skilled': 31114 },
  'Kerala':                               { 'Unskilled': 13500, 'Semi Skilled': 15000, 'Skilled': 17500, 'Highly Skilled': 20000 },
  'Ladakh':                               { 'Unskilled': 12500, 'Semi Skilled': 13700, 'Skilled': 15100, 'Highly Skilled': 16700 },
  'Lakshadweep':                          { 'Unskilled': 12000, 'Semi Skilled': 13200, 'Skilled': 14600, 'Highly Skilled': 16200 },
  'Madhya Pradesh':                       { 'Unskilled': 12200, 'Semi Skilled': 13400, 'Skilled': 14800, 'Highly Skilled': 16400 },
  'Maharashtra':                          { 'Unskilled': 14842, 'Semi Skilled': 16327, 'Skilled': 17812, 'Highly Skilled': 19297 },
  'Manipur':                              { 'Unskilled': 11000, 'Semi Skilled': 12100, 'Skilled': 13400, 'Highly Skilled': 14900 },
  'Meghalaya':                            { 'Unskilled': 11400, 'Semi Skilled': 12500, 'Skilled': 13900, 'Highly Skilled': 15400 },
  'Mizoram':                              { 'Unskilled': 11500, 'Semi Skilled': 12600, 'Skilled': 14000, 'Highly Skilled': 15500 },
  'Nagaland':                             { 'Unskilled': 11300, 'Semi Skilled': 12400, 'Skilled': 13700, 'Highly Skilled': 15200 },
  'Odisha':                               { 'Unskilled': 12000, 'Semi Skilled': 13200, 'Skilled': 14600, 'Highly Skilled': 16200 },
  'Puducherry':                           { 'Unskilled': 12800, 'Semi Skilled': 14000, 'Skilled': 15400, 'Highly Skilled': 17000 },
  'Punjab':                               { 'Unskilled': 11389, 'Semi Skilled': 12500, 'Skilled': 13700, 'Highly Skilled': 14900 },
  'Rajasthan':                            { 'Unskilled': 12200, 'Semi Skilled': 13300, 'Skilled': 14500, 'Highly Skilled': 16000 },
  'Sikkim':                               { 'Unskilled': 13000, 'Semi Skilled': 14200, 'Skilled': 15600, 'Highly Skilled': 17300 },
  'Tamil Nadu':                           { 'Unskilled': 13800, 'Semi Skilled': 15100, 'Skilled': 16600, 'Highly Skilled': 18400 },
  'Telangana':                            { 'Unskilled': 12700, 'Semi Skilled': 14000, 'Skilled': 15400, 'Highly Skilled': 17100 },
  'Tripura':                              { 'Unskilled': 11100, 'Semi Skilled': 12200, 'Skilled': 13500, 'Highly Skilled': 15000 },
  'Uttar Pradesh':                        { 'Unskilled': 13690, 'Semi Skilled': 14850, 'Skilled': 16310, 'Highly Skilled': 18090 },
  'Uttarakhand':                          { 'Unskilled': 12600, 'Semi Skilled': 13800, 'Skilled': 15200, 'Highly Skilled': 16800 },
  'West Bengal':                          { 'Unskilled': 12500, 'Semi Skilled': 13600, 'Skilled': 14800, 'Highly Skilled': 16200 },
}

export const MIN_WAGE_STATES = Object.keys(DEFAULT_MIN_WAGES).sort()
export const DEFAULT_STATE = 'Haryana'
export const DEFAULT_CATEGORY: WageCat = 'Unskilled'
export const FALLBACK_MIN_WAGE = 12000

export interface MwRate { state: string; category: string; total_minimum_wage: number }

/** Resolve the monthly minimum wage: HR master → default table → hard fallback. */
export function resolveMinWage(rates: MwRate[] | null | undefined, state: string, cat: WageCat): { amount: number; source: 'master' | 'default' | 'fallback' } {
  const dbCat = CAT_TO_DB[cat]
  const s = (state || '').trim().toLowerCase()
  const hit = (rates || []).find(r => (r.state || '').trim().toLowerCase() === s && (r.category || '').toUpperCase() === dbCat)
  if (hit && Number(hit.total_minimum_wage) > 0) return { amount: Number(hit.total_minimum_wage), source: 'master' }
  const d = DEFAULT_MIN_WAGES[state]?.[cat]
  if (d) return { amount: d, source: 'default' }
  return { amount: FALLBACK_MIN_WAGE, source: 'fallback' }
}

/** Full state name → the code the professional-tax table is keyed by (others → no PT). */
export const STATE_PT_CODE: Record<string, string> = {
  'Karnataka': 'KA', 'Maharashtra': 'MH', 'Tamil Nadu': 'TN', 'Telangana': 'TS', 'Andhra Pradesh': 'AP',
  'West Bengal': 'WB', 'Gujarat': 'GJ', 'Madhya Pradesh': 'MP', 'Odisha': 'OD', 'Assam': 'AS',
  'Kerala': 'KL', 'Haryana': 'HR', 'Delhi': 'DL', 'Uttar Pradesh': 'UP',
}
/** Negotiations saved before this stored the PT code as the state; map them back. */
export const OLD_CODE_TO_STATE: Record<string, string> = Object.fromEntries(Object.entries(STATE_PT_CODE).map(([n, c]) => [c, n]))

// ── Branch → state ─────────────────────────────────────────────────────────────
// The MRF's branch (locations row) decides which state's minimum wage applies —
// e.g. "Ahmedabad Branch" → Gujarat. `locations.state` is the source of truth; the
// city map only covers rows where state was left blank.
const CITY_TO_STATE: Record<string, string> = {
  ahmedabad: 'Gujarat', surat: 'Gujarat', vadodara: 'Gujarat', rajkot: 'Gujarat', gandhinagar: 'Gujarat',
  mumbai: 'Maharashtra', pune: 'Maharashtra', nagpur: 'Maharashtra', nashik: 'Maharashtra', thane: 'Maharashtra', 'navi mumbai': 'Maharashtra',
  'new delhi': 'Delhi', delhi: 'Delhi', gurugram: 'Haryana', gurgaon: 'Haryana', faridabad: 'Haryana', panipat: 'Haryana', ambala: 'Haryana',
  noida: 'Uttar Pradesh', ghaziabad: 'Uttar Pradesh', lucknow: 'Uttar Pradesh', kanpur: 'Uttar Pradesh', agra: 'Uttar Pradesh',
  bengaluru: 'Karnataka', bangalore: 'Karnataka', mysuru: 'Karnataka', mysore: 'Karnataka',
  chennai: 'Tamil Nadu', coimbatore: 'Tamil Nadu', madurai: 'Tamil Nadu',
  hyderabad: 'Telangana', secunderabad: 'Telangana', warangal: 'Telangana',
  kolkata: 'West Bengal', howrah: 'West Bengal',
  jaipur: 'Rajasthan', jodhpur: 'Rajasthan', udaipur: 'Rajasthan', kota: 'Rajasthan',
  ludhiana: 'Punjab', amritsar: 'Punjab', jalandhar: 'Punjab', mohali: 'Punjab', chandigarh: 'Chandigarh',
  bhopal: 'Madhya Pradesh', indore: 'Madhya Pradesh', kochi: 'Kerala', thiruvananthapuram: 'Kerala', kozhikode: 'Kerala',
  bhubaneswar: 'Odisha', patna: 'Bihar', ranchi: 'Jharkhand', raipur: 'Chhattisgarh', dehradun: 'Uttarakhand',
  guwahati: 'Assam', visakhapatnam: 'Andhra Pradesh', vijayawada: 'Andhra Pradesh', panaji: 'Goa', shimla: 'Himachal Pradesh',
}
const STATE_ALIASES: Record<string, string> = { up: 'Uttar Pradesh', mp: 'Madhya Pradesh', ap: 'Andhra Pradesh', tn: 'Tamil Nadu', wb: 'West Bengal', hr: 'Haryana', dl: 'Delhi', ka: 'Karnataka', mh: 'Maharashtra', gj: 'Gujarat', ts: 'Telangana', rj: 'Rajasthan', pb: 'Punjab', kl: 'Kerala', od: 'Odisha', orissa: 'Odisha', 'new delhi': 'Delhi', 'nct of delhi': 'Delhi', 'j&k': 'Jammu & Kashmir', 'jammu and kashmir': 'Jammu & Kashmir', 'andaman and nicobar islands': 'Andaman & Nicobar Islands', 'dadra and nagar haveli and daman and diu': 'Dadra & Nagar Haveli and Daman & Diu' }

/** Normalise any state spelling to the exact MIN_WAGE_STATES name, or '' if unknown. */
export function normalizeStateName(s?: string | null): string {
  const raw = (s || '').trim(); if (!raw) return ''
  const low = raw.toLowerCase()
  if (STATE_ALIASES[low]) return STATE_ALIASES[low]
  const hit = MIN_WAGE_STATES.find(st => st.toLowerCase() === low || st.toLowerCase().replace(/&/g, 'and') === low.replace(/&/g, 'and'))
  return hit || ''
}

/** The minimum-wage state for a branch: locations.state first, then its city/name. */
export function stateFromLocation(loc?: { state?: string | null; city?: string | null; location_name?: string | null } | null): string {
  if (!loc) return ''
  const byState = normalizeStateName(loc.state); if (byState) return byState
  const city = (loc.city || '').trim().toLowerCase()
  if (city && CITY_TO_STATE[city]) return CITY_TO_STATE[city]
  const name = (loc.location_name || '').toLowerCase()
  const key = Object.keys(CITY_TO_STATE).find(c => name.includes(c))
  return key ? CITY_TO_STATE[key] : ''
}
