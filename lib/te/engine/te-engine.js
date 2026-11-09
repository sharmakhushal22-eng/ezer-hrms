/* eslint-disable */
// @ts-nocheck
/* =============================================================================
 * EZER Travel & Expense — rules engine, SERVER BUILD.   GENERATED FILE.
 *
 * Built from the prototype's engine.js by tools/build-engine.js. Do not edit
 * this file: change design/prototype/source/engine.js and build again, so the
 * prototype and the server always run the same rules.
 *
 * EDITED BY HAND ANYWAY, ONCE — see P9 below. Neither the source this was
 * generated from (design/prototype/source/engine.js) nor the generator
 * (tools/build-engine.js) is in this repository: the file was committed in the
 * original import and has never been rebuilt here, so the instruction above
 * cannot be followed. If the prototype is ever restored, apply P9 to it before
 * rebuilding or the rename below is silently undone.
 *
 * Patches applied (20): P1a factory open · P1b factory close · P2a route key · P2b route ends · P2c route direction · P3 mapKm · P4a regions · P4b hubFor · P5 jStats stored · P6a ref · P6b who · P6c B5 · P6d B7 · P6e B4 category name · P8a shared room · P8b B5 wording · P8c G8 text · P7a load · P7b export load · P9 "leg" reads "journey"
 *
 * P9  Users did not understand the word "leg", so every string a person reads
 *     says journey instead: error messages, the G-layer flag titles and their
 *     evidence, and the history lines. Only STRING LITERALS moved — legId,
 *     legsOf, legKm, legGps and addLeg are untouched, as are the data value
 *     { kind: 'leg' } and the developer text thrown while seeding.
 *
 * USE
 *   const { createEngine } = require('./te-engine.js');
 *   const EZ = createEngine();          // one engine per request, never shared
 *   EZ.load(snapshot);                  // snapshot = select te_snapshot(employee)
 *   EZ.assess(lineIds, employeeId, tripId, note)   // … or any other function
 *
 * The engine is pure: no DOM, no network, no database, no clock (today is
 * snapshot.today). Everything it decides is passed on to the SQL functions,
 * which own every state change and all money.
 * ========================================================================== */
