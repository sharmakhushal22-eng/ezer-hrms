// lib/lms/scorm-core.ts — SCORM packages, the parts that need no server: reading a zip's
// table of contents, reading imsmanifest.xml, judging a learner's run-time data, and the
// small SCORM API the package talks to. Pure, so the tests can run it on bytes.
//
// WHY A ZIP STAYS A ZIP. A package is hundreds of small files. Unpacking it into storage would
// mean hundreds of uploads, and the bucket only accepts a short list of types (206). So the
// .zip is stored once, its table of contents is read here, and each file is later fetched
// out of it with a range request (lib/lms/scorm.ts).
//
// WHY THE API IS A COPY. The package runs in a sandboxed frame with no access to EZER's
// origin: an uploaded package is somebody's JavaScript, and must not be able to read the
// learner's session. A sandboxed frame cannot reach window.parent.API, so every page of the
// package gets its own API object (runtimeScript below), filled with the learner's saved
// data, and it posts each commit to the player, which saves it.

export type ScormVersion = '1.2' | '2004'

/** Where one file sits in the zip: [local header offset, compressed size, size, method]. */
export type ZipEntry = [number, number, number, number]
export type ZipIndex = Record<string, ZipEntry>

export interface ScormManifest {
  version: ScormVersion
  title: string
  /** Path inside the zip of the first page to open, with any launch parameters. */
  launch: string
  /** 1.2 masteryscore (0–100) or 2004 minNormalizedMeasure as a percentage. */
  mastery: number | null
}

export type ReadRange = (start: number, end: number) => Promise<Uint8Array>

// ── The zip's table of contents ─────────────────────────────────────────────
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000

/** Read the central directory, reading only the end of the file and the directory itself. */
export async function readZipIndex(size: number, read: ReadRange): Promise<ZipIndex> {
  if (size < 22) throw new Error('That file is not a zip.')
  const tailLen = Math.min(size, 22 + 65_535 + 20)
  const tail = await read(size - tailLen, size)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('That file is not a zip, or it is damaged.')
  let count = u16(tail, eocd + 10)
  let cdSize = u32(tail, eocd + 12)
  let cdOffset = u32(tail, eocd + 16)
  // ZIP64: a package over 4 GB or 65,535 files says so in a second record just before.
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20
    if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
      const recAt = u64(tail, loc + 8)
      const rec = await read(recAt, recAt + 56)
      if (u32(rec, 0) === 0x06064b50) { count = u64(rec, 32); cdSize = u64(rec, 40); cdOffset = u64(rec, 48) }
    }
  }
  const cd = await read(cdOffset, cdOffset + cdSize)
  const utf8 = new TextDecoder('utf-8'), latin = new TextDecoder('latin1')
  const out: ZipIndex = {}
  let p = 0
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) break
    const flags = u16(cd, p + 8), method = u16(cd, p + 10)
    let csize = u32(cd, p + 20), usize = u32(cd, p + 24)
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32)
    let offset = u32(cd, p + 42)
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen)
    const name = ((flags & 0x800) ? utf8 : latin).decode(nameBytes).replace(/\\/g, '/')
    // The ZIP64 extra field carries whichever sizes did not fit, in this order.
    let e = p + 46 + nameLen
    const end = e + extraLen
    while (e + 4 <= end) {
      const id = u16(cd, e), len = u16(cd, e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (usize === 0xffffffff) { usize = u64(cd, q); q += 8 }
        if (csize === 0xffffffff) { csize = u64(cd, q); q += 8 }
        if (offset === 0xffffffff) { offset = u64(cd, q) }
      }
      e += 4 + len
    }
    if (!name.endsWith('/') && !name.startsWith('__MACOSX/')) out[name] = [offset, csize, usize, method]
    p = end + commentLen
  }
  return out
}

/** A file in the package by its path, forgiving the case mismatches Windows authors leave. */
export function findEntry(index: ZipIndex, path: string): { name: string; entry: ZipEntry } | null {
  const clean = normalisePath(path)
  if (clean == null) return null
  if (index[clean]) return { name: clean, entry: index[clean] }
  const lower = clean.toLowerCase()
  for (const k of Object.keys(index)) if (k.toLowerCase() === lower) return { name: k, entry: index[k] }
  return null
}

