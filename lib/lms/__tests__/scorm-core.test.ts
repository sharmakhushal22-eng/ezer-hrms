// SCORM packages. Each test names what would go wrong for an author or a learner.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import {
  cleanCmi, findEntry, manifestPath, normalisePath, parseManifest, readZipIndex, runtimeScript, scormOutcome, startingCmi, timeToSeconds,
} from '../scorm-core.ts'

/** A real zip, built byte by byte: stored and deflated entries, a central directory, an end record. */
function zip(files: { name: string; data: string; deflate?: boolean }[]): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const raw = Buffer.from(f.data, 'utf8')
    const body = f.deflate ? zlib.deflateRawSync(raw) : raw
    const name = Buffer.from(f.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(f.deflate ? 8 : 0, 8)
    local.writeUInt32LE(0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26)
    // A local extra field the central directory does not have: real zips do this.
    const extra = Buffer.from([0x55, 0x54, 0x05, 0x00, 0x01, 0, 0, 0, 0])
    local.writeUInt16LE(extra.length, 28)
    parts.push(local, name, extra, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(f.deflate ? 8 : 0, 10)
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42)
    central.push(c, name)
    offset += 30 + name.length + extra.length + body.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...parts, cd, end]))
}

const reader = (bytes: Uint8Array) => async (s: number, e: number) => bytes.subarray(s, e)

const MANIFEST_12 = `<?xml version="1.0"?>
<manifest identifier="m" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1">
    <organization identifier="org1"><title>Data Privacy &amp; You</title>
      <item identifier="i1" identifierref="r1"><title>Start</title><adlcp:masteryscore>80</adlcp:masteryscore></item>
    </organization>
  </organizations>
  <resources><resource identifier="r1" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/></resource></resources>
</manifest>`

const MANIFEST_2004 = `<manifest identifier="m" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="B"><organization identifier="A"><title>Wrong one</title><item identifier="x" identifierref="ra"/></organization>
    <organization identifier="B"><title>Golf</title><item identifier="y" identifierref="rb" parameters="?lang=en"/></organization></organizations>
  <resources xml:base="content/"><resource identifier="ra" href="a.html"/><resource identifier="rb" adlcp:scormType="sco" xml:base="shared/" href="launch.html?mode=x"/></resources>
</manifest>`

describe('reading a package', () => {
  it('finds every file in a zip, stored or compressed, by reading only its directory', async () => {
    const bytes = zip([{ name: 'imsmanifest.xml', data: MANIFEST_12, deflate: true }, { name: 'index.html', data: '<html><head></head><body>Hi</body></html>' }, { name: 'img/', data: '' }])
    const index = await readZipIndex(bytes.length, reader(bytes))
    assert.deepEqual(Object.keys(index).sort(), ['imsmanifest.xml', 'index.html'])
    assert.equal(index['imsmanifest.xml'][3], 8)
    assert.equal(index['index.html'][3], 0)
  })

  it('says plainly when a file is not a zip', async () => {
    const junk = new TextEncoder().encode('not a zip at all, just a text file that someone renamed')
    await assert.rejects(readZipIndex(junk.length, reader(junk)), /not a zip/)
  })

  it('finds the manifest one folder down when the package was zipped with its folder', async () => {
    const bytes = zip([{ name: 'course/imsmanifest.xml', data: MANIFEST_12 }, { name: 'course/index.html', data: 'x' }, { name: 'course/extra/imsmanifest.xml', data: 'y' }])
    const index = await readZipIndex(bytes.length, reader(bytes))
    assert.equal(manifestPath(index), 'course/imsmanifest.xml')
  })

  it('reads a SCORM 1.2 manifest: version, title, launch page and mastery score', () => {
    const m = parseManifest(MANIFEST_12)
    assert.deepEqual(m, { version: '1.2', title: 'Data Privacy & You', launch: 'index.html', mastery: 80 })
  })

  it('reads a 2004 manifest from its default organisation, joining xml:base and parameters', () => {
    const m = parseManifest(MANIFEST_2004, 'pkg')
    assert.equal(m.version, '2004')
    assert.equal(m.title, 'Golf')
    assert.equal(m.launch, 'pkg/content/shared/launch.html?mode=x&lang=en')
  })

  it('refuses a manifest with nothing to open', () => {
    assert.throws(() => parseManifest('<manifest><resources></resources></manifest>'), /which page to open/)
  })

  it('never serves a path that climbs out of the package', () => {
    assert.equal(normalisePath('a/../../etc/passwd'), null)
    assert.equal(normalisePath('a/./b/../c.js'), 'a/c.js')
    assert.equal(normalisePath('img/My%20Photo.png'), 'img/My Photo.png')
  })

  it('forgives a package that links Index.HTML when the file is index.html', () => {
    const hit = findEntry({ 'index.html': [0, 1, 1, 0] }, 'Index.HTML')
    assert.equal(hit?.name, 'index.html')
  })
})