/* ===== EZER Travel & Expense — logic engine (pure, no DOM) ===== */
function createEngine() {
  return (function () {
  'use strict';
  const DAY = 864e5;
  const D = s => new Date(s + 'T00:00:00Z');
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (s, n) => iso(D(s).getTime() + n * DAY);
  const days = (a, b) => Math.round((D(b) - D(a)) / DAY);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fd = s => { if (!s) return ''; const t = D(s); return t.getUTCDate() + ' ' + MON[t.getUTCMonth()]; };
  const fdy = s => { if (!s) return ''; return fd(s) + ' ' + D(s).getUTCFullYear(); };
  const fwd = s => WD[D(s).getUTCDay()] + ', ' + fd(s);
  const rs = n => (n < 0 ? '−' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
  const fyOf = s => { const t = D(s), y = t.getUTCFullYear(); return t.getUTCMonth() >= 3 ? y : y - 1; };
  const monthOf = s => s.slice(0, 7);
  const monthName = m => MON[+m.slice(5) - 1] + ' ' + m.slice(0, 4);

  /* ---------- GSTIN (15 chars, Luhn mod 36 check character) ---------- */
  const G36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function gstCheck(b) { let f = 2, sum = 0; for (let i = 13; i >= 0; i--) { let dg = f * G36.indexOf(b[i]); f = f === 2 ? 1 : 2; sum += Math.floor(dg / 36) + (dg % 36); } return G36[(36 - (sum % 36)) % 36]; }
  const gstValid = g => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g || '') && gstCheck(g.slice(0, 14)) === g[14];
  const mkG = b => b + gstCheck(b);

  /* ---------- masters ---------- */
  const CITIES = {
    Gurugram: ['metro', '06'], Delhi: ['metro', '07'], Bengaluru: ['metro', '29'], Mumbai: ['metro', '27'], Chennai: ['metro', '33'],
    Hyderabad: ['metro', '36'], Kolkata: ['metro', '19'], Pune: ['tier1', '27'], Ahmedabad: ['tier1', '24'], Jaipur: ['tier1', '08'],
    Lucknow: ['tier1', '09'], Kochi: ['tier1', '32'], Chandigarh: ['tier1', '04'], Indore: ['tier1', '23'], Nagpur: ['rest', '27'],
    Dehradun: ['rest', '05'], Raipur: ['rest', '22'], Guwahati: ['rest', '18']
  };
  const STATES = { '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh' };
  const COUNTRIES = ['Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Côte d’Ivoire', 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong SAR', 'Hungary', 'Iceland', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macao SAR', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'São Tomé and Príncipe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Türkiye', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'];
  const ZONE_A = ['Australia', 'Austria', 'Belgium', 'Canada', 'Denmark', 'Finland', 'France', 'Germany', 'Hong Kong SAR', 'Ireland', 'Israel', 'Italy', 'Japan', 'Luxembourg', 'Netherlands', 'New Zealand', 'Norway', 'Qatar', 'Singapore', 'South Korea', 'Spain', 'Sweden', 'Switzerland', 'United Arab Emirates', 'United Kingdom', 'United States'];
  const TIERS = [{ id: 'metro', name: 'Metro' }, { id: 'tier1', name: 'Tier 1' }, { id: 'rest', name: 'Rest of India' }, { id: 'intlA', name: 'International, zone A' }, { id: 'intlB', name: 'International, zone B' }];
  /* an international destination is stored as "City, Country", so the country decides the zone */
  const countryOf = c => { const k = (c || '').lastIndexOf(', '), cn = k > 0 ? c.slice(k + 2) : ''; return COUNTRIES.includes(cn) ? cn : ''; };
  const tierOf = c => { if (CITIES[c]) return CITIES[c][0]; if (NCR.includes(c)) return 'metro'; const cn = countryOf(c); return cn ? ((S ? S.cfg.zoneA : ZONE_A).includes(cn) ? 'intlA' : 'intlB') : 'rest'; };
  const stateOf = c => (CITIES[c] || [0, ''])[1];
  const PLACES = [
    { id: 'off', pt: 'corp', s: 'EZER office', name: 'EZER office, Cyber City', addr: 'Building 8B, DLF Cyber City, Phase 2, Gurugram, Haryana 122002', city: 'Gurugram', pin: '122002', lat: 28.4950, lng: 77.0890 },
    { id: 'home', pt: 'home', s: 'Home', name: 'Home, Sector 56', addr: 'Flat 1204, Orchid Residency, Sector 56, Gurugram, Haryana 122011', city: 'Gurugram', pin: '122011', lat: 28.4230, lng: 77.1010 },
    { id: 'uv', pt: 'client', s: 'Udyog Vihar', name: 'Halden Foods, Udyog Vihar', addr: 'Halden Foods, Plot 214, Udyog Vihar Phase 4, Gurugram, Haryana 122015', city: 'Gurugram', pin: '122015', lat: 28.5080, lng: 77.0780 },
    { id: 'soh', pt: 'dealer', s: 'Sohna Road', name: 'Dealer, Sohna Road', addr: 'Sunrise Traders, Shop 12, Vipul Trade Centre, Sohna Road, Sector 48, Gurugram, Haryana 122018', city: 'Gurugram', pin: '122018', lat: 28.4080, lng: 77.0420 },
    { id: 'man', pt: 'factory', s: 'Manesar plant', name: 'IMT Manesar plant', addr: 'Plant 2, Plot 46, Sector 8, IMT Manesar, Gurugram, Haryana 122051', city: 'Manesar', pin: '122051', lat: 28.3590, lng: 76.9380 },
    { id: 'igi', pt: 'airport', code: 'DEL', s: 'Delhi airport T3', name: 'IGI Airport T3', addr: 'Terminal 3, Indira Gandhi International Airport, New Delhi, Delhi 110037', city: 'Delhi', pin: '110037', lat: 28.5562, lng: 77.1000 },
    { id: 'cp', pt: 'client', s: 'Connaught Place', name: 'Connaught Place', addr: 'Halden Foods head office, N-14 Outer Circle, Connaught Place, New Delhi, Delhi 110001', city: 'Delhi', pin: '110001', lat: 28.6315, lng: 77.2167 },
    { id: 'noi', pt: 'client', s: 'Noida client', name: 'Client site, Sector 62 Noida', addr: 'Northwind Retail, Tower C, Stellar IT Park, Sector 62, Noida, Uttar Pradesh 201309', city: 'Noida', pin: '201309', lat: 28.6270, lng: 77.3650 },
    { id: 'far', pt: 'warehouse', s: 'Faridabad warehouse', name: 'Faridabad warehouse, Sector 27', addr: 'Warehouse 5, Plot 88, Sector 27C, Faridabad, Haryana 121003', city: 'Faridabad', pin: '121003', lat: 28.4300, lng: 77.3100 },
    { id: 'ndls', pt: 'station', code: 'NDLS', s: 'New Delhi station', name: 'New Delhi Railway Station', addr: 'New Delhi Railway Station, Ajmeri Gate side, New Delhi, Delhi 110002', city: 'Delhi', pin: '110002', lat: 28.6430, lng: 77.2194 },
    { id: 'blr', pt: 'airport', code: 'BLR', s: 'Bengaluru airport', name: 'Kempegowda International Airport T1', addr: 'Terminal 1, Kempegowda International Airport, Devanahalli, Bengaluru, Karnataka 560300', city: 'Bengaluru', pin: '560300', lat: 13.1986, lng: 77.7066 },
    { id: 'blnw', pt: 'client', s: 'Northwind, Bengaluru', name: 'Northwind Retail, Prestige Tech Park', addr: 'Northwind Retail, 4th Floor, Prestige Tech Park, Kadubeesanahalli, Outer Ring Road, Bengaluru, Karnataka 560103', city: 'Bengaluru', pin: '560103', lat: 12.9352, lng: 77.6950 },
    { id: 'bllk', pt: 'hotel', s: 'Lakeview Residency', name: 'Lakeview Residency, Bellandur', addr: 'Lakeview Residency, 22 Outer Ring Road, Bellandur, Bengaluru, Karnataka 560103', city: 'Bengaluru', pin: '560103', lat: 12.9260, lng: 77.6762 },
    { id: 'bom', pt: 'airport', code: 'BOM', s: 'Mumbai airport T2', name: 'Chhatrapati Shivaji Maharaj International Airport T2', addr: 'Terminal 2, Chhatrapati Shivaji Maharaj International Airport, Andheri East, Mumbai, Maharashtra 400099', city: 'Mumbai', pin: '400099', lat: 19.0896, lng: 72.8656 },
    { id: 'bkc', pt: 'client', s: 'Halden Foods, BKC', name: 'Halden Foods, One BKC', addr: 'Halden Foods, 9th Floor, One BKC, Bandra Kurla Complex, Mumbai, Maharashtra 400051', city: 'Mumbai', pin: '400051', lat: 19.0650, lng: 72.8680 },
    { id: 'pnq', pt: 'airport', code: 'PNQ', s: 'Pune airport', name: 'Pune International Airport', addr: 'Pune International Airport, Lohegaon, Pune, Maharashtra 411032', city: 'Pune', pin: '411032', lat: 18.5821, lng: 73.9197 },
    { id: 'pncv', pt: 'client', s: 'Corvin Logistics, Pune', name: 'Corvin Logistics, Kalyani Nagar', addr: 'Corvin Logistics, Unit 301, Marigold Complex, Kalyani Nagar, Pune, Maharashtra 411014', city: 'Pune', pin: '411014', lat: 18.5470, lng: 73.9020 },
    { id: 'jprs', pt: 'station', code: 'JP', s: 'Jaipur Junction', name: 'Jaipur Junction railway station', addr: 'Jaipur Junction, Station Road, Jaipur, Rajasthan 302006', city: 'Jaipur', pin: '302006', lat: 26.9196, lng: 75.7878 },
    { id: 'jprt', pt: 'dealer', s: 'Rajputana Traders', name: 'Rajputana Traders, Sindhi Camp', addr: 'Rajputana Traders, 22 Sansar Chandra Road, Sindhi Camp, Jaipur, Rajasthan 302001', city: 'Jaipur', pin: '302001', lat: 26.9240, lng: 75.8000 },
    { id: 'dxb', pt: 'airport', code: 'DXB', s: 'Dubai airport T3', name: 'Dubai International Airport T3', addr: 'Terminal 3, Dubai International Airport, Al Garhoud, Dubai, United Arab Emirates', city: 'Dubai', country: 'United Arab Emirates', pin: '', lat: 25.2532, lng: 55.3657 },
    { id: 'dxnw', pt: 'dealer', s: 'Northwind Gulf, Dubai', name: 'Northwind Gulf, Bay Square', addr: 'Northwind Gulf Trading, Office 1204, Bay Square Building 7, Business Bay, Dubai, United Arab Emirates', city: 'Dubai', country: 'United Arab Emirates', pin: '', lat: 25.1865, lng: 55.2810 },
    { id: 'dxht', pt: 'hotel', s: 'Canal View Hotel, Dubai', name: 'Canal View Hotel, Business Bay', addr: 'Canal View Hotel, Marasi Drive, Business Bay, Dubai, United Arab Emirates', city: 'Dubai', country: 'United Arab Emirates', pin: '', lat: 25.1838, lng: 55.2702 }
  ].map(p => Object.assign({ src: 'saved', country: 'India' }, p));
  /* the cities of Delhi NCR share one airport and one main railway station */
  const NCR = ['Gurugram', 'Delhi', 'New Delhi', 'Noida', 'Greater Noida', 'Ghaziabad', 'Faridabad', 'Manesar'];
  let REGIONS = { NCR: NCR };
  const regionOf = c => Object.keys(REGIONS).find(k => (REGIONS[k] || []).includes(c)) || null;
  const HUBS = { NCR: { air: 'igi', rail: 'ndls' }, Bengaluru: { air: 'blr' }, Mumbai: { air: 'bom' }, Pune: { air: 'pnq' }, Jaipur: { rail: 'jprs' }, Dubai: { air: 'dxb' } };
  /* what kind of place each point of a trip is. The admin can rename or switch these off. */
  const PTYPES = [['corp', 'Corporate office'], ['branch', 'Branch or regional office'], ['factory', 'Factory or plant'], ['warehouse', 'Warehouse or depot'], ['client', 'Client site'], ['dealer', 'Dealer or distributor'], ['vendor', 'Vendor or supplier'], ['site', 'Project site'], ['event', 'Event, expo or training venue'], ['govt', 'Bank or government office'], ['airport', 'Airport'], ['station', 'Railway or bus station'], ['hotel', 'Hotel or stay'], ['home', 'Home'], ['other', 'Other']].map(a => ({ id: a[0], name: a[1], on: true }));
  /* why a vehicle stopped on the way. A business stop extends the payable route, a personal one does not. dwell = demo minutes. */
  const STOP_REASONS = [['meet', 'Meeting on the way', 1, 40], ['pick', 'Pick up or drop a colleague', 1, 8], ['goods', 'Collect or deliver material', 1, 20], ['fuel', 'Fuel or charging', 0, 10], ['meal', 'Meal or tea break', 0, 25], ['toll', 'Toll or parking', 0, 3], ['rest', 'Rest break', 0, 15], ['vehicle', 'Vehicle problem', 0, 35], ['other', 'Other', 0, 12]].map(a => ({ id: a[0], name: a[1], biz: !!a[2], dwell: a[3], on: true }));
  /* a small locality list stands in for the map provider's place search and geocoder */
  const GAZ = [['DLF Cyber City', 'Gurugram', '06', '122002', 28.4950, 77.0890], ['Udyog Vihar Phase 4', 'Gurugram', '06', '122015', 28.5080, 77.0780], ['MG Road', 'Gurugram', '06', '122002', 28.4795, 77.0802], ['Sector 29', 'Gurugram', '06', '122001', 28.4672, 77.0660], ['Sector 44', 'Gurugram', '06', '122003', 28.4513, 77.0715], ['Golf Course Road', 'Gurugram', '06', '122011', 28.4372, 77.1036], ['Sector 56', 'Gurugram', '06', '122011', 28.4230, 77.1010], ['Sohna Road', 'Gurugram', '06', '122018', 28.4080, 77.0420], ['Palam Vihar', 'Gurugram', '06', '122017', 28.5080, 77.0380], ['Huda City Centre', 'Gurugram', '06', '122001', 28.4593, 77.0727], ['IMT Manesar', 'Manesar', '06', '122051', 28.3590, 76.9380],
    ['IGI Airport Terminal 3', 'Delhi', '07', '110037', 28.5562, 77.1000], ['Aerocity', 'Delhi', '07', '110037', 28.5494, 77.1211], ['Connaught Place', 'Delhi', '07', '110001', 28.6315, 77.2167], ['Nehru Place', 'Delhi', '07', '110019', 28.5494, 77.2520], ['Saket', 'Delhi', '07', '110017', 28.5245, 77.2066], ['Dwarka Sector 21', 'Delhi', '07', '110077', 28.5523, 77.0583], ['Okhla Phase 3', 'Delhi', '07', '110020', 28.5510, 77.2700], ['Karol Bagh', 'Delhi', '07', '110005', 28.6514, 77.1907],
    ['Sector 62', 'Noida', '09', '201309', 28.6270, 77.3650], ['Sector 18', 'Noida', '09', '201301', 28.5700, 77.3260], ['Sector 135', 'Noida', '09', '201304', 28.4990, 77.4030], ['Knowledge Park', 'Greater Noida', '09', '201310', 28.4744, 77.4900], ['Vaishali', 'Ghaziabad', '09', '201010', 28.6450, 77.3390], ['Sector 27', 'Faridabad', '06', '121003', 28.4300, 77.3100], ['NIT Faridabad', 'Faridabad', '06', '121001', 28.3900, 77.3000],
    ['Bellandur', 'Bengaluru', '29', '560103', 12.9260, 77.6762], ['Koramangala', 'Bengaluru', '29', '560034', 12.9352, 77.6245], ['Whitefield', 'Bengaluru', '29', '560066', 12.9698, 77.7500], ['Outer Ring Road', 'Bengaluru', '29', '560103', 12.9352, 77.6950], ['Bandra Kurla Complex', 'Mumbai', '27', '400051', 19.0650, 72.8680], ['Andheri East', 'Mumbai', '27', '400069', 19.1136, 72.8697], ['Lower Parel', 'Mumbai', '27', '400013', 18.9953, 72.8302], ['Kalyani Nagar', 'Pune', '27', '411014', 18.5470, 73.9020], ['Hinjewadi', 'Pune', '27', '411057', 18.5912, 73.7389], ['Sindhi Camp', 'Jaipur', '08', '302001', 26.9240, 75.8000], ['Kherki Daula toll plaza', 'Gurugram', '06', '122004', 28.3967, 76.9822], ['Hero Honda Chowk', 'Gurugram', '06', '122001', 28.4280, 77.0090], ['Rajiv Chowk', 'Gurugram', '06', '122001', 28.4479, 77.0316], ['KR Puram', 'Bengaluru', '29', '560036', 13.0075, 77.6950], ['Kothanur', 'Bengaluru', '29', '560077', 13.0600, 77.6500], ['Bagaluru Cross', 'Bengaluru', '29', '560063', 13.1350, 77.6700], ['Hoodi', 'Bengaluru', '29', '560048', 12.9900, 77.7150], ['Mahipalpur', 'Delhi', '07', '110037', 28.5440, 77.1240], ['Malviya Nagar', 'Jaipur', '08', '302017', 26.8530, 75.8050],
    ['Business Bay', 'Dubai', '', '', 25.1865, 55.2810, 'United Arab Emirates'], ['Dubai Marina', 'Dubai', '', '', 25.0805, 55.1403, 'United Arab Emirates'], ['Deira', 'Dubai', '', '', 25.2697, 55.3095, 'United Arab Emirates'], ['Al Garhoud', 'Dubai', '', '', 25.2420, 55.3480, 'United Arab Emirates'], ['Dubai Festival City', 'Dubai', '', '', 25.2240, 55.3530, 'United Arab Emirates'], ['Al Jaddaf', 'Dubai', '', '', 25.2180, 55.3290, 'United Arab Emirates'], ['Oud Metha', 'Dubai', '', '', 25.2330, 55.3150, 'United Arab Emirates'], ['Dubai Creek Harbour', 'Dubai', '', '', 25.2000, 55.3450, 'United Arab Emirates'], ['Sheikh Zayed Road, Trade Centre', 'Dubai', '', '', 25.2240, 55.2850, 'United Arab Emirates'], ['Marina Bay', 'Singapore', '', '018956', 1.2834, 103.8607, 'Singapore'], ['Changi Airport', 'Singapore', '', '819663', 1.3644, 103.9915, 'Singapore'], ['Canary Wharf', 'London', '', 'E14 5AB', 51.5054, -0.0235, 'United Kingdom'], ['Heathrow Airport', 'London', '', 'TW6 1QG', 51.4700, -0.4543, 'United Kingdom'], ['Midtown Manhattan', 'New York', '', '10036', 40.7549, -73.9840, 'United States'], ['JFK Airport', 'New York', '', '11430', 40.6413, -73.7781, 'United States'], ['Frankfurt Airport', 'Frankfurt', '', '60547', 50.0379, 8.5622, 'Germany'], ['Bankenviertel', 'Frankfurt', '', '60311', 50.1109, 8.6721, 'Germany']
  ].map(a => ({ n: a[0], city: a[1], state: a[2], pin: a[3], lat: a[4], lng: a[5], country: a[6] || 'India' }));
  /* the first two digits of an Indian PIN code name its postal circle, and so the state */
  const PIN2 = {}; [[[11], ['07']], [[12, 13], ['06']], [[14, 15], ['03']], [[16], ['03', '04']], [[17], ['02']], [[18, 19], ['01', '38']], [[20, 21, 22, 23, 24, 25, 26, 27, 28], ['09', '05']], [[30, 31, 32, 33, 34], ['08']], [[36, 37, 38, 39], ['24', '26']], [[40, 41, 42, 43, 44], ['27', '30']], [[45, 46, 47, 48], ['23']], [[49], ['22']], [[50], ['36']], [[51, 52, 53], ['37', '36']], [[56, 57, 58, 59], ['29']], [[60, 61, 62, 63, 64], ['33', '34']], [[67, 68, 69], ['32', '31']], [[70, 71, 72, 73, 74], ['19', '11', '35']], [[75, 76, 77], ['21']], [[78], ['18']], [[79], ['12', '13', '14', '15', '16', '17', '18']], [[80, 81, 82, 83, 84, 85], ['10', '20']]].forEach(r => r[0].forEach(k => { PIN2[k] = r[1]; }));
  const pinOk = pin => /^[1-9]\d{5}$/.test(pin || '');
  const pinStates = pin => pinOk(pin) ? PIN2[+String(pin).slice(0, 2)] || [] : [];
  const CITY_STATE = { Noida: '09', 'Greater Noida': '09', Ghaziabad: '09', Faridabad: '06', Manesar: '06', 'New Delhi': '07',
    Srinagar: '01', Jammu: '01', Shimla: '02', Manali: '02', Dharamshala: '02', Solan: '02', Amritsar: '03', Ludhiana: '03', Jalandhar: '03', Mohali: '03', Patiala: '03', Haridwar: '05', Rishikesh: '05', Haldwani: '05', Panipat: '06', Sonipat: '06', Karnal: '06', Ambala: '06', Hisar: '06', Rohtak: '06', Panchkula: '06', Rewari: '06',
    Jodhpur: '08', Udaipur: '08', Kota: '08', Ajmer: '08', Bikaner: '08', Neemrana: '08', Bhiwadi: '08', Kanpur: '09', Agra: '09', Varanasi: '09', Prayagraj: '09', Meerut: '09', Aligarh: '09', Bareilly: '09', Gorakhpur: '09', Mathura: '09', Patna: '10', Gaya: '10', Gangtok: '11', Itanagar: '12', Kohima: '13', Imphal: '14', Aizawl: '15', Agartala: '16', Shillong: '17', Dispur: '18', Siliguri: '19', Durgapur: '19', Howrah: '19', Asansol: '19',
    Ranchi: '20', Jamshedpur: '20', Dhanbad: '20', Bhubaneswar: '21', Cuttack: '21', Rourkela: '21', Bhilai: '22', Bilaspur: '22', Bhopal: '23', Gwalior: '23', Jabalpur: '23', Ujjain: '23', Surat: '24', Vadodara: '24', Rajkot: '24', Gandhinagar: '24', Bhavnagar: '24', Jamnagar: '24', Daman: '26', Silvassa: '26', Thane: '27', 'Navi Mumbai': '27', Nashik: '27', Aurangabad: '27', 'Chhatrapati Sambhajinagar': '27', Kolhapur: '27', Solapur: '27',
    Mysuru: '29', Mysore: '29', Mangaluru: '29', Hubballi: '29', Belagavi: '29', Panaji: '30', Margao: '30', Vasco: '30', Kavaratti: '31', Thiruvananthapuram: '32', Kozhikode: '32', Thrissur: '32', Ernakulam: '32', Coimbatore: '33', Madurai: '33', Tiruchirappalli: '33', Salem: '33', Hosur: '33', Puducherry: '34', 'Port Blair': '35', Visakhapatnam: '37', Vijayawada: '37', Guntur: '37', Tirupati: '37', Nellore: '37', Warangal: '36', Secunderabad: '36', Leh: '38' };
  const cityState = c => { const k = Object.keys(CITIES).concat(Object.keys(CITY_STATE)).find(n => n.toLowerCase() === String(c || '').trim().toLowerCase()); return k ? (CITIES[k] ? CITIES[k][1] : CITY_STATE[k]) : ''; };
  /* null when the PIN code fits the state, else the sentence that says why not */
  function pinIssue(pin, state) { if (!pinOk(pin)) return 'Enter a valid 6-digit PIN code.'; const ok = pinStates(pin); if (!ok.length) return 'PIN code ' + pin + ' is not a civilian PIN code. Check it.'; if (state && !ok.includes(state)) return 'PIN code ' + pin + ' belongs to ' + ok.map(c => STATES[c]).filter(Boolean).slice(0, 2).join(' or ') + ', not ' + (STATES[state] || 'the chosen state') + '. Check the PIN code or the state.'; return null; }
  const CITY_XY = { Gurugram: [28.4595, 77.0266], Delhi: [28.6139, 77.2090], 'New Delhi': [28.6139, 77.2090], Noida: [28.5355, 77.3910], 'Greater Noida': [28.4744, 77.5040], Faridabad: [28.4089, 77.3178], Ghaziabad: [28.6692, 77.4538], Manesar: [28.3590, 76.9380], Bengaluru: [12.9716, 77.5946], Mumbai: [19.0760, 72.8777], Chennai: [13.0827, 80.2707], Hyderabad: [17.3850, 78.4867], Kolkata: [22.5726, 88.3639], Pune: [18.5204, 73.8567], Ahmedabad: [23.0225, 72.5714], Jaipur: [26.9124, 75.7873], Lucknow: [26.8467, 80.9462], Kochi: [9.9312, 76.2673], Chandigarh: [30.7333, 76.7794], Indore: [22.7196, 75.8577], Nagpur: [21.1458, 79.0882], Dehradun: [30.3165, 78.0322], Raipur: [21.2514, 81.6296], Guwahati: [26.1445, 91.7362], Dubai: [25.2048, 55.2708], Singapore: [1.3521, 103.8198], London: [51.5072, -0.1276], 'New York': [40.7128, -74.0060], Frankfurt: [50.1109, 8.6821] };
  const CITY_CTRY = { Dubai: 'United Arab Emirates', Singapore: 'Singapore', London: 'United Kingdom', 'New York': 'United States', Frankfurt: 'Germany' };
  const place = id => ((S && S.places) || PLACES).find(p => p.id === id);
  const r1 = n => Math.round(n * 10) / 10;
  function hav(a, b) { const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLn = (b.lng - a.lng) * r, q = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(q)); }
  function seedRnd(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const pathLen = pts => { let d = 0; for (let i = 1; i < pts.length; i++) d += hav(pts[i - 1], pts[i]); return d; };
  const ROUTE_CACHE = {};
  /* the shortest road route between two places. In production this comes from the map provider's directions API. */
  function routePts(f, t) {
    const pair = [f, t].sort(), key = pair.join('|'); let pts = ROUTE_CACHE[key];
    if (!pts) {
      const a = place(pair[0]), b = place(pair[1]), rnd = seedRnd(pair.join('-')), dLa = b.lat - a.lat, dLn = b.lng - a.lng, len = Math.hypot(dLa, dLn) || 1e-6, px = -dLn / len, py = dLa / len;
      const A = len * (0.11 + 0.07 * rnd()), ph1 = rnd() * 6.28, ph2 = rnd() * 6.28, n = 36; pts = [];
      for (let i = 0; i <= n; i++) { const u = i / n, o = A * Math.sin(Math.PI * u) * (0.9 * Math.sin(3 * Math.PI * u + ph1) + 0.45 * Math.sin(7 * Math.PI * u + ph2)); pts.push({ lat: a.lat + dLa * u + px * o, lng: a.lng + dLn * u + py * o }); }
      ROUTE_CACHE[key] = pts;
    }
    return f === pair[0] ? pts : pts.slice().reverse();
  }
  const mapKm = (f, t) => {
    if (!(f && t && f !== t && place(f) && place(t))) return 0;
    const R = S && S.routes; if (R) { const v = R[f + '|' + t] != null ? R[f + '|' + t] : R[t + '|' + f]; if (v != null) return r1(+v); }
    if (S && S.routesOnly) { (S.routeMiss = S.routeMiss || []).push([f, t]); return r1(hav(place(f), place(t)) * (+(S.cfg.track || {}).roadFactor || 1.3)); }
    return r1(pathLen(routePts(f, t)));
  };
  const CATS = [
    { id: 'air', name: 'Air travel', icon: 'plane', needsTrip: true, proof: 'always', group: 'Travel' },
    { id: 'train', name: 'Train', icon: 'train', needsTrip: true, proof: 'always', group: 'Travel' },
    { id: 'bus', name: 'Bus ticket', icon: 'bus', needsTrip: true, proof: 'always', group: 'Travel' },
    { id: 'hotel', name: 'Hotel stay', icon: 'bed', needsTrip: true, proof: 'always', group: 'Stay' },
    { id: 'meals', name: 'Meals', icon: 'food', needsTrip: true, proof: 'above', group: 'Food' },
    { id: 'cab', name: 'Cab or taxi', icon: 'car', needsTrip: false, proof: 'above', group: 'Local travel' },
    { id: 'local', name: 'Local conveyance, no bill', icon: 'pin', needsTrip: false, proof: 'none', group: 'Local travel' },
    { id: 'mileage', name: 'Own vehicle', icon: 'car', needsTrip: false, proof: 'none', group: 'Local travel' },
    { id: 'toll', name: 'Toll and parking', icon: 'ticket', needsTrip: false, proof: 'above', group: 'Local travel' },
    { id: 'client', name: 'Client entertainment', icon: 'users', needsTrip: false, proof: 'always', group: 'Other' },
    { id: 'comm', name: 'Courier and communication', icon: 'file', needsTrip: false, proof: 'above', group: 'Other' },
    { id: 'misc', name: 'Miscellaneous', icon: 'receipt', needsTrip: false, proof: 'above', group: 'Other' }
  ];
  const cat = id => S.cfg.cats.find(c => c.id === id);
  const AIR = ['Economy', 'Premium Economy', 'Business'], RAIL = ['SL', '3A', '2A', '1A'];

  const CHECKS = [
    ['A1', 'A', 'Mandatory fields and proofs are present', 'block', '', 1], ['A2', 'A', 'Bill date is not in the future and is inside the bill-age limit', 'block', '', 1],
    ['A3', 'A', 'PNR or ticket reference has the right format', 'warn', 'low', 1], ['A4', 'A', 'GSTIN has valid format and checksum', 'warn', 'low', 1],
    ['A5', 'A', 'Typed amount differs from the amount read from the bill', 'justify', 'medium', 1], ['A6', 'A', 'Claimed amount is more than the bill amount', 'block', '', 1],
    ['B1', 'B', 'Same file fingerprint as an earlier upload', 'block', '', 1], ['B2', 'B', 'Near-identical bill image', 'warn', 'high', 1],
    ['B3', 'B', 'Same merchant and invoice number', 'block', '', 1], ['B4', 'B', 'Same employee, date, amount and category', 'warn', 'low', 1],
    ['B5', 'B', 'Different employees, same merchant, date and amount', 'warn', 'medium', 1], ['B6', 'B', 'Same PNR, cab trip ID or FASTag ID claimed twice', 'block', '', 1],
    ['B7', 'B', 'Self-paid line matches a company-paid booking', 'block', '', 1],
    ['C1', 'C', 'Expense date is an approved leave day', 'justify', 'medium', 1], ['C2', 'C', 'Office punch on a day claimed as outstation', 'warn', 'high', 1],
    ['C3', 'C', 'Expense date is outside the trip dates', 'warn', 'low', 1], ['C4', 'C', 'Local travel or other expense on a weekly off or holiday', 'warn', 'low', 1],
    ['C5', 'C', 'Merchant state is not a trip city', 'warn', 'medium', 1], ['C6', 'C', 'Hotel nights exceed trip nights, or stays overlap', 'block', '', 1],
    ['C7', 'C', 'Timeline conflict between travel and spend', 'warn', 'medium', 0], ['C8', 'C', 'Employee already tagged as co-traveller on the bill', 'block', '', 0],
    ['C9', 'C', 'Employee is past date of leaving', 'block', '', 0], ['C10', 'C', 'Trip overlaps another trip of the same employee', 'block', '', 1], ['C11', 'C', 'Hotel or flight on a local trip', 'block', '', 1],
    ['D1', 'D', 'Claimed distance exceeds map distance beyond tolerance', 'cap', 'medium', 1], ['D2', 'D', 'Two or more bills from one merchant on one day', 'warn', 'medium', 1],
    ['D3', 'D', 'Amounts repeatedly just under a limit', 'warn', 'medium', 0], ['D4', 'D', 'Repeated round amounts on no-bill lines', 'warn', 'low', 1],
    ['D5', 'D', 'Amount far above peers', 'warn', 'medium', 0], ['D6', 'D', 'Consecutive bill numbers from one merchant', 'warn', 'high', 0],
    ['D7', 'D', 'High share of no-bill lines', 'warn', 'medium', 0], ['D8', 'D', 'Cash to one merchant in a day above ₹10,000', 'warn', 'medium', 1],
    ['D9', 'D', 'Restricted words on the bill', 'warn', 'medium', 1], ['D10', 'D', 'Claim exceeds the approved trip estimate', 'justify', 'medium', 1],
    ['E1', 'E', 'Image metadata shows editing software', 'warn', 'medium', 1], ['E2', 'E', 'PDF produced by a bill-generator tool', 'warn', 'high', 1],
    ['E3', 'E', 'E-invoice QR code does not match typed values', 'warn', 'high', 0], ['E4', 'E', 'GSTIN live status lookup', 'warn', 'medium', 0],
    ['F1', 'F', 'Approver is the claimant or a co-traveller', 'reroute', '', 1], ['F2', 'F', 'Approver clears flagged claims within seconds', 'report', '', 0],
    ['F3', 'F', 'One approver always approves one employee’s flags', 'report', '', 0], ['F4', 'F', 'Random sample of clean claims', 'sample', '', 1],
    ['G1', 'G', 'Journey started or checked in away from the planned start point', 'warn', 'medium', 1], ['G2', 'G', 'Journey ended or checked in away from the planned destination', 'justify', 'medium', 1],
    ['G3', 'G', 'GPS distance exceeds the shortest map route beyond tolerance', 'cap', 'medium', 1], ['G4', 'G', 'Tracking gap: no location for several minutes', 'warn', 'medium', 1],
    ['G5', 'G', 'Impossible speed or location jump (possible mock location)', 'warn', 'high', 1], ['G6', 'G', 'Mock-location app or developer mode found on the device', 'block', '', 0],
    ['G7', 'G', 'Travel journey without a GPS record or check-ins', 'justify', 'medium', 1], ['G8', 'G', 'Fare per km is above the ceiling for the mode', 'warn', 'medium', 1],
    ['G9', 'G', 'Vehicle is not verified in the employee’s profile', 'warn', 'low', 1], ['G10', 'G', 'Daily distance cap exceeded', 'cap', 'medium', 1], ['G11', 'G', 'Long stop on the way for a personal reason', 'warn', 'low', 1], ['G12', 'G', 'Own vehicle is registered in another person’s name', 'warn', 'low', 1], ['G13', 'G', 'Vehicle insurance or RC was not valid on the day of the drive', 'warn', 'medium', 1]
  ].map(a => ({ c: a[0], layer: a[1], t: a[2], a: a[3], s: a[4], on: true, live: !!a[5] }));
  const LAYERS = { A: 'Format and completeness', B: 'Duplicates', C: 'Cross-checks with EZER data', D: 'Amounts and patterns', E: 'Bill authenticity', F: 'Approval-side controls', G: 'Trip journeys, GPS and vehicles' };

  /* the approval chain the admin builds. who: rm (R1), rm2 (R2), hod, person, finance (the Finance team).
     when: empty = always, else any of: amount above, kind of trip, post-facto, policy exception, high risk */
  function defaultFlows() {
    return {
      claim: { levels: [
        { id: 'c1', kind: 'approve', label: 'Reporting manager (R1)', who: 'rm', person: '', when: [] },
        { id: 'c2', kind: 'approve', label: 'Head of department', who: 'hod', person: '', when: [{ t: 'amount', v: 30000 }, { t: 'exception' }, { t: 'postFacto' }] },
        { id: 'c3', kind: 'finance', label: 'Finance check', who: 'finance', person: '', when: [] }
      ] },
      trip: { levels: [
        { id: 't1', kind: 'approve', label: 'Reporting manager (R1)', who: 'rm', person: '', when: [] },
        { id: 't2', kind: 'approve', label: 'Head of department', who: 'hod', person: '', when: [{ t: 'amount', v: 30000 }, { t: 'scope', v: 'international' }] }
      ] }
    };
  }
  function defaultCfg() {
    return {
      billAgeDays: 90, claimDeadlineDays: 15, noticeDays: 3, receiptAbove: 200, noBillPerDay: 300, advanceMaxPct: 80, graceDays: 7,
      mileageTol: 10, estimateTol: 10, hodAbove: 30000, postFacto: 'limited', postFactoPerQuarter: 2, autoApprove: false,
      fastTrack: 5000, samplePct: 10, reminderDays: 2, escalateDays: 5, fallback: 'SRS0101',
      flows: defaultFlows(), teams: { finance: ['SRS0101', 'SRS0102'] },
      grades: ['E1', 'M1', 'M2', 'L1'],
      limits: {
        E1: { metro: { hotel: 3500, meals: 900, conv: 600 }, tier1: { hotel: 2800, meals: 750, conv: 500 }, rest: { hotel: 2200, meals: 600, conv: 400 }, intlA: { hotel: 14000, meals: 5000, conv: 3000 }, intlB: { hotel: 9000, meals: 3500, conv: 2000 } },
        M1: { metro: { hotel: 4200, meals: 1000, conv: 700 }, tier1: { hotel: 3400, meals: 850, conv: 550 }, rest: { hotel: 2600, meals: 700, conv: 450 }, intlA: { hotel: 16000, meals: 5500, conv: 3500 }, intlB: { hotel: 10000, meals: 4000, conv: 2500 } },
        M2: { metro: { hotel: 5000, meals: 1200, conv: 800 }, tier1: { hotel: 4000, meals: 1000, conv: 600 }, rest: { hotel: 3000, meals: 800, conv: 500 }, intlA: { hotel: 18000, meals: 6000, conv: 4000 }, intlB: { hotel: 12000, meals: 4500, conv: 3000 } },
        L1: { metro: { hotel: 7500, meals: 1800, conv: 1200 }, tier1: { hotel: 6000, meals: 1500, conv: 1000 }, rest: { hotel: 4500, meals: 1200, conv: 800 }, intlA: { hotel: 25000, meals: 8000, conv: 5000 }, intlB: { hotel: 16000, meals: 6000, conv: 4000 } }
      },
      zoneA: ZONE_A.slice(), intlAir: 65000,
      airClass: { E1: 'Economy', M1: 'Economy', M2: 'Economy', L1: 'Premium Economy' },
      trainClass: { E1: '3A', M1: '3A', M2: '2A', L1: '1A' },
      clientPerHead: 1500, miscPerClaim: 1000, commPerClaim: 1500,
      vehicles: [
        { id: 'bike', name: 'Two-wheeler', eg: 'Scooter or motorcycle', method: 'fixed', rate: 4, fuel: 'petrol', kmpl: 45, wear: 1.5, on: true },
        { id: 'hatch', name: 'Hatchback', eg: 'Small car', method: 'fixed', rate: 9, fuel: 'petrol', kmpl: 18, wear: 3.5, on: true },
        { id: 'sedan', name: 'Sedan', eg: 'Mid-size car', method: 'fixed', rate: 11, fuel: 'petrol', kmpl: 15, wear: 4.5, on: true },
        { id: 'suv', name: 'SUV', eg: 'SUV or MUV', method: 'fixed', rate: 13, fuel: 'diesel', kmpl: 13, wear: 5.5, on: true },
        { id: 'ev', name: 'Electric car', eg: 'Battery car, km per kWh', method: 'fuel', rate: 7, fuel: 'ev', kmpl: 7, wear: 3, on: true }
      ],
      fuelPrice: { petrol: 95, diesel: 88, cng: 76, ev: 9 },
      vehx: { rcCheck: true, owner: 'any', insurance: 'flag' },
      modes: [
        { id: 'own', name: 'Own vehicle', icon: 'car', basis: 'km', scopes: ['local', 'domestic'], gps: 'track', stops: true, ceil: 0, cat: 'mileage', on: true },
        { id: 'company', name: 'Company vehicle', icon: 'car', basis: 'none', scopes: ['local', 'domestic'], gps: 'track', stops: true, ceil: 0, on: true },
        { id: 'cab', name: 'Cab or taxi', icon: 'taxi', basis: 'bill', scopes: ['local', 'domestic', 'international'], gps: 'track', stops: true, ceil: 25, minFare: 200, estKm: 16, estMin: 150, cat: 'cab', on: true },
        { id: 'auto', name: 'Auto-rickshaw', icon: 'auto', basis: 'nobill', scopes: ['local', 'domestic'], gps: 'track', stops: true, ceil: 15, minFare: 60, estKm: 12, estMin: 50, cat: 'local', on: true },
        { id: 'public', name: 'City bus or metro', icon: 'bus', basis: 'nobill', scopes: ['local', 'domestic', 'international'], gps: 'track', stops: false, ceil: 5, minFare: 40, estKm: 3, estMin: 30, cat: 'local', on: true },
        { id: 'rental', name: 'Rental car', icon: 'car', basis: 'bill', scopes: ['domestic', 'international'], gps: 'track', stops: true, ceil: 30, minFare: 1500, estKm: 14, estMin: 1500, cat: 'cab', on: true },
        { id: 'train', name: 'Train', icon: 'train', basis: 'ticket', scopes: ['local', 'domestic', 'international'], gps: 'track', stops: false, ceil: 0, estKm: 2, estMin: 300, cat: 'train', on: true },
        { id: 'bus', name: 'Intercity bus', icon: 'bus', basis: 'ticket', scopes: ['domestic', 'international'], gps: 'track', stops: false, ceil: 0, estKm: 1.6, estMin: 300, cat: 'bus', on: true },
        { id: 'flight', name: 'Flight', icon: 'plane', basis: 'ticket', scopes: ['domestic', 'international'], gps: 'checkin', stops: false, ceil: 0, cat: 'air', on: true }
      ],
      track: { gpsRequired: true, manualAllowed: true, intlTrack: false, pingSec: 30, minAccuracy: 50, startRadius: 300, endRadius: 300, hubRadius: 2000, routeTol: 15, gapMin: 5, trainGapMin: 30, maxSpeed: 130, stopMaxMin: 90, preApproveKm: 75, maxKmDay: 150, localMaxKm: 120, localMealCap: 300, abroadFactor: 6, maxKmDayOut: 500, provider: 'Google Maps', retentionDays: 180, journeyClaim: 'instant', pastDays: 7, pastPerMonth: 5, typedAddress: true, noticeAction: 'block', noticeScopes: ['domestic', 'international'] },
      ptypes: PTYPES.map(k => Object.assign({}, k)), stopReasons: STOP_REASONS.map(k => Object.assign({}, k)), domAir: 6000,
      basis: { meals: 'strict', conv: 'strict' },
      breach: { hotel: 'cap', meals: 'cap', conv: 'cap', client: 'justify', misc: 'cap', comm: 'cap', cls: 'justify', nobill: 'cap' },
      weights: { low: 1, medium: 3, high: 8 }, bands: { medium: 3, high: 8 },
      checks: CHECKS.map(c => Object.assign({}, c)), cats: CATS.map(c => Object.assign({}, c))
    };
  }

  /* ---------- state ---------- */
  let S = null;
  const emp = id => S.emp[id];
  const exp = id => S.expenses.find(x => x.id === id);
  const trip = id => S.trips.find(t => t.id === id);
  const claim = id => S.claims.find(c => c.id === id);
  const adv = id => S.advances.find(a => a.id === id);
  const nid = (k, pre, pad) => pre + String(++S.seq[k]).padStart(pad || 4, '0');
  let inAct = 0, stamped = false;
  /* every public action is one event: all its history, audit and status times share one minute */
  const act = fn => function () { if (!inAct) stamped = false; inAct++; try { return fn.apply(this, arguments); } finally { inAct--; } };
  function stamp() { if (!(inAct && stamped)) S.clock += 7; if (inAct) stamped = true; const m = S.clock % 60, h = 9 + Math.floor(S.clock / 60) % 9; return fd(S.today) + ', ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
  function log(who, what, ref) { S.audit.unshift({ at: stamp(), who, what, ref: ref || '' }); }
  const chk = code => S.cfg.checks.find(c => c.c === code);

  /* ---------- trip helpers ---------- */
  /* status as the employee sees it. A local trip whose day passed with no leg started is MISSED. */
  function tStatus(t) {
    if (['PENDING_APPROVAL', 'SENT_BACK'].includes(t.status) && t.origin !== 'POST_FACTO' && S.today > t.start) return 'EXPIRED';
    if (t.status === 'APPROVED') {
      const ls = legsOf(t), began = ls.some(j => j.startedAt || j.manual || ['ENDED', 'SUBMITTED', 'SKIPPED'].includes(j.status));
      if (ls.some(j => ['ACTIVE', 'PAUSED'].includes(j.status))) return 'ONGOING';
      if (ls.length && !ls.some(legOpen)) return 'COMPLETED';
      if (S.today > t.end) return began || t.scope !== 'local' ? 'COMPLETED' : 'MISSED';
      if (began) return 'ONGOING';
    }
    return t.status;
  }
  const fq = s => { const t = D(s), m = t.getUTCMonth(), y = t.getUTCFullYear(); return (m >= 3 ? y : y - 1) + '-Q' + (Math.floor(((m + 9) % 12) / 3) + 1); };
  const tripDays = t => days(t.start, t.end) + 1;
  const tripNights = t => Math.max(0, days(t.start, t.end));
  function limitsFor(empId, city) { return S.cfg.limits[emp(empId).grade][tierOf(city)]; }
  function entitlements(empId, city) {
    const g = emp(empId).grade, L = limitsFor(empId, city);
    return { tier: TIERS.find(t => t.id === tierOf(city)).name, grade: g, hotel: L.hotel, meals: L.meals, conv: L.conv, air: S.cfg.airClass[g], train: S.cfg.trainClass[g] };
  }
  /* travel the Travel Desk books is in the total but not in what the employee pays */
  function selfEstimate(t) { const e = t.estimate || {}; let s = 0; for (const k in e) { if (k === 'desk' || ((k === 'air' || k === 'train') && t.travelBy === 'desk') || (k === 'hotel' && t.stayBy === 'desk')) continue; s += +e[k] || 0; } return s; }
  const estimateTotal = t => Object.values(t.estimate || {}).reduce((a, b) => a + (+b || 0), 0);
  const advanceCap = t => Math.floor(selfEstimate(t) * S.cfg.advanceMaxPct / 100 / 100) * 100;
  const deadline = t => addDays(t.end, S.cfg.claimDeadlineDays);
  const tripAdvance = t => S.advances.find(a => a.tripId === t.id && !['REJECTED', 'CANCELLED'].includes(a.status));
  const outstandingFor = t => { const a = t && tripAdvance(t); return a && ['PAID', 'PART_SETTLED', 'RECOVERY_DUE'].includes(a.status) ? a.outstanding : 0; };

  /* everything that stops a trip plan from being saved (block) or that the approver should see (note). k names the field for the form. */
  function tripIssues(t) {
    const out = [], T = S.cfg.track, B = (x, k) => out.push({ block: true, t: x, k: k || '' }), W = x => out.push({ t: x }), P = t.points || [], pre = t.origin !== 'POST_FACTO', loc = t.scope === 'local';
    if (!['local', 'domestic', 'international'].includes(t.scope)) B('Choose local, domestic or international.', 'scope');
    if (!(t.name || '').trim()) B('Give the trip a name.', 'name'); else if (t.name.trim().length > 60) B('Keep the trip name under 60 characters.', 'name');
    if (!t.purpose) B('Choose why you are travelling.', 'purpose');
    const N = +t.pax || 1, ppl = t.people || [];
    if (!Number.isInteger(N) || N < 1) B('Say how many people travel, including you.', 'pax'); else if (N > 50) B('A trip can have up to 50 people.', 'pax');
    else if (t.people && ppl.length !== N - 1) B('You said ' + N + ' people. List the other ' + (N - 1) + ', or change the number.', 'pax');
    /* A NAME IS ONLY ASKED FOR WHEN THE CODE IS NOT KNOWN. This used to demand
       both, and three lines later looked the person up and knew their name
       perfectly well — so somebody who typed a colleague's code, and was shown
       "Riya Rao - M1 - found in EZER" under the field, was still refused until
       they typed "Riya Rao" themselves. A code that matches nobody still needs
       a name: that is the case where the approver has nothing else to go on. */
    ppl.forEach((p, i) => { const id = (p.id || '').trim().toUpperCase(), n = (p.name || '').trim(); const e = id && id !== 'SYSTEM' ? emp(id) : null;
      if (!id) B('Enter the employee ID of person ' + (i + 2) + '.', 'pax');
      else if (id === t.emp) B('You are already counted. Remove ' + id + ' from the list.', 'pax');
      else if (ppl.findIndex(q => (q.id || '').trim().toUpperCase() === id) !== i) B(id + ' is listed twice.', 'pax');
      else if (!e && !n) B(id + ' is not in EZER, so enter the name of person ' + (i + 2) + ' as well.', 'pax');
      else if (!e) W(id + ' (' + n + ') is not found in EZER. Your approver will check.');
      else if (n && e.name.toLowerCase() !== n.toLowerCase()) W(id + ' is ' + e.name + ' in EZER, not ' + n + '.'); });
    P.forEach((p, i) => { const pl = place(p.place), lbl = i === 0 ? 'where the trip starts' : p.ret ? 'where you return to' : 'destination ' + i; if (!pl) B('Choose ' + lbl + '.', 'p' + i); else if (!p.pt) B('Choose the type of place for ' + pl.s + '.', 'p' + i); else if (i && !p.ret && pre && !(p.what || '').trim()) B('Say what you will do at ' + pl.s + '.', 'p' + i); });
    for (let i = 1; i < P.length; i++) if (P[i].place && P[i].place === P[i - 1].place) B('The same place twice in a row: ' + place(P[i].place).s + '.', 'p' + i);
    if (t.pattern === 'multi' && P.filter((p, i) => i && !p.ret).length < 2) B('A multi-city trip has at least two destinations.', 'p2');
    if (t.pattern === 'round' && !P.some(p => p.ret)) B('Choose where you return to.', 'pr');
    if (!(P[0] || {}).leave) B(loc ? 'Choose the date of the trip.' : 'Choose the start date.', 'd0');
    P.forEach((p, i) => { const nm = (place(p.place) || {}).s || 'destination ' + i; if (i && !p.ret && i < P.length - 1 && !loc && !p.leave) B('Choose when you leave ' + nm + '.', 'd' + i); if (i && p.leave && p.arrive && p.leave < p.arrive) B('You leave ' + nm + ' before you reach it.', 'd' + i); });
    (t.segs || []).forEach((s, i) => {
      const md = modeOf(s.mode), a = place((P[i] || {}).place), b = place((P[i + 1] || {}).place), lbl = (a ? a.s : '…') + ' to ' + (b ? b.s : '…');
      const hk = !loc && md && HUB_OF[s.mode], x = s.xfer || {};
      if (hk && a && b) { const ha = hubPick(a, hk, x.hubA), hb = hubPick(b, hk, x.hubB), w = hk === 'air' ? 'airport' : 'station'; if (!ha) B('Choose the ' + w + ' you leave from in ' + (a.city || a.s) + '.', 'm' + i); if (!hb) B('Choose the ' + w + ' you arrive at in ' + (b.city || b.s) + '.', 'm' + i); }
      if (!s.mode || !md) B('Choose how you travel from ' + lbl + '.', 'm' + i);
      else if (!md.on) B(md.name + ' is switched off by your company. Choose another way for ' + lbl + '.', 'm' + i);
      else if (!md.scopes.includes(t.scope)) B(md.name + ' is not allowed on a ' + t.scope + ' trip. Choose another way for ' + lbl + '.', 'm' + i);
      else if (s.mode === 'own') { const v = S.vehicles.find(k => k.id === s.vehicleId), vt = v && vtype(v.type); if (!v) B('Choose your vehicle for ' + lbl + '.', 'm' + i); else if (!vt || !vt.on) B('Your company no longer pays for ' + (vt ? vt.name.toLowerCase() : 'this vehicle') + '. Choose another way.', 'm' + i); else if (v.rc) { const dd = t.end || t.start || S.today, ok = vehValid(v, dd); if (!ok.rc) B('The RC of ' + v.reg + ' expired on ' + fdy(v.rc.rcValid) + '. Choose another vehicle.', 'm' + i); else if (!ok.ins) { if (S.cfg.vehx.insurance === 'block') B('The insurance of ' + v.reg + ' expired on ' + fdy(v.rc.insValid) + '. Renew it or choose another vehicle.', 'm' + i); else if (!out.some(o => o.t.indexOf(v.reg) >= 0)) W('The insurance of ' + v.reg + ' expired on ' + fdy(v.rc.insValid) + '. Your approver will see this.'); } } if (a && b && (!inIndia(a) || !inIndia(b))) B('Own vehicle is paid only within India.', 'm' + i); }
    });
    const p0 = place((P[0] || {}).place), all = P.map(p => place(p.place)).filter(Boolean), abroad = all.some(p => !inIndia(p));
    if (p0 && all.length > 1) {
      const far = all.map(p => [p, p.id === p0.id ? 0 : inIndia(p) && inIndia(p0) ? mapKm(p0.id, p.id) : 9999]).sort((a, b) => b[1] - a[1])[0];
      if (loc) { if (abroad) B('A place is outside India. Choose International.', 'scope'); else if (far[1] > T.localMaxKm) B(far[0].s + ' is ' + Math.round(far[1]) + ' km from the start. Local trips cover up to ' + T.localMaxKm + ' km, so choose Domestic.', 'scope'); }
      else if (t.scope === 'domestic') { if (abroad) B('A place is outside India. Choose International.', 'scope'); else if (far[1] <= T.localMaxKm && t.start && t.start === t.end) B('Every place is within ' + T.localMaxKm + ' km and there is no night away. Choose Local.', 'scope'); }
      else if (!abroad) B('Every place is in India. Choose Domestic or Local.', 'scope');
    }
    if (+t.advance < 0) B('The advance cannot be negative.', 'adv');
    if (loc && +t.advance > 0) B('A local trip has no advance.', 'adv');
    if (t.start && t.end && t.end >= t.start) {
      const ovs = chk('C10').on ? S.trips.filter(o => o.id !== t.id && o.emp === t.emp && !['REJECTED', 'CANCELLED', 'EXPIRED', 'MISSED'].includes(tStatus(o)) && !(o.end < t.start || o.start > t.end)) : [];
      ovs.forEach(ov => {
        const nm = ov.name || ov.id, ol = ov.scope === 'local';
        if (loc && ol) W('You have another local trip on this day: ' + nm + '.');
        else if (loc !== ol) { const out = loc ? ov : t, day = loc ? t.start : ov.start; /* a local trip on the day an outstation trip starts or ends is fine */ if (day === out.start || day === out.end) W('Same day as ' + (loc ? nm : 'your local trip ' + nm) + '. Fine if the local travel is before you leave or after you are back.'); else B(loc ? 'You are on ' + nm + ' that day. Add this travel as a journey of that trip.' : 'Your local trip ' + nm + ' on ' + fd(ov.start) + ' falls inside these dates. Cancel it or change the dates.', 'd0'); }
        else B('Overlaps your trip ' + nm + ' (' + fd(ov.start) + ' to ' + fd(ov.end) + ').', 'd0');
      });
      const lv = (S.leave[t.emp] || []).filter(d => d >= t.start && d <= t.end);
      if (lv.length) W('You have approved leave on ' + lv.map(fd).join(', ') + ' inside these dates.');
      if (pre) {
        if (t.start < S.today) B('These dates are in the past. Use I already travelled instead.', 'd0');
        else {
          /* THE BOOKING LEAD TIME. A plan is not a ticket. The Travel Desk has
             to find a fare and Finance has to release the money, and a flight
             or a train asked for the same week is dearer when it is available
             at all. So a trip of a kind that has to be booked cannot leave
             sooner than the notice the company asks for.

             NOTHING HERE IS A CONSTANT. How many days is notice_days, which
             kinds of trip it covers is track.noticeScopes, and whether falling
             short stops the plan or only tells the approver is
             track.noticeAction — all three from te_settings, all three edited
             in Admin → Trip and GPS rules. Zero days, or an empty list of
             kinds, switches the rule off without touching this file.

             AN EXISTING TRIP WHOSE DATE HAS NOT MOVED IS NEVER BLOCKED. Fixing
             the purpose of a trip that leaves tomorrow must not lock somebody
             out of their own plan — the lead time is about when you ASK for a
             booking, not about never touching the trip again. Moving the date
             closer is asking again, so that is checked. */
          const needDays = Math.max(0, +S.cfg.noticeDays || 0);
          const scopes = Array.isArray(T.noticeScopes) ? T.noticeScopes : ['domestic', 'international'];
          if (needDays > 0 && scopes.indexOf(t.scope) >= 0 && days(S.today, t.start) < needDays) {
            const was = t.id && t.id !== '__draft__' ? (trip(t.id) || {}).start : null;
            const moved = !was || was !== t.start;
            const word = t.scope === 'international' ? 'International travel' : t.scope === 'domestic' ? 'Domestic travel' : 'This trip';
            const why = word + ' has to be planned at least ' + needDays + ' ' + (needDays === 1 ? 'day' : 'days')
              + ' before you leave, so the Travel Desk can book the ticket and Finance can release the money. '
              + 'The earliest you can leave is ' + fd(addDays(S.today, needDays)) + '.';
            if (T.noticeAction !== 'warn' && moved) B(why, 'd0');
            else W(why);
          }
        }
      } else {
        if (t.end > S.today) B('A trip you already did must have ended.', 'd0');
        if (loc) {
          if (!T.manualAllowed) B('Your company accepts local trips only with a GPS record.');
          else {
            if (days(t.start, S.today) > T.pastDays) B('Older than ' + T.pastDays + ' days. Local trips can be added up to ' + T.pastDays + ' days back.', 'd0');
            const m = monthOf(t.start), used = S.journeys.filter(j => j.emp === t.emp && j.manual && j.tripId !== t.id && (trip(j.tripId) || {}).scope === 'local' && j.status !== 'CANCELLED' && monthOf(j.date) === m).length, mine = Math.max(1, (t.segs || []).length);
            if (used + mine > T.pastPerMonth) B('Only ' + T.pastPerMonth + ' journeys without GPS are allowed in ' + monthName(m) + '. You have used ' + used + '.');
          }
          if (!t.pfReason) B('Say why GPS was not used.', 'pf');
        } else {
          if (S.cfg.postFacto === 'blocked') B('Your company does not allow claims without prior trip approval.');
          if (S.cfg.postFacto === 'limited') {
            const qtr = fq(t.start), n = S.trips.filter(o => o.id !== t.id && o.emp === t.emp && o.scope !== 'local' && o.origin === 'POST_FACTO' && !['REJECTED', 'CANCELLED', 'DRAFT'].includes(o.status) && fq(o.start) === qtr).length;
            if (n >= S.cfg.postFactoPerQuarter) B('You have used all ' + S.cfg.postFactoPerQuarter + ' trips without prior approval allowed this quarter.');
            else W('Trip ' + (n + 1) + ' of ' + S.cfg.postFactoPerQuarter + ' without prior approval this quarter. HOD approval is added.');
          }
          if (!t.pfReason) B('Choose why there was no prior approval.', 'pf');
        }
      }
    }
    if (t.estimate && t.advance > 0 && t.advance > advanceCap(t)) B('Advance is above the cap of ' + rs(advanceCap(t)) + '.', 'adv');
    return out;
  }

  /* ---------- policy engine ---------- */
  /* limits follow the city the employee was in on the day of the bill. A ride to or from the airport or station is not local conveyance. */
  const xferLine = x => { const j = x.journeyId && journey(x.journeyId); return !!j && (j.kind === 'first' || j.kind === 'last'); };
  function policy(lines, empId, t) {
    const res = {}; lines.forEach(x => { res[x.id] = { eligible: x.pay === 'self' ? +x.claimed || 0 : 0, pol: [] }; });
    const own = lines.filter(x => x.pay === 'self').slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const base = limitsFor(empId, emp(empId).base), Lon = d => t && t.points ? limitsFor(empId, cityOn(t, d)) : t ? limitsFor(empId, t.to) : base, br = S.cfg.breach, g = emp(empId).grade, loc = t && t.scope === 'local';
    const apply = (x, over, key, msg, limitTxt, pre) => {
      if (over <= 0) return; const r = res[x.id], act = br[key]; pre = pre ? pre + ' ' : '';
      const b0 = { code: 'POL', key, title: msg, limitTxt };
      if (x.wantException && (x.reason || '').trim()) { r.pol.push(Object.assign(b0, { sev: 'medium', action: 'justify', exception: true, evidence: 'Exception requested for ' + rs(over) + ' over the limit. Reason: ' + x.reason })); return; }
      if (act === 'cap') { r.eligible = Math.max(0, r.eligible - over); r.pol.push(Object.assign(b0, { sev: 'medium', action: 'cap', over, evidence: pre + rs(over) + ' over ' + limitTxt + '. Capped to the limit.' })); }
      else if (act === 'justify') r.pol.push(Object.assign(b0, { sev: 'medium', action: 'justify', over, exception: !!(x.reason || '').trim(), needsReason: !(x.reason || '').trim(), evidence: pre + rs(over) + ' over ' + limitTxt + '. A reason is needed and HOD approval is added.' }));
      else if (act === 'warn') r.pol.push(Object.assign(b0, { sev: 'low', action: 'warn', over, evidence: pre + rs(over) + ' over ' + limitTxt + '.' }));
      else if (act === 'block') r.pol.push(Object.assign(b0, { sev: null, action: 'block', over, block: true, evidence: pre + rs(over) + ' over ' + limitTxt + '. This line cannot be submitted.' }));
      else r.pol.push(Object.assign(b0, { sev: null, action: 'inform', over, evidence: pre + rs(over) + ' over ' + limitTxt + '.' }));
    };
    const pax = t ? 1 + (t.co || []).length : 1;
    own.filter(x => x.cat === 'hotel').forEach(x => { const n = Math.max(1, days(x.checkIn || x.date, x.checkOut || x.date)), L = Lon(x.checkIn || x.date); const lim = L.hotel * n * (x.shared ? pax : 1); apply(x, res[x.id].eligible - lim, 'hotel', 'Over the hotel limit', 'the limit of ' + rs(L.hotel) + ' a night'); });
    const byDay = (arr) => { const m = {}; arr.forEach(x => { (m[x.date] = m[x.date] || []).push(x); }); return m; };
    Object.values(byDay(own.filter(x => x.cat === 'local' && !xferLine(x)))).forEach(list => { let used = 0; list.forEach(x => { const allowed = Math.max(0, S.cfg.noBillPerDay - used); apply(x, res[x.id].eligible - allowed, 'nobill', 'Over the no-bill limit', 'the no-bill limit of ' + rs(S.cfg.noBillPerDay) + ' a day'); used += +x.claimed || 0; }); });
    const limOf = (key, d) => key === 'meals' && loc ? S.cfg.track.localMealCap : Lon(d)[key];
    const daily = (catIds, key, label) => {
      const list = own.filter(x => catIds.includes(x.cat) && !xferLine(x));
      if (S.cfg.basis[key] === 'pooled') {
        let pool = 0; if (t && t.start && t.end) for (let d = t.start; d <= t.end; d = addDays(d, 1)) pool += limOf(key, d); else Object.keys(byDay(list)).forEach(d => { pool += limOf(key, d); }); pool = Math.max(pool, limOf(key, (list[0] || {}).date || S.today)); let used = 0;
        list.forEach(x => { const allowed = Math.max(0, pool - used); apply(x, res[x.id].eligible - allowed, key, 'Over the ' + label + ' pool', 'the trip pool of ' + rs(pool)); used += res[x.id].eligible; });
      } else Object.values(byDay(list)).forEach(dl => { let used = 0; const lim = limOf(key, dl[0].date); dl.forEach(x => { const allowed = Math.max(0, lim - used); const before = res[x.id].eligible; apply(x, before - allowed, key, 'Over the daily ' + label + ' limit', 'the daily limit of ' + rs(lim), used > 0 ? 'Other bills already use ' + rs(Math.min(used, lim)) + ' of the ' + rs(lim) + ' ' + label + ' limit for ' + fd(x.date) + '.' : ''); used += before; }); });
    };
    daily(['meals'], 'meals', 'food'); daily(['cab', 'local'], 'conv', 'local conveyance');
    own.filter(x => x.cat === 'client').forEach(x => { const lim = S.cfg.clientPerHead * Math.max(1, +x.attendees || 1); apply(x, res[x.id].eligible - lim, 'client', 'Over the per-head limit', 'the limit of ' + rs(S.cfg.clientPerHead) + ' a head'); });
    [['misc', S.cfg.miscPerClaim, 'miscellaneous'], ['comm', S.cfg.commPerClaim, 'courier and communication']].forEach(a => { let used = 0; own.filter(x => x.cat === a[0]).forEach(x => { const allowed = Math.max(0, a[1] - used); apply(x, res[x.id].eligible - allowed, a[0], 'Over the ' + a[2] + ' cap', 'the cap of ' + rs(a[1]) + ' a claim'); used += +x.claimed || 0; }); });
    own.filter(x => x.cat === 'air' && x.cls && AIR.indexOf(x.cls) > AIR.indexOf(S.cfg.airClass[g])).forEach(x => apply(x, 1, 'cls', 'Travel class above entitlement', 'your entitlement of ' + S.cfg.airClass[g]));
    own.filter(x => x.cat === 'train' && x.cls && RAIL.indexOf(x.cls) > RAIL.indexOf(S.cfg.trainClass[g])).forEach(x => apply(x, 1, 'cls', 'Travel class above entitlement', 'your entitlement of ' + S.cfg.trainClass[g]));
    return res;
  }

  /* ---------- validation engine ---------- */
  const live = x => !['REJECTED_REFILE', 'EXPIRED', 'DISCARDED'].includes(x.status);
  const normM = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function lineFlags(x) {
    const out = [], c = cat(x.cat), t = x.tripId ? trip(x.tripId) : null, e = emp(x.emp);
    const others = S.expenses.filter(o => o.id !== x.id && live(o));
    const fire = (code, title, evidence, extra) => { const k = chk(code); if (!k || !k.on) return; out.push(Object.assign({ code, title, evidence, action: k.a, sev: k.a === 'block' || k.a === 'inform' ? null : (k.s || 'low'), block: k.a === 'block', needsReason: k.a === 'justify' && !(x.reason || '').trim() }, extra || {})); };
    // A1
    const miss = [];
    if (!x.date) miss.push('date'); if (!(+x.bill > 0) && x.cat !== 'mileage') miss.push('amount');
    if (c && c.proof !== 'none' && !x.merchant) miss.push('merchant');
    if (['air', 'train'].includes(x.cat) && !x.pnr) miss.push('PNR');
    if (x.cat === 'hotel' && (!x.checkIn || !x.checkOut)) miss.push('check-in and check-out');
    if (x.cat === 'client' && (!x.client || !(+x.attendees > 0))) miss.push('client and attendees');
    if (['local', 'misc'].includes(x.cat) && !x.desc) miss.push('description');
    if (x.cat === 'mileage') { if (!x.vehicleId) miss.push('vehicle'); if (!x.journeyId) { if (!x.from || !x.to || x.from === x.to || !(+x.km > 0)) miss.push('from, to and distance'); if (S.cfg.track.gpsRequired && !S.cfg.track.manualAllowed) miss.push('a GPS record (typing the distance is switched off by your company)'); } }
    const needProof = c && (c.proof === 'always' || (c.proof === 'above' && +x.bill > S.cfg.receiptAbove));
    if (needProof && !x.file) miss.push(c.proof === 'always' ? 'bill (always needed for this category)' : 'bill (needed above ' + rs(S.cfg.receiptAbove) + ')');
    if (c && c.needsTrip && !x.tripId) miss.push('a trip (this category needs an outstation trip)');
    if (x.pay === 'self' && x.cat !== 'mileage' && +x.bill > 0 && !(+x.claimed > 0)) miss.push('the amount you claim, more than ₹0');
    if (miss.length) fire('A1', 'Missing: ' + miss.join(', '), 'Add these before you continue.');
    // A2
    if (x.date) {
      if (x.date > S.today) fire('A2', 'Bill date is in the future', fdy(x.date) + ' is after today.');
      else if (days(x.date, S.today) > S.cfg.billAgeDays && x.status === 'UNCLAIMED') fire('A2', 'Bill is older than ' + S.cfg.billAgeDays + ' days', 'Dated ' + fdy(x.date) + ', ' + days(x.date, S.today) + ' days ago.');
    }
    if (x.cat === 'air' && x.pnr && !/^[A-Z0-9]{6}$/.test(x.pnr)) fire('A3', 'Airline PNR should be 6 letters or digits', 'Typed: ' + x.pnr);
    if (x.cat === 'train' && x.pnr && !/^\d{10}$/.test(x.pnr)) fire('A3', 'Rail PNR should be 10 digits', 'Typed: ' + x.pnr);
    if (x.gstin && !gstValid(x.gstin)) fire('A4', 'GSTIN format or checksum is wrong', 'Typed: ' + x.gstin);
    if (x.file && x.file.ocrAmount != null && +x.bill > 0 && Math.abs(x.file.ocrAmount - x.bill) >= 1) fire('A5', 'Typed amount differs from the bill', 'Bill reads ' + rs(x.file.ocrAmount) + ', typed ' + rs(x.bill) + '.');
    if (+x.claimed > +x.bill && x.cat !== 'mileage') fire('A6', 'Claimed amount is more than the bill', 'Claimed ' + rs(x.claimed) + ' against a bill of ' + rs(x.bill) + '.');
    // B
    const ref = o => o.claimId ? (o.claimNo || o.claimId) : 'an unclaimed line', mine = o => o.emp === x.emp, hide = (o, t) => mine(o) ? {} : { evEmp: t };
    const who = o => (emp(o.emp) || { name: 'another employee' }).name + (o.emp === x.emp ? ' (you)' : '');
    if (x.file && x.file.sha) { const m = others.find(o => o.file && o.file.sha === x.file.sha); if (m) fire('B1', 'This exact file was uploaded before', 'Same file is on ' + ref(m) + ' by ' + who(m) + ', ' + fd(m.date) + ', ' + rs(m.bill) + '.', Object.assign({ match: m.id }, hide(m, 'This bill has already been claimed by someone else.'))); else if (x.file.phash) { const n = others.find(o => o.file && o.file.phash === x.file.phash); if (n) fire('B2', 'Looks like a re-photographed copy of an earlier bill', 'Matches the bill on ' + ref(n) + ' by ' + who(n) + '.', Object.assign({ match: n.id }, hide(n, 'This looks like a copy of a bill already claimed.'))); } }
    if (x.billNo && (x.gstin || x.merchant)) { const m = others.find(o => o.billNo && normM(o.billNo) === normM(x.billNo) && ((x.gstin && o.gstin === x.gstin) || (!x.gstin && normM(o.merchant) === normM(x.merchant) && o.date === x.date && +o.bill === +x.bill))); if (m) fire('B3', 'Same merchant and invoice number already claimed', 'Invoice ' + m.billNo + ' from ' + m.merchant + ' is on ' + ref(m) + ' by ' + who(m) + '.', Object.assign({ match: m.id }, hide(m, 'Invoice ' + m.billNo + ' has already been claimed by someone else.'))); }
    { const m = others.find(o => o.emp === x.emp && o.date === x.date && +o.bill === +x.bill && o.cat === x.cat && +x.bill > 0 && x.pay === 'self' && o.pay === 'self'); if (m) fire('B4', 'Possible duplicate of your own line', 'Same date, amount and category as ' + (m.merchant || (cat(m.cat) || { name: 'a line' }).name) + ' on ' + ref(m) + '.', { match: m.id }); }
    if (x.merchant && +x.bill > 0) { const m = others.find(o => o.emp !== x.emp && o.date === x.date && +o.bill === +x.bill && normM(o.merchant) === normM(x.merchant) && normM(o.billNo) !== normM(x.billNo)); if (m) fire('B5', 'Another employee claimed the same merchant, date and amount', (emp(m.emp) || { name: 'Another employee' }).name + ' claimed ' + rs(m.bill) + ' at ' + m.merchant + ' on ' + fd(m.date) + ' (' + ref(m) + ').', { match: m.id, evEmp: 'Another employee claimed the same merchant, date and amount.' }); }
    const rf = x.pnr || x.ref;
    if (rf) {
      const m = others.find(o => (o.pnr || o.ref) === rf && o.pay === 'self'); if (m && x.pay === 'self') fire('B6', 'This reference was claimed before', rf + ' is on ' + ref(m) + ' by ' + who(m) + '.', Object.assign({ match: m.id }, hide(m, rf + ' has already been claimed by someone else.')));
      const b = S.bookings.find(k => k.pnr === rf && k.paidBy === 'company'); if (b && x.pay === 'self') fire('B7', 'This ticket was booked and paid by the company', 'PNR ' + rf + ' is Travel Desk booking ' + (b.no || b.id) + ' on trip ' + (b.tripNo || b.tripId) + ' for ' + rs(b.amount) + '.');
    }
    // C
    if (x.date && (S.leave[x.emp] || []).includes(x.date)) fire('C1', 'You were on approved leave on this date', fwd(x.date) + ' is an approved leave day in Leave records.');
    if (t && t.scope !== 'local' && x.date && S.punch[x.emp] && S.punch[x.emp][x.date]) fire('C2', 'Attendance shows an office punch on this outstation day', 'Punch at ' + S.punch[x.emp][x.date] + ' on ' + fd(x.date) + ', while the line is on a trip to ' + t.to + '.');
    if (t && x.date && (x.date < addDays(t.start, -1) || x.date > addDays(t.end, 1))) fire('C3', 'Date is outside the trip', 'Trip runs ' + fd(t.start) + ' to ' + fd(t.end) + '. This line is dated ' + fd(x.date) + '.');
    if (!t && x.date) { const wd = D(x.date).getUTCDay(); if (S.holidays[x.date]) fire('C4', 'Dated on a holiday', fd(x.date) + ' is ' + S.holidays[x.date] + '.'); else if (wd === 0 || wd === 6) fire('C4', 'Dated on a weekly off', fwd(x.date) + ' is a weekly off.'); }
    if (t && t.scope !== 'international' && x.gstin && gstValid(x.gstin) && ['hotel', 'meals', 'client'].includes(x.cat)) { const st = x.gstin.slice(0, 2), ok = tripStates(t); if (ok.length && !ok.includes(st)) fire('C5', 'Merchant is registered in another state', 'GSTIN state is ' + (STATES[st] || st) + '. The trip is in ' + ok.filter((v, i, a) => a.indexOf(v) === i).map(c => STATES[c]).join(', ') + '.'); }
    /* C7 — the bill is from a city on this trip, but not the city you were in
       that day.
       Deliberately the complement of C5 and never both: C5 fires when the
       merchant's state is NOWHERE on the trip, which is the blunt case. C7 is
       the sharp one — Jaipur and Mumbai are both on the trip, you were in
       Jaipur on the 20th, and this Mumbai dinner is dated the 20th. Nothing in
       the route is wrong and nothing in the state list is wrong; the TIMELINE
       is.
       cityOn(t, date) is what makes it possible: it already answers "which
       city was this trip in on this day" from the points' own arrive and leave
       dates, which is how the limits are picked per day.
       A stay is judged over its whole range, not its start: three nights that
       include one day in the right city is a stay in the right city. */
    if (t && t.scope !== 'international' && x.gstin && gstValid(x.gstin) && ['hotel', 'meals', 'client'].includes(x.cat)) {
      const st = x.gstin.slice(0, 2), onTrip = tripStates(t);
      if (onTrip.includes(st)) {
        const span = [];
        if (x.cat === 'hotel' && x.checkIn && x.checkOut) {
          for (let d = x.checkIn; d < x.checkOut; d = addDays(d, 1)) span.push(d);
        }
        if (!span.length && x.date) span.push(x.date);
        const whereThen = span.map(d => cityOn(t, d)).filter(Boolean);
        const matches = whereThen.some(c => {
          const cs = stateOf(c) || CITY_STATE[c] || '';
          return !cs || cs === st;
        });
        if (span.length && whereThen.length && !matches) {
          const days = span.length > 1 ? fd(span[0]) + ' to ' + fd(span[span.length - 1]) : fd(span[0]);
          fire('C7', 'You were in another city on this date',
            'The bill is registered in ' + (STATES[st] || st) + '. On ' + days + ' this trip was in '
            + [...new Set(whereThen)].join(', ') + '. Both are on the trip, so the dates are what do not line up.');
        }
      }
    }
    /* A local trip CAN have a hotel now: a late finish near the client is a real thing,
       and the planner asks for a stay on every kind of trip. A flight on a local trip is
       still a contradiction, so that half of the check stays. */
    if (t && t.scope === 'local' && x.pay === 'self' && x.cat === 'air') fire('C11', 'A local trip has no flight', 'Plan it as a domestic trip to claim this.');
    /* C8 — somebody else on this trip has already billed for this.
       The co-traveller feature lets several people share one trip, which is
       what makes a shared dinner or one hotel room possible — and the same
       thing that lets one receipt be claimed twice, once by each of them.
       B1 blocks the identical FILE and B5 only warns on merchant, date and
       amount, because company-wide that can be coincidence. On one trip,
       between people who travelled together, it is not.
       Two arms, and the first is the stronger:
         a) the payer declared the bill SHARED, which is them saying out loud
            that it covered the others. Anyone covered by it claiming their
            own is a second claim on one expense.
         b) the same category, date and amount as another person's line on
            this trip, which is one receipt entered twice.
       Only fires when the trip actually has co-travellers; one person's own
       duplicates are B4's job. The approver sees who and what; the employee
       is told it is already claimed and not whose claim or for how much —
       the same masking B1 and B5 use. */
    if (t && x.pay === 'self' && (t.co || []).length && x.cat !== 'mileage') {
      const together = o => o.tripId === x.tripId && o.emp !== x.emp && o.pay === 'self';
      const nightsOverlap = o => x.cat === 'hotel' && x.checkIn && x.checkOut && o.checkIn && o.checkOut
        && x.checkIn < o.checkOut && o.checkIn < x.checkOut;
      const covered = others.find(o => together(o) && o.shared && o.cat === x.cat
        && (nightsOverlap(o) || (!!o.date && o.date === x.date)));
      if (covered) {
        fire('C8', 'A shared bill on this trip already covers this',
          who(covered) + ' claimed this ' + (cat(covered.cat) || {}).name + ' as shared on ' + fd(covered.date)
          + ' (' + ref(covered) + ', ' + rs(covered.bill) + '), which covers everyone on the trip.',
          { match: covered.id, evEmp: 'Someone on this trip has already claimed this as a shared bill.' });
      } else {
        const twice = others.find(o => together(o) && o.cat === x.cat && !!x.date && o.date === x.date
          && +o.bill > 0 && +o.bill === +x.bill);
        if (twice) {
          fire('C8', 'The same bill is claimed by two people on this trip',
            who(twice) + ' claimed ' + rs(twice.bill) + ' for ' + (cat(twice.cat) || {}).name + ' on ' + fd(twice.date)
            + ' (' + ref(twice) + ') on this same trip.',
            { match: twice.id, evEmp: 'Someone on this trip has already claimed a bill like this one.' });
        }
      }
    }
    if (x.cat === 'hotel' && x.checkIn && x.checkOut) {
      const n = days(x.checkIn, x.checkOut);
      if (n <= 0) fire('C6', 'Check-out must be after check-in', '');
      else if (t && n > tripNights(t)) fire('C6', 'Hotel nights exceed trip nights', n + (n === 1 ? ' night' : ' nights') + ' claimed. The trip has ' + tripNights(t) + '.');
      const ov = others.find(o => o.cat === 'hotel' && o.emp === x.emp && o.checkIn && o.checkOut && x.checkIn < o.checkOut && o.checkIn < x.checkOut);
      if (ov) fire('C6', 'Overlaps another hotel stay', 'You already have ' + ov.merchant + ' for ' + fd(ov.checkIn) + ' to ' + fd(ov.checkOut) + '.', { match: ov.id });
    }
    // D
    if (x.pay === 'cash' || (x.payMode === 'Cash' && +x.bill > 10000)) { /* reserved */ }
    if (x.payMode === 'Cash' && +x.bill > 10000) fire('D8', 'Cash payment above ₹10,000 to one merchant', 'Finance will check how this was paid.');
    if (x.file && x.file.text && /\b(whisky|whiskey|beer|vodka|rum|wine|liquor|cigarette|tobacco)\b/i.test(x.file.text)) fire('D9', 'Restricted items found on the bill', 'Words found: ' + x.file.text.match(/\b(whisky|whiskey|beer|vodka|rum|wine|liquor|cigarette|tobacco)\b/ig).join(', ') + '.');
    if (x.file && x.file.editedWith) fire('E1', 'Image was saved from editing software', 'File metadata names ' + x.file.editedWith + '.');
    if (x.file && x.file.producer) fire('E2', 'PDF came from a bill-generator tool', 'PDF producer field: ' + x.file.producer + '.');
    if (x.journeyId) journeyChecks(x, fire);
    return out;
  }
  const tripStates = t => (t.points || []).map(p => place(p.place)).filter(p => inIndia(p)).map(p => p.state || stateOf(p.city) || CITY_STATE[p.city] || (pinStates(p.pin)[0] || '')).filter(Boolean);
  /* ---------- places: where a travel starts and ends ---------- */
  const normT = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const jit = (str, km) => { const r = seedRnd(str); return { dLat: (r() - .5) * 2 * km / 111, dLng: (r() - .5) * 2 * km / 100 }; };
  const myPlaces = e => S.places.filter(p => !p.owner || p.owner === e);
  /* address to coordinates. In production this is the map provider's geocoding API. */
  function geocode(a) {
    const txt = ' ' + normT([a.line, a.area, a.city].join(' ')) + ' ', city = normT(a.city);
    const hits = GAZ.filter(g => txt.includes(' ' + normT(g.n) + ' ') && (!city || normT(g.city) === city || city.includes(normT(g.city)) || normT(g.city).includes(city))).sort((x, y) => y.n.length - x.n.length);
    const g = hits[0] || GAZ.find(k => a.pin && k.pin === a.pin && txt.includes(' ' + normT(k.n).split(' ')[0] + ' '));
    if (g) { const o = jit(txt, 0.12); return { lat: g.lat + o.dLat, lng: g.lng + o.dLng, approx: false, via: 'Found on the map near ' + g.n + ', ' + g.city }; }
    const key = Object.keys(CITY_XY).find(k => normT(k) === city);
    if (key) { const o = jit(txt, 2.2); return { lat: CITY_XY[key][0] + o.dLat, lng: CITY_XY[key][1] + o.dLng, approx: true, via: 'Only the city was found. The pin is near the centre of ' + key }; }
    return null;
  }
  /* coordinates to an address. In production this is the map provider's reverse geocoding API. */
  function reverseGeo(lat, lng) {
    const me = { lat, lng }, all = PLACES.map(p => ({ n: p.s, city: p.city, pin: p.pin, lat: p.lat, lng: p.lng, country: p.country, full: p.addr })).concat(GAZ).map(g => [g, hav(me, g)]).sort((a, b) => a[1] - b[1])[0];
    const co = lat.toFixed(5) + ', ' + lng.toFixed(5);
    if (all && all[1] <= 0.3 && all[0].full) { const g = all[0]; return { s: g.n, addr: g.full + ' (' + co + ')', city: g.city, pin: g.pin, country: g.country || 'India' }; }
    if (all && all[1] <= 3) { const g = all[0], near = all[1] < 0.25 ? '' : 'Near '; return { s: near + g.n, addr: (near ? Math.round(all[1] * 10) / 10 + ' km from ' : '') + g.n + ', ' + g.city + (g.pin ? ' ' + g.pin : '') + (g.country && g.country !== 'India' ? ', ' + g.country : '') + ' (' + co + ')', city: g.city, pin: g.pin, country: g.country || 'India' }; }
    const cty = Object.keys(CITY_XY).map(k => [k, hav(me, { lat: CITY_XY[k][0], lng: CITY_XY[k][1] })]).sort((a, b) => a[1] - b[1])[0];
    const cc = cty && cty[1] < 40 ? cty[0] : ''; return { s: cc ? 'GPS point, ' + cc : 'GPS point', addr: (cc ? cc + '. ' : '') + 'Street address from the map provider. Latitude and longitude ' + co, city: cc, pin: '', country: CITY_CTRY[cc] || (cc ? 'India' : '') };
  }
  function addPlace(empId, o) {
    const lat = +o.lat, lng = +o.lng; if (!isFinite(lat) || !isFinite(lng) || (!lat && !lng)) return { error: 'This place has no position on the map.' };
    let pl;
    if (o.src === 'gps') { const near = myPlaces(empId).map(p => [p, hav(p, { lat, lng })]).sort((a, b) => a[1] - b[1])[0]; if (near && near[1] <= 0.15) return { place: near[0], matched: true }; const r = reverseGeo(lat, lng); pl = { s: r.s, name: r.s, addr: r.addr, city: r.city, pin: r.pin, country: r.country || 'India', acc: Math.round(+o.acc || 0) }; }
    else {
      const line = (o.line || '').trim(), area = (o.area || '').trim(), city = (o.city || '').trim(), pin = (o.pin || '').trim();
      if (!line) return { error: 'Enter the building and street.' }; if (!city) return { error: 'Enter the city.' };
      const ab = o.country && o.country !== 'India';
      if (o.src !== 'search') { if (!area) return { error: 'Enter the area or locality.' }; if (!ab) { const pi = pinIssue(pin, o.state); if (pi) return { error: pi }; } }
      const label = (o.label || '').trim() || area || line;
      pl = { s: label.length > 26 ? label.slice(0, 25) + '…' : label, name: label, addr: ab ? [line, area, city, pin, o.country].filter(Boolean).join(', ') : [line, area, city, STATES[o.state] || '', pin].filter(Boolean).join(', ').replace(/, (\d{6})$/, ' $1'), city, state: ab ? '' : o.state || '', pin, country: ab ? o.country : 'India', approx: !!o.approx };
    }
    const same = S.places.find(p => p.owner === empId && p.src === o.src && p.addr === pl.addr && hav(p, { lat, lng }) < 0.03); if (same) return { place: same, matched: true };
    Object.assign(pl, { id: 'pl' + (++S.seq.place), src: o.src, pt: o.pt || pl.pt || 'other', lat, lng, owner: empId, at: stamp() }); if (!pl.country) pl.country = 'India'; S.places.push(pl); log(empId, 'Added a place: ' + pl.s, pl.id); return { place: pl };
  }
  /* ---------- vehicles, rates and GPS journeys ---------- */
  const journey = id => S.journeys.find(j => j.id === id);
  const modeOf = id => S.cfg.modes.find(m => m.id === id);
  const vtype = id => S.cfg.vehicles.find(v => v.id === id);
  const vehRate = v => !v ? 0 : v.method === 'fuel' ? Math.round(((S.cfg.fuelPrice[v.fuel] || 0) / Math.max(1, +v.kmpl || 1) + (+v.wear || 0)) * 100) / 100 : +v.rate || 0;
  const myVehicles = e => S.vehicles.filter(v => v.emp === e);
  const clockMin = s => { const m = /(\d\d):(\d\d)$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : 600; };
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.round(m) % 60).padStart(2, '0');
  const fmtM = m => m >= 1000 ? r1(m / 1000) + ' km' : Math.round(m) + ' m';
  function jStats(j) {
    if (j.stats && !(j.track && j.track.length)) return j.stats;
    const T = S.cfg.track, pts = j.track.slice(0, j.shown || j.track.length), o = { n: pts.length, gpsKm: 0, jumpKm: 0, gapKm: 0, gaps: 0, jumps: 0, gapMaxMin: 0, maxSp: 0, dur: 0, startOff: 0, endOff: 0, stopMin: 0, stops: (j.stops || []).length };
    (j.stops || []).forEach(s => { o.stopMin += s.dwell || 0; });
    if (!pts.length) return Object.assign(o, { payBase: 0, avg: 0, pings: 0, moving: 0 });
    if (j.gps === 'checkin') { o.gpsKm = o.payBase = j.plannedKm; o.dur = pts[pts.length - 1].t || 0; o.moving = Math.max(0, o.dur - o.stopMin * 60); o.avg = o.moving > 0 && pts.length > 1 ? o.payBase / o.moving * 3600 : 0; o.pings = pts.length + o.stops; o.startOff = hav(pts[0], place(j.from)) * 1000; o.endOff = pts.length > 1 ? hav(pts[pts.length - 1], place(j.to)) * 1000 : 0; return o; }
    const gapMin = ['train', 'bus'].includes(j.mode) ? T.trainGapMin : T.gapMin, maxS = j.mode === 'train' ? Math.max(T.maxSpeed, 200) : T.maxSpeed, sAt = new Set((j.stops || []).filter(s => s.dwell != null).map(s => s.i));
    for (let i = 1; i < pts.length; i++) {
      const d = hav(pts[i - 1], pts[i]), dt = pts[i].t - pts[i - 1].t, sp = dt > 0 ? d / dt * 3600 : 0; o.gpsKm += d;
      if (sAt.has(i - 1)) continue;
      if (sp > maxS) { o.jumps++; o.jumpKm += d; o.maxSp = Math.max(o.maxSp, sp); }
      else if (dt > gapMin * 60) { o.gaps++; o.gapKm += d; o.gapMaxMin = Math.max(o.gapMaxMin, dt / 60); } else o.maxSp = Math.max(o.maxSp, o.jumps ? o.maxSp : sp);
    }
    o.dur = pts[pts.length - 1].t; o.moving = Math.max(0, o.dur - o.stopMin * 60); o.payBase = r1(o.gpsKm - o.jumpKm); o.gpsKm = r1(o.gpsKm); o.avg = o.moving > 0 ? o.payBase / o.moving * 3600 : 0; o.pings = Math.floor(o.moving / T.pingSec) + 1 + o.stops;
    o.startOff = hav(pts[0], place(j.from)) * 1000; o.endOff = hav(pts[pts.length - 1], place(j.to)) * 1000; return o;
  }
  /* an airport or a station is large, so a check-in there has a wider radius */
  const hubRad = id => { const p = place(id); return p && (p.pt === 'airport' || p.pt === 'station') ? S.cfg.track.hubRadius : 0; };
  function journeyChecks(x, fire) {
    const j = journey(x.journeyId); if (!j) return; const st = jStats(j), T = S.cfg.track, md = modeOf(j.mode), dist = j.manual ? j.plannedKm : st.payBase, ci = j.gps === 'checkin';
    if (j.manual) fire('G7', ci ? 'Journey without GPS check-ins' : 'Journey without a GPS record', 'Added after the travel. Reason: ' + String(j.noGps || 'not given').replace(/[.\s]+$/, '') + '. The distance is the ' + (j.mode === 'flight' ? 'air distance, ' : 'shortest map route, ') + j.plannedKm + ' km. It was not typed by the employee.');
    else {
      const ra = hubRad(j.from) || T.startRadius, rb = hubRad(j.to) || T.endRadius;
      if (st.startOff > ra) fire('G1', ci ? 'Check-in away from the start point' : 'Journey started away from the planned start point', (ci ? 'The check-in was ' : 'Tracking began ') + fmtM(st.startOff) + ' from ' + place(j.from).name + '. The allowed radius is ' + fmtM(ra) + '.');
      if (st.endOff > rb) fire('G2', ci ? 'Arrival check-in away from the destination' : 'Journey ended away from the planned destination', (ci ? 'The arrival check-in was ' : 'Tracking ended ') + fmtM(st.endOff) + ' from ' + place(j.to).name + '. The allowed radius is ' + fmtM(rb) + '.');
      if (!ci && st.gaps) fire('G4', 'No location for part of the journey', st.gaps + ' gap' + (st.gaps > 1 ? 's' : '') + ', the longest ' + Math.round(st.gapMaxMin) + ' min. The ' + r1(st.gapKm) + ' km inside the gap is counted as a straight line.');
      if (!ci && st.jumps) fire('G5', 'Impossible speed or location jump', st.jumps + ' segments above ' + T.maxSpeed + ' km/h, up to ' + Math.round(st.maxSp) + ' km/h. ' + r1(st.jumpKm) + ' km is left out of the payable distance.');
      const long = (j.stops || []).filter(s => !s.biz && (s.dwell || 0) > T.stopMaxMin);
      if (long.length) fire('G11', 'Long stop for a personal reason', long.map(s => (reasonOf(s.reason) || {}).name + ', ' + s.dwell + ' min at ' + s.name).join('; ') + '. The limit is ' + T.stopMaxMin + ' min.');
    }
    const abroad = !inIndia(place(j.from)) || !inIndia(place(j.to)), cap = md ? Math.max(md.ceil * dist, md.minFare || 0) * (abroad ? S.cfg.track.abroadFactor : 1) : 0;
    if (md && md.ceil > 0 && x.cat !== 'mileage' && +x.bill > 0 && dist > 0 && +x.bill > cap) fire('G8', 'Fare is above the ceiling for the distance', rs(x.bill) + ' for ' + dist + ' km' + (j.manual ? ' on the map' : '') + ' is ' + rs(x.bill / dist) + ' a km. The ceiling for ' + md.name.toLowerCase() + ' is ' + rs(md.ceil * (abroad ? S.cfg.track.abroadFactor : 1)) + ' a km, or ' + rs((md.minFare || 0) * (abroad ? S.cfg.track.abroadFactor : 1)) + ' for a short ride.');
  }
  /* the shortest route through every business stop. Personal stops do not add to it. */
  function viaKm(j) { const a = place(j.from), b = place(j.to); if (!a || !b) return j.plannedKm; const base = Math.max(0.001, hav(a, b)), f = j.plannedKm / base; return r1(j.plannedKm + (j.stops || []).filter(s => s.biz).reduce((m, s) => m + Math.max(0, f * (hav(a, s) + hav(s, b) - base)), 0)); }
  function mileage(x) {
    const v = S.vehicles.find(k => k.id === x.vehicleId), vt = v && vtype(v.type), rate = vehRate(vt), T = S.cfg.track, out = { rate, veh: v, vt, flags: [] }, j = x.journeyId && journey(x.journeyId), gps = j && !j.manual;
    const F = (code, title, evidence) => { const k = chk(code); if (!k || !k.on) return null; out.flags.push({ code, title, evidence, action: k.a, sev: k.a === 'block' || k.a === 'inform' ? null : (k.s || 'low'), block: k.a === 'block', needsReason: k.a === 'justify' && !(x.reason || '').trim() }); return k; };
    let km = 0, pay = 0;
    if (gps) {
      const st = jStats(j), via = viaKm(j); km = st.gpsKm; pay = st.payBase; out.mapKm = j.plannedKm; out.viaKm = via; out.stats = st; out.allowed = r1(via * (1 + T.routeTol / 100));
      if (pay > out.allowed) { const k = F('G3', 'GPS distance is above the shortest route', 'Driven ' + pay + ' km. The shortest route' + (via > j.plannedKm ? ' through the business stops' : '') + ' is ' + via + ' km, allowed up to ' + out.allowed + ' km with ' + T.routeTol + '% tolerance.'); if (k && k.a === 'cap') pay = out.allowed; }
    } else {
      km = j ? j.plannedKm : +x.km || 0; pay = km; out.manual = true; out.mapKm = j ? j.plannedKm : mapKm(x.from, x.to); out.allowed = r1(out.mapKm * (1 + S.cfg.mileageTol / 100));
      if (km > 0 && !j) F('G7', 'No GPS record for this drive', 'This drive was not tracked. Say why, so your approver can accept it.');
      if (out.mapKm && km > out.allowed && chk('D1').on) { out.flags.push({ code: 'D1', title: 'Distance is above the map distance', evidence: 'Typed ' + km + ' km. The map distance is ' + out.mapKm + ' km, allowed up to ' + out.allowed + ' km.', action: 'cap', sev: chk('D1').s || 'medium' }); pay = out.allowed; }
    }
    if (v && !v.verified) F('G9', 'Vehicle is not verified yet', v.reg + ' is waiting for HR to check the registration certificate.');
    if (v && v.whose && v.whose !== 'self') F('G12', 'Vehicle in another person’s name', v.reg + ' is registered to ' + (v.rc ? v.rc.owner : 'someone else') + (v.whose === 'family' ? ', a family member' : ', not family') + '.');
    if (v && v.rc && x.date) { const ok = vehValid(v, x.date); if (!ok.rc || !ok.ins) F('G13', !ok.rc ? 'RC had expired' : 'Insurance had expired', v.reg + (!ok.rc ? ': RC valid till ' + fdy(v.rc.rcValid) : ': insurance valid till ' + fdy(v.rc.insValid)) + '. The drive was on ' + fdy(x.date) + '.'); }
    const capKm = (trip(x.tripId) || {}).scope && trip(x.tripId).scope !== 'local' ? T.maxKmDayOut : T.maxKmDay, used = S.expenses.filter(o => o.id !== x.id && o.emp === x.emp && o.cat === 'mileage' && o.date === x.date && live(o)).reduce((a, o) => a + (+o.payKm || 0), 0), left = Math.max(0, capKm - used);
    if (pay > left) { const k = F('G10', 'Daily distance cap reached', 'The cap is ' + capKm + ' km a day. ' + r1(used) + ' km is already claimed for ' + fd(x.date) + '.'); if (k && k.a === 'cap') pay = left; }
    out.km = r1(km); out.payKm = r1(pay); out.full = Math.round(km * rate); out.amount = Math.round(out.payKm * rate); return out;
  }
  function densify(pts, step) { const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(hav(a, b) / step)); for (let k = 1; k <= n; k++) out.push({ lat: a.lat + (b.lat - a.lat) * k / n, lng: a.lng + (b.lng - a.lng) * k / n }); } return out; }
  /* a simulated phone GPS feed. In production these points come from the mobile app. */
  const SPEED = { train: [55, 40], bus: [42, 26], public: [18, 14] };
  function simulate(j, sc) {
    const rnd = seedRnd(j.id + sc), long = j.plannedKm > 60; let pts = densify(routePts(j.from, j.to), long ? 0.9 : 0.3).map(p => ({ lat: p.lat + (rnd() - .5) * 0.0003, lng: p.lng + (rnd() - .5) * 0.0003 }));
    pts[0] = { lat: place(j.from).lat, lng: place(j.from).lng }; pts[pts.length - 1] = { lat: place(j.to).lat, lng: place(j.to).lng };
    if (sc === 'offstart') { const k = Math.floor(pts.length * 0.12); pts = pts.slice(k); }
    if (sc === 'detour') { const i = Math.floor(pts.length * 0.45), p = pts[i], q = pts[i + 1]; pts = pts.slice(0, i + 1).concat(densify([p, { lat: p.lat + 0.030, lng: p.lng + 0.004 }, { lat: p.lat + 0.034, lng: p.lng + 0.030 }, { lat: p.lat + 0.004, lng: p.lng + 0.033 }, q], 0.3).slice(1), pts.slice(i + 2)); }
    const spd = SPEED[j.mode] || [24, 22]; let t = 0; pts[0].t = 0; pts[0].sp = 0;
    for (let i = 1; i < pts.length; i++) { const d = hav(pts[i - 1], pts[i]), sp = spd[0] + rnd() * spd[1]; t += d / sp * 3600; pts[i].t = Math.round(t); pts[i].sp = Math.round(sp); }
    pts.forEach(p => { p.acc = Math.round(6 + rnd() * 18); });
    if (sc === 'gap') { const a = Math.floor(pts.length * 0.40), b = Math.floor(pts.length * 0.62); pts = pts.slice(0, a).concat(pts.slice(b)); }
    if (sc === 'spoof') { const i = Math.floor(pts.length * 0.55), p = pts[i]; pts.splice(i + 1, 0, { lat: p.lat + 0.14, lng: p.lng + 0.05, t: p.t + 20, sp: 0, acc: 5, fake: true }); }
    return pts;
  }
  /* one GPS fix near a place, as the phone reports it at a check-in */
  function fixNear(p, km, key) { const o = jit(key, km); return { lat: p.lat + o.dLat, lng: p.lng + o.dLng, acc: Math.round(8 + seedRnd(key + 'a')() * 14), t: 0 }; }

  /* ---------- trips: one trip holds every leg, stop and expense ---------- */
  const ptName = id => ((S.cfg.ptypes || []).find(k => k.id === id) || {}).name || 'Place';
  const reasonOf = id => (S.cfg.stopReasons || []).find(r => r.id === id);
  const inIndia = p => !!p && (!p.country || p.country === 'India');
  const limCity = p => !p ? '' : inIndia(p) ? p.city : p.city + ', ' + p.country;
  const HUB_OF = { flight: 'air', train: 'rail' };
  /* The transfer mode that means "no journey here, nothing to claim". Not a
     mode in te_modes: it is the absence of one, and buildLegs omits the leg. */
  const NO_XFER = 'none';
  /* THE PLACE ITSELF is a hub of this kind. A trip that already starts at the
     airport needs no other, and no preference can move somebody from where
     they are standing — so this outranks everything. */
  const hubSelf = (p, k) => (p && ((k === 'air' && p.pt === 'airport') || (k === 'rail' && p.pt === 'station')) ? p.id : null);
  /* THE COMPANY'S CONFIGURED hub for the city, or for the region it belongs
     to. A default — which is why it loses to a hub the traveller picked. */
  const hubCity = (p, k) => { if (!p) return null; const h = HUBS[regionOf(p.city) || p.city]; return h && h[k] ? h[k] : null; };
  /* The order the planner promises and the traveller expects: where they
     already are, then what they chose, then what the company configured.
     `pick` is x.hubA / x.hubB — the hub named for this end of the leg.
     This used to read `hubFor(p, k) || pick`, so the configured default won
     and the pick did nothing. It went unnoticed while almost no city had a hub
     configured; migration 173 configured one for every city and turned the
     planner's "Chosen by you" button into dead UI everywhere at once. */
  const hubPick = (p, k, pick) => hubSelf(p, k) || (pick && place(pick) ? pick : null) || hubCity(p, k);
  const hubFor = (p, k) => hubSelf(p, k) || hubCity(p, k);
  /* flights are check-in only. Abroad, tracking follows the admin switch. Every leg inside India is tracked. */
  const legGps = (scope, mode, from, to) => { const md = modeOf(mode); if (md && md.gps === 'checkin') return 'checkin'; if ((!inIndia(place(from)) || !inIndia(place(to))) && !S.cfg.track.intlTrack) return 'checkin'; return 'track'; };
  const legKm = (f, t, mode) => { const a = place(f), b = place(t); if (!a || !b || f === t) return 0; return mode === 'flight' ? r1(hav(a, b)) : mapKm(f, t); };
  const legsOf = t => (t && t.legIds || []).map(journey).filter(Boolean).sort((a, b) => a.n - b.n);
  const OPEN_LEG = ['PLANNED', 'ACTIVE', 'PAUSED', 'ENDED'];
  const legOpen = j => OPEN_LEG.includes(j.status);
  /* the itinerary sets the dates. A point is reached on the day the previous one is left. */
  function derive(t) {
    const P = t.points || []; t.pax = +t.pax || 1 + (t.co || []).length;
    /* WHEN YOU ARE WHERE. The traveller's own answer wins and this only fills
       what they left blank: an overnight train leaves on the 2nd and lands on
       the 3rd, and deriving every arrival from the previous departure said it
       landed on the 2nd. The planner asks for the arrival now, so the guess is
       a fallback rather than the rule. */
    P.forEach((p, i) => { if (!i) { p.arrive = ''; return; } p.arrive = p.arrive || P[i - 1].leave || P[i - 1].arrive || ''; if (p.ret) p.leave = ''; if (t.scope === 'local') { p.arrive = p.arrive || (P[0] || {}).leave || ''; if (!p.ret) p.leave = p.leave || p.arrive; } });
    /* BOTH DATES OF EVERY POINT, not just the later-looking one. `leave ||
       arrive` hid the arrival wherever a departure existed, so a stay that
       ends after the last departure — reaching home the morning after you set
       off — left t.end short, and nights, the estimate and the expense month
       are all measured off it. */
    const ds = P.flatMap(p => [p.leave, p.arrive]).filter(Boolean).sort(); t.start = (P[0] || {}).leave || ds[0] || ''; t.end = ds[ds.length - 1] || t.start;
    const p0 = place((P[0] || {}).place), dest = P.filter((p, i) => i && !p.ret).map(p => place(p.place)).filter(Boolean);
    /* WHERE THE TRIP IS TO. The places you merely pass through are not it: a
       run to Mumbai that breaks at Pune on the way home is a trip to Mumbai,
       and so is one that breaks at Jaipur on the way out.

       This used to take the FIRST place after the start, which made a trip
       with a stop on the way out read as a trip to the stop — visible,
       because the trips list falls back to this when a trip has no name of
       its own. It also disagreed with the planner, which has always called
       the last one the destination.

       Both now say the same thing: the last place that is neither the return
       nor a stop. Identical to pointLabel in lib/te/trip-draft.ts, including
       the fallback for a trip saved before points could say which they were. */
    const named = P.filter((p, i) => i && !p.ret && !p.stop).map(p => place(p.place)).filter(Boolean);
    const main = named.length ? named : dest;
    t.from = p0 ? p0.city : ''; t.fromPlace = (P[0] || {}).place || ''; t.to = main.length ? limCity(main[main.length - 1]) : ''; t.type = t.scope === 'international' ? 'international' : 'domestic';
    t.country = (dest.find(p => !inIndia(p)) || {}).country || ''; const s0 = (t.segs || []).find(s => HUB_OF[s.mode]) || (t.segs || [])[0]; t.mode = s0 ? s0.mode : '';
    return t;
  }
  /* the legs a plan makes. A flight or a train between cities adds the ride to the airport or station and the ride from it. */
  function buildLegs(t) {
    const out = [], P = t.points || [];
    (t.segs || []).forEach((s, i) => {
      const a = P[i], b = P[i + 1]; if (!a || !b || !place(a.place) || !place(b.place)) return;
      const pa = place(a.place), pb = place(b.place), md = modeOf(s.mode), k = t.scope !== 'local' && HUB_OF[s.mode], x = s.xfer || {}, date = a.leave || b.arrive || t.start;
      let ha = k ? hubPick(pa, k, x.hubA) : null, hb = k ? hubPick(pb, k, x.hubB) : null; if (ha && hb && ha === hb) ha = hb = null;
      const L = (from, to, mode, kind, o) => out.push(Object.assign({ seg: i, from, to, date, mode, kind, bookedBy: 'self', vehicleId: null, km: legKm(from, to, mode), gps: legGps(t.scope, mode, from, to) }, o || {}));
      const xv = m => m === 'own' ? x.veh || s.vehicleId || null : null;
      /* NO_XFER means there is nothing to claim for getting to the hub: a
         colleague dropped them, they walked, or the trip already starts there.
         Without it the only way to say "no first mile" was to leave the
         default cab in place and then not claim it, which quietly inflates
         every estimate and every approval the plan is judged on. */
      if (ha && ha !== a.place && x.first !== NO_XFER) L(a.place, ha, x.first || 'cab', 'first', { vehicleId: xv(x.first) });
      L(ha || a.place, hb || b.place, s.mode, b.ret ? 'return' : 'main', { bookedBy: md && md.basis === 'ticket' ? s.bookedBy || 'desk' : 'self', vehicleId: s.mode === 'own' ? s.vehicleId || null : null });
      if (hb && hb !== b.place && x.last !== NO_XFER) L(hb, b.place, x.last || 'cab', 'last', { vehicleId: xv(x.last) });
    });
    return out.map((l, n) => Object.assign(l, { n: n + 1 }));
  }
  /* what a leg is likely to cost, for the estimate */
  function legEst(l, scope) {
    const md = modeOf(l.mode), km = l.km != null ? l.km : (l.plannedKm || 0), ab = !inIndia(place(l.from)) || !inIndia(place(l.to)), f = ab ? S.cfg.track.abroadFactor : 1; if (!md) return 0;
    if (l.mode === 'own') { const v = S.vehicles.find(k => k.id === l.vehicleId), vt = v && vtype(v.type); return Math.round(Math.min(km, scope === 'local' ? S.cfg.track.maxKmDay : S.cfg.track.maxKmDayOut) * vehRate(vt)); }
    if (md.basis === 'none') return 0;
    if (l.mode === 'flight') return scope === 'international' ? Math.round(S.cfg.intlAir / 2) : S.cfg.domAir;
    return Math.max((md.estMin || 50) * f, Math.round(km * (md.estKm || 15) * f / 10) * 10);
  }
  /* where the employee is on a date. The limits of that city apply to the day. */
  function cityOn(t, date) {
    const P = t.points || [], dest = P.filter((p, i) => i && !p.ret && p.place), base = limCity(place((P[0] || {}).place)) || (emp(t.emp) || {}).base;
    if (t.scope === 'local' || !dest.length) return base;
    const hit = dest.find(p => date >= (p.arrive || '') && date <= (p.leave || p.arrive || '')); if (hit) return limCity(place(hit.place));
    return limCity(place((date < (dest[0].arrive || '') ? dest[0] : dest[dest.length - 1]).place));
  }
  function estimateFor(empId, t) {
    const P = t.points || [], e = { travel: 0, desk: 0, hotel: 0, meals: 0, conv: 0 };
    buildLegs(t).forEach(l => { const v = legEst(l, t.scope); if (l.bookedBy === 'desk') e.desk += v; else e.travel += v; });
    if (!t.start || !t.end || t.end < t.start) return e;
    if (t.scope === 'local') {
      e.meals = t.foodWanted === false ? 0 : (S.cfg.track.localMealCap || 0);
      /* a local trip gets a hotel line only when one was actually asked for */
      if (t.stayWanted) {
        const n = Math.max(0, days(t.start, t.end)), to = P.find((p, i) => i && !p.ret && place(p.place));
        if (n > 0 && to) e.hotel = n * limitsFor(empId, limCity(place(to.place))).hotel;
      }
      return e;
    }
    P.forEach((p, i) => { if (!i || p.ret || !place(p.place) || !p.arrive) return; const n = Math.max(0, days(p.arrive, p.leave || p.arrive)), L = limitsFor(empId, limCity(place(p.place))); e.hotel += n * L.hotel; e.conv += Math.max(1, n) * L.conv; });
    for (let d = t.start; d <= t.end; d = addDays(d, 1)) e.meals += limitsFor(empId, cityOn(t, d)).meals;
    /* An explicit "no stay" takes the hotel out of the estimate, and so out of the
       trip total and the advance cap. null means the trip was planned before the
       question existed, and keeps the hotel line it has always had. */
    if (t.stayWanted === false) e.hotel = 0;
    /* AND THE SAME FOR FOOD, which it did not do. stayWanted was honoured here
       and foodWanted was not, so a trip that said "no food" was still estimated
       a full daily allowance for every day of it — money in the total and in
       the advance cap that the traveller had already said they did not want.
       Both answers are asked together on step 1; both have to mean something. */
    if (t.foodWanted === false) e.meals = 0;
    return e;
  }
  /* each leg is a travel record of its own: tracked, checked and paid separately, but always inside the trip */
  function makeLegs(t) {
    (t.legIds || []).map(journey).filter(j => j && (j.status === 'PLANNED' || (j.manual && !j.expenseId))).forEach(j => { S.journeys.splice(S.journeys.indexOf(j), 1); });
    t.legIds = buildLegs(t).map(l => { const j = { id: 'JRN-' + String(++S.seq.jrn).padStart(4, '0'), emp: t.emp, tripId: t.id, n: l.n, seg: l.seg, kind: l.kind, from: l.from, to: l.to, date: l.date, purpose: t.purpose, why: t.name, mode: l.mode, vehicleId: l.vehicleId, bookedBy: l.bookedBy, gps: l.gps, plannedKm: l.km, status: 'PLANNED', chain: [], track: [], shown: 0, pauses: 0, stops: [], checkin: {}, history: [] }; S.journeys.push(j); return j.id; });
  }
  function markManual(j, reason) { j.status = 'ENDED'; j.manual = true; j.noGps = reason || 'Recorded after the travel'; j.track = []; j.shown = 0; j.endedAt = fd(j.date); j.history.unshift({ at: stamp(), who: j.emp, text: 'Added without GPS. Reason: ' + j.noGps + '.' }); }
  const jState = j => j.status === 'PLANNED' && j.date < S.today ? 'NOT_RECORDED' : j.status;
  const stopSec = j => (j.stops || []).reduce((a, s) => a + (s.dwell || 0) * 60, 0);
  /* start a leg. A tracked leg records the route; a check-in leg records the start fix only (a flight, or abroad when tracking is off). */
  function startJourney(id, sc) {
    const j = journey(id), t = j && trip(j.tripId); if (!j || j.status !== 'PLANNED') return { error: 'This journey cannot be started.' };
    if (t) {
      const ts = tStatus(t); if (!['APPROVED', 'ONGOING'].includes(ts)) return { error: ts === 'PENDING_APPROVAL' ? 'The trip is waiting for approval.' : ts === 'MISSED' ? 'The day of this trip has passed. Add it without GPS.' : 'The trip is not open for travel.' };
      const prev = legsOf(t).find(k => k.n < j.n && ['PLANNED', 'ACTIVE', 'PAUSED'].includes(k.status)); if (prev) return { error: 'Finish or skip journey ' + prev.n + ' first.' };
      if (S.today > addDays(t.end, 1)) return { error: 'The trip dates are over. Add this journey without GPS, or skip it.' };
    }
    if (j.date > S.today) return { error: 'This journey is planned for ' + fwd(j.date) + '.' };
    if (S.journeys.some(k => k.emp === j.emp && ['ACTIVE', 'PAUSED'].includes(k.status))) return { error: 'End the journey that is running first.' };
    j.scenario = sc || 'normal'; j.startedAt = stamp(); j.status = 'ACTIVE'; j.date = S.today;
    if (j.gps === 'checkin') { j.track = [fixNear(place(j.from), j.scenario === 'offstart' ? 1.8 : 0.06, j.id + 's')]; j.shown = 1; }
    else { j.track = simulate(j, j.scenario); j.shown = 1; }
    const p = j.track[0], g = reverseGeo(p.lat, p.lng); j.checkin = { start: { at: j.startedAt, lat: p.lat, lng: p.lng, acc: p.acc, addr: g.addr, name: g.s, off: Math.round(hav(p, place(j.from)) * 1000) } };
    j.history.unshift({ at: j.startedAt, who: j.emp, text: (j.gps === 'checkin' ? 'Checked in at ' : 'Journey started at ') + g.s + '. GPS fix within ' + p.acc + ' m.' }); log(j.emp, 'Started journey ' + j.n + (t ? ' of ' + t.id : ''), j.id); return { journey: j };
  }
  function advanceJourney(id, n) { const j = journey(id); if (!j || j.status !== 'ACTIVE' || j.gps === 'checkin') return true; j.shown = Math.min(j.track.length, j.shown + (n || 1)); return j.shown >= j.track.length; }
  /* a stop: where the vehicle stopped (GPS and address), why, and for how long */
  function addStop(id, d) {
    const j = journey(id), md = j && modeOf(j.mode), R = reasonOf((d || {}).reason); d = d || {};
    if (!j || j.status === 'PAUSED') return { error: 'You are already at a stop. Tap Continue first.' };
    if (j.status !== 'ACTIVE') return { error: 'Start the journey first.' };
    if (!md.stops) return { error: j.mode === 'flight' ? 'A stop cannot be added during a flight. A connecting flight is a journey of its own.' : 'On a ' + md.name.toLowerCase() + ' the stops are the operator’s. If you get off, end this journey and start a new one.' };
    if (!R || !R.on) return { error: 'Choose why you stopped.' }; if (R.id === 'other' && !(d.note || '').trim()) return { error: 'Say why you stopped.' };
    let p; if (j.gps === 'checkin') { const rp = routePts(j.from, j.to), q = rp[Math.min(rp.length - 2, Math.floor(rp.length * (0.35 + 0.2 * j.stops.length)))]; p = Object.assign(fixNear(q, 0.05, j.id + 'p' + j.stops.length), { t: Math.round(j.plannedKm * (0.35 + 0.2 * j.stops.length) / 30 * 3600) + stopSec(j) }); }
    else p = j.track[Math.max(0, j.shown - 1)];
    const g = reverseGeo(p.lat, p.lng), at = fd(S.today) + ', ' + hhmm(clockMin(j.startedAt) + Math.round((p.t || 0) / 60));
    const s = { id: 'S' + (j.stops.length + 1), i: Math.max(0, j.shown - 1), t: p.t || 0, lat: p.lat, lng: p.lng, acc: p.acc || 10, name: g.s, addr: g.addr, reason: R.id, biz: R.biz, note: (d.note || '').trim(), dwell: null, at };
    j.stops.push(s); j.status = 'PAUSED'; j.history.unshift({ at, who: j.emp, text: 'Stopped at ' + g.s + ': ' + R.name + (s.note ? ', ' + s.note : '') + '.' }); log(j.emp, 'Added a stop on journey ' + j.n, j.id);
    return { journey: j, stop: s };
  }
  /* leaving a stop. In the app the time is measured; the demo uses a typical time for the reason. */
  function endStop(id, minutes) {
    const j = journey(id), s = j && j.stops[j.stops.length - 1]; if (!j || j.status !== 'PAUSED' || !s || s.dwell != null) return { error: 'You are not at a stop.' };
    s.dwell = Math.max(1, Math.round(+minutes || (reasonOf(s.reason) || {}).dwell || 10)); const sh = s.dwell * 60;
    if (j.gps !== 'checkin') for (let k = s.i + 1; k < j.track.length; k++) j.track[k].t += sh;
    j.status = 'ACTIVE'; j.history.unshift({ at: fd(S.today) + ', ' + hhmm(clockMin(j.startedAt) + Math.round((s.t + sh) / 60)), who: j.emp, text: 'Left the stop after ' + s.dwell + ' min.' }); return { journey: j, stop: s };
  }
  function endJourney(id) {
    const j = journey(id); if (!j || !['ACTIVE', 'PAUSED'].includes(j.status)) return { error: 'This journey is not running.' };
    if (j.status === 'PAUSED') endStop(id);
    if (j.gps === 'checkin') { const f = fixNear(place(j.to), j.scenario === 'offend' ? 2.6 : 0.06, j.id + 'e'), sp = j.mode === 'flight' ? 650 : 32; f.t = Math.round(j.plannedKm / sp * 3600 + (j.mode === 'flight' ? 2400 : 0)) + stopSec(j); j.track = [j.track[0], f]; j.shown = 2; }
    else { j.track = j.track.slice(0, Math.max(2, j.shown)); j.shown = j.track.length; }
    j.status = 'ENDED'; const st = jStats(j), endMin = clockMin(j.startedAt) + Math.round(st.dur / 60); j.endedAt = fd(S.today) + ', ' + hhmm(endMin); { const want = Math.min(539, Math.max(0, endMin - 540)); if (S.clock % 540 < want) S.clock += want - S.clock % 540; } stamped = true;
    const p = j.track[j.track.length - 1], g = reverseGeo(p.lat, p.lng); j.checkin.end = { at: j.endedAt, lat: p.lat, lng: p.lng, acc: p.acc, addr: g.addr, name: g.s, off: Math.round(hav(p, place(j.to)) * 1000) };
    j.history.unshift({ at: j.endedAt, who: j.emp, text: (j.gps === 'checkin' ? 'Checked in at ' + g.s + ' on arrival. ' + st.gpsKm + (j.mode === 'flight' ? ' km by air.' : ' km on the map.') : 'Journey ended at ' + g.s + '. ' + st.gpsKm + ' km recorded from ' + st.pings + ' location points.') });
    log(j.emp, 'Ended journey ' + j.n, j.id); return { journey: j };
  }
  /* the expense line a leg makes once it is over */
  function legLine(j, d) {
    d = d || {}; const md = modeOf(j.mode), t = j.tripId && trip(j.tripId), name = place(j.from).s + ' → ' + place(j.to).s;
    const x = { id: null, emp: j.emp, tripId: j.tripId || null, journeyId: j.id, legId: j.id, date: j.date, pay: 'self', status: 'UNCLAIMED', billNo: '', gstin: '', reason: d.reason || '', desc: 'Journey ' + j.n + (t ? ' of ' + t.name : '') + (d.curr ? '. Paid ' + d.curr + ' ' + (+d.fxAmt || 0) + ' at ₹' + (+d.fxRate || 0) : ''), file: null, curr: d.curr || '', fxAmt: +d.fxAmt || 0, fxRate: +d.fxRate || 0 };
    const file = d.attach ? { name: d.attach.name || 'invoice-' + j.id + '.pdf', sha: d.attach.sha || 'sha-' + j.id + '-' + (d.ref || ''), ocrAmount: d.attach.sha ? null : +d.fare || 0 } : null;
    if (j.mode === 'own') return Object.assign(x, { cat: 'mileage', vehicleId: j.vehicleId, merchant: name, payMode: 'Own vehicle', from: j.from, to: j.to });
    if (md.basis === 'bill') return Object.assign(x, { cat: 'cab', merchant: d.merchant || '', ref: d.ref || '', billNo: d.ref || '', bill: +d.fare || 0, claimed: +d.fare || 0, payMode: d.payMode || 'UPI', file, desc: name + '. ' + x.desc });
    if (md.basis === 'ticket') return Object.assign(x, { cat: md.cat || 'train', merchant: d.merchant || '', pnr: (d.ref || '').toUpperCase().trim(), cls: d.cls || '', billNo: d.ref || '', bill: +d.fare || 0, claimed: +d.fare || 0, payMode: d.payMode || 'Personal card', file, desc: name + '. ' + x.desc });
    return Object.assign(x, { cat: 'local', merchant: '', bill: +d.fare || 0, claimed: +d.fare || 0, payMode: 'Cash', desc: md.name + ', ' + name + '. ' + x.desc });
  }
  const legBooking = j => S.bookings.find(b => b.legId === j.id && b.status !== 'CANCELLED');
  const legNothing = j => { const md = modeOf(j.mode); return md.basis === 'none' || (md.basis === 'ticket' && j.bookedBy === 'desk' && !!legBooking(j)); };
  function legPreview(id, d) { const j = journey(id); if (legNothing(j)) return { none: true, flags: [], eligible: 0, claimed: 0, stats: jStats(j) }; const p = previewExpense(legLine(j, d)); p.stats = jStats(j); return p; }
  /* the leg report: what the employee paid for this leg. A local trip can send its claim with the last report. */
  function fileLeg(id, d) {
    const j = journey(id), t = j && trip(j.tripId); d = d || {}; if (!j || j.status !== 'ENDED') return { error: 'End the journey first.' };
    if (legNothing(j)) { j.status = 'SUBMITTED'; j.filedAt = stamp(); j.history.unshift({ at: j.filedAt, who: j.emp, text: modeOf(j.mode).basis === 'none' ? 'Journey closed. Company vehicle, nothing to claim.' : 'Journey closed. The ticket was booked and paid by the company.' }); return afterLeg(j, t, d, null); }
    const x = legLine(j, d), p = previewExpense(x); if (p.block) return { error: 'Fix the blocked items first.' }; if (p.flags.some(f => f.needsReason)) return { error: 'Add a reason where one is asked.' };
    const r = saveExpense(x); if (r.error) return r; j.expenseId = x.id; j.status = 'SUBMITTED'; j.filedAt = stamp(); j.history.unshift({ at: j.filedAt, who: j.emp, text: 'Journey report saved. ' + rs(p.eligible) + ' eligible.' }); log(j.emp, 'Filed journey ' + j.n, j.id);
    return afterLeg(j, t, d, x);
  }
  function afterLeg(j, t, d, x) {
    const out = { journey: j, expense: x }; if (!t || legsOf(t).some(legOpen)) return out;
    t.history.unshift({ at: stamp(), who: j.emp, text: 'All journeys are closed.' });
    const lines = unclaimed(t.emp, t.id), self = lines.filter(k => k.pay === 'self');
    if (!self.length && !S.claims.some(c => c.tripId === t.id && c.status !== 'CANCELLED')) { t.status = 'CLOSED'; t.history.unshift({ at: stamp(), who: 'SYSTEM', text: 'Nothing to claim on this trip. Closed.' }); return out; }
    if (d.claim && t.scope === 'local' && S.cfg.track.journeyClaim === 'instant') { const c = submitClaim(t.emp, { tripId: t.id, lineIds: lines.map(k => k.id), declared: !!d.declared, note: d.note || '' }); if (c.error) out.claimError = c.error; else out.claim = c.claim; }
    return out;
  }
  function skipLeg(id, reason) {
    const j = journey(id), t = j && trip(j.tripId); if (!j || j.status !== 'PLANNED') return { error: 'Only a journey that has not started can be skipped.' }; if (!(reason || '').trim()) return { error: 'Say why this journey was not needed.' };
    j.status = 'SKIPPED'; j.skipReason = reason.trim(); j.history.unshift({ at: stamp(), who: j.emp, text: 'Skipped: ' + j.skipReason + '.' }); log(j.emp, 'Skipped journey ' + j.n, j.id); return afterLeg(j, t, {}, null);
  }
  /* a leg that happened without GPS. For a local trip the days-back and monthly limits apply. */
  function legNoGps(id, d) {
    const j = journey(id), t = j && trip(j.tripId), T = S.cfg.track; d = d || {}; if (!j || j.status !== 'PLANNED') return { error: 'This journey cannot be added now.' };
    if (j.date > S.today) return { error: 'This journey is in the future.' }; if (!T.manualAllowed) return { error: 'Your company accepts journeys only with a GPS record.' };
    if (!d.reason) return { error: 'Say why GPS was not used.' }; if (d.reason === 'Other' && !(d.note || '').trim()) return { error: 'Tell your approver what happened.' };
    if (t && t.scope === 'local') { if (days(j.date, S.today) > T.pastDays) return { error: 'Older than ' + T.pastDays + ' days. It can no longer be added.' }; const m = monthOf(j.date), used = S.journeys.filter(k => k.emp === j.emp && k.manual && k.status !== 'CANCELLED' && (trip(k.tripId) || {}).scope === 'local' && monthOf(k.date) === m).length; if (used >= T.pastPerMonth) return { error: 'You have added ' + used + ' journeys without GPS in ' + monthName(m) + '. The limit is ' + T.pastPerMonth + '.' }; }
    markManual(j, d.reason + (d.note ? ': ' + d.note.trim() : '')); log(j.emp, 'Added journey ' + j.n + ' without GPS', j.id); return { journey: j };
  }
  /* a leg nobody planned: a ride at the destination, or a change of plan. It goes in after the current leg. */
  function addLeg(tripId, d) {
    const t = trip(tripId), md = modeOf((d || {}).mode); d = d || {}; if (!t) return { error: 'Trip not found.' };
    const ts = tStatus(t); if (!['APPROVED', 'ONGOING', 'COMPLETED'].includes(ts) || S.today < t.start || S.today > addDays(t.end, 1)) return { error: 'Journeys can be added only during the trip.' };
    if (!d.from || !d.to || !place(d.from) || !place(d.to)) return { error: 'Choose where the journey starts and ends.' }; if (d.from === d.to) return { error: 'Start and end are the same place.' };
    if (!md || !md.on || !md.scopes.includes(t.scope)) return { error: 'Choose a way of travel allowed on this trip.' }; if (d.mode === 'own' && !d.vehicleId) return { error: 'Choose your vehicle.' };
    if (t.scope === 'local' && mapKm(t.fromPlace, d.to) > S.cfg.track.localMaxKm) return { error: 'That is beyond the local travel range of ' + S.cfg.track.localMaxKm + ' km.' };
    const ls = legsOf(t), cur = ls.filter(k => !['PLANNED'].includes(k.status)).pop(), at = cur ? cur.n + 1 : 1;
    ls.filter(k => k.n >= at).forEach(k => { k.n++; });
    const j = { id: 'JRN-' + String(++S.seq.jrn).padStart(4, '0'), emp: t.emp, tripId: t.id, n: at, seg: null, kind: 'extra', from: d.from, to: d.to, date: S.today, purpose: t.purpose, why: d.why || t.name, mode: d.mode, vehicleId: d.mode === 'own' ? d.vehicleId : null, bookedBy: 'self', gps: legGps(t.scope, d.mode, d.from, d.to), plannedKm: legKm(d.from, d.to, d.mode), status: 'PLANNED', chain: [], track: [], shown: 0, pauses: 0, stops: [], checkin: {}, history: [{ at: stamp(), who: t.emp, text: 'Added during the trip' + (d.why ? ': ' + d.why : '') + '.' }] };
    S.journeys.push(j); t.legIds.push(j.id); if (t.status === 'CLOSED') t.status = 'APPROVED';
    const nx = ls.find(k => k.n === at + 1 && k.status === 'PLANNED');
    if (nx && nx.from !== d.to) { if (nx.to === d.to) { nx.status = 'SKIPPED'; nx.skipReason = 'Replaced by the journey added before it'; nx.history.unshift({ at: stamp(), who: t.emp, text: 'Skipped: the added journey goes to the same place.' }); } else { const was = place(nx.from).s; nx.from = d.to; nx.plannedKm = legKm(nx.from, nx.to, nx.mode); nx.gps = legGps(t.scope, nx.mode, nx.from, nx.to); nx.history.unshift({ at: stamp(), who: t.emp, text: 'Now starts at ' + place(d.to).s + ' instead of ' + was + ', because a journey was added before it.' }); } } t.history.unshift({ at: stamp(), who: t.emp, text: 'Journey added: ' + place(d.from).s + ' to ' + place(d.to).s + ' by ' + md.name.toLowerCase() + '.' }); log(t.emp, 'Added a journey', j.id); return { journey: j };
  }
  /* a local trip whose day passed: all its legs become legs without GPS */
  function recordMissed(tripId, d) {
    const t = trip(tripId); d = d || {}; if (!t || tStatus(t) !== 'MISSED') return { error: 'This trip is not missed.' };
    const ls = legsOf(t).filter(j => j.status === 'PLANNED'); for (const j of ls) { const r = legNoGps(j.id, d); if (r.error) return r; }
    t.history.unshift({ at: stamp(), who: t.emp, text: 'Not tracked on the day. Journeys added without GPS.' }); return { trip: t };
  }
  /* ---------- RC check: the registration certificate from Vahan (MoRTH), read through a data provider ---------- */
  const rcNorm = r => (r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const rcFmtOk = r => { const k = rcNorm(r); return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(k) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(k); };
  const rcShow = r => (r || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const RC_FMT = 'Enter the vehicle number as on the RC, like HR26 DK 4821, or 22 BH 1234 AA.';
  const RC_MODELS = [
    ['Maruti Suzuki', 'Swift VXi', 'Motor Car (LMV)', 'Hatchback', 'Petrol'], ['Hyundai', 'i20 Asta', 'Motor Car (LMV)', 'Hatchback', 'Petrol'],
    ['Honda', 'City ZX', 'Motor Car (LMV)', 'Sedan', 'Petrol'], ['Maruti Suzuki', 'Dzire ZXi', 'Motor Car (LMV)', 'Sedan', 'CNG'],
    ['Hyundai', 'Creta SX', 'Motor Car (LMV)', 'SUV', 'Diesel'], ['Mahindra', 'Scorpio-N Z8', 'Motor Car (LMV)', 'SUV', 'Diesel'],
    ['Toyota', 'Innova Crysta', 'Motor Car (LMV)', 'MUV', 'Diesel'], ['Tata', 'Nexon EV', 'Motor Car (LMV)', 'SUV', 'Electric'],
    ['Honda', 'Activa 6G', 'Motor Cycle/Scooter (2WN)', 'Scooter', 'Petrol'], ['Hero', 'Splendor Plus', 'Motor Cycle/Scooter (2WN)', 'Motorcycle', 'Petrol'],
    ['Royal Enfield', 'Classic 350', 'Motor Cycle/Scooter (2WN)', 'Motorcycle', 'Petrol'], ['Ather', '450X', 'Motor Cycle/Scooter (2WN)', 'Scooter', 'Electric']
  ];
  /* demo numbers with a known story; any other valid number reads as the employee's own vehicle; a number ending 0000 is not found */
  const RC_DEMO = {
    HR26DK4821: { m: 2, owner: 'Rahul Nair', reg: '2021-08-19', ins: '2027-08-18', puc: '2027-02-10' },
    HR26AB1190: { m: 9, owner: 'Rahul Nair', reg: '2019-05-02', ins: '2027-05-01', puc: '2026-12-20' },
    HR26CQ7736: { m: 9, owner: 'Arjun Rao', reg: '2020-11-11', ins: '2027-01-10', puc: '2026-12-01' },
    HR26EF3021: { m: 5, owner: 'Suresh Nair', reg: '2022-03-14', ins: '2027-03-13', puc: '2026-12-10' },
    DL8SCK7710: { m: 8, owner: 'Rahul Nair', reg: '2018-07-09', ins: '2026-09-30', puc: '2026-11-25' },
    UP16AT5512: { m: 0, owner: 'Karan Malhotra', reg: '2017-02-20', ins: '2027-04-01', puc: '2027-01-01' },
    HR51BZ2208: { m: 7, owner: 'Rahul Nair', reg: '2024-01-25', ins: '2027-01-24', puc: '' },
    DL3CAA4410: { m: 2, owner: 'Rahul Nair', reg: '2010-04-02', ins: '2027-02-01', puc: '2026-12-31' }
  };
  const hashS = x => { let h = 2166136261; for (const ch of x) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  function nameMatch(a, b) { const t = x => (x || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean), x = t(a), y = t(b); if (!x.length || !y.length) return 'no'; if (x[0] === y[0] && x[x.length - 1] === y[y.length - 1]) return 'match'; return x[x.length - 1] === y[y.length - 1] ? 'partial' : 'no'; }
  const maskName = n => (n || '').split(/\s+/).filter(Boolean).map(w => w[0] + '•'.repeat(Math.max(2, w.length - 1))).join(' ');
  function rcType(rc) { if (/2W/.test(rc.cls)) return 'bike'; if (rc.fuel === 'Electric') return 'ev'; return rc.body === 'Hatchback' ? 'hatch' : rc.body === 'Sedan' ? 'sedan' : 'suv'; }
  function rcBuild(reg, empId, today, nm) {
    const k = rcNorm(reg), h = hashS(k), nm0 = nm || (emp(empId) || {}).name || '', d = RC_DEMO[k] || { m: h % RC_MODELS.length, owner: nm0, reg: (2016 + h % 9) + '-' + String(1 + (h >> 4) % 12).padStart(2, '0') + '-' + String(1 + (h >> 8) % 28).padStart(2, '0'), ins: addDays(today, 60 + (h >> 12) % 400), puc: addDays(today, 20 + (h >> 16) % 300) };
    const M = RC_MODELS[d.m], rc = { no: rcShow(reg), maker: M[0], model: M[1], cls: M[2], body: M[3], fuel: M[4], owner: d.owner, regd: d.reg, rcValid: addDays(d.reg, 15 * 365 + 3), insValid: d.ins, pucValid: M[4] === 'Electric' ? '' : d.puc, src: 'vahan', checked: today };
    rc.type = rcType(rc); rc.match = nameMatch(rc.owner, nm0); return rc;
  }
  /* what the RC says about a number. The employee sees the owner's name masked. */
  function rcLookup(reg, empId) {
    const k = rcNorm(reg); if (!rcFmtOk(k)) return { error: RC_FMT };
    if (!S.cfg.vehx.rcCheck) return { off: true };
    if (/0000[A-Z]{0,2}$/.test(k)) return { notFound: true };
    return { rc: rcBuild(reg, empId, S.today) };
  }
  function addVehicle(empId, type, reg, x) {
    x = x || {}; const show = rcShow(reg), k = rcNorm(reg), P = S.cfg.vehx, rc = x.rc || null;
    if (!rcFmtOk(k)) return { error: RC_FMT };
    if (S.vehicles.some(v => v.emp === empId && rcNorm(v.reg) === k)) return { error: show + ' is already in your vehicles.' };
    const other = S.vehicles.find(v => v.emp !== empId && rcNorm(v.reg) === k); if (other) return { error: show + ' is already added by another employee. Ask HR to move it to you.' };
    const vt = rc ? rc.type : type;
    if (!vtype(vt)) return { error: 'Choose what vehicle it is.' };
    if (!(vtype(vt) || {}).on) return { error: 'Your company does not pay for a ' + vtype(vt).name.toLowerCase() + '.' };
    if (!rc && P.rcCheck && !x.photo) return { error: 'Attach a photo of the RC. HR checks it before the vehicle is paid.' };
    if (rc && rc.rcValid && rc.rcValid < S.today) return { error: 'The RC of ' + show + ' expired on ' + fdy(rc.rcValid) + '. It cannot be used for paid travel.' };
    const whose = rc && rc.match === 'match' ? 'self' : x.whose;
    if (!whose) return { error: rc ? 'The RC is in another name. Say whose vehicle it is.' : 'Say whose vehicle it is.' };
    if (P.owner === 'self' && whose !== 'self') return { error: 'Your company pays only for a vehicle registered in your name.' };
    if (P.owner === 'family' && whose === 'other') return { error: 'Your company pays only for your own vehicle or a family member’s.' };
    if (rc && P.insurance === 'block' && rc.insValid && rc.insValid < S.today) return { error: 'The insurance of ' + show + ' expired on ' + fdy(rc.insValid) + '. Renew it, then add the vehicle.' };
    const v = { id: 'VEH-' + String(++S.seq.veh).padStart(3, '0'), emp: empId, type: vt, declared: type || '', reg: show, rc, whose, photo: !!x.photo, verified: !!rc, vby: rc ? 'rc' : '', added: S.today };
    S.vehicles.push(v); log(empId, 'Added vehicle ' + show + (rc ? '. RC: ' + rc.maker + ' ' + rc.model + ', paid as ' + vtype(vt).name + (type && type !== vt ? ' (employee said ' + (vtype(type) || {}).name + ')' : '') : '. RC photo sent to HR'), v.id); return { vehicle: v };
  }
  function verifyVehicle(id, who, type) { const v = S.vehicles.find(k => k.id === id); if (!v) return { error: 'Vehicle not found.' }; if (type && vtype(type)) v.type = type; v.verified = true; v.vby = 'hr'; log(who, 'Checked the RC of ' + v.reg + ': ' + vtype(v.type).name, v.id); return { vehicle: v }; }
  function vehValid(v, date) { const r = v && v.rc, d = date || S.today; return { rc: !(r && r.rcValid && r.rcValid < d), ins: !(r && r.insValid && r.insValid < d), puc: !(r && r.pucValid && r.pucValid < d) }; }
  function setFlags(lines, t) {
    const out = [];
    const fire = (code, title, evidence, lineId) => { const k = chk(code); if (!k || !k.on) return; out.push({ code, title, evidence, action: k.a, block: k.a === 'block', sev: k.a === 'block' || k.a === 'inform' ? null : (k.s || 'low'), lineId: lineId || null, claimLevel: !lineId }); };
    const own = lines.filter(x => x.pay === 'self');
    const g = {}; own.forEach(x => { if (!x.merchant || x.journeyId) return; const k = normM(x.merchant) + '|' + x.date; (g[k] = g[k] || []).push(x); });
    Object.values(g).forEach(l => { if (l.length > 1) fire('D2', 'Several bills from one merchant on one day', l.length + ' bills from ' + l[0].merchant + ' on ' + fd(l[0].date) + ' totalling ' + rs(l.reduce((a, x) => a + +x.bill, 0)) + '.', l[1].id); });
    const rd = own.filter(x => !x.file && +x.bill >= 100 && +x.bill % 100 === 0); if (rd.length >= 3) fire('D4', 'Repeated round amounts without bills', rd.length + ' no-bill lines are exact multiples of ₹100.');

    /* ---- D3, D5, D6, D7: the spend-pattern layer ----------------------------
       These four look at SHAPE rather than any single line: a person who keeps
       landing just under the receipt threshold, one whose amount dwarfs what
       everybody else pays for the same thing, bill numbers that run in
       sequence, a claim that is mostly unreceipted. None of them proves
       anything on its own, which is why all four warn and none blocks — they
       tell an approver where to look.
       Every threshold reads from te_checks.params with a default, so an
       administrator can tune one without a deploy. */
    const par = (code, key, dflt) => { const k = chk(code); const v = k && k.params ? +k.params[key] : NaN; return isFinite(v) && v > 0 ? v : dflt; };
    const empId = (lines[0] || {}).emp;
    const me = empId ? emp(empId) : null;

    /* D3 — amounts repeatedly just under the receipt threshold. Staying under
       the amount that would require a bill is the oldest trick there is, and
       one such line is nothing; several in one claim is a shape. */
    const above = +S.cfg.receiptAbove || 0;
    if (above > 0) {
      const band = par('D3', 'bandPct', 15) / 100;          // how close counts as "just under"
      const need = par('D3', 'minLines', 3);
      const near = own.filter(x => !x.file && +x.bill > 0 && +x.bill <= above && +x.bill >= above * (1 - band));
      if (near.length >= need) {
        fire('D3', 'Several amounts sit just under the receipt threshold',
          near.length + ' no-bill lines are between ' + rs(Math.round(above * (1 - band))) + ' and ' + rs(above)
          + ', the amount above which a bill is required: ' + near.map(x => rs(x.bill)).join(', ') + '.');
      }
    }

    /* D5 — amount far above peers. The comparison is against the same category
       and the same grade, because a manager's hotel is not an analyst's, and
       against the MEDIAN rather than the mean so one outlier cannot raise the
       bar that hides the next one. */
    if (me) {
      const mult = par('D5', 'times', 2.5);
      const need = par('D5', 'minPeers', 4);
      own.forEach(x => {
        if (!(+x.bill > 0) || x.cat === 'mileage') return;
        const peers = S.expenses
          .filter(o => o.id !== x.id && live(o) && o.cat === x.cat && o.pay === 'self' && +o.bill > 0 && o.emp !== x.emp)
          .filter(o => { const e = emp(o.emp); return e && e.grade === me.grade })
          .map(o => +o.bill).sort((a, b) => a - b);
        if (peers.length < need) return;
        const mid = peers.length % 2 ? peers[(peers.length - 1) / 2] : (peers[peers.length / 2 - 1] + peers[peers.length / 2]) / 2;
        if (mid > 0 && +x.bill >= mid * mult) {
          fire('D5', 'Amount is far above what peers claim for this',
            rs(x.bill) + ' against a median of ' + rs(Math.round(mid)) + ' across ' + peers.length
            + ' ' + (cat(x.cat) || {}).name + ' bills from grade ' + me.grade + '.', x.id);
        }
      });
    }

    /* D6 — consecutive bill numbers from one merchant. Real invoices from a
       busy merchant are not consecutive across somebody's month: numbers in
       sequence mean the book was written in one sitting. Only the trailing
       digits are compared, so GST-style prefixes do not defeat it. */
    const tail = v => { const m = String(v || '').match(/(\d{2,})\s*$/); return m ? +m[1] : null; };
    const byMerch = {};
    own.forEach(x => { if (!x.merchant || !x.billNo) return; const n = tail(x.billNo); if (n === null) return; (byMerch[normM(x.merchant)] = byMerch[normM(x.merchant)] || []).push({ x, n }); });
    Object.values(byMerch).forEach(list => {
      if (list.length < par('D6', 'minLines', 3)) return;
      const ns = list.map(k => k.n).sort((a, b) => a - b);
      let run = 1, best = 1;
      for (let i = 1; i < ns.length; i++) { run = ns[i] === ns[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); }
      if (best >= par('D6', 'minRun', 3)) {
        fire('D6', 'Bill numbers from one merchant run in sequence',
          best + ' consecutive bill numbers from ' + list[0].x.merchant + ': '
          + list.map(k => k.x.billNo).join(', ') + '.', list[list.length - 1].x.id);
      }
    });

    /* D7 — high share of no-bill lines. Judged on VALUE, not on count: ten
       small unreceipted autos are how people actually travel, and one large
       unreceipted line is the thing worth asking about. */
    const billable = own.filter(x => (cat(x.cat) || {}).proof !== 'none' && +x.bill > 0);
    if (billable.length >= par('D7', 'minLines', 4)) {
      const total = billable.reduce((a, x) => a + +x.bill, 0);
      const noBill = billable.filter(x => !x.file).reduce((a, x) => a + +x.bill, 0);
      const pct = total > 0 ? Math.round((noBill / total) * 100) : 0;
      if (pct >= par('D7', 'pct', 60)) {
        fire('D7', 'Most of this claim has no bill behind it',
          pct + '% of ' + rs(total) + ' — ' + rs(noBill) + ' — is claimed without a bill, across '
          + billable.filter(x => !x.file).length + ' of ' + billable.length + ' lines.');
      }
    }

    return out;
  }

  /* ---------- claim assembly ---------- */
  function assess(lineIds, empId, tripId, claimNote) {
    const lines = lineIds.map(exp), t = tripId ? trip(tripId) : null;
    lines.forEach(x => { if (x.cat === 'mileage') { const m = mileage(x); x.bill = m.full; x.claimed = m.full; x.payKm = m.payKm; } });
    const pol = policy(lines, empId, t), flags = [], rows = [];
    lines.forEach(x => {
      let lf = lineFlags(x).map(f => Object.assign({ lineId: x.id }, f));
      let elig = pol[x.id].eligible;
      if (x.cat === 'mileage') { const m = mileage(x); if (x.pay === 'self') elig = Math.min(elig, m.amount); lf = lf.concat(m.flags.map(f => Object.assign({ lineId: x.id }, f))); }
      lf = lf.concat(pol[x.id].pol.map(f => Object.assign({ lineId: x.id }, f)));
      rows.push({ x, eligible: elig, flags: lf }); lf.forEach(f => flags.push(f));
    });
    setFlags(lines, t).forEach(f => { flags.push(f); if (f.lineId) { const r = rows.find(k => k.x.id === f.lineId); if (r) r.flags.push(f); } });
    const claimed = rows.reduce((a, r) => a + (r.x.pay === 'self' ? +r.x.claimed || 0 : 0), 0), eligible = rows.reduce((a, r) => a + r.eligible, 0);
    if (t && t.end && S.today > deadline(t)) flags.push({ code: 'LATE', title: 'Submitted after the claim deadline', evidence: 'The deadline was ' + fd(deadline(t)) + ', ' + S.cfg.claimDeadlineDays + ' days after the trip. This is ' + days(deadline(t), S.today) + ' days late.', action: 'justify', sev: 'low', claimLevel: true, needsReason: !(claimNote || '').trim() });
    if (t && t.origin === 'PRE_APPROVED' && chk('D10').on) { const est = selfEstimate(t), lim = est * (1 + S.cfg.estimateTol / 100); if (claimed > lim && est > 0) flags.push({ code: 'D10', title: 'Claim is above the approved estimate', evidence: 'Self-paid estimate was ' + rs(est) + '. Claim is ' + rs(claimed) + ', more than ' + S.cfg.estimateTol + '% over.', action: 'justify', sev: 'medium', claimLevel: true, needsReason: !(claimNote || '').trim() }); }
    const blockers = flags.filter(f => f.block), needs = flags.filter(f => f.needsReason);
    const score = riskScore(flags), band = bandOf(score);
    const exception = flags.some(f => f.exception);
    const outstanding = t ? outstandingFor(t) : 0;
    return { rows, flags, claimed, eligible, blockers, needs, score, band, exception, outstanding, net: eligible - outstanding, companyPaid: lines.filter(x => x.pay === 'company').reduce((a, x) => a + +x.bill, 0) };
  }
  const riskScore = flags => flags.filter(f => f.status !== 'dismissed' && f.sev).reduce((a, f) => a + (S.cfg.weights[f.sev] || 0), 0);
  const bandOf = s => s >= S.cfg.bands.high ? 'High' : s >= S.cfg.bands.medium ? 'Medium' : 'Low';

  const WHO = { rm: 'Reporting manager (R1)', rm2: 'Manager’s manager (R2)', hod: 'Head of department', person: 'A named person', finance: 'Finance team' };
  const teamOf = k => ((S.cfg.teams || {})[k] || []).filter(id => emp(id));
  /* does a level apply to this claim or trip? */
  function levelOn(L, o) {
    const w = L.when || []; if (!w.length) return true;
    return w.some(c => c.t === 'amount' ? +o.total > +c.v : c.t === 'scope' ? o.scope === c.v : c.t === 'postFacto' ? !!o.postFacto : c.t === 'exception' ? !!o.exception : c.t === 'risk' ? o.band === 'High' : false);
  }
  const whenText = L => (L.when || []).map(c => c.t === 'amount' ? 'total above ' + rs(c.v) : c.t === 'scope' ? c.v + ' trip' : c.t === 'postFacto' ? 'post-facto' : c.t === 'exception' ? 'policy exception' : c.t === 'risk' ? 'high risk' : '').filter(Boolean);
  function chainFor(empId, o, t) {
    o = o || {}; const fk = o.flow || 'claim', F = o.levels || ((S.cfg.flows || {})[fk] || {}).levels || [], e = emp(empId), co = t ? [t.emp || empId].concat(t.co || []) : [empId];
    const ctx = Object.assign({ scope: t ? t.scope : null }, o);
    const up = id => { let w = id, guard = 0; while (w && co.includes(w) && guard++ < 6) w = (emp(w) || {}).rm; return w; };
    const fb = () => { const f = S.cfg.fallback; return f && !co.includes(f) ? f : up(f); };
    const steps = [], fin = [], why = [];
    F.forEach(L => {
      if (!levelOn(L, ctx)) return;
      const hit = (L.when || []).filter(c => levelOn({ when: [c] }, ctx)); if (hit.length && L.kind !== 'finance') why.push((L.label || WHO[L.who]) + ': ' + whenText({ when: hit }).join(', '));
      if (L.kind === 'finance') {
        if (L.who === 'person') { const w = L.person && emp(L.person) && L.person !== empId ? L.person : fb(); fin.push({ role: L.label || 'Finance', who: w, team: '', level: L.id, stage: 'finance', status: 'pending', rerouted: w !== L.person }); }
        else { const m = teamOf('finance').filter(id => id !== empId); fin.push(m.length ? { role: L.label || 'Finance check', who: '', team: 'finance', level: L.id, stage: 'finance', status: 'pending' } : { role: (L.label || 'Finance check') + ' (fallback)', who: fb(), team: '', level: L.id, stage: 'finance', status: 'pending' }); }
        return;
      }
      const raw = L.who === 'rm' ? e.rm : L.who === 'rm2' ? (emp(e.rm) || {}).rm : L.who === 'hod' ? e.hod : L.person;
      let w = raw && emp(raw) ? raw : null, role = L.label || WHO[L.who];
      if (w && co.includes(w)) { w = L.who === 'person' ? fb() : (chk('F1').on ? up(w) : w); role += ' (rerouted)'; }
      if (!w) { w = fb(); role += ' (fallback)'; }
      if (w && w !== empId) steps.push({ role, who: w, level: L.id, stage: 'manager', status: 'pending' });
    });
    /* a person on two levels is asked once, at the later level */
    const seen = {}, out = []; for (let i = steps.length - 1; i >= 0; i--) if (!seen[steps[i].who]) { seen[steps[i].who] = 1; out.unshift(steps[i]); }
    out.why = why; out.fin = fk === 'claim' ? fin : []; return out;
  }
  const finSteps = c => c.fin && c.fin.length ? c.fin : (c.fin = [{ role: 'Finance check', who: '', team: 'finance', level: 'legacy', stage: 'finance', status: 'pending' }]);
  const finStep = c => finSteps(c).find(k => k.status === 'pending');
  /* four eyes in Finance: nobody verifies two finance levels of one claim */
  function finWhy(c, st, who) {
    if (!st) return 'This claim is not in verification.';
    if (!(st.team ? teamOf(st.team).includes(who) : st.who === who)) return 'This claim is waiting for ' + stepName(st) + ' (' + st.role + ').';
    if (c) { const fs = finSteps(c), i = fs.indexOf(st); if (fs.slice(0, i).some(k => k.by === who)) return 'You verified an earlier finance level of this claim. Another person verifies this one.'; const later = fs.slice(i + 1).find(k => k.status === 'pending' && !k.team && k.who === who); if (st.team && later) return 'You are the ' + later.role + ' on this claim. Another Finance team member verifies first.'; }
    return '';
  }
  const canFin = (st, who, c) => !finWhy(c, st, who);
  /* a Finance-team level followed by a named person who is the only member would never move */
  function finDeadlock(levels, team) { for (let i = 0; i < levels.length; i++) { const L = levels[i]; if (L.kind !== 'finance' || L.who !== 'finance') continue; const P = levels.slice(i + 1).find(x => x.kind === 'finance' && x.who === 'person' && team.length && team.every(id => id === x.person)); if (P) return 'The Finance team has only ' + emp(P.person).name + ', who is also “' + P.label + '”. Nobody verifies two finance levels of one claim: add another person to the team or change a level.'; } return ''; }
  const stepName = st => !st ? '' : st.team ? 'Finance team' : (emp(st.who) || {}).name || st.who;
  /* the admin saves a flow. Every level is checked; claims keep at least one finance level, trip plans at least one approval level */
  function setFlow(key, levels, who) {
    if (!['claim', 'trip'].includes(key)) return { error: 'Unknown workflow.' };
    const L = (levels || []).map((x, i) => ({ id: x.id || key[0] + Date.now().toString(36) + i, kind: key === 'trip' ? 'approve' : x.kind === 'finance' ? 'finance' : 'approve', label: (x.label || '').trim().slice(0, 40), who: x.who, person: x.who === 'person' ? x.person || '' : '', when: (x.when || []).filter(c => c && c.t).map(c => c.t === 'amount' ? { t: 'amount', v: Math.max(0, Math.round(+c.v || 0)) } : c.t === 'scope' ? { t: 'scope', v: c.v } : { t: c.t }) }));
    for (let i = 0; i < L.length; i++) {
      const x = L[i], n = 'Level ' + (i + 1);
      if (x.kind === 'finance' && !['finance', 'person'].includes(x.who)) return { error: n + ': a finance level is the Finance team or a named person.' };
      if (x.kind === 'approve' && !['rm', 'rm2', 'hod', 'person'].includes(x.who)) return { error: n + ': choose who approves.' };
      if (x.who === 'person' && !emp(x.person)) return { error: n + ': choose the person.' };
      if (x.when.some(c => c.t === 'amount' && !(c.v > 0))) return { error: n + ': enter the amount above which this level applies.' };
      if (!x.label) x.label = x.who === 'person' ? (x.kind === 'finance' ? 'Finance: ' : '') + emp(x.person).name : x.kind === 'finance' ? 'Finance check' : WHO[x.who];
    }
    const fi = L.findIndex(x => x.kind === 'finance'); if (fi >= 0 && L.slice(fi).some(x => x.kind !== 'finance')) return { error: 'Finance levels come last, after every approval level.' };
    if (key === 'claim' && !L.some(x => x.kind === 'finance')) return { error: 'Keep at least one finance level. Finance checks the bills before payout.' };
    if (key === 'claim') { const dl = finDeadlock(L, teamOf('finance')); if (dl) return { error: dl }; }
    if (key === 'trip' && !L.length) return { error: 'Keep at least one level. Local trips up to the no-approval distance skip approval anyway.' };
    if (L.length > 8) return { error: 'Up to 8 levels.' };
    S.cfg.flows[key].levels = L;
    log(who, 'Changed the ' + (key === 'claim' ? 'expense claim' : 'trip plan') + ' approval workflow: ' + L.map(x => x.label + (x.when.length ? ' (' + whenText(x).join(' or ') + ')' : '')).join(' → '), key);
    return { levels: L };
  }
  function resetFlow(key, who) { const d = defaultFlows()[key]; if (!d) return { error: 'Unknown workflow.' }; S.cfg.flows[key] = d; log(who, 'Reset the ' + (key === 'claim' ? 'expense claim' : 'trip plan') + ' approval workflow to the default', key); return { levels: d.levels }; }
  function setTeam(key, ids, who) { const m = [...new Set((ids || []).filter(id => emp(id) && id !== 'SYSTEM'))]; if (!m.length) return { error: 'The Finance team needs at least one person.' }; const dl = finDeadlock(S.cfg.flows.claim.levels, m); if (dl) return { error: dl }; S.cfg.teams[key] = m; log(who, 'Finance team: ' + m.map(id => emp(id).name).join(', '), 'team'); return { team: m }; }
  function periodFor(dateStr) { const m = monthOf(dateStr); const p = S.periods.find(k => k.m === m); if (p && p.status === 'OPEN') return { m, late: false }; const open = S.periods.find(k => k.status === 'OPEN'); return { m: open ? open.m : m, late: true }; }

  function submitClaim(empId, o) { // o: {tripId, lineIds, note, declared}
    const t = o.tripId ? trip(o.tripId) : null, open = t ? legsOf(t).filter(legOpen) : [];
    if (open.length) return { error: 'Close every journey first. Journey ' + open[0].n + ' is ' + (open[0].status === 'ENDED' ? 'waiting for its report.' : open[0].status === 'PLANNED' ? 'not recorded: add it without GPS or skip it.' : 'still running.') };
    const a = assess(o.lineIds, empId, o.tripId, o.note);
    if (!o.lineIds.length) return { error: 'Add at least one expense line.' };
    if (a.blockers.length) return { error: 'Fix the blocked lines first.' };
    if (a.needs.length) return { error: 'Add a reason where one is asked.' };
    if (!o.declared) return { error: 'Accept the declaration to submit.' };
    const postFacto = !!(t && t.origin === 'POST_FACTO');
    if (t && t.origin === 'POST_FACTO') { const iss = tripIssues(t).filter(i => i.block); if (iss.length) return { error: iss[0].t }; }
    const lines = o.lineIds.map(exp), last = lines.map(x => x.date).sort().pop(), per = periodFor(t ? t.end : last);
    const id = 'CLM-2026-' + String(++S.seq.claim).padStart(6, '0');
    const chain = chainFor(empId, { flow: 'claim', total: a.claimed, exception: a.exception, postFacto, band: a.band }, t);
    const c = { id, emp: empId, tripId: o.tripId || null, type: t ? 'TRIP' : 'GENERAL', period: per.m, late: per.late, lines: o.lineIds.slice(), note: o.note || '', claimed: a.claimed, eligible: a.eligible, approved: a.eligible, advanceAdjusted: 0, net: null, flags: a.flags.map((f, i) => Object.assign({ id: id + '-F' + (i + 1), status: 'open' }, f)), score: a.score, band: a.band, exception: a.exception, postFacto, chain: chain.slice(), fin: (chain.fin || []).map(k => Object.assign({}, k)), why: chain.why || [], stage: 'manager', status: 'IN_APPROVAL', submittedAt: stamp(), thread: [], history: [], autoApproved: false, sampled: false, autoVerified: false };
    a.rows.forEach(r => { r.x.status = 'IN_CLAIM'; r.x.claimId = id; r.x.eligible = r.eligible; r.x.approved = r.eligible; r.x.dreason = r.eligible < (r.x.pay === 'self' ? r.x.claimed : 0) ? 'Capped to policy limit' : ''; });
    S.claims.unshift(c); if (t) { t.status = 'CLAIMED'; (t.history || (t.history = [])).unshift({ at: stamp(), who: empId, text: 'Claim ' + id + ' sent: ' + c.lines.length + (c.lines.length === 1 ? ' line, ' : ' lines, ') + rs(c.claimed) + '.' }); }
    hist(c, empId, 'Submitted with declaration. ' + c.lines.length + (c.lines.length === 1 ? ' line, ' : ' lines, ') + rs(c.claimed) + ' claimed.'); log(empId, 'Submitted claim', id);
    if (!c.chain.length) { hist(c, 'SYSTEM', 'No approval level applies in the workflow. Sent to Finance.'); enterVerification(c); }
    return { claim: c };
  }
  function hist(c, who, text) { c.history.unshift({ at: stamp(), who, text }); }
  const curStep = c => c.chain.find(s => s.status === 'pending');
  function recalc(c) { const ls = c.lines.map(exp); c.approved = ls.reduce((a, x) => a + (x.pay === 'self' ? +x.approved || 0 : 0), 0); c.score = riskScore(c.flags); c.band = bandOf(c.score); }
  function applyDecisions(c, decs, who) {
    Object.keys(decs || {}).forEach(id => { const x = exp(id), d = decs[id]; if (!x || !d) return;
      if (d.reject) { x.approved = 0; x.dreason = d.reason || 'Rejected'; x.lstatus = d.reject === 'refile' ? 'REJECTED_REFILE' : 'REJECTED_FINAL'; hist(c, who, 'Rejected line ' + (x.merchant || cat(x.cat).name) + ': ' + x.dreason); }
      else if (d.amount != null && +d.amount > +x.approved) { hist(c, who, 'Accepted ' + (x.merchant || cat(x.cat).name) + ' above the cap, ' + rs(x.approved) + ' to ' + rs(d.amount) + ': ' + (d.reason || '')); x.approved = +d.amount; x.dreason = 'Accepted by approver: ' + (d.reason || ''); }
      else if (d.amount != null && +d.amount < +x.approved) { hist(c, who, 'Reduced ' + (x.merchant || cat(x.cat).name) + ' from ' + rs(x.approved) + ' to ' + rs(d.amount) + ': ' + (d.reason || '')); x.approved = +d.amount; x.dreason = d.reason || 'Reduced by approver'; x.lstatus = 'PARTLY_APPROVED'; } });
    recalc(c);
  }
  const capLift = (c, id) => !!(c && (c.flags || []).some(f => f.lineId === id && ['G3', 'G10'].includes(f.code)));
  function checkDecisions(decs, c) { for (const id in (decs || {})) { const d = decs[id], x = exp(id); if (!d) continue; if (d.amount != null && +d.amount > +x.approved && capLift(c, id) && +d.amount <= +x.claimed) { if (!(d.reason || '').trim()) return 'Say why you accept the longer route.'; continue; } if ((d.reject || (d.amount != null && +d.amount < +x.approved)) && !(d.reason || '').trim()) return 'Give a reason for every reduced or rejected line.'; if (d.amount != null && +d.amount > +x.approved) return capLift(c, id) ? 'You can raise it up to the amount claimed, ' + rs(x.claimed) + '.' : 'An approver cannot increase an amount.'; } return null; }

  function managerAct(claimId, who, action, o) {
    const c = claim(claimId), st = curStep(c); o = o || {};
    if (!st || c.status !== 'IN_APPROVAL' || st.who !== who) return { error: 'This claim is not waiting for you.' };
    if (action !== 'approve' && !(o.comment || '').trim()) return { error: 'Write a comment so the employee knows why.' };
    if (action === 'approve') {
      const er = checkDecisions(o.decs, c); if (er) return { error: er };
      applyDecisions(c, o.decs, who); st.status = 'approved'; st.at = stamp(); st.comment = o.comment || '';
      hist(c, who, 'Approved as ' + st.role + (o.comment ? ': ' + o.comment : '.')); log(who, 'Approved claim (' + st.role + ')', c.id);
      if (!curStep(c)) enterVerification(c);
    } else if (action === 'sendback') { markFix(c, o.fix); c.status = 'SENT_BACK'; c.sentFrom = 'manager'; c.thread.push({ who, text: o.comment, at: stamp() }); hist(c, who, 'Sent back: ' + o.comment + fixNote(c)); log(who, 'Sent claim back', c.id); }
    else if (action === 'reject') { rejectClaim(c, who, o.comment); }
    return { claim: c };
  }
  function rejectClaim(c, who, comment) {
    c.status = 'REJECTED'; c.rejectedFrom = c.stage; c.rejectReason = comment; c.lines.map(exp).forEach(x => { x.status = 'REJECTED_FINAL'; x.approved = 0; x.dreason = 'Claim rejected: ' + comment; }); c.approved = 0; c.net = 0;
    hist(c, who, 'Rejected: ' + comment); log(who, 'Rejected claim', c.id);
    const t = c.tripId && trip(c.tripId); if (t) { t.status = c.postFacto ? 'REJECTED' : 'CLOSED'; t.claimRejected = c.id; t.history.unshift({ at: stamp(), who, text: 'Claim ' + c.id + ' rejected: ' + comment }); const a = tripAdvance(t); if (a && a.outstanding > 0 && ['PAID', 'PART_SETTLED'].includes(a.status)) { a.status = 'RECOVERY_DUE'; hist(c, 'SYSTEM', 'Advance ' + a.id + ' of ' + rs(a.outstanding) + ' is now due for recovery.'); } }
  }
  function enterVerification(c) {
    c.stage = 'finance'; recalc(c);
    const k = chk('F4'), n = parseInt(c.id.slice(-6), 10), every = S.cfg.samplePct > 0 ? Math.max(1, Math.round(100 / S.cfg.samplePct)) : 0;
    c.sampled = !!(k.on && every && n % every === 0);
    const inPolicy = !c.flags.some(f => f.status !== 'dismissed' && (f.code === 'POL' || f.sev === 'medium' || f.sev === 'high' || f.action === 'justify'));
    if (c.band === 'High' || c.sampled) { c.status = 'ON_HOLD'; hist(c, 'SYSTEM', c.band === 'High' ? 'Risk band is High. Placed on hold for Finance audit.' : 'Picked by the random audit sample. Placed on hold.'); }
    else if (c.band === 'Low' && inPolicy && c.claimed <= S.cfg.fastTrack && !c.autoApproved) { c.autoVerified = true; hist(c, 'SYSTEM', 'Low risk, fully in policy and under ' + rs(S.cfg.fastTrack) + '. Auto-verified.'); finSteps(c).forEach(k => { k.status = 'auto'; k.at = stamp(); }); finalize(c, 'SYSTEM'); }
    else { c.status = 'IN_VERIFICATION'; hist(c, 'SYSTEM', 'Moved to Finance verification.'); }
  }
  function financeAct(claimId, who, action, o) {
    const c = claim(claimId); o = o || {};
    if (!['IN_VERIFICATION', 'ON_HOLD'].includes(c.status)) return { error: 'This claim is not in verification.' };
    if (who === c.emp) return { error: 'Nobody can verify their own claim.' };
    const fs = finStep(c), fw = fs ? finWhy(c, fs, who) : ''; if (fw) return { error: fw };
    if (action === 'verify') {
      if (c.status === 'ON_HOLD' && !(o.comment || '').trim()) return { error: 'An audit note is mandatory for a claim on hold.' };
      const er = checkDecisions(o.decs, c); if (er) return { error: er };
      applyDecisions(c, o.decs, who); hist(c, who, (c.status === 'ON_HOLD' ? 'Audit cleared' : 'Verified') + (fs ? ' as ' + fs.role : '') + (o.comment ? ': ' + o.comment : '.')); log(who, 'Verified claim' + (fs ? ' (' + fs.role + ')' : ''), c.id);
      if (fs) { fs.status = 'approved'; fs.at = stamp(); fs.by = who; } const nx = finStep(c);
      if (nx) { c.status = 'IN_VERIFICATION'; hist(c, 'SYSTEM', 'Next: ' + nx.role + ', ' + stepName(nx) + '.'); } else finalize(c, who);
    } else if (!(o.comment || '').trim()) return { error: 'Write a comment so the employee knows why.' };
    else if (action === 'hold') { c.status = 'ON_HOLD'; hist(c, who, 'Held for audit: ' + o.comment); log(who, 'Held claim for audit', c.id); }
    else if (action === 'sendback') { markFix(c, o.fix); c.sentFrom = c.status; c.status = 'SENT_BACK'; c.thread.push({ who, text: o.comment, at: stamp() }); hist(c, who, 'Sent back: ' + o.comment + fixNote(c)); log(who, 'Sent claim back', c.id); }
    else if (action === 'reject') rejectClaim(c, who, o.comment);
    return { claim: c };
  }
  function flagAct(claimId, flagId, who, status, note) { const c = claim(claimId), f = c.flags.find(k => k.id === flagId); if (!f) return; if (!(note || '').trim()) return { error: 'Give a reason.' }; f.status = status; f.note = note; recalc(c); hist(c, who, (status === 'dismissed' ? 'Dismissed' : 'Confirmed') + ' flag ' + f.code + ': ' + note); log(who, (status === 'dismissed' ? 'Dismissed' : 'Confirmed') + ' flag ' + f.code, c.id); return { ok: true }; }
  function finalize(c, who) {
    const t = c.tripId && trip(c.tripId), a = t && tripAdvance(t), out = a && ['PAID', 'PART_SETTLED', 'RECOVERY_DUE'].includes(a.status) ? a.outstanding : 0;
    recalc(c); const adj = Math.min(c.approved, out); c.advanceAdjusted = adj; c.net = c.approved - out;
    if (a && out > 0) { a.outstanding = out - adj; S.settlements.unshift({ id: nid('settle', 'SET-'), advanceId: a.id, claimId: c.id, amount: adj, kind: 'net_off', at: stamp() }); a.status = a.outstanding === 0 ? 'SETTLED' : 'RECOVERY_DUE'; hist(c, 'SYSTEM', rs(adj) + ' adjusted against advance ' + a.id + (a.outstanding ? '. ' + rs(a.outstanding) + ' stays on the advance for recovery.' : '.')); }
    c.lines.map(exp).forEach(x => { if (x.lstatus === 'REJECTED_REFILE') { x.status = 'UNCLAIMED'; x.claimId = null; x.note = 'Returned: ' + x.dreason; x.lstatus = null; x.file = null; } else if (x.lstatus === 'REJECTED_FINAL') x.status = 'REJECTED_FINAL'; else x.status = x.lstatus === 'PARTLY_APPROVED' || +x.approved < (x.pay === 'self' ? +x.claimed : 0) ? 'PARTLY_APPROVED' : 'APPROVED'; });
    c.lines = c.lines.filter(id => exp(id).claimId === c.id);
    if (c.net > 0) { c.status = 'VERIFIED'; hist(c, 'SYSTEM', 'Net payable ' + rs(c.net) + '. Waiting for a payout batch.'); }
    else settle(c, 'SYSTEM', 'Nothing to pay. The advance covers this claim.');
  }
  function settle(c, who, text) { c.status = 'SETTLED'; c.settledAt = stamp(); c.lines.map(exp).forEach(x => { if (['APPROVED', 'PARTLY_APPROVED'].includes(x.status)) x.status = 'PAID'; }); hist(c, who, text); const t = c.tripId && trip(c.tripId); if (t && !S.claims.some(k => k.tripId === t.id && !['SETTLED', 'REJECTED', 'CANCELLED'].includes(k.status))) t.status = 'CLOSED'; }
  function markFix(c, ids) { const own = c.lines.map(exp).filter(x => x.pay === 'self'); ids = (ids || []).filter(id => own.some(x => x.id === id)); c.fixAll = !ids.length; own.forEach(x => { x.fix = c.fixAll || ids.includes(x.id); }); }
  const fixNote = c => c.fixAll ? ' Every line can be edited.' : ' Lines to fix: ' + c.lines.map(exp).filter(x => x.fix).map(x => x.merchant || cat(x.cat).name).join(', ') + '.';
  /* after the employee fixes a sent-back claim, every check runs again */
  function reassess(c) {
    const was = c.claimed, a = assess(c.lines, c.emp, c.tripId, c.note);
    a.rows.forEach(r => { r.x.eligible = r.eligible; r.x.approved = r.eligible; r.x.dreason = r.eligible < (r.x.pay === 'self' ? r.x.claimed : 0) ? 'Capped to policy limit' : ''; r.x.fix = false; });
    Object.assign(c, { claimed: a.claimed, eligible: a.eligible, approved: a.eligible, score: a.score, band: a.band, exception: a.exception, flags: a.flags.map((f, i) => Object.assign({ id: c.id + '-R' + (c.history.length + 1) + '-F' + (i + 1), status: 'open' }, f)) }); c.fixAll = false;
    return { was, a };
  }
  function respond(claimId, who, text) {
    const c = claim(claimId); if (c.status !== 'SENT_BACK') return { error: 'Nothing to answer.' }; if (!(text || '').trim()) return { error: 'Write your answer.' };
    const r = reassess(c); if (r.a.blockers.length) return { error: 'Fix the blocked lines first.' };
    c.thread.push({ who, text, at: stamp() }); hist(c, who, 'Answered and sent again: ' + text);
    if (c.claimed > r.was) { c.chain.forEach(k => { k.status = 'pending'; k.at = null; }); finSteps(c).forEach(k => { k.status = 'pending'; k.at = null; k.by = null; }); c.stage = c.chain.length ? 'manager' : 'finance'; c.status = c.chain.length ? 'IN_APPROVAL' : 'IN_VERIFICATION'; hist(c, 'SYSTEM', 'Total went up from ' + rs(r.was) + ' to ' + rs(c.claimed) + '. Approval starts again from the first approver.'); }
    else c.status = c.sentFrom === 'manager' ? 'IN_APPROVAL' : c.sentFrom;
    log(who, 'Answered a send-back', c.id); return { claim: c };
  }
  function recall(claimId, who) { const c = claim(claimId); if (!(c.status === 'SENT_BACK' || (c.status === 'IN_APPROVAL' && !c.chain.some(s => s.status === 'approved')))) return { error: 'An approver has already acted.' }; c.lines.map(exp).forEach(x => { x.status = 'UNCLAIMED'; x.claimId = null; x.fix = false; }); const t = c.tripId && trip(c.tripId); if (t) t.status = c.postFacto ? 'DRAFT' : 'APPROVED'; c.status = 'CANCELLED'; hist(c, who, 'Recalled by the employee. Lines returned to Unclaimed.'); log(who, 'Recalled claim', c.id); return { claim: c }; }
  function reopen(claimId, who, reason) { const c = claim(claimId); if (c.status !== 'REJECTED') return { error: 'Only a rejected claim can be reopened.' }; if (!(reason || '').trim()) return { error: 'Give a reason.' }; const p = S.periods.find(k => k.m === c.period); if (p && p.status === 'LOCKED') return { error: 'The period is locked.' }; c.status = c.rejectedFrom === 'finance' ? 'IN_VERIFICATION' : 'IN_APPROVAL'; const t = c.tripId && trip(c.tripId); if (t) t.status = 'CLAIMED'; hist(c, who, 'Reopened: ' + reason); log(who, 'Reopened claim', c.id); return { claim: c }; }

  /* ---------- trips, bookings, advances ---------- */
  const tripKm = t => r1(legsOf(t).reduce((a, j) => a + (j.mode === 'flight' ? 0 : j.plannedKm), 0));
  function saveTrip(empId, d) {
    const T = S.cfg.track, t = derive(Object.assign({ id: 'TRP-2026-' + String(++S.seq.trip).padStart(4, '0'), emp: empId, co: [], status: 'DRAFT', history: [], createdAt: stamp(), stayBy: 'self', advance: 0 }, d));
    t.estimate = estimateFor(empId, t);
    const iss = tripIssues(t).filter(i => i.block); if (iss.length) { S.seq.trip--; return { error: iss[0].t }; }
    S.trips.unshift(t); makeLegs(t); const n = t.legIds.length, km = tripKm(t);
    if (t.origin === 'POST_FACTO') { legsOf(t).forEach(j => markManual(j, t.pfReason + (t.pfNote ? ': ' + t.pfNote : ''))); t.history.unshift({ at: stamp(), who: empId, text: 'Recorded after travel: ' + n + ' journey' + (n === 1 ? '' : 's') + ', ' + km + ' km on the map. Reason: ' + t.pfReason + '.' }); log(empId, 'Recorded a past trip', t.id); return { trip: t }; }
    if (t.scope === 'local' && km <= T.preApproveKm) { t.status = 'APPROVED'; t.chain = []; t.why = []; t.history.unshift({ at: stamp(), who: empId, text: 'Planned ' + n + ' journey' + (n === 1 ? '' : 's') + ', ' + km + ' km. Local travel up to ' + T.preApproveKm + ' km needs no approval.' }); log(empId, 'Planned local trip', t.id); return { trip: t }; }
    const ch = chainFor(empId, { flow: 'trip', total: estimateTotal(t), intl: t.scope === 'international' }, t); t.chain = ch.slice(); t.why = ch.why || []; t.status = 'PENDING_APPROVAL';
    if (!ch.length) { t.status = 'APPROVED'; if (t.advance > 0) S.advances.unshift({ id: 'ADV-' + String(++S.seq.adv).padStart(4, '0'), tripId: t.id, emp: empId, requested: +t.advance, approved: 0, outstanding: 0, status: 'REQUESTED', due: addDays(t.end, S.cfg.claimDeadlineDays) }); t.history.unshift({ at: stamp(), who: empId, text: 'Planned ' + n + ' journeys, ' + km + ' km. No approval level applies to this plan in the workflow.' }); log(empId, 'Planned trip', t.id); return { trip: t }; }
    if (t.advance > 0) S.advances.unshift({ id: 'ADV-' + String(++S.seq.adv).padStart(4, '0'), tripId: t.id, emp: empId, requested: +t.advance, approved: 0, outstanding: 0, status: 'REQUESTED', due: addDays(t.end, S.cfg.claimDeadlineDays) });
    t.history.unshift({ at: stamp(), who: empId, text: 'Sent for approval. ' + n + ' journeys, ' + km + ' km by road' + (legsOf(t).some(j => j.mode === 'flight') ? ' plus flights' : '') + '. Estimate ' + rs(estimateTotal(t)) + (t.advance ? ', advance asked ' + rs(t.advance) : '') + '.' }); log(empId, 'Submitted trip request', t.id);
    return { trip: t };
  }
  function tripAct(tripId, who, action, comment) {
    const t = trip(tripId), st = (t.chain || []).find(s => s.status === 'pending');
    if (tStatus(t) === 'EXPIRED') return { error: 'The trip dates have passed. Ask the employee to record it as I already travelled.' };
    if (t.status !== 'PENDING_APPROVAL' || !st || st.who !== who) return { error: 'This trip is not waiting for you.' };
    if (action !== 'approve' && !(comment || '').trim()) return { error: 'Write a comment so the employee knows why.' };
    if (action === 'approve') { st.status = 'approved'; st.at = stamp(); t.history.unshift({ at: stamp(), who, text: 'Approved as ' + st.role + (comment ? ': ' + comment : '.') }); log(who, 'Approved trip (' + st.role + ')', t.id); if (!t.chain.some(s => s.status === 'pending')) { t.status = 'APPROVED'; const desk = legsOf(t).some(j => j.bookedBy === 'desk') || t.stayBy === 'desk'; t.history.unshift({ at: stamp(), who: 'SYSTEM', text: 'Trip approved. Policy version frozen.' + (desk ? ' Sent to Travel Desk.' : '') + (tripAdvance(t) ? ' Advance sent to Finance.' : '') }); } }
    else if (action === 'reject') { t.status = 'REJECTED'; const a = tripAdvance(t); if (a) a.status = 'CANCELLED'; legsOf(t).forEach(j => { if (j.status === 'PLANNED') j.status = 'CANCELLED'; }); t.history.unshift({ at: stamp(), who, text: 'Rejected: ' + comment }); log(who, 'Rejected trip', t.id); }
    else { t.status = 'SENT_BACK'; t.history.unshift({ at: stamp(), who, text: 'Sent back: ' + comment }); log(who, 'Sent trip back', t.id); }
    return { trip: t };
  }
  function editTrip(empId, tripId, d) {
    const t = trip(tripId), began = t && legsOf(t).some(j => j.startedAt || j.expenseId);
    if (!t || t.emp !== empId || !(t.status === 'SENT_BACK' || (t.status === 'DRAFT' && t.origin === 'POST_FACTO') || (t.status === 'APPROVED' && !(t.chain || []).length))) return { error: 'This trip cannot be edited now.' };
    if (began) return { error: 'A journey already has a GPS record or a report. Delete the draft and record the trip again.' };
    const nx = derive(Object.assign({}, t, d, { id: t.id, emp: t.emp, origin: t.origin, status: t.status })); nx.estimate = estimateFor(empId, nx);
    const iss = tripIssues(nx).filter(i => i.block); if (iss.length) return { error: iss[0].t };
    if (!(d.answer || '').trim() && t.status === 'SENT_BACK') return { error: 'Tell your approver what you changed.' };
    const was = estimateTotal(t); ['name', 'scope', 'pattern', 'points', 'segs', 'purpose', 'project', 'co', 'people', 'pax', 'stayBy', 'advance', 'pfReason', 'pfNote'].forEach(k => { if (d[k] !== undefined) t[k] = d[k]; });
    derive(t); t.estimate = estimateFor(empId, t); makeLegs(t); if (t.origin === 'POST_FACTO') legsOf(t).forEach(j => markManual(j, t.pfReason));
    const a = tripAdvance(t); if (a && a.status === 'REQUESTED') { if (+t.advance > 0) a.requested = +t.advance; else a.status = 'CANCELLED'; } else if (!a && +t.advance > 0 && t.origin !== 'POST_FACTO') S.advances.push({ id: 'ADV-' + String(++S.seq.adv).padStart(4, '0'), tripId: t.id, emp: t.emp, requested: +t.advance, approved: 0, outstanding: 0, status: 'REQUESTED', due: addDays(t.end, S.cfg.claimDeadlineDays) });
    if (t.status === 'SENT_BACK') { const ch = chainFor(empId, { flow: 'trip', total: estimateTotal(t), intl: t.scope === 'international' }, t), up = estimateTotal(t) > was; if (up || ch.length !== t.chain.length) t.chain = ch.slice(); else t.chain.forEach(k => { if (k.status === 'pending') k.at = null; }); t.status = 'PENDING_APPROVAL'; t.history.unshift({ at: stamp(), who: empId, text: 'Edited and sent again: ' + d.answer + (up ? ' Estimate went up from ' + rs(was) + ' to ' + rs(estimateTotal(t)) + ', so approval starts again.' : '') }); }
    else if (t.status === 'APPROVED') { if (t.scope !== 'local' || tripKm(t) > S.cfg.track.preApproveKm) { const ch = chainFor(empId, { flow: 'trip', total: estimateTotal(t), intl: t.scope === 'international' }, t); t.chain = ch.slice(); t.why = ch.why || []; t.status = ch.length ? 'PENDING_APPROVAL' : 'APPROVED'; t.history.unshift({ at: stamp(), who: empId, text: 'Plan changed to ' + tripKm(t) + ' km. It now needs approval.' }); } else t.history.unshift({ at: stamp(), who: empId, text: 'Plan changed.' }); }
    else t.history.unshift({ at: stamp(), who: empId, text: 'Past trip edited.' });
    log(empId, 'Edited trip', t.id); return { trip: t };
  }
  function tripResubmit(tripId, who, text) { const t = trip(tripId); if (t.status !== 'SENT_BACK') return { error: 'Nothing to answer.' }; if (!(text || '').trim()) return { error: 'Write your answer.' }; t.status = 'PENDING_APPROVAL'; t.history.unshift({ at: stamp(), who, text: 'Answered: ' + text }); return { trip: t }; }
  function cancelTrip(tripId, who) {
    const t = trip(tripId); if (!t) return { error: 'Trip not found.' };
    const legs = legsOf(t), began = legs.some(j => j.startedAt || j.expenseId);
    if (t.status === 'DRAFT' && t.origin === 'POST_FACTO') { if (S.expenses.some(x => x.tripId === t.id && x.claimId)) return { error: 'This trip has a claim. Recall the claim first.' }; S.expenses.filter(x => x.tripId === t.id && x.status === 'UNCLAIMED').forEach(x => { x.status = 'DISCARDED'; }); legs.forEach(j => { S.journeys.splice(S.journeys.indexOf(j), 1); }); S.trips.splice(S.trips.indexOf(t), 1); log(who, 'Deleted draft trip', t.id); return { trip: t, deleted: true }; }
    if (!['PENDING_APPROVAL', 'SENT_BACK', 'APPROVED'].includes(t.status) || began) return { error: 'This trip has started and can no longer be cancelled. Skip the journeys you did not take.' };
    if (S.expenses.some(x => x.tripId === t.id && x.pay === 'self' && live(x) && x.status !== 'UNCLAIMED')) return { error: 'This trip has a claim. Recall the claim first.' };
    S.expenses.filter(x => x.tripId === t.id && x.status === 'UNCLAIMED').forEach(x => { x.status = 'DISCARDED'; }); legs.forEach(j => { if (legOpen(j)) j.status = 'CANCELLED'; });
    t.status = 'CANCELLED'; const a = tripAdvance(t); if (a) { if (a.status === 'PAID') a.status = 'RECOVERY_DUE'; else a.status = 'CANCELLED'; }
    t.history.unshift({ at: stamp(), who, text: 'Trip cancelled.' }); log(who, 'Cancelled trip', t.id); return { trip: t };
  }
  /* the Travel Desk books each ticket leg, and each hotel stay when the company books stays */
  function book(tripId, who, d) {
    const t = trip(tripId); d = d || {}; if (!d.vendor || !d.pnr || !(+d.amount > 0)) return { error: 'Enter vendor, reference and amount.' };
    const j = d.legId && journey(d.legId), P = t.points || [], p = d.idx != null && d.idx !== '' ? P[+d.idx] : null; if (!j && !p) return { error: 'Choose what is booked.' };
    const b = { id: 'BKG-' + String(++S.seq.bkg).padStart(4, '0'), tripId, legId: j ? j.id : null, pointIdx: p ? +d.idx : null, kind: j ? 'travel' : 'hotel', vendor: d.vendor, pnr: d.pnr.toUpperCase(), amount: +d.amount, paidBy: 'company', status: 'BOOKED', at: stamp() };
    S.bookings.unshift(b);
    S.expenses.push({ id: nid('exp', 'EXP-'), emp: t.emp, tripId, legId: j ? j.id : null, cat: j ? (modeOf(j.mode).cat || 'air') : 'hotel', date: j ? j.date : p.arrive, checkIn: p ? p.arrive : undefined, checkOut: p ? p.leave : undefined, merchant: d.vendor, pnr: j ? b.pnr : '', ref: j ? '' : b.pnr, bill: +d.amount, claimed: 0, pay: 'company', payMode: 'Paid by company', status: 'UNCLAIMED', desc: 'Booked by Travel Desk, ' + b.id, file: { name: b.id + '-ticket.pdf', sha: 'bk-' + b.id } });
    t.history.unshift({ at: stamp(), who, text: 'Travel Desk booked ' + d.vendor + ' (' + b.pnr + ') for ' + rs(b.amount) + '. Paid by company.' }); log(who, 'Recorded booking ' + b.id, t.id); return { booking: b };
  }
  /* what the Travel Desk still has to book on an approved trip */
  const needsBooking = t => {
    if (t.status !== 'APPROVED' || S.today > t.end) return [];
    const out = legsOf(t).filter(j => j.bookedBy === 'desk' && j.status === 'PLANNED' && !S.bookings.some(b => b.legId === j.id)).map(j => ({ kind: 'leg', legId: j.id }));
    if (t.stayBy === 'desk') (t.points || []).forEach((p, i) => { if (i && !p.ret && p.arrive && days(p.arrive, p.leave || p.arrive) > 0 && !S.bookings.some(b => b.tripId === t.id && b.pointIdx === i)) out.push({ kind: 'hotel', idx: i }); });
    return out;
  };
  function advanceAct(advId, who, action, d) {
    const a = adv(advId), t = trip(a.tripId); d = d || {};
    if (action === 'pay') { if (a.status !== 'REQUESTED' && a.status !== 'APPROVED') return { error: 'Already handled.' }; if (t.status !== 'APPROVED') return { error: 'The trip is not approved yet.' }; const amt = +d.amount; if (!(amt > 0) || amt > a.requested) return { error: 'Enter an amount up to ' + rs(a.requested) + '.' }; if (!(d.ref || '').trim()) return { error: 'Enter the bank reference.' }; a.approved = amt; a.outstanding = amt; a.status = 'PAID'; a.ref = d.ref; a.paidOn = S.today; t.history.unshift({ at: stamp(), who, text: 'Advance ' + rs(amt) + ' paid. Ref ' + d.ref + '.' }); log(who, 'Paid advance ' + rs(amt), a.id); }
    else if (action === 'reject') { a.status = 'REJECTED'; log(who, 'Rejected advance', a.id); }
    else if (action === 'refund' || action === 'payroll' || action === 'carry') {
      if (!['RECOVERY_DUE', 'PAID', 'PART_SETTLED'].includes(a.status) || !(a.outstanding > 0)) return { error: 'Nothing is outstanding.' };
      if (action === 'carry') { const nt = S.trips.find(k => k.emp === a.emp && k.id !== a.tripId && k.status === 'APPROVED' && S.today <= k.end && !tripAdvance(k)); if (!nt) return { error: 'Carry forward needs another approved trip without an advance.' }; S.advances.unshift({ id: 'ADV-' + String(++S.seq.adv).padStart(4, '0'), tripId: nt.id, emp: a.emp, requested: a.outstanding, approved: a.outstanding, outstanding: a.outstanding, status: 'PAID', due: addDays(nt.end, S.cfg.claimDeadlineDays), source: a.id, ref: 'Carried from ' + a.id, paidOn: S.today }); }
      S.settlements.unshift({ id: nid('settle', 'SET-'), advanceId: a.id, claimId: null, amount: a.outstanding, kind: action === 'refund' ? 'refund' : action === 'payroll' ? 'payroll_recovery' : 'carry_forward', at: stamp() });
      log(who, (action === 'refund' ? 'Recorded refund of ' : action === 'payroll' ? 'Sent to payroll recovery ' : 'Carried forward ') + rs(a.outstanding), a.id); a.outstanding = 0; a.status = 'SETTLED';
    }
    return { advance: a };
  }
  function advView(a) { if (['PAID', 'PART_SETTLED'].includes(a.status) && a.outstanding > 0 && S.today > addDays(a.due, S.cfg.graceDays)) return 'RECOVERY_DUE'; return a.status; }

  /* ---------- expenses ---------- */
  function blankExpense(empId, tripId) { const t = tripId && trip(tripId); return { id: null, emp: empId, tripId: tripId || null, cat: t ? 'meals' : 'client', date: t ? (S.today > t.end ? t.end : S.today < t.start ? t.start : S.today) : S.today, merchant: '', billNo: '', gstin: '', bill: '', claimed: '', pay: 'self', payMode: 'UPI', desc: '', status: 'UNCLAIMED', file: null, reason: '', wantException: false, vehicleId: (myVehicles(empId)[0] || {}).id || '', from: 'off', to: '' }; }
  function previewExpense(x) { // live flags for a draft line (not yet saved)
    const tmp = Object.assign({}, x, { id: x.id || '__draft__' }); if (tmp.cat === 'mileage') { const m = mileage(tmp); tmp.bill = m.full; tmp.claimed = m.full; tmp.payKm = m.payKm; }
    const had = S.expenses.findIndex(k => k.id === tmp.id); const keep = had >= 0 ? S.expenses[had] : null; if (had >= 0) S.expenses[had] = tmp; else S.expenses.push(tmp);
    const cl = tmp.claimId && claim(tmp.claimId), sibs = cl ? cl.lines.slice() : S.expenses.filter(k => k.emp === tmp.emp && (k.tripId || null) === (tmp.tripId || null) && k.status === 'UNCLAIMED').map(k => k.id); if (!sibs.includes(tmp.id)) sibs.push(tmp.id);
    const a = assess(sibs, tmp.emp, tmp.tripId); const row = a.rows.find(r => r.x.id === tmp.id);
    if (had >= 0) S.expenses[had] = keep; else S.expenses.pop();
    return { flags: row.flags, eligible: row.eligible, claimed: +tmp.claimed || 0, block: row.flags.some(f => f.block), mileage: tmp.cat === 'mileage' ? mileage(tmp) : null };
  }
  function saveExpense(x) {
    const old = x.id && exp(x.id), oc = old && old.claimId && claim(old.claimId); if (old && old.status !== 'UNCLAIMED' && !(oc && oc.status === 'SENT_BACK' && old.fix)) return { error: 'This line is in a claim and cannot be changed now.' };
    const p = previewExpense(x); if (p.block) return { error: 'Fix the blocked items first.' };
    if (x.cat === 'mileage') { const m = mileage(x); x.bill = m.full; x.claimed = m.full; x.payKm = m.payKm; if (!x.journeyId) { x.merchant = place(x.from).name + ' → ' + place(x.to).name; x.payMode = 'Own vehicle'; } }
    if (!x.id) { x.id = nid('exp', 'EXP-'); S.expenses.push(x); log(x.emp, 'Saved expense line', x.id); } else { const i = S.expenses.findIndex(k => k.id === x.id); S.expenses[i] = x; }
    return { expense: x };
  }
  function deleteExpense(id) { const i = S.expenses.findIndex(k => k.id === id); if (i >= 0 && S.expenses[i].status === 'UNCLAIMED' && S.expenses[i].pay === 'self') S.expenses.splice(i, 1); }
  const unclaimed = (empId, tripId) => S.expenses.filter(x => x.emp === empId && (x.tripId || null) === (tripId || null) && x.status === 'UNCLAIMED');

  /* ---------- payout & periods ---------- */
  const payable = () => S.claims.filter(c => c.status === 'VERIFIED' && c.net > 0);
  function createBatch(who, route, ids) { const list = payable().filter(c => !ids || ids.includes(c.id)); if (!list.length) return { error: 'No verified claims are waiting for payout.' }; const b = { id: 'PAY-' + String(++S.seq.batch).padStart(4, '0'), route, date: S.today, status: 'DRAFT', items: list.map(c => ({ claimId: c.id, emp: c.emp, amount: c.net, status: 'PENDING' })) }; b.total = b.items.reduce((a, i) => a + i.amount, 0); list.forEach(c => { c.status = 'IN_PAYOUT'; c.batchId = b.id; hist(c, who, 'Added to payout batch ' + b.id + ' (' + (route === 'PAYROLL' ? 'with payroll' : 'off-cycle') + ').'); }); S.batches.unshift(b); log(who, 'Created payout batch, ' + rs(b.total), b.id); return { batch: b }; }
  function bankFile(batchId) { const b = S.batches.find(k => k.id === batchId); const rows = [['Beneficiary name', 'Employee code', 'Account number', 'IFSC', 'Amount', 'Narration']]; b.items.forEach(i => { const e = emp(i.emp); rows.push([e.name, i.emp, e.acct, e.ifsc, i.amount.toFixed(2), 'EXP REIMB ' + i.claimId]); }); if (b.status === 'DRAFT') b.status = 'FILE_GENERATED'; return rows.map(r => r.join(',')).join('\n'); }
  function payBatch(batchId, who, refNo) { const b = S.batches.find(k => k.id === batchId); if (b.status === 'PAID') return { error: 'Already paid.' }; if (!(refNo || '').trim()) return { error: 'Enter the bank or payroll reference.' }; b.status = 'PAID'; b.ref = refNo; b.items.forEach(i => { i.status = 'PAID'; const c = claim(i.claimId); c.status = 'PAID'; c.paidRef = refNo; hist(c, who, rs(i.amount) + ' paid. Ref ' + refNo + '.'); settle(c, 'SYSTEM', 'Settled.'); }); log(who, 'Marked batch paid, ref ' + refNo, b.id); return { batch: b }; }
  const unfinished = m => S.claims.filter(c => c.period === m && !['SETTLED', 'REJECTED', 'CANCELLED'].includes(c.status));
  function periodAct(m, who, action, reason) {
    const p = S.periods.find(k => k.m === m);
    if (action === 'close') { if (p.status !== 'OPEN') return { error: 'Only an open period can be closed.' }; if (S.periods.filter(k => k.status === 'OPEN').length < 2) return { error: 'Keep at least one period open for new claims.' }; p.status = 'CLOSED'; }
    else if (action === 'reopen') { if (p.status !== 'CLOSED') return { error: 'Only a closed period can be reopened.' }; if (!(reason || '').trim()) return { error: 'Reopening needs a reason.' }; p.status = 'OPEN'; p.reason = reason; }
    else if (action === 'roll') { const nx = S.periods.find(k => k.status === 'OPEN' && k.m > m) || S.periods.find(k => k.status === 'OPEN'); if (!nx) return { error: 'No open period to roll into.' }; unfinished(m).forEach(c => { c.period = nx.m; c.late = true; hist(c, who, 'Rolled forward to ' + monthName(nx.m) + ' when ' + monthName(m) + ' was locked.'); }); }
    else if (action === 'lock') { if (p.status !== 'CLOSED') return { error: 'Close the period before locking it.' }; if (unfinished(m).length) return { error: unfinished(m).length + ' unfinished claims are in this period. Roll them forward first.' }; p.status = 'LOCKED'; p.lockedAt = stamp(); }
    log(who, 'Period ' + monthName(m) + ': ' + action + (reason ? ' (' + reason + ')' : ''), m); return { period: p };
  }

  /* ---------- load: the state comes from te_snapshot() ---------- */
  function load(state) {
    S = Object.assign({ clock: 0, me: '', seq: {}, emp: {}, codes: {}, leave: {}, punch: {}, holidays: {}, routes: null, places: [], journeys: [], vehicles: [], trips: [], expenses: [], claims: [], advances: [], bookings: [], batches: [], settlements: [], audit: [], periods: [] }, state);
    const M = S.masters || {};
    if (M.cities) { Object.keys(CITIES).forEach(k => { delete CITIES[k]; }); Object.assign(CITIES, M.cities); }
    if (M.regions) { REGIONS = M.regions; NCR.length = 0; (M.regions.NCR || []).forEach(c => NCR.push(c)); }
    if (M.hubs) { Object.keys(HUBS).forEach(k => { delete HUBS[k]; }); Object.assign(HUBS, M.hubs); }
    if (M.places) S.places = M.places;
    /* a person can be looked up by the employee code typed in a form */
    Object.keys(S.codes || {}).forEach(code => { const e = S.emp[S.codes[code]]; if (e && !S.emp[code]) S.emp[code] = e; });
    /* a grade without a full set of limits (five tiers and both classes) uses the default grade */
    const L = S.cfg.limits || {}, full = g => !!L[g] && ['metro', 'tier1', 'rest', 'intlA', 'intlB'].every(t => L[g][t]) && !!(S.cfg.airClass || {})[g] && !!(S.cfg.trainClass || {})[g];
    const dg = full(S.cfg.defaultGrade) ? S.cfg.defaultGrade : (S.cfg.grades || []).find(full);
    Object.keys(S.emp).forEach(k => { const e = S.emp[k]; if (e && !full(e.grade)) { if (e.gradeRaw === undefined) e.gradeRaw = e.grade; e.grade = dg; } });
    if (!S.emp.SYSTEM) S.emp.SYSTEM = { id: 'SYSTEM', name: 'EZER', grade: dg, dept: '', title: 'System' };
    Object.keys(ROUTE_CACHE).forEach(k => { delete ROUTE_CACHE[k]; });
    return S;
  }

  /* ---------- seed ---------- */
  function seed() {
    S = {
      today: '2026-11-16', clock: 0, me: 'SRS0512', seq: { trip: 86, claim: 400, adv: 30, exp: 2000, bkg: 140, batch: 17, settle: 60, jrn: 100, veh: 3, place: 100 },
      emp: {
        SRS0512: { id: 'SRS0512', name: 'Rahul Nair', grade: 'M2', dept: 'Enterprise Sales', title: 'Senior Account Manager', base: 'Gurugram', rm: 'SRS0210', hod: 'SRS0044', acct: 'XXXXXX4821', ifsc: 'HDFC0000572', vehicle: 'HR26 DK 4821' },
        SRS0533: { id: 'SRS0533', name: 'Priya Nair', grade: 'M1', dept: 'Enterprise Sales', title: 'Solutions Consultant', base: 'Gurugram', rm: 'SRS0210', hod: 'SRS0044', acct: 'XXXXXX1190', ifsc: 'ICIC0000184' },
        SRS0611: { id: 'SRS0611', name: 'Arjun Rao', grade: 'E1', dept: 'Enterprise Sales', title: 'Sales Executive', base: 'Gurugram', rm: 'SRS0210', hod: 'SRS0044', acct: 'XXXXXX7736', ifsc: 'SBIN0004455' },
        SRS0210: { id: 'SRS0210', name: 'Rajesh Mehta', grade: 'L1', dept: 'Enterprise Sales', title: 'Regional Sales Manager', base: 'Gurugram', rm: 'SRS0044', hod: 'SRS0044', acct: 'XXXXXX3307', ifsc: 'HDFC0000572' },
        SRS0044: { id: 'SRS0044', name: 'Meera Iyer', grade: 'L1', dept: 'Enterprise Sales', title: 'Head of Sales (HOD)', base: 'Gurugram', rm: 'SRS0001', hod: 'SRS0001', acct: 'XXXXXX9012', ifsc: 'UTIB0000131' },
        SRS0101: { id: 'SRS0101', name: 'Sanjay Kulkarni', grade: 'L1', dept: 'Finance', title: 'Finance Controller', base: 'Gurugram', rm: 'SRS0001', hod: 'SRS0001', acct: 'XXXXXX5548', ifsc: 'KKBK0000261' },
        SRS0102: { id: 'SRS0102', name: 'Kavita Desai', grade: 'M1', dept: 'Finance', title: 'Finance Executive', base: 'Gurugram', rm: 'SRS0101', hod: 'SRS0001', acct: 'XXXXXX6620', ifsc: 'HDFC0000572' },
        SRS0001: { id: 'SRS0001', name: 'Anil Sharma', grade: 'L1', dept: 'Management', title: 'Managing Director', base: 'Gurugram', rm: null, hod: null, acct: '', ifsc: '' },
        SYSTEM: { id: 'SYSTEM', name: 'EZER', grade: '', dept: '', title: 'System' }
      },
      leave: { SRS0512: ['2026-11-06'], SRS0611: ['2026-11-10'] },
      punch: { SRS0611: { '2026-11-11': 'Gurugram office, 09:42' } },
      holidays: { '2026-11-24': 'Guru Nanak Jayanti', '2026-12-25': 'Christmas' },
      cfg: defaultCfg(), places: PLACES.map(p => Object.assign({}, p)), journeys: [], vehicles: [['VEH-001', 'SRS0512', 'HR26 DK 4821', 'Rahul Nair'], ['VEH-002', 'SRS0512', 'HR26 AB 1190', 'Rahul Nair'], ['VEH-003', 'SRS0611', 'HR26 CQ 7736', 'Arjun Rao']].map(a => { const rc = rcBuild(a[2], a[1], '2026-06-01', a[3]); return { id: a[0], emp: a[1], type: rc.type, declared: rc.type, reg: a[2], rc, whose: 'self', photo: false, verified: true, vby: 'rc', added: '2026-06-01' }; }), trips: [], expenses: [], claims: [], advances: [], bookings: [], batches: [], settlements: [], audit: [],
      periods: [{ m: '2026-10', status: 'LOCKED', lockedAt: '2 Nov, 11:20' }, { m: '2026-11', status: 'OPEN' }, { m: '2026-12', status: 'OPEN' }]
    };
    const G = { lake: mkG('29AAGCL4471K1Z'), naga: mkG('29AABCN8821M1Z'), truf: mkG('29AAFCT5510P1Z'), mtr: mkG('29AACCM2093Q1Z'), pune: mkG('27AAECP1234F1Z'), ggn: mkG('06AAKCS9087L1Z'), jai: mkG('08AAFCR6120B1Z') };
    S.G = G;
    let n = 0; const E = o => { const x = Object.assign({ id: 'EXP-' + (1900 + (++n)), pay: 'self', payMode: 'UPI', status: 'UNCLAIMED', billNo: '', gstin: '', desc: '', reason: '', claimed: o.bill }, o); if (x.file === undefined && x.billNo) x.file = { name: x.billNo.replace(/\W/g, '') + '.pdf', sha: 'sha-' + x.billNo, ocrAmount: x.bill }; S.expenses.push(x); return x.id; };
    const T = o => { const t = Object.assign({ co: [], history: [], type: 'domestic', mode: 'air', travelBy: 'desk', stayBy: 'self', origin: 'PRE_APPROVED', from: 'Gurugram', fromPlace: 'off', toAddr: {} }, o); S.trips.push(t); return t; };

    /* ---------- trips, built through the same functions the app uses ---------- */
    const ptOf = id => place(id).pt, P0 = (id, leave, what) => ({ place: id, pt: ptOf(id), leave: leave || '', what: what || '' }), PR = id => ({ place: id, pt: ptOf(id), ret: true });
    const SEG = (mode, o) => Object.assign({ mode, bookedBy: modeOf(mode).basis === 'ticket' ? 'desk' : 'self', vehicleId: null, xfer: {} }, o || {});
    const mk = (empId, on, d, approve) => { S.today = on; const r = saveTrip(empId, Object.assign({ origin: 'PRE_APPROVED', co: [] }, d)); if (r.error) throw new Error('Seed ' + d.name + ': ' + r.error); if (approve) (r.trip.chain || []).slice().forEach(s => { const a = tripAct(r.trip.id, s.who, 'approve', ''); if (a.error) throw new Error('Seed approve ' + d.name + ': ' + a.error); }); return r.trip; };
    const legN = (t, n) => n ? legsOf(t).find(j => j.n === n) : legsOf(t).find(j => j.status === 'PLANNED');
    const go = (t, n, o) => {
      o = o || {}; const j = legN(t, n); if (o.on) S.today = o.on; else if (j.date > S.today) S.today = j.date;
      const r = startJourney(j.id, o.sc || 'normal'); if (r.error) throw new Error('Seed leg ' + t.id + '/' + j.n + ': ' + r.error);
      (o.stops || []).forEach(s => { if (j.gps !== 'checkin') j.shown = Math.max(2, Math.floor(j.track.length * s[0])); const a = addStop(j.id, { reason: s[1], note: s[2] || '' }); if (a.error) throw new Error('Seed stop: ' + a.error); endStop(j.id, s[3]); });
      advanceJourney(j.id, 99999); endJourney(j.id);
      if (o.file !== false) { const f = fileLeg(j.id, o.file || {}); if (f.error) throw new Error('Seed file ' + t.id + '/' + j.n + ': ' + f.error); }
      return j;
    };
    const cab = (fare, ref, merchant, more) => Object.assign({ fare, merchant: merchant || 'Uber', ref, attach: {} }, more || {});
    const extra = (t, on, from, to, mode, why) => { S.today = on; const r = addLeg(t.id, { from, to, mode, why }); if (r.error) throw new Error('Seed extra leg: ' + r.error); return r.journey; };
    const fin = (c, note) => { if (['IN_VERIFICATION', 'ON_HOLD'].includes(c.status)) financeAct(c.id, 'SRS0101', 'verify', { comment: note || 'Bills checked.' }); };
    S.periods[0].status = 'OPEN';

    /* --- October: Pune, closed and paid with payroll --- */
    S.seq.trip = 73; S.seq.claim = 370; S.seq.bkg = 130; S.seq.batch = 14; S.clock = 10;
    const pune = mk('SRS0512', '2026-10-01', { name: 'Corvin Logistics product demo', scope: 'domestic', pattern: 'round', purpose: 'Client meeting', project: 'Corvin Logistics', points: [P0('home', '2026-10-06'), P0('pncv', '2026-10-07', 'Product demo for the operations team'), PR('home')], segs: [SEG('flight'), SEG('flight')] }, true);
    S.today = '2026-10-02'; book(pune.id, 'SRS0101', { legId: legN(pune, 2).id, vendor: 'IndiGo 6E 6125', pnr: 'M2Q8RT', amount: 4900 }); book(pune.id, 'SRS0101', { legId: legN(pune, 5).id, vendor: 'IndiGo 6E 6214', pnr: 'M2Q8RW', amount: 4900 });
    go(pune, 1, { file: cab(380, 'UB-3K8L21') }); go(pune, 2); go(pune, 3, { file: cab(190, 'OL-55K2M1', 'Ola') });
    E({ emp: 'SRS0512', tripId: pune.id, cat: 'hotel', date: '2026-10-06', checkIn: '2026-10-06', checkOut: '2026-10-07', merchant: 'Deccan Park Hotel', gstin: G.pune, billNo: 'DPH/2610/118', bill: 3800 });
    E({ emp: 'SRS0512', tripId: pune.id, cat: 'meals', date: '2026-10-06', merchant: 'Vaishali', billNo: 'VS-40112', bill: 1640 });
    go(pune, 4, { file: cab(195, 'OL-55K9X4', 'Ola') }); go(pune, 5); go(pune, 6, { file: cab(400, 'UB-3K9Q07') });
    S.today = '2026-10-09'; let r = submitClaim('SRS0512', { tripId: pune.id, lineIds: unclaimed('SRS0512', pune.id).map(x => x.id), declared: true }); if (r.error) throw new Error('Seed claim 371: ' + r.error);
    S.today = '2026-10-12'; managerAct(r.claim.id, 'SRS0210', 'approve', {}); S.today = '2026-10-14'; fin(r.claim);
    S.today = '2026-10-31'; let bt = createBatch('SRS0101', 'PAYROLL', [r.claim.id]); payBatch(bt.batch.id, 'SRS0101', 'OCT-PAYROLL-2026');
    S.periods[0] = { m: '2026-10', status: 'LOCKED', lockedAt: '2 Nov, 11:20' };

    /* --- 3 Nov: a local trip, one way, paid off-cycle --- */
    S.seq.trip = 80; S.seq.claim = 397;
    const cpT = mk('SRS0512', '2026-11-03', { name: 'Halden Foods contract review', scope: 'local', pattern: 'oneway', purpose: 'Client meeting', project: 'Halden Foods', points: [P0('off', '2026-11-03'), P0('cp', '', 'Contract review with the legal team')], segs: [SEG('own', { vehicleId: 'VEH-001' })] });
    go(cpT, 1, { file: { claim: true, declared: true } });
    const cpc = S.claims.find(c => c.tripId === cpT.id); S.today = '2026-11-04'; managerAct(cpc.id, 'SRS0210', 'approve', {}); fin(cpc);
    S.today = '2026-11-07'; bt = createBatch('SRS0101', 'OFF_CYCLE', [cpc.id]); payBatch(bt.batch.id, 'SRS0101', 'N307260118452');

    /* --- colleagues' trips planned early November --- */
    S.seq.trip = 82; S.seq.adv = 27;
    const jai = mk('SRS0611', '2026-11-13', { name: 'Rajputana Traders dealer onboarding', scope: 'domestic', pattern: 'round', purpose: 'Dealer or partner visit', project: 'Rajputana Traders', points: [P0('off', '2026-11-19'), P0('jprt', '2026-11-20', 'Dealer onboarding and stock check'), PR('off')], segs: [SEG('train', { xfer: { last: 'auto' } }), SEG('train', { xfer: { first: 'auto' } })], stayBy: 'desk', advance: 2000 }, true);
    S.seq.trip = 83;
    const pri = mk('SRS0533', '2026-11-04', { name: 'Northwind solution workshop', scope: 'domestic', pattern: 'round', purpose: 'Client meeting', project: 'Northwind Retail', points: [P0('off', '2026-11-12'), P0('blnw', '2026-11-14', 'Solution workshop with the retail IT team'), PR('off')], segs: [SEG('flight'), SEG('flight')] }, true);
    S.seq.trip = 84; S.seq.adv = 28;
    const blr = mk('SRS0512', '2026-11-04', { name: 'Northwind quarterly business review', scope: 'domestic', pattern: 'round', purpose: 'Client meeting', project: 'Northwind Retail', points: [P0('off', '2026-11-12'), P0('blnw', '2026-11-14', 'Quarterly business review with the leadership team'), PR('home')], segs: [SEG('flight'), SEG('flight')], advance: 8000 }, true);
    S.today = '2026-11-06'; book(pri.id, 'SRS0101', { legId: legN(pri, 2).id, vendor: 'IndiGo 6E 2134', pnr: 'X7K3LM', amount: 5900 }); book(pri.id, 'SRS0101', { legId: legN(pri, 5).id, vendor: 'IndiGo 6E 2141', pnr: 'X7K3LN', amount: 5900 });
    book(blr.id, 'SRS0101', { legId: legN(blr, 2).id, vendor: 'IndiGo 6E 2134', pnr: 'X7K2QD', amount: 5900 }); book(blr.id, 'SRS0101', { legId: legN(blr, 5).id, vendor: 'IndiGo 6E 2141', pnr: 'X7K2QF', amount: 5900 });
    S.today = '2026-11-10'; advanceAct('ADV-0029', 'SRS0101', 'pay', { amount: 8000, ref: 'N314260311874' });

    /* --- 12 to 14 Nov: both Bengaluru trips are travelled --- */
    go(blr, 1, { on: '2026-11-12', file: cab(196, 'UB-7H2K90') }); go(blr, 2); go(blr, 3, { stops: [[0.55, 'meal', '', 22]], file: cab(820, 'UB-7H2K91') });
    go(blr, extra(blr, '2026-11-12', 'blnw', 'bllk', 'cab', 'Client office to the hotel').n, { file: cab(150, 'UB-7H2K97') });
    go(pri, 1, { on: '2026-11-12', file: cab(198, 'UB-4T7R51') }); go(pri, 2); go(pri, 3, { file: cab(860, 'UB-4T7R52') });
    go(blr, extra(blr, '2026-11-13', 'bllk', 'blnw', 'cab', 'Hotel to the client office').n, { file: cab(160, 'UB-9P3L22') });
    go(blr, extra(blr, '2026-11-13', 'blnw', 'bllk', 'cab', 'Back to the hotel').n, { file: cab(170, 'UB-9P3L29') });
    go(blr, extra(blr, '2026-11-14', 'bllk', 'blnw', 'cab', 'Checked out, to the client office').n, { file: cab(155, 'UB-2M8Q40') });
    go(blr, null, { on: '2026-11-14', file: cab(790, 'UB-2M8Q47') }); go(blr, null); go(blr, null, { file: cab(410, 'UB-2M8Q52') });
    go(pri, null, { on: '2026-11-14', file: cab(810, 'UB-4T7R60') }); go(pri, null); go(pri, null, { file: cab(190, 'UB-4T7R66') });
    E({ emp: 'SRS0512', tripId: blr.id, cat: 'hotel', date: '2026-11-12', checkIn: '2026-11-12', checkOut: '2026-11-14', merchant: 'Lakeview Residency', gstin: G.lake, billNo: 'LR/26-27/4471', bill: 9800 });
    E({ emp: 'SRS0512', tripId: blr.id, cat: 'meals', date: '2026-11-12', merchant: 'Nagarjuna Restaurant', gstin: G.naga, billNo: 'NG-88213', bill: 950 });
    E({ emp: 'SRS0512', tripId: blr.id, cat: 'meals', date: '2026-11-13', merchant: 'Truffles, Koramangala', gstin: G.truf, billNo: 'TR-55102', bill: 1480 });
    E({ emp: 'SRS0512', tripId: blr.id, cat: 'meals', date: '2026-11-14', merchant: 'MTR 1924', gstin: G.mtr, billNo: 'MTR-20931', bill: 600 });
    E({ emp: 'SRS0533', tripId: pri.id, cat: 'hotel', date: '2026-11-12', checkIn: '2026-11-12', checkOut: '2026-11-14', merchant: 'Lakeview Residency', gstin: G.lake, billNo: 'LR/26-27/4470', bill: 8200, file: { name: 'Lakeview-4470.pdf', sha: 'sha-lakeview-4470', phash: 'ph-lakeview-4470', ocrAmount: 8200 } });
    E({ emp: 'SRS0533', tripId: pri.id, cat: 'meals', date: '2026-11-12', merchant: 'Nagarjuna Restaurant', gstin: G.naga, billNo: 'NG-88214', bill: 870 });
    E({ emp: 'SRS0533', tripId: pri.id, cat: 'meals', date: '2026-11-13', merchant: 'Empire Restaurant', billNo: 'EM-30117', bill: 640 });
    /* other expenses waiting for this month's claim */
    E({ emp: 'SRS0512', cat: 'local', date: '2026-11-10', merchant: '', bill: 180, desc: 'Auto, office to Cyber Hub client lunch', file: null, payMode: 'Cash' });
    E({ emp: 'SRS0512', cat: 'comm', date: '2026-11-11', merchant: 'BlueDart', gstin: G.ggn, billNo: 'BD-7781120', bill: 340, desc: 'Contract copies to Northwind Retail' });

    /* --- 13 Nov: Arjun's local trip with a detour --- */
    S.seq.trip = 81;
    const farT = mk('SRS0611', '2026-11-13', { name: 'Demo kit drop, Faridabad', scope: 'local', pattern: 'oneway', purpose: 'Delivery or collection', project: '', points: [P0('off', '2026-11-13'), P0('far', '', 'Drop the demo kit at the warehouse')], segs: [SEG('own', { vehicleId: 'VEH-003' })] });

    /* --- claims sent in mid-November --- */
    S.today = '2026-11-15'; S.seq.claim = 400; S.me = 'SRS0533';
    r = submitClaim('SRS0533', { tripId: pri.id, lineIds: unclaimed('SRS0533', pri.id).map(x => x.id), declared: true }); if (r.error) throw new Error('Seed claim 401: ' + r.error);
    const p2 = [E({ emp: 'SRS0533', cat: 'cab', date: '2026-11-04', merchant: 'Uber', ref: 'UB-1C9D03', billNo: 'UB-1C9D03', bill: 430, desc: 'Office to Halden Foods, Udyog Vihar' }), E({ emp: 'SRS0533', cat: 'comm', date: '2026-11-05', merchant: 'DTDC', billNo: 'DT-992011', bill: 260, desc: 'Demo kit to Jaipur' })];
    r = submitClaim('SRS0533', { lineIds: p2, declared: true }); managerAct(r.claim.id, 'SRS0210', 'approve', {});
    const a1 = [E({ emp: 'SRS0611', cat: 'client', date: '2026-11-10', merchant: 'Farzi Cafe, Cyber Hub', gstin: G.ggn, billNo: 'FZ-66120', bill: 4200, client: 'Halden Foods', attendees: 3, reason: 'Client asked to meet that day. I came in for the lunch.', file: { name: 'farzi-66120.jpg', sha: 'sha-farzi-66120', ocrAmount: 4200, text: 'Farzi Cafe 2 x Beer 1 x Whisky Paneer Tikka', editedWith: '' } }),
      E({ emp: 'SRS0611', cat: 'cab', date: '2026-11-04', merchant: 'Uber', ref: 'UB-8Z1X55', billNo: 'UB-8Z1X55', bill: 430, desc: 'Office to Halden Foods' }),
      E({ emp: 'SRS0611', cat: 'local', date: '2026-11-11', bill: 300, desc: 'Auto to Udyog Vihar', file: null, payMode: 'Cash' }), E({ emp: 'SRS0611', cat: 'local', date: '2026-11-12', bill: 300, desc: 'Auto to Sohna Road', file: null, payMode: 'Cash' }), E({ emp: 'SRS0611', cat: 'local', date: '2026-11-13', bill: 200, desc: 'Auto to MG Road', file: null, payMode: 'Cash' })];
    r = submitClaim('SRS0611', { lineIds: a1, declared: true }); managerAct(r.claim.id, 'SRS0210', 'approve', { comment: 'Client lunch was real, I was informed.' });
    go(farT, 1, { on: '2026-11-13', sc: 'detour', file: { claim: true, declared: true, reason: 'Road closed near Badarpur. Took the Kalindi Kunj diversion.' } });
    S.today = '2026-11-15';

    /* --- Rahul's plans from 14 Nov: Mumbai waits for approval, Manesar is today, the sample run needs approval, Dubai is approved --- */
    S.seq.trip = 85; S.seq.adv = 29;
    mk('SRS0512', '2026-11-14', { name: 'Halden Foods contract renewal', scope: 'domestic', pattern: 'round', purpose: 'Client meeting', project: 'Halden Foods', points: [P0('off', '2026-11-25'), P0('bkc', '2026-11-27', 'Contract renewal meeting with procurement'), PR('off')], segs: [SEG('flight'), SEG('flight')], advance: 6000 });
    mk('SRS0512', '2026-11-14', { name: 'Manesar plant audit', scope: 'local', pattern: 'round', purpose: 'Site or plant visit', project: 'Plant operations', points: [P0('off', '2026-11-16'), P0('man', '', 'Quarterly quality and safety audit'), PR('off')], segs: [SEG('own', { vehicleId: 'VEH-001' }), SEG('own', { vehicleId: 'VEH-001' })] }, true);
    mk('SRS0512', '2026-11-14', { name: 'Trial samples to the Noida client', scope: 'local', pattern: 'multi', purpose: 'Delivery or collection', project: 'Northwind Retail', points: [P0('off', '2026-11-19'), P0('man', '', 'Collect the trial samples'), P0('noi', '', 'Deliver the samples and run the demo'), PR('off')], segs: [SEG('own', { vehicleId: 'VEH-001' }), SEG('own', { vehicleId: 'VEH-001' }), SEG('own', { vehicleId: 'VEH-001' })] });
    S.seq.adv = 30;
    const dxb = mk('SRS0512', '2026-11-14', { name: 'Northwind Gulf distributor summit', scope: 'international', pattern: 'round', purpose: 'Training or event', project: 'Northwind Gulf', points: [P0('home', '2026-12-07'), P0('dxnw', '2026-12-10', 'Distributor summit and product training'), PR('home')], segs: [SEG('flight'), SEG('flight')], stayBy: 'desk', advance: 25000 });
    S.today = '2026-11-15'; dxb.chain.slice().forEach(s => tripAct(dxb.id, s.who, 'approve', s.role === 'HOD' ? 'Summit attendance confirmed with the Gulf team.' : ''));
    S.today = '2026-11-16'; S.seq.trip = 89;
    S.seq.claim = 404; S.me = 'SRS0512'; S.audit = S.audit.slice(0, 14); S.clock = 40;
    return S;
  }

  submitClaim = act(submitClaim); managerAct = act(managerAct); financeAct = act(financeAct); flagAct = act(flagAct); respond = act(respond); recall = act(recall); reopen = act(reopen); saveTrip = act(saveTrip); editTrip = act(editTrip); tripAct = act(tripAct); tripResubmit = act(tripResubmit); cancelTrip = act(cancelTrip); book = act(book); advanceAct = act(advanceAct); createBatch = act(createBatch); payBatch = act(payBatch); periodAct = act(periodAct); startJourney = act(startJourney); endJourney = act(endJourney); addStop = act(addStop); endStop = act(endStop); fileLeg = act(fileLeg); skipLeg = act(skipLeg); legNoGps = act(legNoGps); addLeg = act(addLeg); recordMissed = act(recordMissed); addVehicle = act(addVehicle); verifyVehicle = act(verifyVehicle); addPlace = act(addPlace); saveExpense = act(saveExpense);

  /* sample bills for the scanner (a real OCR service replaces this in production) */
  function samples() {
    const G = S.G;
    return [
      { id: 's1', label: 'Dinner, Meghana Foods', hint: 'A clean bill', d: { cat: 'meals', date: '2026-11-13', merchant: 'Meghana Foods', gstin: mkG('29AAECM7719R1Z'), billNo: 'MF-71204', bill: 380, payMode: 'UPI' }, file: { name: 'meghana-71204.jpg', sha: 'sha-s1', ocrAmount: 380 } },
      { id: 's2', label: 'Colleague’s hotel invoice', hint: 'Already claimed by Priya Nair', d: { cat: 'hotel', date: '2026-11-12', checkIn: '2026-11-12', checkOut: '2026-11-14', merchant: 'Lakeview Residency', gstin: G.lake, billNo: 'LR/26-27/4470', bill: 8200, payMode: 'Personal card' }, file: { name: 'Lakeview-4470.pdf', sha: 'sha-lakeview-4470', phash: 'ph-lakeview-4470', ocrAmount: 8200 } },
      { id: 's3', label: 'Dinner bill, amount typed higher', hint: 'Bill says ₹1,180', d: { cat: 'meals', date: '2026-11-14', merchant: 'Karavalli', gstin: G.truf, billNo: 'KV-20418', bill: 1810, payMode: 'UPI' }, file: { name: 'karavalli-20418.jpg', sha: 'sha-s3', ocrAmount: 1180, editedWith: 'Adobe Photoshop 25.1' } },
      { id: 's4', label: 'Flight ticket, PNR X7K2QD', hint: 'Booked by the Travel Desk', d: { cat: 'air', date: '2026-11-12', merchant: 'IndiGo', pnr: 'X7K2QD', cls: 'Economy', billNo: 'INV-6E-88120', bill: 11800, payMode: 'Personal card' }, file: { name: 'indigo-x7k2qd.pdf', sha: 'sha-s4', ocrAmount: 11800 } },
      { id: 's5', label: 'Bar bill with liquor', hint: 'Restricted items', d: { cat: 'meals', date: '2026-11-13', merchant: 'Toit Brewpub', gstin: mkG('29AAFCT2210K1Z'), billNo: 'TO-91773', bill: 920, payMode: 'UPI' }, file: { name: 'toit-91773.jpg', sha: 'sha-s5', ocrAmount: 920, text: 'Toit Brewpub 2 x Beer Pint 1 x Nachos' } },
      { id: 's6', label: 'Bill made on a generator site', hint: 'Wrong GSTIN, tool-made PDF', d: { cat: 'cab', date: '2026-11-13', merchant: 'City Taxi Service', gstin: '29ABCDE1234F1Z5', billNo: 'CT-0001', bill: 1500, ref: 'CT-0001', payMode: 'Cash' }, file: { name: 'taxi-bill.pdf', sha: 'sha-s6', ocrAmount: 1500, producer: 'FreeBillGenerator v3' } },
      { id: 's7', label: 'Lunch on 6 Nov', hint: 'An approved leave day', d: { cat: 'client', date: '2026-11-06', merchant: 'Dhaba Estd 1986', gstin: G.ggn, billNo: 'DH-11873', bill: 2400, client: 'Halden Foods', attendees: 2, payMode: 'UPI' }, file: { name: 'dhaba-11873.jpg', sha: 'sha-s7', ocrAmount: 2400 } },
      { id: 's8', label: 'Courier bill from July', hint: 'Older than the bill-age limit', d: { cat: 'comm', date: '2026-07-20', merchant: 'BlueDart', gstin: G.ggn, billNo: 'BD-5519023', bill: 410, payMode: 'UPI' }, file: { name: 'bluedart-5519023.pdf', sha: 'sha-s8', ocrAmount: 410 } }
    ];
  }

  return {
    get S() { return S; }, seed, load, regionOf, CITIES, TIERS, PLACES, GAZ, COUNTRIES, countryOf, LAYERS, AIR, RAIL, STATES, NCR, HUBS, place, myPlaces, geocode, reverseGeo, addPlace, hav, mapKm, routePts, journey, modeOf, vtype, vehRate, myVehicles, jStats, jState, editTrip, pinIssue, pinStates, cityState, fq, monthOf, monthName, startJourney, advanceJourney, endJourney, addVehicle, verifyVehicle,
    ptName, reasonOf, inIndia, limCity, hubFor, legBooking, HUB_OF, NO_XFER, defaultFlows, setFlow, resetFlow, setTeam, teamOf, finStep, finSteps, canFin, finWhy, stepName, levelOn, whenText, WHO, addVehicle, verifyVehicle, rcLookup, rcType, rcNorm, rcFmtOk, rcShow, maskName, nameMatch, vehValid, legGps, legKm, legsOf, legOpen, OPEN_LEG, derive, buildLegs, legEst, cityOn, tripKm, addStop, endStop, legLine, legPreview, fileLeg, skipLeg, legNoGps, addLeg, recordMissed, viaKm, hubRad, stopSec, xferLine,
    fd, fdy, fwd, rs, days, addDays, gstValid, mkG, tierOf, cat, emp, exp, trip, claim, adv,
    tStatus, tripDays, tripNights, entitlements, estimateFor, selfEstimate, estimateTotal, advanceCap, deadline, tripAdvance, outstandingFor, tripIssues,
    policy, lineFlags, assess, chainFor, submitClaim, managerAct, financeAct, flagAct, respond, recall, reopen, curStep,
    saveTrip, tripAct, tripResubmit, cancelTrip, book, needsBooking, advanceAct, advView,
    blankExpense, previewExpense, saveExpense, deleteExpense, unclaimed, mileage, samples,
    payable, createBatch, bankFile, payBatch, periodAct, unfinished, log, riskScore, bandOf
  };
})();
}
if (typeof module !== 'undefined') { module.exports = { createEngine: createEngine, ENGINE_VERSION: '6.7-server.1' }; }