/** A path inside the package, or null when it tries to climb out of it. */
export function normalisePath(path: string): string | null {
  const parts: string[] = []
  for (const raw of path.replace(/\\/g, '/').split('/')) {
    let seg: string
    try { seg = decodeURIComponent(raw) } catch { seg = raw }
    if (!seg || seg === '.') continue
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue }
    parts.push(seg)
  }
  return parts.join('/')
}

// ── imsmanifest.xml ─────────────────────────────────────────────────────────
/** The manifest closest to the top of the zip; a package zipped with its folder has it one down. */
export function manifestPath(index: ZipIndex): string | null {
  const all = Object.keys(index).filter(k => /(^|\/)imsmanifest\.xml$/i.test(k))
  all.sort((a, b) => a.split('/').length - b.split('/').length)
  return all[0] || null
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? (m[2] ?? m[3] ?? '') : null
}
const decodeXml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim()

/** Read what the player needs from imsmanifest.xml. `dir` is the folder it sits in. */
export function parseManifest(xml: string, dir = ''): ScormManifest {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '')
  const schemaVersion = /<(?:[\w-]+:)?schemaversion>\s*([^<]+?)\s*</i.exec(text)?.[1] || ''
  const version: ScormVersion = /2004|CAM 1\.3|adlcp_v1p3|imsss/i.test(schemaVersion + text.slice(0, 4000)) && !/^1\.2$/.test(schemaVersion) ? '2004' : '1.2'

  // Resources: identifier → href and xml:base.
  const resources = new Map<string, { href: string; base: string; sco: boolean }>()
  const resRe = /<(?:[\w-]+:)?resource\b([^>]*)>/gi
  let m: RegExpExecArray | null
  while ((m = resRe.exec(text))) {
    const id = attr(m[1], 'identifier'), href = attr(m[1], 'href')
    const type = (attr(m[1], 'scormtype') || attr(m[1], 'scormType') || '').toLowerCase()
    if (id) resources.set(id, { href: href || '', base: attr(m[1], 'base') || '', sco: type === 'sco' })
  }
  const resourcesBase = (() => { const r = /<(?:[\w-]+:)?resources\b([^>]*)>/i.exec(text); return r ? attr(r[1], 'base') || '' : '' })()

  // The default organisation, else the first; its first item that points at a resource.
  const orgsTag = /<(?:[\w-]+:)?organizations\b([^>]*)>/i.exec(text)
  const wanted = orgsTag ? attr(orgsTag[1], 'default') : null
  const orgRe = /<(?:[\w-]+:)?organization\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?organization>/gi
  let org: { attrs: string; body: string } | null = null
  while ((m = orgRe.exec(text))) {
    if (!org) org = { attrs: m[1], body: m[2] }
    if (wanted && attr(m[1], 'identifier') === wanted) { org = { attrs: m[1], body: m[2] }; break }
  }
  const title = decodeXml(/<(?:[\w-]+:)?title>([\s\S]*?)<\/(?:[\w-]+:)?title>/i.exec(org?.body || text)?.[1] || '') || 'SCORM package'

  let launchRes: { href: string; base: string } | null = null
  let params = ''
  const itemRe = /<(?:[\w-]+:)?item\b([^>]*)>/gi
  while (org && (m = itemRe.exec(org.body))) {
    const ref = attr(m[1], 'identifierref')
    const r = ref ? resources.get(ref) : null
    if (r?.href) { launchRes = r; params = attr(m[1], 'parameters') || ''; break }
  }
  if (!launchRes) launchRes = [...resources.values()].find(r => r.sco && r.href) || [...resources.values()].find(r => r.href) || null
  if (!launchRes) throw new Error('The package does not say which page to open (no resource with an href in imsmanifest.xml).')

  const joined = [dir, resourcesBase, launchRes.base, launchRes.href].filter(Boolean).join('/')
  const [file, query] = joined.split('?')
  const path = normalisePath(file)
  if (path == null) throw new Error('The launch page points outside the package.')
  const extra = [query, params.replace(/^[?&]/, '')].filter(Boolean).join('&')

  let mastery: number | null = null
  const ms12 = /<(?:[\w-]+:)?masteryscore>\s*([\d.]+)\s*</i.exec(text)?.[1]
  if (ms12 != null) mastery = Math.max(0, Math.min(100, Number(ms12)))
  const mnm = /<(?:[\w-]+:)?minNormalizedMeasure>\s*([-\d.]+)\s*</i.exec(text)?.[1]
  if (mastery == null && mnm != null && /satisfiedByMeasure\s*=\s*["']true/i.test(text)) mastery = Math.round(Math.max(0, Math.min(1, Number(mnm))) * 100)

  return { version, title, launch: extra ? `${path}?${extra}` : path, mastery: Number.isFinite(mastery as number) ? mastery : null }
}

// ── What the learner's data means ───────────────────────────────────────────
export type Cmi = Record<string, string>

export interface ScormOutcome {
  /** The content part of the lesson is done. */
  done: boolean
  failed: boolean
  /** 0–100, when the package reported a score. */
  scorePct: number | null
  /** Plain words for the screen. */
  label: 'Not started' | 'In progress' | 'Completed' | 'Passed' | 'Not passed'
}

const num = (v: string | undefined) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export function scormScore(version: ScormVersion, cmi: Cmi): number | null {
  const scaled = version === '2004' ? num(cmi['cmi.score.scaled']) : null
  if (scaled != null) return Math.round(Math.max(0, Math.min(1, scaled)) * 1000) / 10
  const p = version === '2004' ? 'cmi.score' : 'cmi.core.score'
  const raw = num(cmi[`${p}.raw`]), max = num(cmi[`${p}.max`]), min = num(cmi[`${p}.min`]) ?? 0
  if (raw == null) return null
  // A raw score with no max is read on the 0–100 scale both standards default to.
  const pct = max != null && max > min ? ((raw - min) / (max - min)) * 100 : raw
  return Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10
}

/** Done, failed or neither. The package decides, except that a 1.2 package with a mastery
 *  score is judged by the LMS on its score, as the 1.2 run-time standard asks. */
export function scormOutcome(version: ScormVersion, cmi: Cmi, mastery: number | null): ScormOutcome {
  const scorePct = scormScore(version, cmi)
  if (version === '1.2') {
    let status = (cmi['cmi.core.lesson_status'] || '').toLowerCase()
    if (mastery != null && scorePct != null && (status === 'completed' || status === 'passed' || status === 'failed')) status = scorePct >= mastery ? 'passed' : 'failed'
    if (status === 'passed') return { done: true, failed: false, scorePct, label: 'Passed' }
    if (status === 'completed') return { done: true, failed: false, scorePct, label: 'Completed' }
    if (status === 'failed') return { done: false, failed: true, scorePct, label: 'Not passed' }
    return { done: false, failed: false, scorePct, label: status && status !== 'not attempted' ? 'In progress' : Object.keys(cmi).length ? 'In progress' : 'Not started' }
  }
  const completion = (cmi['cmi.completion_status'] || '').toLowerCase()
  let success = (cmi['cmi.success_status'] || '').toLowerCase()
  if (mastery != null && scorePct != null && (success === 'unknown' || !success) && completion === 'completed') success = scorePct >= mastery ? 'passed' : 'failed'
  if (success === 'failed') return { done: false, failed: true, scorePct, label: 'Not passed' }
  if (success === 'passed') return { done: true, failed: false, scorePct, label: 'Passed' }
  if (completion === 'completed') return { done: true, failed: false, scorePct, label: 'Completed' }
  return { done: false, failed: false, scorePct, label: completion && completion !== 'not attempted' && completion !== 'unknown' ? 'In progress' : Object.keys(cmi).length ? 'In progress' : 'Not started' }
}

/** Keep what a package may store, within limits; drop what the runtime computes itself. */
export function cleanCmi(input: unknown): Cmi {
  const out: Cmi = {}
  if (!input || typeof input !== 'object') return out
  let total = 0
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^cmi\.[\w.]+$/.test(k) || k.length > 255 || /\._(children|count|version)$/.test(k)) continue
    if (/^cmi\.(core\.)?(session_time|total_time|student_id|student_name|learner_id|learner_name|credit|entry|mode|lesson_mode|launch_data)$/.test(k)) continue
    const s = String(v ?? '').slice(0, 64_000)
    total += k.length + s.length
    if (total > 256_000) break
    out[k] = s
    if (Object.keys(out).length >= 3000) break
  }
  return out
}