describe('what a run means', () => {
  it('1.2: completed or passed finishes the lesson; failed does not', () => {
    assert.equal(scormOutcome('1.2', { 'cmi.core.lesson_status': 'completed' }, null).done, true)
    assert.equal(scormOutcome('1.2', { 'cmi.core.lesson_status': 'passed' }, null).label, 'Passed')
    const f = scormOutcome('1.2', { 'cmi.core.lesson_status': 'failed' }, null)
    assert.equal(f.done, false); assert.equal(f.failed, true)
    assert.equal(scormOutcome('1.2', { 'cmi.core.lesson_status': 'incomplete' }, null).label, 'In progress')
  })

  it('1.2 with a mastery score: the score decides, as the standard asks of the LMS', () => {
    assert.equal(scormOutcome('1.2', { 'cmi.core.lesson_status': 'completed', 'cmi.core.score.raw': '60' }, 80).failed, true)
    assert.equal(scormOutcome('1.2', { 'cmi.core.lesson_status': 'completed', 'cmi.core.score.raw': '85' }, 80).label, 'Passed')
  })

  it('2004: success_status failed holds the lesson back even when completed', () => {
    assert.equal(scormOutcome('2004', { 'cmi.completion_status': 'completed', 'cmi.success_status': 'failed' }, null).done, false)
    assert.equal(scormOutcome('2004', { 'cmi.completion_status': 'completed', 'cmi.success_status': 'unknown' }, null).done, true)
    assert.equal(scormOutcome('2004', { 'cmi.success_status': 'passed', 'cmi.score.scaled': '0.9' }, null).scorePct, 90)
  })

  it('reads a raw score against its own max', () => {
    assert.equal(scormOutcome('1.2', { 'cmi.core.score.raw': '15', 'cmi.core.score.max': '20' }, null).scorePct, 75)
  })

  it('keeps what a package may store, and drops what the LMS computes', () => {
    const c = cleanCmi({ 'cmi.suspend_data': 'abc', 'cmi.core.lesson_status': 'incomplete', 'cmi.core.student_name': 'Hacker', 'cmi.interactions._count': '3', 'window.x': '1' })
    assert.deepEqual(c, { 'cmi.suspend_data': 'abc', 'cmi.core.lesson_status': 'incomplete' })
  })

  it('a returning learner resumes, and the package is told who they are', () => {
    const fresh = startingCmi('1.2', null, { id: 'L1', name: 'Riya Jain' }, 80, 0, false)
    assert.equal(fresh['cmi.core.entry'], 'ab-initio')
    assert.equal(fresh['cmi.core.student_name'], 'Jain, Riya')
    const back = startingCmi('2004', { 'cmi.location': 'slide-7', 'cmi.learner_name': 'forged' }, { id: 'L1', name: 'Riya Jain' }, null, 754, false)
    assert.equal(back['cmi.entry'], 'resume')
    assert.equal(back['cmi.location'], 'slide-7')
    assert.equal(back['cmi.learner_name'], 'Jain, Riya')
    assert.equal(back['cmi.total_time'], 'PT0H12M34S')
  })

  it('reads both time formats', () => {
    assert.equal(timeToSeconds('0000:12:30.5'), 750.5)
    assert.equal(timeToSeconds('PT1H2M3S'), 3723)
  })

  it('the runtime script cannot be broken out of by the learner data it carries', () => {
    const js = runtimeScript({ version: '1.2', token: 't', cmi: { 'cmi.suspend_data': '</script><script>alert(1)</script>' }, readOnly: false })
    assert.ok(!js.includes('</script>'))
  })

  it('offers a package only the API of its own version, so a wrapper that tries 2004 first is not misled', () => {
    const run = (version: '1.2' | '2004') => {
      const w: any = { addEventListener() {}, parent: { postMessage() {} } }
      new Function('window', 'parent', 'setInterval', runtimeScript({ version, token: 't', cmi: { 'cmi.core.student_name': 'Jain, Riya' }, readOnly: false }))(w, w.parent, () => 0)
      return w
    }
    const old = run('1.2')
    assert.equal(typeof old.API?.LMSInitialize, 'function'); assert.equal(old.API_1484_11, undefined)
    assert.equal(old.API.LMSInitialize(''), 'true')
    assert.equal(old.API.LMSGetValue('cmi.core.student_name'), 'Jain, Riya')
    assert.equal(old.API.LMSSetValue('cmi.core.student_name', 'x'), 'false')
    assert.equal(old.API.LMSGetLastError(), '403')
    const now = run('2004')
    assert.equal(old.API_1484_11, undefined); assert.equal(typeof now.API_1484_11?.Initialize, 'function'); assert.equal(now.API, undefined)
  })
})