/** "0000:12:30.5" (1.2) or "PT12M30.5S" (2004) as seconds. */
export function timeToSeconds(v: string | undefined): number {
  if (!v) return 0
  const iso = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(v)
  if (iso) return ((+(iso[3] || 0)) * 86400) + (+(iso[4] || 0)) * 3600 + (+(iso[5] || 0)) * 60 + (+(iso[6] || 0))
  const hms = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v)
  return hms ? (+hms[1]) * 3600 + (+hms[2]) * 60 + (+hms[3]) : 0
}

export function secondsToTime(version: ScormVersion, s: number): string {
  const t = Math.max(0, Math.round(s))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  return version === '2004' ? `PT${h}H${m}M${sec}S` : `${String(h).padStart(4, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** What the package reads when it starts: the saved data plus who the learner is. */
export function startingCmi(version: ScormVersion, saved: Cmi | null, who: { id: string; name: string }, mastery: number | null, totalS: number, reviewOnly: boolean): Cmi {
  const have = saved || {}
  const resuming = Object.keys(have).length > 0
  const name = who.name.trim().split(/\s+/)
  const lastFirst = name.length > 1 ? `${name[name.length - 1]}, ${name.slice(0, -1).join(' ')}` : who.name
  if (version === '1.2') {
    return {
      'cmi.core.lesson_status': 'not attempted',
      'cmi.core.lesson_location': '', 'cmi.suspend_data': '', 'cmi.launch_data': '',
      'cmi.core.score.raw': '', 'cmi.core.score.min': '', 'cmi.core.score.max': '',
      ...have,
      'cmi.core.student_id': who.id, 'cmi.core.student_name': lastFirst,
      'cmi.core.credit': reviewOnly ? 'no-credit' : 'credit', 'cmi.core.entry': resuming ? 'resume' : 'ab-initio',
      'cmi.core.lesson_mode': reviewOnly ? 'browse' : 'normal', 'cmi.core.total_time': secondsToTime('1.2', totalS),
      'cmi.student_data.mastery_score': mastery != null ? String(mastery) : '',
    }
  }
  return {
    'cmi.completion_status': 'unknown', 'cmi.success_status': 'unknown',
    'cmi.location': '', 'cmi.suspend_data': '', 'cmi.launch_data': '', 'cmi.progress_measure': '',
    ...have,
    'cmi.learner_id': who.id, 'cmi.learner_name': lastFirst,
    'cmi.credit': reviewOnly ? 'no-credit' : 'credit', 'cmi.entry': resuming ? 'resume' : 'ab-initio',
    'cmi.mode': reviewOnly ? 'browse' : 'normal', 'cmi.total_time': secondsToTime('2004', totalS),
    'cmi.scaled_passing_score': mastery != null ? String(mastery / 100) : '',
  }
}

// ── The API the package calls ───────────────────────────────────────────────
/** A <script> body put at the top of every HTML page of the package. It defines window.API
 *  (SCORM 1.2) or window.API_1484_11 (2004), whichever the manifest declares, over a copy of
 *  the learner's data, and posts that
 *  copy to the player on every Commit and Finish, every 20 seconds while it changes, and as the
 *  page goes away. Written in plain ES5: packages run in every kind of browser. */
export function runtimeScript(state: { version: ScormVersion; token: string; cmi: Cmi; readOnly: boolean }): string {
  const json = JSON.stringify(state).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `(function(){var S=${json};var d=S.cmi||{},e='0',up=false,fin=false,dirty=false,t0=Date.now(),L=Math.random().toString(36).slice(2);
var CH12={'cmi.core._children':'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time','cmi.core.score._children':'raw,min,max','cmi.objectives._children':'id,score,status','cmi.interactions._children':'id,objectives,time,type,correct_responses,weighting,student_response,result,latency','cmi.student_data._children':'mastery_score,max_time_allowed,time_limit_action','cmi.student_preference._children':'audio,language,speed,text','cmi._version':'3.4'};
var CH04={'cmi._version':'1.0','cmi.score._children':'scaled,raw,min,max','cmi.objectives._children':'id,score,success_status,completion_status,progress_measure,description','cmi.interactions._children':'id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description','cmi.learner_preference._children':'audio_level,language,delivery_speed,audio_captioning','cmi.comments_from_learner._children':'comment,location,timestamp'};
var MSG={'0':'No error','101':'General exception','201':'Invalid argument','301':'Not initialized','401':'Not implemented','403':'Element not initialized','404':'Read only','405':'Write only','132':'Store data before initialization','142':'Commit after termination','122':'Retrieve data before initialization','123':'Retrieve data after termination','112':'Termination before initialization','113':'Termination after termination','103':'Already initialized','104':'Content instance terminated','406':'Incorrect data type','351':'Set value general failure','391':'Commit general failure'};
var RO=/^cmi\\.(core\\.(student_id|student_name|credit|entry|total_time|lesson_mode)|launch_data|student_data\\.mastery_score|learner_id|learner_name|credit|entry|mode|total_time|scaled_passing_score|completion_threshold)$/;
function post(kind){if(S.readOnly)return;try{parent.postMessage({ezlScorm:1,kind:kind,token:S.token,launch:L,cmi:d,session:Math.round((Date.now()-t0)/1000)},'*')}catch(x){}}
function count(k){var p=k.replace(/\\._count$/,'.'),n=-1;for(var key in d){if(key.indexOf(p)===0){var i=parseInt(key.slice(p.length),10);if(i>n)n=i}}return String(n+1)}
function get(k){k=String(k);if(S.version==='2004'?!up||fin:!up){e=S.version==='2004'?(fin?'123':'122'):'301';return''}
var ch=S.version==='2004'?CH04:CH12;if(ch[k]!=null){e='0';return ch[k]}if(/\\._count$/.test(k)){e='0';return count(k)}
if(/(session_time|\\.exit)$/.test(k)&&S.version==='1.2'){e='404';return''}if(/^cmi\\.(core\\.)?(exit|session_time)$/.test(k)&&S.version==='2004'){e='405';return''}
if(d.hasOwnProperty(k)){e='0';return String(d[k])}if(S.version==='2004'&&/^cmi\\./.test(k)){e='403';return''}e='0';return''}
function set(k,v){k=String(k);if(S.version==='2004'?!up||fin:!up){e=S.version==='2004'?(fin?'133':'132'):'301';return'false'}
if(RO.test(k)||/\\._(children|count|version)$/.test(k)){e=S.version==='2004'?'404':'403';return'false'}
if(!/^cmi\\./.test(k)){e='401';return'false'}d[k]=String(v);dirty=true;e='0';return'true'}
function init(){if(up&&!fin){e=S.version==='2004'?'103':'101';return'false'}if(fin&&S.version==='2004'){e='104';return'false'}up=true;e='0';post('start');return'true'}
function commit(){if(!up||fin){e=S.version==='2004'?(fin?'143':'142'):'301';return'false'}dirty=false;post('commit');e='0';return'true'}
function finish(){if(!up){e=S.version==='2004'?'112':'301';return'false'}if(fin){e='113';return'false'}dirty=false;post('finish');fin=true;e='0';return'true'}
var err=function(){return e},str=function(c){return MSG[String(c)]||''},diag=function(c){return MSG[String(c||e)]||''};
/* Only the package's own version: a wrapper that tries 2004 first must not find it in a 1.2 package. */
if(S.version==='2004')window.API_1484_11={Initialize:init,Terminate:finish,GetValue:get,SetValue:set,Commit:commit,GetLastError:err,GetErrorString:str,GetDiagnostic:diag};
else window.API={LMSInitialize:init,LMSFinish:finish,LMSGetValue:get,LMSSetValue:set,LMSCommit:commit,LMSGetLastError:err,LMSGetErrorString:str,LMSGetDiagnostic:diag};
setInterval(function(){if(up&&!fin&&dirty){dirty=false;post('commit')}},20000);
window.addEventListener('pagehide',function(){if(up&&!fin)post('commit')});
function mem(){var m={};return{getItem:function(k){return m.hasOwnProperty(k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}
/* The sandbox has no storage of its own, and some authoring tools stop dead when reading it throws. */
['localStorage','sessionStorage'].forEach(function(n){try{window[n].length}catch(x){try{var s=mem();Object.defineProperty(window,n,{configurable:true,get:function(){return s}})}catch(y){}}});
})();`
}
