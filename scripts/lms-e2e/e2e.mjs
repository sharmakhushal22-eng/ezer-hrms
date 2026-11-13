// End-to-end over the real Next.js routes, with invented people and a local database.
import crypto from 'crypto'
import zlib from 'node:zlib'
import assert from 'node:assert/strict'

const APP = process.env.APP || 'http://127.0.0.1:3210', RIG = process.env.RIG || 'http://127.0.0.1:54400', SECRET = 'rig-ess-secret'
const hid = k => { const h = crypto.createHash('md5').update(k).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}` }
const emp = k => hid(`emp:${k}`), co = k => hid(k), dept = (c, d) => hid(`${c}:${d}`), loc = (c, l) => hid(`${c}:${l}`)
const ess = k => { const body = Buffer.from(JSON.stringify({ sub: emp(k), exp: Date.now() + 3600e3 })).toString('base64url'); return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}` }
const sql = async (s, p = []) => { const r = await fetch(`${RIG}/__sql`, { method: 'POST', headers: { apikey: 'rig-service-key' }, body: JSON.stringify({ sql: s, params: p }) }); const j = await r.json(); if (!r.ok) throw new Error(j.message); return j }

async function call(who, path, body, method) {
  const headers = { 'Content-Type': 'application/json' }
  const token = who === null ? null : who.startsWith?.('lmsc.') || who.includes?.('.') ? who : ess(who)
  if (token) headers.Authorization = `Bearer ${token}`
  // The scheduled jobs refuse to run without CRON_SECRET (lib/cron-auth.ts): the app runs with this one.
  if (path.startsWith('/api/cron/')) headers.Authorization = `Bearer ${process.env.CRON_SECRET || 'rig-cron-secret'}`
  const r = await fetch(APP + path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined })
  const ct = r.headers.get('content-type') || ''
  const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer())
  return { status: r.status, data, ct }
}
const ok = async (...a) => { const r = await call(...a); if (r.status >= 300) throw new Error(`${a[1]} → ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); return r.data }
const deny = async (want, ...a) => { const r = await call(...a); assert.equal(r.status, want, `${a[1]} expected ${want}, got ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); return r.data }

let pass = 0, fail = 0
const failures = []
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ok   ${name}`) }
  catch (e) { fail++; failures.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).slice(0, 400)}`) }
}
const S = {}

async function upload(who, kind, name, mime, bytes, duration, purpose) {
  const b = await ok(who, '/api/lms/admin/assets', { kind, name, mime, size: bytes.length, duration_s: duration, purpose })
  if (kind === 'VIDEO' || kind === 'SCORM') {
    const meta = `bucketName ${Buffer.from(b.bucket).toString('base64')},objectName ${Buffer.from(b.path).toString('base64')},contentType ${Buffer.from(mime).toString('base64')}`
    const c = await fetch(b.tus_endpoint, { method: 'POST', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(bytes.length), 'Upload-Metadata': meta, 'x-signature': b.token } })
    assert.equal(c.status, 201, 'tus create')
    const loc = c.headers.get('location')
    for (let off = 0; off < bytes.length; off += 6 * 1024 * 1024) {
      const part = bytes.subarray(off, off + 6 * 1024 * 1024)
      const p = await fetch(loc, { method: 'PATCH', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(off), 'Content-Type': 'application/offset+octet-stream' }, body: part })
      assert.equal(p.status, 204, 'tus patch')
    }
  } else {
    const r = await fetch(`${RIG}/storage/v1/object/upload/sign/${b.bucket}/${b.path}?token=${b.token}`, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes })
    assert.equal(r.status, 200, 'signed put')
  }
  return (await ok(who, '/api/lms/admin/assets', { asset_id: b.asset_id, duration_s: duration }, 'PATCH')).asset
}
const op = (who, o, body) => ok(who, '/api/lms/admin/builder', { op: o, ...body })

async function watch(who, enrollment, lesson, seconds, total = seconds) {
  await sql(`UPDATE lms_lesson_progress SET last_beat_at = now() - make_interval(secs => $1) WHERE enrollment_id=$2 AND lesson_id=$3`, [seconds, enrollment, lesson])
  return ok(who, `/api/lms/me/enrollments/${enrollment}`, { event: 'beat', lesson_id: lesson, ranges: [[0, total]], position: total })
}
const open = (who, e, l) => ok(who, `/api/lms/me/enrollments/${e}`, { event: 'open', lesson_id: l })
const quizStart = (who, e, l) => ok(who, `/api/lms/me/enrollments/${e}`, { event: 'quiz_start', lesson_id: l })
const quizSubmit = (who, e, a, answers) => ok(who, `/api/lms/me/enrollments/${e}`, { event: 'quiz_submit', attempt_id: a, answers })
const key = async quiz => Object.fromEntries((await sql(`SELECT id, options FROM lms_questions WHERE quiz_id=$1`, [quiz])).map(q => [q.id, q.options.find(o => o.correct)?.id]))
const wrong = k => Object.fromEntries(Object.entries(k).map(([q, a]) => [q, a === 'a' ? 'b' : 'a']))
const enrolOf = async (who, course) => (await sql(`SELECT e.* FROM lms_enrollments e JOIN lms_learners l ON l.id=e.learner_id WHERE l.employee_id=$1 AND e.course_id=$2 ORDER BY e.cycle_no DESC LIMIT 1`, [emp(who), course]))[0]

const mcq = (prompt) => ({ kind: 'SINGLE', prompt, marks: 1, options: [{ id: 'a', text: 'Right', correct: true }, { id: 'b', text: 'Wrong' }, { id: 'c', text: 'Also wrong' }] })

console.log('\n1–4  Authoring and publishing')
await t('1  HR Manager creates a course and uploads videos (7 MB through resumable upload)', async () => {
  const r = await ok('mgr', '/api/lms/admin/courses', { title: 'Cybersecurity Awareness', summary: 'Stay safe', difficulty: 'BEGINNER', is_compliance: true, skills: ['Security'], tags: ['security'] })
  S.course = r.course.id; S.version = r.version.id
  S.m1 = (await op('mgr', 'module.create', { version_id: S.version, title: 'Introduction' })).result.id
  S.m2 = (await op('mgr', 'module.create', { version_id: S.version, title: 'Practical security' })).result.id
  const big = crypto.randomBytes(7 * 1024 * 1024)
  S.vid1 = await upload('mgr', 'VIDEO', 'intro.mp4', 'video/mp4', big, 120)
  S.vid2 = await upload('mgr', 'VIDEO', 'passwords.mp4', 'video/mp4', crypto.randomBytes(1024), 100)
  assert.equal(S.vid1.status, 'READY'); assert.equal(Number(S.vid1.duration_s), 120)
  S.l1 = (await op('mgr', 'lesson.create', { module_id: S.m1, kind: 'VIDEO', title: 'Intro to security', asset_id: S.vid1.id })).result.id
  S.l2 = (await op('mgr', 'lesson.create', { module_id: S.m2, kind: 'VIDEO', title: 'Password security', asset_id: S.vid2.id })).result.id
  S.l3 = (await op('mgr', 'lesson.create', { module_id: S.m2, kind: 'ARTICLE', title: 'Policy', body: 'Read this.', require_ack: true, ack_text: 'I have read it' })).result.id
})
await t('2  HR adds quizzes after individual videos', async () => {
  await op('mgr', 'quiz.attach', { lesson_id: S.l1 })
  await op('mgr', 'quiz.attach', { lesson_id: S.l2 })
  const ls = await sql(`SELECT id, quiz_id FROM lms_lessons WHERE version_id=$1`, [S.version])
  S.q1 = ls.find(x => x.id === S.l1).quiz_id; S.q2 = ls.find(x => x.id === S.l2).quiz_id
  for (const q of [S.q1, S.q2]) for (const p of ['One?', 'Two?', 'Three?', 'Four?']) await op('mgr', 'question.create', { quiz_id: q, ...mcq(p) })
})
await t('3  HR configures passing percentage and attempts', async () => {
  await op('mgr', 'quiz.update', { id: S.q1, pass_pct: 70, max_attempts: 2, on_exhausted: 'LOCK' })
  await op('mgr', 'quiz.update', { id: S.q2, pass_pct: 70, max_attempts: null })
  assert.equal((await sql(`SELECT pass_pct FROM lms_quizzes WHERE id=$1`, [S.q1]))[0].pass_pct, 70)
})
await t('   a bad course cannot be published: the checks speak in plain words', async () => {
  const c = await ok('mgr', '/api/lms/admin/courses', { title: 'Empty' })
  S.empty = c.course.id
  const r = await deny(422, 'head', `/api/lms/admin/courses/${S.empty}`, { action: 'publish' })
  assert.ok(r.problems.some(p => p.includes('at least one lesson')))
})
await t('4  HR Manager cannot publish; HR Head can', async () => {
  await deny(403, 'mgr', `/api/lms/admin/courses/${S.course}`, { action: 'publish' })
  const r = await ok('head', `/api/lms/admin/courses/${S.course}`, { action: 'publish' })
  assert.equal(r.ok, true)
  assert.equal((await sql(`SELECT status FROM lms_courses WHERE id=$1`, [S.course]))[0].status, 'PUBLISHED')
})
await t('   a published version is frozen by the database itself', async () => {
  await assert.rejects(sql(`UPDATE lms_lessons SET title='x' WHERE id=$1`, [S.l1]), /published and cannot change/)
  await deny(409, 'mgr', '/api/lms/admin/builder', { op: 'lesson.update', id: S.l1, title: 'Sneaky' })
})
await t('   publishing assigns nobody', async () => {
  assert.equal((await sql(`SELECT count(*)::int c FROM lms_enrollments WHERE course_id=$1`, [S.course]))[0].c, 0)
})

console.log('\n5–8  Assignment')
await t('5  assign to one employee, with an audit row', async () => {
  const r = await ok('exec', '/api/lms/admin/assignments', { items: [{ course_id: S.course }], targets: [{ kind: 'EMPLOYEE', value: emp('dev1') }], due_mode: 'AFTER_ASSIGN', due_days: 14 })
  assert.equal(r.enrolled, 1)
  S.a1 = r.id
  assert.ok((await sql(`SELECT 1 FROM lms_audit_log WHERE action='ASSIGNMENT_CREATED' AND entity_id=$1`, [r.id])).length)
  assert.ok((await sql(`SELECT 1 FROM ess_notifications WHERE employee_id=$1 AND notification_code='LMS_ASSIGNED'`, [emp('dev1')])).length, 'bell written')
})
await t('6  bulk-assign to several, skipping who already has it', async () => {
  const r = await ok('exec', '/api/lms/admin/assignments', { items: [{ course_id: S.course }], targets: ['dev1', 'dev2', 'sale1'].map(k => ({ kind: 'EMPLOYEE', value: emp(k) })), due_mode: 'NONE' })
  assert.equal(r.enrolled, 2)
})
await t('7  assign to a whole department, audience previewed first', async () => {
  const c = await ok('mgr', '/api/lms/admin/courses', { title: 'Engineering Standards' })
  S.c2 = c.course.id
  const m = (await op('mgr', 'module.create', { version_id: c.version.id, title: 'Standards' })).result.id
  const v = await upload('mgr', 'VIDEO', 'std.mp4', 'video/mp4', crypto.randomBytes(1024), 60)
  S.c2l = (await op('mgr', 'lesson.create', { module_id: m, kind: 'VIDEO', title: 'Standards', asset_id: v.id })).result.id
  await ok('head', `/api/lms/admin/courses/${S.c2}`, { action: 'publish' })
  const targets = [{ kind: 'DEPARTMENT', value: dept('acme', 'eng') }]
  const p = await ok('exec', '/api/lms/admin/assignments', { mode: 'preview', targets })
  assert.equal(p.count, 4)
  const r = await ok('exec', '/api/lms/admin/assignments', { items: [{ course_id: S.c2 }], targets, due_mode: 'FIXED', due_date: '2026-12-31' })
  assert.equal(r.enrolled, 4)
})
await t('   HR Executive cannot assign to the whole company', async () => {
  await deny(403, 'exec', '/api/lms/admin/assignments', { items: [{ course_id: S.c2 }], targets: [{ kind: 'COMPANY' }] })
})
await t('8  mandatory training for the organisation: actives only, not the leaver or the other company', async () => {
  const c = await ok('mgr', '/api/lms/admin/courses', { title: 'Code of Conduct', is_compliance: true, validity_months: 12 })
  S.c3 = c.course.id; S.c3v = c.version.id
  const m = (await op('mgr', 'module.create', { version_id: c.version.id, title: 'Conduct' })).result.id
  S.c3l = (await op('mgr', 'lesson.create', { module_id: m, kind: 'LINK', title: 'Read the code', external_url: 'https://example.test/code' })).result.id
  await ok('head', `/api/lms/admin/courses/${S.c3}`, { action: 'publish' })
  const r = await ok('mgr', '/api/lms/admin/assignments', { items: [{ course_id: S.c3 }], targets: [{ kind: 'COMPANY' }], mandatory: true, due_mode: 'AFTER_ASSIGN', due_days: 30, priority: 'HIGH' })
  assert.equal(r.enrolled, 13)   // 14 Acme people minus the one who resigned
  assert.equal((await sql(`SELECT count(*)::int c FROM lms_enrollments e JOIN lms_learners l ON l.id=e.learner_id WHERE e.course_id=$1 AND l.employee_id=$2`, [S.c3, emp('gone')]))[0].c, 0)
})
await t('   applying the same assignment twice enrols nobody twice', async () => {
  const r = await ok('mgr', `/api/lms/admin/assignments/${S.a1}`, { action: 'apply' })
  assert.equal(r.enrolled, 0)
})

console.log('\n9–12  Learning')
await t('   the player shows no answer key and no file URL', async () => {
  S.e1 = (await enrolOf('dev1', S.course)).id
  const v = await ok('dev1', `/api/lms/me/enrollments/${S.e1}`)
  const wire = JSON.stringify(v)
  assert.ok(!wire.includes('"correct"') && !wire.includes('storage') && !wire.includes('token='))
  assert.equal(v.lessons.length, 3)
  assert.equal(v.lessons[0].locked, false); assert.equal(v.lessons[1].locked, true)
})
await t('   a locked lesson cannot be opened by its id', async () => { await deny(403, 'dev1', `/api/lms/me/enrollments/${S.e1}`, { event: 'open', lesson_id: S.l2 }) })
await t('   the video URL plays with Range, and is shared between viewers', async () => {
  const a = await open('dev1', S.e1, S.l1)
  assert.ok(a.url); assert.equal(a.duration_s, 120)
  const r = await fetch(a.url, { headers: { Range: 'bytes=0-1023' } })
  assert.equal(r.status, 206)
  const b = await open('dev2', (await enrolOf('dev2', S.course)).id, S.l1)
  assert.equal(a.url, b.url, 'one URL per video keeps the CDN warm')
})
await t('   a forged heartbeat claiming the whole video is refused', async () => {
  const r = await ok('dev1', `/api/lms/me/enrollments/${S.e1}`, { event: 'beat', lesson_id: S.l1, ranges: [[0, 120]], position: 120 })
  assert.equal(r.content_done, false)
  assert.ok(r.refused_s > 90, `refused ${r.refused_s}`)
})
await t('   the quiz stays shut until the video is watched', async () => { await deny(409, 'dev1', `/api/lms/me/enrollments/${S.e1}`, { event: 'quiz_start', lesson_id: S.l1 }) })
await t('9  employee watches the video after real time has passed', async () => {
  const r = await watch('dev1', S.e1, S.l1, 120, 120)
  assert.equal(r.content_done, true)
})
await t('10 fails the quiz, retries, passes', async () => {
  const k = await key(S.q1)
  const a = await quizStart('dev1', S.e1, S.l1)
  assert.ok(!JSON.stringify(a).includes('correct'), 'paper carries no key')
  const first = await quizSubmit('dev1', S.e1, a.attempt_id, wrong(k))
  assert.equal(first.passed, false); assert.equal(first.attempts_left, 1)
  assert.equal(first.review, null, 'answers hidden until passed')
  const b = await quizStart('dev1', S.e1, S.l1)
  const second = await quizSubmit('dev1', S.e1, b.attempt_id, k)
  assert.equal(second.passed, true); assert.equal(second.pct, 100)
  assert.ok(second.review?.length, 'answers shown after a pass')
})
await t('   a double submit cannot grade twice', async () => {
  const last = (await sql(`SELECT id FROM lms_quiz_attempts WHERE enrollment_id=$1 ORDER BY attempt_no DESC LIMIT 1`, [S.e1]))[0]
  await deny(409, 'dev1', `/api/lms/me/enrollments/${S.e1}`, { event: 'quiz_submit', attempt_id: last.id, answers: {} })
})
await t('   a sat attempt counts even if abandoned, so a paper cannot be previewed for free', async () => {
  const e = (await enrolOf('dev2', S.course)).id
  await watch('dev2', e, S.l1, 120, 120)
  await quizStart('dev2', e, S.l1)
  const p = (await sql(`SELECT attempts_used FROM lms_lesson_progress WHERE enrollment_id=$1 AND lesson_id=$2`, [e, S.l1]))[0]
  assert.equal(p.attempts_used, 1)
  S.e2 = e
})
await t('   attempts run out: the course is FAILED, HR grants another, it recovers', async () => {
  const k = await key(S.q1)
  const a1 = await quizStart('dev2', S.e2, S.l1)
  await quizSubmit('dev2', S.e2, a1.attempt_id, wrong(k))
  const a2 = await quizStart('dev2', S.e2, S.l1)
  const r = await quizSubmit('dev2', S.e2, a2.attempt_id, wrong(k))
  assert.equal(r.locked, true)
  assert.equal((await sql(`SELECT status FROM lms_enrollments WHERE id=$1`, [S.e2]))[0].status, 'FAILED')
  await deny(409, 'dev2', `/api/lms/me/enrollments/${S.e2}`, { event: 'quiz_start', lesson_id: S.l1 })
  const g = await ok('exec', `/api/lms/admin/enrollments/${S.e2}`, { action: 'grant_attempts', lesson_id: S.l1, attempts: 1 })
  assert.equal(g.status, 'IN_PROGRESS')
  const a3 = await quizStart('dev2', S.e2, S.l1)
  assert.equal((await quizSubmit('dev2', S.e2, a3.attempt_id, k)).passed, true)
})
await t('11 completes the course and receives a certificate, verifiable in public', async () => {
  await open('dev1', S.e1, S.l2)
  await watch('dev1', S.e1, S.l2, 100, 100)
  const k = await key(S.q2)
  const a = await quizStart('dev1', S.e1, S.l2)
  await quizSubmit('dev1', S.e1, a.attempt_id, k)
  await open('dev1', S.e1, S.l3)
  const u = await ok('dev1', `/api/lms/me/enrollments/${S.e1}`, { event: 'mark', lesson_id: S.l3, done: true })
  assert.notEqual(u.status, 'COMPLETED', 'the attestation is still owed')
  const done = await ok('dev1', `/api/lms/me/enrollments/${S.e1}`, { event: 'mark', lesson_id: S.l3, ack: true })
  assert.equal(done.status, 'COMPLETED'); assert.ok(done.certificate?.cert_no)
  S.cert = done.certificate
  const pdf = await call('dev1', `/api/lms/me/certificates/${S.cert.id}`)
  assert.equal(pdf.status, 200); assert.ok(pdf.data.subarray(0, 4).toString() === '%PDF')
  const v = await ok(null, `/api/lms/verify/${S.cert.verify_code}`)
  assert.equal(v.status, 'VALID'); assert.equal(v.recipient, 'Dev One')
  assert.ok(!JSON.stringify(v).includes('emp_code') && !JSON.stringify(v).includes('@'))
})
await t('   scores are real percentages everywhere they are stored', async () => {
  const bad = await sql(`SELECT score_pct FROM lms_enrollments WHERE score_pct > 100 OR score_pct < 0`)
  assert.equal(bad.length, 0, JSON.stringify(bad))
  const e = (await sql(`SELECT score_pct FROM lms_enrollments WHERE id=$1`, [S.e1]))[0]
  assert.equal(Number(e.score_pct), 100)
  const by = (await ok('head', '/api/lms/admin/overview')).overview.by_course.find(c => c.course_id === S.course)
  assert.ok(Number(by.avg_score) <= 100, `avg ${by.avg_score}`)
})
await t('   completion lands on the employee profile too', async () => {
  assert.equal((await sql(`SELECT count(*)::int c FROM employee_trainings WHERE employee_id=$1`, [emp('dev1')]))[0].c, 1)
  assert.equal((await sql(`SELECT count(*)::int c FROM employee_certifications WHERE employee_id=$1`, [emp('dev1')]))[0].c, 1)
})
await t('   someone else cannot download that certificate', async () => { await deny(404, 'dev2', `/api/lms/me/certificates/${S.cert.id}`) })
await t('   a revoked certificate says so', async () => {
  const c2 = S.cert
  await ok('head', '/api/lms/admin/certificates', { id: c2.id, reason: 'Test' })
  assert.equal((await ok(null, `/api/lms/verify/${c2.verify_code}`)).status, 'REVOKED')
})
await t('12 self-enrols in an optional course from the catalogue', async () => {
  const c = await ok('mgr', '/api/lms/admin/courses', { title: 'Effective Writing', enrolment_mode: 'SELF' })
  S.c4 = c.course.id
  const m = (await op('mgr', 'module.create', { version_id: c.version.id, title: 'Writing' })).result.id
  await op('mgr', 'lesson.create', { module_id: m, kind: 'ARTICLE', title: 'Be brief', body: 'Be brief.' })
  await ok('head', `/api/lms/admin/courses/${S.c4}`, { action: 'publish' })
  const cat = await ok('sale1', '/api/lms/me/catalog')
  assert.ok(cat.courses.some(x => x.id === S.c4))
  const r = await ok('sale1', '/api/lms/me/enrol', { course_id: S.c4 })
  assert.equal(r.status, 'NOT_STARTED')
})
await t('   a restricted course is invisible outside its audience, and unenrollable', async () => {
  const c = await ok('mgr', '/api/lms/admin/courses', { title: 'Sales Only', enrolment_mode: 'SELF', visibility: 'RESTRICTED' })
  S.c5 = c.course.id
  await ok('mgr', `/api/lms/admin/courses/${S.c5}`, { audience: [{ kind: 'DEPARTMENT', value: dept('acme', 'sales') }] }, 'PATCH')
  const m = (await op('mgr', 'module.create', { version_id: c.version.id, title: 'x' })).result.id
  await op('mgr', 'lesson.create', { module_id: m, kind: 'ARTICLE', title: 'x', body: 'x' })
  await ok('head', `/api/lms/admin/courses/${S.c5}`, { action: 'publish' })
  assert.ok((await ok('sale1', '/api/lms/me/catalog')).courses.some(x => x.id === S.c5))
  assert.ok(!(await ok('dev1', '/api/lms/me/catalog')).courses.some(x => x.id === S.c5))
  await deny(404, 'dev1', '/api/lms/me/enrol', { course_id: S.c5 })
})
await t('   approval mode: request goes to the manager, who approves it', async () => {
  const c = await ok('mgr', '/api/lms/admin/courses', { title: 'Leadership', enrolment_mode: 'APPROVAL' })
  S.c6 = c.course.id
  const m = (await op('mgr', 'module.create', { version_id: c.version.id, title: 'x' })).result.id
  await op('mgr', 'lesson.create', { module_id: m, kind: 'ARTICLE', title: 'x', body: 'x' })
  await ok('head', `/api/lms/admin/courses/${S.c6}`, { action: 'publish' })
  const r = await ok('dev1', '/api/lms/me/enrol', { course_id: S.c6 })
  assert.equal(r.status, 'PENDING_APPROVAL')
  await deny(404, 'exec', '/api/lms/team', { action: 'decide', enrollment_id: r.id, approve: true })
  const team = await ok('lead', '/api/lms/team')
  assert.equal(team.requests.length, 1)
  await ok('lead', '/api/lms/team', { action: 'decide', enrollment_id: r.id, approve: true })
  assert.equal((await sql(`SELECT status FROM lms_enrollments WHERE id=$1`, [r.id]))[0].status, 'NOT_STARTED')
})

console.log('\n13–14  Joiners and candidates')
await t('13 a new joiner automatically receives the onboarding template, due from their joining date', async () => {
  await ok('mgr', '/api/lms/admin/assignments', { name: 'New joiner: Engineering', trigger_type: 'ON_JOIN', items: [{ course_id: S.c2 }, { course_id: S.c3 }], targets: [{ kind: 'DEPARTMENT', value: dept('acme', 'eng') }], due_mode: 'AFTER_JOIN', due_days: 7, join_window_days: 30 })
  const id = crypto.randomUUID(), doj = new Date().toISOString().slice(0, 10)
  await sql(`INSERT INTO employees (id, emp_code, company_id, department_id, location_id, full_name, designation, employment_status, employment_type, company_doj, office_email, grade)
             VALUES ($1,'ACM0099',$2,$3,$4,'Nina New','Software Engineer','Active','Employee',$5,'nina@example.test','E1')`, [id, co('acme'), dept('acme', 'eng'), loc('acme', 'pune'), doj])
  S.nina = id
  const d = await ok(null, '/api/cron/lms-daily')
  assert.ok(d.sweep.enrolled >= 2, JSON.stringify(d.sweep))
  const rows = await sql(`SELECT e.due_at FROM lms_enrollments e JOIN lms_learners l ON l.id=e.learner_id WHERE l.employee_id=$1`, [id])
  assert.equal(rows.length, 2)
  const days = Math.round((new Date(rows[0].due_at) - Date.now()) / 864e5)
  assert.ok(days >= 6 && days <= 8, `due in ${days} days`)
})
await t('   the rule does not reach back to long-serving staff in that department', async () => {
  assert.equal((await sql(`SELECT count(*)::int c FROM lms_enrollments e JOIN lms_assignments a ON a.id=e.assignment_id WHERE a.trigger_type='ON_JOIN' AND e.learner_id IN (SELECT id FROM lms_learners WHERE employee_id=$1)`, [emp('dev3')]))[0].c, 0)
})
await t('   the daily job a second time changes nothing', async () => {
  const before = (await sql(`SELECT count(*)::int c FROM lms_enrollments`))[0].c
  await ok(null, '/api/cron/lms-daily')
  assert.equal((await sql(`SELECT count(*)::int c FROM lms_enrollments`))[0].c, before)
})
await t('14 a candidate gets limited access through a link and one-time code', async () => {
  const ob = crypto.randomUUID()
  await sql(`INSERT INTO onboarding_candidates (id, company_id, full_name, email, designation, department_id, date_of_joining, status, created_at) VALUES ($1,$2,'Cara Candidate','cara@example.test','Software Engineer',$3,(current_date + 10),'SUBMITTED',now())`, [ob, co('acme'), dept('acme', 'eng')])
  S.ob = ob
  const list = await ok('exec', '/api/lms/admin/preboarding')
  assert.ok(list.pending.some(p => p.onboarding_candidate_id === ob))
  const inv = await ok('exec', '/api/lms/admin/preboarding', { action: 'invite', full_name: 'Cara Candidate', email: 'cara@example.test', onboarding_candidate_id: ob, date_of_joining: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), department_id: dept('acme', 'eng'), designation: 'Software Engineer', items: [{ course_id: S.c4 }] })
  assert.equal(inv.enrolled, 1)
  assert.equal((await sql(`SELECT enrolled_count FROM lms_assignments WHERE name='Pre-joining: Cara Candidate'`))[0].enrolled_count, 1)
  S.learner = inv.learner_id
  S.link = inv.link.split('/learn/')[1]
  assert.ok((await sql(`SELECT token_hash FROM lms_candidate_access WHERE learner_id=$1`, [S.learner]))[0].token_hash !== S.link, 'only the hash is stored')
  const o = await ok(null, '/api/lms/pre', { action: 'open', token: S.link })
  assert.equal(o.first_name, 'Cara'); assert.ok(o.email.includes('*'))
  await ok(null, '/api/lms/pre', { action: 'send', token: S.link })
  await deny(400, null, '/api/lms/pre', { action: 'verify', token: S.link, otp: '000000' })
  const key2 = crypto.createHmac('sha256', SECRET).update('ezer-learn:candidate-otp:v1').digest()
  await sql(`UPDATE lms_candidate_access SET otp_hmac=$1 WHERE learner_id=$2`, [crypto.createHmac('sha256', key2).update(`${S.learner}:123456`).digest('hex'), S.learner])
  const v = await ok(null, '/api/lms/pre', { action: 'verify', token: S.link, otp: '123456' })
  S.cand = v.session
  const d = await ok(S.cand, '/api/lms/me/dashboard')
  assert.equal(d.kind, 'CANDIDATE'); assert.equal(d.counts.assigned, 1)
  const e = d.optional[0] || d.mandatory[0]
  const p = await ok(S.cand, `/api/lms/me/enrollments/${e.id}`)
  await open(S.cand, e.id, p.lessons[0].id)
  const done = await ok(S.cand, `/api/lms/me/enrollments/${e.id}`, { event: 'mark', lesson_id: p.lessons[0].id, done: true })
  assert.equal(done.status, 'COMPLETED')
})
await t('   a candidate token opens nothing else in the application', async () => {
  for (const path of ['/api/lms/admin/overview', '/api/lms/admin/courses', '/api/lms/team', '/api/ess/menu', '/api/leave/balance']) {
    const r = await call(S.cand, path)
    assert.ok([401, 404, 405].includes(r.status), `${path} answered ${r.status}`)
  }
  const cat = await ok(S.cand, '/api/lms/me/catalog')
  assert.equal(cat.courses.length, 0)
  await deny(403, S.cand, '/api/lms/me/enrol', { course_id: S.c4 })
})
await t('   a candidate token signed with the ESS format is not accepted as an employee', async () => {
  const body = Buffer.from(JSON.stringify({ sub: S.learner, exp: Date.now() + 3600e3 })).toString('base64url')
  const forged = `lmsc.${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`
  await deny(401, forged, '/api/lms/me/dashboard')
})
await t('   joining converts them: same record, link dead, ESS works, onboarding template follows', async () => {
  const id = crypto.randomUUID()
  await sql(`INSERT INTO employees (id, emp_code, company_id, department_id, location_id, full_name, designation, employment_status, employment_type, company_doj, office_email, grade) VALUES ($1,'ACM0100',$2,$3,$4,'Cara Candidate','Software Engineer','Active','Employee',current_date,'cara@example.test','E1')`, [id, co('acme'), dept('acme', 'eng'), loc('acme', 'pune')])
  await sql(`INSERT INTO ess_accounts (id, employee_id, status) VALUES (gen_random_uuid(), $1, 'ACTIVE')`, [id])
  await sql(`UPDATE onboarding_candidates SET employee_id=$1, status='EMPLOYEE_CREATED' WHERE id=$2`, [id, S.ob])
  const d = await ok(null, '/api/cron/lms-daily')
  assert.equal(d.preboarding.converted, 1, JSON.stringify(d.preboarding))
  const l = (await sql(`SELECT kind, employee_id FROM lms_learners WHERE id=$1`, [S.learner]))[0]
  assert.equal(l.kind, 'EMPLOYEE'); assert.equal(l.employee_id, id)
  assert.equal((await sql(`SELECT status FROM lms_enrollments WHERE learner_id=$1 AND course_id=$2`, [S.learner, S.c4]))[0].status, 'COMPLETED')
  await deny(401, S.cand, '/api/lms/me/dashboard')
  await deny(404, null, '/api/lms/pre', { action: 'open', token: S.link })
  assert.ok((await sql(`SELECT count(*)::int c FROM lms_enrollments WHERE learner_id=$1`, [S.learner]))[0].c >= 3, 'onboarding courses followed')
})

await t('   a candidate who already has an employee learner record is merged, nothing lost or doubled', async () => {
  const ob = crypto.randomUUID()
  await sql(`INSERT INTO onboarding_candidates (id, company_id, full_name, email, department_id, date_of_joining, status, created_at) VALUES ($1,$2,'Mo Merge','mo@example.test',$3,(current_date + 5),'SUBMITTED',now())`, [ob, co('acme'), dept('acme', 'sales')])
  const inv = await ok('exec', '/api/lms/admin/preboarding', { action: 'invite', full_name: 'Mo Merge', email: 'mo@example.test', onboarding_candidate_id: ob, items: [{ course_id: S.c4 }] })
  const id = crypto.randomUUID()
  await sql(`INSERT INTO employees (id, emp_code, company_id, department_id, location_id, full_name, employment_status, employment_type, company_doj, office_email, grade) VALUES ($1,'ACM0101',$2,$3,$4,'Mo Merge','Active','Employee',current_date,'mo@example.test','E1')`, [id, co('acme'), dept('acme', 'sales'), loc('acme', 'pune')])
  await ok('exec', '/api/lms/admin/assignments', { items: [{ course_id: S.c4 }], targets: [{ kind: 'EMPLOYEE', value: id }], due_mode: 'NONE' })
  await sql(`UPDATE onboarding_candidates SET employee_id=$1, status='EMPLOYEE_CREATED' WHERE id=$2`, [id, ob])
  await ok(null, '/api/cron/lms-daily')
  const rows = await sql(`SELECT e.status FROM lms_enrollments e JOIN lms_learners l ON l.id=e.learner_id WHERE l.employee_id=$1 AND e.course_id=$2`, [id, S.c4])
  assert.equal(rows.length, 1, JSON.stringify(rows))
  assert.equal((await sql(`SELECT status FROM lms_learners WHERE id=$1`, [inv.learner_id]))[0].status, 'REVOKED')
})

console.log('\n15–16  Oversight')
await t('15 a manager sees their own team, and only that', async () => {
  const t = await ok('lead', '/api/lms/team')
  assert.equal(t.is_manager, true)
  assert.equal(t.people.length, 3)
  assert.ok(t.rows.every(r => [emp('dev1'), emp('dev2'), emp('dev3')].includes(r.employee_id)))
  assert.equal((await ok('dev1', '/api/lms/team')).is_manager, false)
})
await t('   a manager assigns to their report, and not beyond', async () => {
  const r = await ok('lead', '/api/lms/team', { action: 'assign', employee_ids: [emp('dev3')], items: [{ course_id: S.c4 }], mandatory: false, due_mode: 'NONE' })
  assert.equal(r.enrolled, 1)
  await deny(403, 'lead', '/api/lms/team', { action: 'assign', employee_ids: [emp('sale1')], items: [{ course_id: S.c4 }] })
})
await t('16 HR sees organisation-wide figures, filters, and exports Excel', async () => {
  const o = await ok('head', '/api/lms/admin/overview')
  assert.ok(o.overview.enrollments.total >= 18)
  assert.ok(o.overview.by_department.length >= 2 && o.overview.by_course.length >= 3)
  assert.ok(o.overview.enrollments.completed >= 2)
  const f = await ok('head', `/api/lms/admin/reports?course=${S.course}`)
  assert.ok(f.rows.every(r => r.course_id === S.course))
  const x = await call('head', '/api/lms/admin/reports?format=xlsx&kind=compliance')
  assert.equal(x.status, 200); assert.equal(x.data.subarray(0, 2).toString(), 'PK')
  assert.ok(Array.isArray((await ok('head', '/api/lms/admin/reports?kind=quizzes')).rows))
})
await t('   a super admin sees across companies; an HR Head does not', async () => {
  await ok('bhead', '/api/lms/admin/courses', { title: 'Beta course' })
  const sup = await ok('super', '/api/lms/admin/courses')
  assert.ok(sup.courses.some(c => c.title === 'Beta course') && sup.courses.some(c => c.title === 'Code of Conduct'))
  assert.ok(!(await ok('head', '/api/lms/admin/courses')).courses.some(c => c.title === 'Beta course'))
})

console.log('\n17  Refusals')
await t('17 an ordinary employee is refused every admin route', async () => {
  for (const p of ['overview', 'courses', 'assignments', 'preboarding', 'reports', 'audit', 'certificates']) await deny(403, 'dev1', `/api/lms/admin/${p}`)
})
await t('   no session gets nothing', async () => {
  for (const p of ['/api/lms/admin/courses', '/api/lms/me/dashboard', '/api/lms/team']) await deny(401, null, p)
})
await t('   Content Author writes but cannot publish, assign or read reports', async () => {
  const c = await ok('author', '/api/lms/admin/courses', { title: 'Author draft' })
  await deny(403, 'author', `/api/lms/admin/courses/${c.course.id}`, { action: 'publish' })
  await deny(403, 'author', '/api/lms/admin/assignments', { items: [{ course_id: S.c2 }], targets: [{ kind: 'EMPLOYEE', value: emp('dev1') }] })
  await deny(403, 'author', '/api/lms/admin/reports')
})
await t('   Training Coordinator assigns but cannot change content', async () => {
  await deny(403, 'coord', '/api/lms/admin/courses', { title: 'No' })
  await deny(403, 'coord', '/api/lms/admin/builder', { op: 'module.create', version_id: S.version })
  const r = await ok('coord', '/api/lms/admin/assignments', { items: [{ course_id: S.c2 }], targets: [{ kind: 'EMPLOYEE', value: emp('sale2') }], due_mode: 'NONE' })
  assert.equal(r.enrolled, 1)
})
await t('   another company\'s course is simply not there', async () => {
  await deny(404, 'bhead', `/api/lms/admin/courses/${S.course}`)
  await deny(404, 'bhead', `/api/lms/admin/courses/${S.course}`, { action: 'archive' })
  await deny(404, 'bhead', '/api/lms/admin/assignments', { items: [{ course_id: S.course }], targets: [{ kind: 'COMPANY' }] })
  await deny(404, 'bdev', `/api/lms/me/catalog/${S.course}`)
})
await t('   the database itself refuses a cross-company link', async () => {
  const l = (await sql(`SELECT id FROM lms_learners WHERE company_id=$1 LIMIT 1`, [co('acme')]))[0]
  await assert.rejects(sql(`INSERT INTO lms_enrollments (company_id, learner_id, course_id, version_id) VALUES ($1,$2,$3,$4)`, [co('beta'), l.id, S.course, S.version]), /foreign key/)
})
await t('   another learner\'s enrolment is not found', async () => { await deny(404, 'dev2', `/api/lms/me/enrollments/${S.e1}`) })
await t('   an admin viewing someone\'s portal may look but not act', async () => {
  const e = (await enrolOf('sale1', S.c3)).id
  const v = await call('head', `/api/lms/me/enrollments/${e}?employee_id=${emp('sale1')}`)
  assert.equal(v.status, 200); assert.equal(v.data.read_only, true)
  await deny(403, 'head', `/api/lms/me/enrollments/${e}?employee_id=${emp('sale1')}`, { event: 'mark', lesson_id: S.c3l, done: true })
})
await t('   a plain employee cannot view someone else\'s portal', async () => { await deny(403, 'dev1', `/api/lms/me/dashboard?employee_id=${emp('dev2')}`) })
await t('   Branch HR reaches only their branch', async () => {
  const f = await ok('branch', '/api/lms/admin/reports')
  assert.ok(f.rows.length > 0 && f.rows.every(r => r.location_name === 'Delhi'))
  const r = await ok('branch', '/api/lms/admin/assignments', { items: [{ course_id: S.c4 }], targets: [{ kind: 'DEPARTMENT', value: dept('acme', 'sales') }], due_mode: 'NONE' })
  const who = await sql(`SELECT emp.emp_code, emp.location_id FROM lms_enrollments e JOIN lms_learners l ON l.id=e.learner_id JOIN employees emp ON emp.id=l.employee_id WHERE e.assignment_id=$1`, [r.id])
  assert.ok(who.every(x => x.location_id === loc('acme', 'delhi')), JSON.stringify(who))
  await deny(403, 'branch', '/api/lms/admin/assignments', { items: [{ course_id: S.c4 }], targets: [{ kind: 'EMPLOYEE', value: emp('sale2') }], due_mode: 'NONE' })
})
await t('   an HR Head of another company cannot read this company\'s learners through view-as', async () => {
  await deny(403, 'bhead', `/api/lms/me/dashboard?employee_id=${emp('dev1')}`)
  await deny(403, 'bhead', `/api/lms/team?employee_id=${emp('lead')}`)
})
await t('   an admin with no learning oversight cannot either, and a manager uses Team, not the portal', async () => {
  await deny(403, 'author', `/api/lms/me/dashboard?employee_id=${emp('dev1')}`)
  await deny(403, 'lead', `/api/lms/me/dashboard?employee_id=${emp('dev1')}`)
})
await t('   viewing a lesson as someone else leaves no mark on their record', async () => {
  const e = await enrolOf('sale1', S.c3)
  await ok('head', `/api/lms/me/enrollments/${e.id}?employee_id=${emp('sale1')}`, { event: 'open', lesson_id: S.c3l })
  const after = (await sql(`SELECT status, (SELECT count(*)::int FROM lms_lesson_progress p WHERE p.enrollment_id=e.id) n FROM lms_enrollments e WHERE id=$1`, [e.id]))[0]
  assert.equal(after.status, 'NOT_STARTED'); assert.equal(after.n, 0)
})
await t('   a content author sees how much content exists, and nobody\'s results', async () => {
  const o = (await ok('author', '/api/lms/admin/overview')).overview
  assert.ok(o.courses.total > 0)
  assert.equal(o.enrollments, undefined); assert.equal(o.by_department, undefined)
})
await t('   the course list counts every course, not just the top 25', async () => {
  const c = (await ok('head', '/api/lms/admin/courses')).courses.find(x => x.id === S.c3)
  assert.ok(c.enrolled >= 13, String(c.enrolled))
})
await t('   Branch HR cannot see or touch another branch\'s assignment, audit log or people', async () => {
  const company = await ok('head', '/api/lms/admin/assignments', { items: [{ course_id: S.c2 }], targets: [{ kind: 'EMPLOYEE', value: emp('sale2') }], due_mode: 'NONE', include_completed: true })
  const list = (await ok('branch', '/api/lms/admin/assignments')).assignments
  assert.ok(list.length > 0 && !list.some(a => a.id === company.id) && !list.some(a => a.id === S.a1), 'other branches hidden')
  await deny(404, 'branch', `/api/lms/admin/assignments/${company.id}`, { action: 'cancel' })
  await deny(403, 'branch', '/api/lms/admin/audit')
  const certs = (await ok('branch', '/api/lms/admin/certificates')).certificates
  assert.ok(!certs.some(c => c.recipient_name === 'Dev One'), 'Dev One sits in Pune')
  const e = (await enrolOf('sale2', S.c3)).id
  await deny(404, 'branch', `/api/lms/admin/enrollments/${e}`, { action: 'waive', reason: 'x' })
})
await t('   a coordinator holding no Reports could still list enrolments to act on, but not export', async () => {
  await sql(`DELETE FROM role_permissions WHERE module='Learning Reports' AND role_id=(SELECT id FROM ess_roles WHERE role_code='LMS_COORDINATOR')`)
  assert.equal((await call('coord', '/api/lms/admin/reports')).status, 200)
  await deny(403, 'coord', '/api/lms/admin/reports?format=xlsx')
  await deny(403, 'coord', '/api/lms/admin/reports?kind=quizzes')
  await sql(`INSERT INTO role_permissions (role_id, module, access_level) SELECT id, 'Learning Reports', 'VIEW' FROM ess_roles WHERE role_code='LMS_COORDINATOR'`)
})
await t('   the audit log cannot be altered', async () => { await assert.rejects(sql(`DELETE FROM lms_audit_log`), /append-only/) })

console.log('\nVersions, paths, renewal, reminders')
await t('   versioning follows the learner', async () => {
  await ok('exec', '/api/lms/admin/assignments', { items: [{ course_id: S.course }], targets: [{ kind: 'EMPLOYEE', value: emp('dev3') }, { kind: 'EMPLOYEE', value: emp('sale2') }], due_mode: 'NONE' })
  const started = (await enrolOf('dev3', S.course)).id
  await open('dev3', started, S.l1)
  await watch('dev3', started, S.l1, 120, 120)
  const nv = await ok('mgr', `/api/lms/admin/courses/${S.course}`, { action: 'new_version' })
  await deny(409, 'mgr', `/api/lms/admin/courses/${S.course}`, { action: 'new_version' })
  const ls = await sql(`SELECT id FROM lms_lessons WHERE version_id=$1 AND title='Policy'`, [nv.version_id])
  await op('mgr', 'lesson.update', { id: ls[0].id, title: 'Updated policy' })
  const pub = await ok('head', `/api/lms/admin/courses/${S.course}`, { action: 'publish' })
  assert.ok(pub.moved >= 1, 'not-started learners moved')
  assert.notEqual((await enrolOf('dev3', S.course)).version_id, nv.version_id, 'in progress stays put')
  assert.equal((await enrolOf('sale2', S.course)).version_id, nv.version_id)
  const m = await ok('head', `/api/lms/admin/courses/${S.course}`, { action: 'move_in_progress' })
  assert.equal(m.moved, 2, 'both people mid-course moved')
  const after = await enrolOf('dev3', S.course)
  assert.equal(after.version_id, nv.version_id)
  const carried = await sql(`SELECT p.content_done, l.source_lesson_id FROM lms_lesson_progress p JOIN lms_lessons l ON l.id=p.lesson_id WHERE p.enrollment_id=$1`, [after.id])
  assert.equal(carried.length, 1); assert.equal(carried[0].content_done, true); assert.equal(carried[0].source_lesson_id, S.l1)
  assert.equal((await sql(`SELECT progress_pct FROM lms_enrollments e WHERE id=$1 AND EXISTS (SELECT 1)`, [S.e1])).length, 1)
})
await t('   a sequential learning path locks in order and completes as one', async () => {
  const p = await ok('mgr', '/api/lms/admin/paths', { title: 'New Employee Onboarding', order_mode: 'SEQUENTIAL', items: [{ course_id: S.c5 }, { course_id: S.c6 }] })
  await deny(403, 'mgr', `/api/lms/admin/paths/${p.id}`, { action: 'publish' })
  await ok('head', `/api/lms/admin/paths/${p.id}`, { action: 'publish' })
  await ok('mgr', '/api/lms/admin/assignments', { items: [{ path_id: p.id }], targets: [{ kind: 'EMPLOYEE', value: emp('sale2') }], due_mode: 'NONE' })
  const e1 = (await enrolOf('sale2', S.c5)).id, e2 = (await enrolOf('sale2', S.c6)).id
  const lp = await ok('sale2', `/api/lms/me/enrollments/${e2}`)
  assert.ok(lp.gate?.includes('come first'), lp.gate)
  await deny(403, 'sale2', `/api/lms/me/enrollments/${e2}`, { event: 'open', lesson_id: lp.lessons[0].id })
  const l1 = (await ok('sale2', `/api/lms/me/enrollments/${e1}`)).lessons[0].id
  await open('sale2', e1, l1)
  await ok('sale2', `/api/lms/me/enrollments/${e1}`, { event: 'mark', lesson_id: l1, done: true })
  await open('sale2', e2, lp.lessons[0].id)
  await ok('sale2', `/api/lms/me/enrollments/${e2}`, { event: 'mark', lesson_id: lp.lessons[0].id, done: true })
  const pe = (await sql(`SELECT status, progress_pct FROM lms_path_enrollments WHERE path_id=$1`, [p.id]))[0]
  assert.equal(pe.status, 'COMPLETED')
  assert.ok((await sql(`SELECT 1 FROM lms_certificates WHERE path_enrollment_id IS NOT NULL`)).length, 'path certificate')
})
await t('   annual training renews itself: a new cycle ahead of expiry, the old record kept', async () => {
  const e = (await enrolOf('dev1', S.c3)).id
  await open('dev1', e, S.c3l)
  await ok('dev1', `/api/lms/me/enrollments/${e}`, { event: 'mark', lesson_id: S.c3l, done: true })
  const done = (await sql(`SELECT status, expires_at FROM lms_enrollments WHERE id=$1`, [e]))[0]
  assert.equal(done.status, 'COMPLETED'); assert.ok(done.expires_at, 'expiry from validity_months')
  await sql(`UPDATE lms_enrollments SET expires_at = now() + interval '10 days' WHERE id=$1`, [e])
  await ok(null, '/api/cron/lms-daily')
  const cycles = await sql(`SELECT cycle_no, status, source FROM lms_enrollments WHERE learner_id=(SELECT learner_id FROM lms_enrollments WHERE id=$1) AND course_id=$2 ORDER BY cycle_no`, [e, S.c3])
  assert.equal(cycles.length, 2); assert.equal(cycles[0].status, 'COMPLETED'); assert.equal(cycles[1].source, 'RENEWAL')
})
await t('   a leaver\'s open training is closed, not left overdue for ever', async () => {
  await sql(`UPDATE employees SET employment_status='Resigned' WHERE id=$1`, [emp('sale2')])
  await ok(null, '/api/cron/lms-daily')
  assert.equal((await sql(`SELECT count(*)::int c FROM lms_enrollments e JOIN lms_learners l ON l.id=e.learner_id WHERE l.employee_id=$1 AND e.status IN ('NOT_STARTED','IN_PROGRESS')`, [emp('sale2')]))[0].c, 0)
  await sql(`UPDATE employees SET employment_status='Active' WHERE id=$1`, [emp('sale2')])
})
await t('   reminders fire once a day, however often the job runs', async () => {
  const e = (await enrolOf('sale1', S.c3)).id
  await sql(`UPDATE lms_enrollments SET due_at = now() + interval '3 days' WHERE id=$1`, [e])
  await ok(null, '/api/cron/lms-daily'); await ok(null, '/api/cron/lms-daily')
  assert.equal((await sql(`SELECT count(*)::int c FROM lms_reminder_log WHERE enrollment_id=$1 AND kind='DUE_SOON'`, [e]))[0].c, 1)
})
await t('   overdue training escalates to the manager', async () => {
  const e = (await enrolOf('dev2', S.c3)).id
  await sql(`UPDATE lms_enrollments SET due_at = now() - interval '9 days' WHERE id=$1`, [e])
  await ok(null, '/api/cron/lms-daily')
  assert.ok((await sql(`SELECT 1 FROM ess_notifications WHERE employee_id=$1 AND notification_code='LMS_TEAM_OVERDUE'`, [emp('lead')])).length)
})
await t('   Excel import checks every row and applies nothing unless all are good', async () => {
  const code = (await sql(`SELECT code FROM lms_courses WHERE id=$1`, [S.c4]))[0].code
  const bad = await ok('mgr', '/api/lms/admin/assignments', { mode: 'import', commit: true, rows: [{ emp_code: 'ACM0021', course_code: code }, { emp_code: 'NOPE', course_code: code }] })
  assert.equal(bad.committed, false); assert.equal(bad.error_count, 1)
  const good = await ok('mgr', '/api/lms/admin/assignments', { mode: 'import', commit: true, rows: [{ emp_code: 'ACM0021', course_code: code, due_date: '2026-12-31' }] })
  assert.equal(good.committed, true); assert.equal(good.enrolled, 1)
})
await t('   four-eyes: with review on, an author cannot publish their own submission', async () => {
  await ok('head', '/api/lms/admin/settings', { publish_requires_review: true }, 'PUT')
  const c = await ok('head', '/api/lms/admin/courses', { title: 'Reviewed course' })
  const m = (await op('head', 'module.create', { version_id: c.version.id, title: 'x' })).result.id
  await op('head', 'lesson.create', { module_id: m, kind: 'ARTICLE', title: 'x', body: 'x' })
  await deny(409, 'head', `/api/lms/admin/courses/${c.course.id}`, { action: 'publish' })
  await ok('head', `/api/lms/admin/courses/${c.course.id}`, { action: 'submit_review' })
  await deny(403, 'head', `/api/lms/admin/courses/${c.course.id}`, { action: 'publish' })
  await ok('super', `/api/lms/admin/courses/${c.course.id}`, { action: 'publish' })
  await ok('head', '/api/lms/admin/settings', { publish_requires_review: false }, 'PUT')
})

console.log('\nQuiz policies')
async function policyCourse(title, quizPatch, lessonKind = 'ASSESSMENT') {
  const c = await ok('head', '/api/lms/admin/courses', { title })
  const m = (await op('head', 'module.create', { version_id: c.version.id, title: 'x' })).result.id
  let lesson, quiz
  if (lessonKind === 'ASSESSMENT') {
    const l = (await op('head', 'lesson.create', { module_id: m, kind: 'ASSESSMENT', title: 'Test' })).result
    lesson = l.id; quiz = l.quiz_id
  } else {
    const v = await upload('head', 'VIDEO', 'p.mp4', 'video/mp4', crypto.randomBytes(1024), 60)
    lesson = (await op('head', 'lesson.create', { module_id: m, kind: 'VIDEO', title: 'Watch', asset_id: v.id })).result.id
    quiz = (await op('head', 'quiz.attach', { lesson_id: lesson })).result.quiz_id
  }
  await op('head', 'quiz.update', { id: quiz, ...quizPatch })
  for (const p of ['A?', 'B?']) await op('head', 'question.create', { quiz_id: quiz, ...mcq(p) })
  await ok('head', `/api/lms/admin/courses/${c.course.id}`, { action: 'publish' })
  await ok('head', '/api/lms/admin/assignments', { items: [{ course_id: c.course.id }], targets: [{ kind: 'EMPLOYEE', value: emp('sale1') }], due_mode: 'NONE' })
  return { course: c.course.id, lesson, quiz, e: (await enrolOf('sale1', c.course.id)).id }
}
await t('   a timed attempt submitted late scores nothing, and the limit is the server\'s', async () => {
  const x = await policyCourse('Timed', { time_limit_minutes: 5, max_attempts: 2 })
  const a = await quizStart('sale1', x.e, x.lesson)
  assert.ok(a.seconds_left > 280 && a.seconds_left <= 300)
  await sql(`UPDATE lms_quiz_attempts SET expires_at = now() - interval '5 minutes' WHERE id=$1`, [a.attempt_id])
  const r = await quizSubmit('sale1', x.e, a.attempt_id, await key(x.quiz))
  assert.equal(r.late, true); assert.equal(r.passed, false); assert.equal(r.pct, 0)
})
await t('   a timed attempt abandoned on the last try fails the course in the nightly run', async () => {
  const x = await policyCourse('Abandoned', { time_limit_minutes: 5, max_attempts: 1 })
  const a = await quizStart('sale1', x.e, x.lesson)
  await sql(`UPDATE lms_quiz_attempts SET expires_at = now() - interval '5 minutes' WHERE id=$1`, [a.attempt_id])
  await ok(null, '/api/cron/lms-daily')
  assert.equal((await sql(`SELECT status FROM lms_enrollments WHERE id=$1`, [x.e]))[0].status, 'FAILED')
})
await t('   a cooldown holds the next attempt back', async () => {
  const x = await policyCourse('Cooldown', { cooldown_minutes: 60, max_attempts: 3 })
  const a = await quizStart('sale1', x.e, x.lesson)
  await quizSubmit('sale1', x.e, a.attempt_id, wrong(await key(x.quiz)))
  await deny(409, 'sale1', `/api/lms/me/enrollments/${x.e}`, { event: 'quiz_start', lesson_id: x.lesson })
})
await t('   rewatch policy: out of attempts sends you back to the video, and watching restores them', async () => {
  const x = await policyCourse('Rewatch', { max_attempts: 1, on_exhausted: 'REWATCH' }, 'VIDEO')
  await open('sale1', x.e, x.lesson)
  await watch('sale1', x.e, x.lesson, 60, 60)
  const k = await key(x.quiz)
  const a = await quizStart('sale1', x.e, x.lesson)
  const r = await quizSubmit('sale1', x.e, a.attempt_id, wrong(k))
  assert.equal(r.sent_back, true)
  assert.equal((await sql(`SELECT status FROM lms_enrollments WHERE id=$1`, [x.e]))[0].status, 'IN_PROGRESS')
  await deny(409, 'sale1', `/api/lms/me/enrollments/${x.e}`, { event: 'quiz_start', lesson_id: x.lesson })
  await watch('sale1', x.e, x.lesson, 60, 60)
  const b = await quizStart('sale1', x.e, x.lesson)
  assert.equal((await quizSubmit('sale1', x.e, b.attempt_id, k)).passed, true)
})
await t('   a random draw gives each learner their own paper, and only that paper is graded', async () => {
  const x = await policyCourse('Draw', { draw_count: 1, max_attempts: null })
  const a = await quizStart('sale1', x.e, x.lesson)
  assert.equal(a.questions.length, 1)
  const k = await key(x.quiz)
  const r = await quizSubmit('sale1', x.e, a.attempt_id, { [a.questions[0].id]: k[a.questions[0].id] })
  assert.equal(r.pct, 100)
})
await t('   a waived enrolment cannot be submitted to', async () => {
  const x = await policyCourse('Waive', { max_attempts: 3 })
  const a = await quizStart('sale1', x.e, x.lesson)
  await ok('exec', `/api/lms/admin/enrollments/${x.e}`, { action: 'waive', reason: 'Prior experience' })
  await deny(409, 'sale1', `/api/lms/me/enrollments/${x.e}`, { event: 'quiz_submit', attempt_id: a.attempt_id, answers: {} })
})

// ── SCORM packages and live sessions (migration 211) ───────────────────────
/** A real zip: deflated text files, and one stored file so ranges can be checked. */
function zip(files) {
  const parts = [], central = []
  let offset = 0
  for (const f of files) {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8')
    const body = f.store ? raw : zlib.deflateRawSync(raw)
    const name = Buffer.from(f.name, 'utf8')
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(f.store ? 0 : 8, 8)
    h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26)
    parts.push(h, name, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(f.store ? 0 : 8, 10)
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42)
    central.push(c, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}
const MANIFEST = `<?xml version="1.0"?><manifest identifier="m" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"><metadata><schemaversion>1.2</schemaversion></metadata>
<organizations default="o"><organization identifier="o"><title>Privacy practice</title><item identifier="i" identifierref="r"><title>Start</title><adlcp:masteryscore>80</adlcp:masteryscore></item></organization></organizations>
<resources><resource identifier="r" type="webcontent" adlcp:scormtype="sco" href="index.html"/></resources></manifest>`
const CLIP = crypto.randomBytes(200_000)
const scormFile = (path, opened) => fetch(APP + opened.scorm.url.replace(/\/index\.html.*$/, '/') + path, path.startsWith('range:') ? {} : undefined)

console.log('\nSCORM packages')
await t('an author uploads a SCORM 1.2 zip; its manifest is read at upload', async () => {
  const bytes = zip([{ name: 'imsmanifest.xml', data: MANIFEST }, { name: 'index.html', data: '<!doctype html><html><head><title>x</title></head><body>Hello</body></html>' },
    { name: 'assets/style.css', data: 'body{color:red}' }, { name: 'media/clip.bin', data: CLIP, store: true }])
  const a = await upload('mgr', 'SCORM', 'privacy.zip', 'application/x-zip-compressed', bytes)
  assert.equal(a.status, 'READY'); assert.equal(a.scorm.version, '1.2'); assert.equal(a.scorm.launch, 'index.html'); assert.equal(Number(a.scorm.files), 4)
  const r = await ok('mgr', '/api/lms/admin/courses', { title: 'Privacy SCORM' })
  S.sc = { course: r.course.id, version: r.version.id }
  const m = (await op('mgr', 'module.create', { version_id: r.version.id, title: 'Practice' })).result.id
  S.sc.lesson = (await op('mgr', 'lesson.create', { module_id: m, kind: 'SCORM', title: 'Privacy practice', asset_id: a.id })).result.id
  await ok('head', `/api/lms/admin/courses/${S.sc.course}`, { action: 'publish' })
  await ok('exec', '/api/lms/admin/assignments', { items: [{ course_id: S.sc.course }], targets: [{ kind: 'EMPLOYEE', value: emp('dev1') }], due_mode: 'NONE' })
  S.sc.e = (await enrolOf('dev1', S.sc.course)).id
})
await t('a zip with no imsmanifest.xml is refused in plain words, and marked failed', async () => {
  const bytes = zip([{ name: 'index.html', data: 'x' }])
  const b = await ok('mgr', '/api/lms/admin/assets', { kind: 'SCORM', name: 'notscorm.zip', mime: 'application/zip', size: bytes.length })
  const meta = `bucketName ${Buffer.from(b.bucket).toString('base64')},objectName ${Buffer.from(b.path).toString('base64')},contentType ${Buffer.from('application/zip').toString('base64')}`
  const c = await fetch(b.tus_endpoint, { method: 'POST', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(bytes.length), 'Upload-Metadata': meta, 'x-signature': b.token } })
  await fetch(c.headers.get('location'), { method: 'PATCH', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' }, body: bytes })
  const r = await deny(400, 'mgr', '/api/lms/admin/assets', { asset_id: b.asset_id }, 'PATCH')
  assert.match(r.error, /imsmanifest\.xml/)
  assert.equal((await sql(`SELECT status FROM lms_assets WHERE id=$1`, [b.asset_id]))[0].status, 'FAILED')
})
await t('the learner opens the package: each page carries the SCORM API and who they are', async () => {
  const o = await open('dev1', S.sc.e, S.sc.lesson)
  S.sc.opened = o
  assert.match(o.scorm.url, /^\/learn-scorm\/[^/]+\/index\.html$/)
  const page = await fetch(APP + o.scorm.url)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /window\.API=/); assert.match(html, /window\.API_1484_11=/)
  assert.match(html, /"cmi.core.student_name":"One, Dev"/)
  assert.ok(html.indexOf('window.API=') < html.indexOf('<title>'), 'the API comes before the page\'s own scripts')
  assert.equal(page.headers.get('access-control-allow-origin'), '*')
  const css = await scormFile('assets/style.css', o)
  assert.match(css.headers.get('content-type'), /text\/css/); assert.equal(await css.text(), 'body{color:red}')
})
await t('stored media in a package seeks with ranges; nothing outside it is served; a forged link is refused', async () => {
  const o = S.sc.opened
  const base = APP + o.scorm.url.replace(/index\.html$/, '')
  const r = await fetch(base + 'media/clip.bin', { headers: { Range: 'bytes=1000-1999' } })
  assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes 1000-1999/${CLIP.length}`)
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(CLIP.subarray(1000, 2000)))
  assert.equal((await fetch(base + '..%2F..%2Fimsmanifest.xml')).status, 404)
  const [, , tok] = o.scorm.url.split('/')
  const forged = tok.slice(0, -2) + (tok.endsWith('AA') ? 'BB' : 'AA')
  assert.equal((await fetch(`${APP}/learn-scorm/${forged}/index.html`)).status, 403)
})
await t('a commit saves progress; reopening resumes where the learner was', async () => {
  const r = await ok('dev1', `/api/lms/me/enrollments/${S.sc.e}`, { event: 'scorm', lesson_id: S.sc.lesson, launch: 'L1', session: 120, cmi: { 'cmi.core.lesson_status': 'incomplete', 'cmi.core.lesson_location': 'page-3', 'cmi.suspend_data': 'abc', 'cmi.core.student_name': 'Forged' } })
  assert.equal(r.content_done, false); assert.equal(r.label, 'In progress')
  const html = await (await fetch(APP + S.sc.opened.scorm.url)).text()
  assert.match(html, /"cmi.core.entry":"resume"/); assert.match(html, /"cmi.core.lesson_location":"page-3"/)
  assert.match(html, /"cmi.core.student_name":"One, Dev"/, 'the package cannot rename the learner')
  assert.match(html, /"cmi.core.total_time":"0000:02:00"/)
})
await t('a 1.2 score under the mastery score does not finish it; a pass does, and the course completes', async () => {
  const send = cmi => ok('dev1', `/api/lms/me/enrollments/${S.sc.e}`, { event: 'scorm', lesson_id: S.sc.lesson, launch: 'L2', session: 60, cmi })
  const f = await send({ 'cmi.core.lesson_status': 'completed', 'cmi.core.score.raw': '60' })
  assert.equal(f.content_done, false); assert.equal(f.label, 'Not passed')
  const p = await send({ 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '90' })
  assert.equal(p.content_done, true); assert.equal(p.score_pct, 90)
  assert.equal((await enrolOf('dev1', S.sc.course)).status, 'COMPLETED')
  await deny(409, 'dev1', `/api/lms/me/enrollments/${S.sc.e}`, { event: 'scorm_reset', lesson_id: S.sc.lesson })
})
await t('nobody else can write to a learner\'s package, and Mark complete cannot shortcut it', async () => {
  await deny(404, 'dev2', `/api/lms/me/enrollments/${S.sc.e}`, { event: 'scorm', lesson_id: S.sc.lesson, cmi: { 'cmi.core.lesson_status': 'failed' } })
  await ok('exec', '/api/lms/admin/assignments', { items: [{ course_id: S.sc.course }], targets: [{ kind: 'EMPLOYEE', value: emp('dev2') }], due_mode: 'NONE' })
  const e2 = (await enrolOf('dev2', S.sc.course)).id
  await open('dev2', e2, S.sc.lesson)
  const r = await deny(400, 'dev2', `/api/lms/me/enrollments/${e2}`, { event: 'mark', lesson_id: S.sc.lesson, done: true })
  assert.match(r.error, /completes on its own/)
})

console.log('\nLive sessions')
const at = (min) => new Date(Date.now() + min * 60_000).toISOString()
await t('HR schedules a webinar for a course and invites two people; both are on the register', async () => {
  const r = await ok('mgr', '/api/lms/admin/courses', { title: 'Privacy live' })
  S.lv = { course: r.course.id }
  const m = (await op('mgr', 'module.create', { version_id: r.version.id, title: 'Live' })).result.id
  S.lv.lesson = (await op('mgr', 'lesson.create', { module_id: m, kind: 'LIVE', title: 'Q&A' })).result.id
  await ok('head', `/api/lms/admin/courses/${S.lv.course}`, { action: 'publish' })
  await ok('exec', '/api/lms/admin/assignments', { items: [{ course_id: S.lv.course }], targets: ['dev1', 'dev2', 'sale1'].map(k => ({ kind: 'EMPLOYEE', value: emp(k) })), due_mode: 'NONE' })
  const s = await ok('exec', '/api/lms/admin/sessions', { title: 'DPDP Q&A', starts_at: at(2 * 24 * 60), duration_min: 60, join_url: 'https://meet.google.com/abc-defg-hij', course_id: S.lv.course, targets: [{ kind: 'EMPLOYEE', value: emp('dev1') }, { kind: 'EMPLOYEE', value: emp('dev2') }] })
  S.lv.s = s.session.id
  assert.equal(s.invited.invited, 2)
  assert.match(s.session.checkin_code, /^[A-Z2-9]{6}$/)
  const d = await ok('exec', `/api/lms/admin/sessions/${S.lv.s}`)
  assert.equal(d.attendees.length, 2)
  assert.ok((await sql(`SELECT 1 FROM ess_notifications WHERE employee_id=$1 AND notification_code='LMS_ASSIGNED' AND link LIKE '/learning/live/%'`, [emp('dev1')])).length, 'bell with a link to the session')
})
await t('a meeting link that is not https is refused; an uninvited person cannot see a closed session', async () => {
  const r = await deny(400, 'exec', '/api/lms/admin/sessions', { title: 'Bad', starts_at: at(60), join_url: 'javascript:alert(1)' })
  assert.match(r.error, /https/)
  await deny(404, 'sale1', `/api/lms/me/sessions/${S.lv.s}`)
  await deny(404, 'bdev', `/api/lms/me/sessions/${S.lv.s}`)
})
await t('the invitee sees it, registers, and gets a calendar file; Join is shut until 15 minutes before', async () => {
  const mine = await ok('dev1', '/api/lms/me/sessions')
  const s = mine.upcoming.find(x => x.id === S.lv.s)
  assert.equal(s.me.invited, true); assert.equal(s.can_join, false); assert.equal(s.has_link, true)
  assert.equal(JSON.stringify(mine).includes('meet.google.com'), false, 'the link is not handed out early')
  await deny(409, 'dev1', `/api/lms/me/sessions/${S.lv.s}`, { event: 'join' })
  await ok('dev1', `/api/lms/me/sessions/${S.lv.s}`, { event: 'register' })
  const ics = await call('dev1', `/api/lms/me/sessions/${S.lv.s}?ics=1`)
  assert.match(ics.ct, /text\/calendar/)
  const text = ics.data.toString()
  assert.match(text, /BEGIN:VCALENDAR/); assert.match(text, new RegExp(`UID:${S.lv.s}@ezer-learn`)); assert.match(text, /ATTENDEE;CN=Dev One/)
})
await t('seats run out: the last seat goes, the next person is told', async () => {
  const s = await ok('exec', '/api/lms/admin/sessions', { title: 'Small room', starts_at: at(3000), duration_min: 30, location: 'Room 4', capacity: 1, open_registration: true })
  await ok('sale1', `/api/lms/me/sessions/${s.session.id}`, { event: 'register' })
  const r = await deny(409, 'dev2', `/api/lms/me/sessions/${s.session.id}`, { event: 'register' })
  assert.match(r.error, /seat/)
  await deny(404, 'bdev', `/api/lms/me/sessions/${s.session.id}`)
})
await t('changing the time sends the updated invitation (sequence goes up)', async () => {
  const r = await ok('exec', `/api/lms/admin/sessions/${S.lv.s}`, { starts_at: at(2 * 24 * 60 + 30) }, 'PATCH')
  assert.equal(r.session.sequence, 1)
})
await t('live: Join hands out the link and is noted; the attendance code completes the course\'s live lesson', async () => {
  await sql(`UPDATE lms_sessions SET starts_at = now() - interval '5 minutes' WHERE id=$1`, [S.lv.s])
  const j = await ok('dev1', `/api/lms/me/sessions/${S.lv.s}`, { event: 'join' })
  assert.equal(j.url, 'https://meet.google.com/abc-defg-hij')
  await deny(400, 'dev1', `/api/lms/me/sessions/${S.lv.s}`, { event: 'checkin', code: 'WRONG1' })
  const code = (await sql(`SELECT checkin_code FROM lms_sessions WHERE id=$1`, [S.lv.s]))[0].checkin_code
  await ok('dev1', `/api/lms/me/sessions/${S.lv.s}`, { event: 'checkin', code: code.toLowerCase() })
  const row = (await sql(`SELECT a.attended, a.attendance_by, a.joined_at FROM lms_session_attendees a JOIN lms_learners l ON l.id=a.learner_id WHERE a.session_id=$1 AND l.employee_id=$2`, [S.lv.s, emp('dev1')]))[0]
  assert.equal(row.attended, true); assert.equal(row.attendance_by, 'CODE'); assert.ok(row.joined_at)
  assert.equal((await enrolOf('dev1', S.lv.course)).status, 'COMPLETED')
})
await t('the host ticks attendance; someone uninvited who never came cannot check in', async () => {
  const dev2 = (await sql(`SELECT id FROM lms_learners WHERE employee_id=$1`, [emp('dev2')]))[0].id
  await ok('exec', `/api/lms/admin/sessions/${S.lv.s}`, { action: 'attendance', learners: [dev2], attended: true })
  assert.equal((await enrolOf('dev2', S.lv.course)).status, 'COMPLETED')
  await deny(404, 'sale1', `/api/lms/me/sessions/${S.lv.s}`, { event: 'checkin', code: 'ABCDEF' })
})
await t('the recording counts instead of attending, but only as fast as the clock allows', async () => {
  const vid = await upload('exec', 'VIDEO', 'recording.mp4', 'video/mp4', crypto.randomBytes(2048), 120, 'recording')
  await deny(403, 'exec', '/api/lms/admin/assets', { kind: 'DOCUMENT', name: 'x.pdf', mime: 'application/pdf', size: 10, purpose: 'recording' })
  await ok('exec', `/api/lms/admin/sessions/${S.lv.s}`, { action: 'recording', asset_id: vid.id })
  await ok('exec', `/api/lms/admin/sessions/${S.lv.s}`, { action: 'complete' })
  // sale1 is enrolled on the course but was never invited: an open session's recording would be
  // theirs to watch; this one is closed, so add them as a self sign-up first.
  await sql(`UPDATE lms_sessions SET open_registration = true WHERE id=$1`, [S.lv.s])
  const rec = await ok('sale1', `/api/lms/me/sessions/${S.lv.s}`, { event: 'recording' })
  assert.ok(rec.url); assert.equal(rec.duration_s, 120)
  const greedy = await ok('sale1', `/api/lms/me/sessions/${S.lv.s}`, { event: 'beat', played_s: 600, position: 110 })
  assert.ok(greedy.watched_s < 20, `credited ${greedy.watched_s}`); assert.equal(greedy.done, false)
  await sql(`UPDATE lms_session_attendees SET recording_last_beat_at = now() - interval '2 minutes' WHERE session_id=$1 AND learner_id=(SELECT id FROM lms_learners WHERE employee_id=$2)`, [S.lv.s, emp('sale1')])
  const fair = await ok('sale1', `/api/lms/me/sessions/${S.lv.s}`, { event: 'beat', played_s: 110, position: 120 })
  assert.equal(fair.done, true)
  assert.equal((await enrolOf('sale1', S.lv.course)).status, 'COMPLETED')
})
await t('the daily job runs the live-session mail without error; a cancelled session shuts Join', async () => {
  const d = await ok(null, '/api/cron/lms-daily')
  const live = d.result?.live || d.live || d
  assert.ok(!live.skipped, JSON.stringify(live).slice(0, 200))
  const s = await ok('exec', '/api/lms/admin/sessions', { title: 'To cancel', starts_at: at(-5), duration_min: 60, join_url: 'https://zoom.us/j/1', targets: [{ kind: 'EMPLOYEE', value: emp('dev1') }] })
  const c = await ok('exec', `/api/lms/admin/sessions/${s.session.id}`, { action: 'cancel', reason: 'Speaker unwell' })
  assert.equal(c.session.status, 'CANCELLED'); assert.equal(c.session.sequence, 1)
  await deny(409, 'dev1', `/api/lms/me/sessions/${s.session.id}`, { event: 'join' })
})
await t('another company\'s HR cannot open or change this company\'s session', async () => {
  await deny(404, 'bhead', `/api/lms/admin/sessions/${S.lv.s}`)
  await deny(404, 'bhead', `/api/lms/admin/sessions/${S.lv.s}`, { action: 'complete' })
})

console.log('\nThe webinar room')
const room = id => `/api/lms/room/${id}`
const broadcasts = async () => { const r = await fetch(`${RIG}/__rig/broadcasts`, { headers: { apikey: 'rig-service-key' } }); return r.json() }
const learnerId = async k => (await sql(`SELECT id FROM lms_learners WHERE employee_id=$1 AND company_id=$2`, [emp(k), co(k.startsWith('b') ? 'beta' : 'acme')]))[0]?.id
const rowOf = async (sid, k) => (await sql(`SELECT a.* FROM lms_session_attendees a JOIN lms_learners l ON l.id=a.learner_id WHERE a.session_id=$1 AND l.employee_id=$2`, [sid, emp(k)]))[0]
await t('HR streams a session in EZER Learn: the YouTube address is checked, the room is on', async () => {
  const r = await ok('mgr', '/api/lms/admin/courses', { title: 'Room live' })
  S.rm = { course: r.course.id }
  const m = (await op('mgr', 'module.create', { version_id: r.version.id, title: 'Live' })).result.id
  await op('mgr', 'lesson.create', { module_id: m, kind: 'LIVE', title: 'Town hall' })
  await ok('head', `/api/lms/admin/courses/${S.rm.course}`, { action: 'publish' })
  await ok('exec', '/api/lms/admin/assignments', { items: [{ course_id: S.rm.course }], targets: ['dev1', 'dev3'].map(k => ({ kind: 'EMPLOYEE', value: emp(k) })), due_mode: 'NONE' })
  const bad = await deny(400, 'exec', '/api/lms/admin/sessions', { title: 'Bad stream', starts_at: at(-5), duration_min: 60, stream_kind: 'YOUTUBE', stream_url: 'https://example.com/watch?v=dQw4w9WgXcQ' })
  assert.match(bad.error, /YouTube/)
  const s = await ok('exec', '/api/lms/admin/sessions', { title: 'All-hands stream', starts_at: at(-5), duration_min: 60, stream_kind: 'YOUTUBE', stream_url: 'https://youtu.be/dQw4w9WgXcQ', room_attend_pct: 10, course_id: S.rm.course, targets: ['dev1', 'dev3'].map(k => ({ kind: 'EMPLOYEE', value: emp(k) })) })
  S.rm.s = s.session.id
  const d = await ok('exec', `/api/lms/admin/sessions/${S.rm.s}`)
  assert.equal(d.session.stream_kind, 'YOUTUBE'); assert.equal(d.session.room_ready, true); assert.equal(d.session.room_attend_pct, 10)
  assert.equal((await ok('exec', '/api/lms/admin/sessions')).room_ready, true)
  const mine = (await ok('dev1', '/api/lms/me/sessions')).upcoming.find(x => x.id === S.rm.s)
  assert.equal(mine.room_enabled, true); assert.equal(mine.stream, 'YOUTUBE')
})
await t('an invitee enters the room and sees the stream; nobody else gets in, nor another company', async () => {
  const r = await ok('dev1', room(S.rm.s))
  assert.match(r.stage.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/)
  assert.equal(r.session.phase, 'live'); assert.equal(r.me.host, false); assert.match(r.topic, /^room-[\w-]{32}$/)
  assert.equal(r.host_join_url, null); assert.equal(r.checkin_code, null)
  S.rm.topic = r.topic
  await deny(404, 'sale1', room(S.rm.s))
  await deny(404, 'bdev', room(S.rm.s))
  await deny(404, 'bhead', room(S.rm.s))
  await deny(404, 'bhead', room(S.rm.s), { action: 'go_live' })
  await deny(401, null, room(S.rm.s))
  const h = await ok('exec', room(S.rm.s))
  assert.equal(h.me.host, true); assert.equal(h.topic, S.rm.topic); assert.match(h.checkin_code, /^[A-Z2-9]{6}$/)
})
await t('chat: a line goes out on the room\'s channel without who wrote it; too fast, empty or too long is refused', async () => {
  const before = (await broadcasts()).length
  const m = await ok('dev1', room(S.rm.s), { action: 'chat', body: '  Hello everyone  ' })
  assert.equal(m.message.body, 'Hello everyone'); assert.equal(m.message.mine, true)
  S.rm.chat = m.message.id
  const sent = (await broadcasts()).slice(before)
  assert.equal(sent.length, 1); assert.equal(sent[0].topic, S.rm.topic); assert.equal(sent[0].event, 'msg')
  assert.equal(sent[0].payload.id, S.rm.chat); assert.equal(sent[0].payload.learner_id, undefined); assert.equal(sent[0].payload.mine, false)
  const fast = await deny(429, 'dev1', room(S.rm.s), { action: 'chat', body: 'again' })
  assert.match(fast.error, /two seconds/)
  await new Promise(r => setTimeout(r, 2100))
  await deny(400, 'dev1', room(S.rm.s), { action: 'chat', body: '   ' })
  await deny(400, 'dev1', room(S.rm.s), { action: 'chat', body: 'x'.repeat(501) })
  const seen = await ok('dev3', room(S.rm.s))
  const line = seen.chat.find(x => x.id === S.rm.chat)
  assert.equal(line.author, 'Dev One'); assert.equal(line.mine, false)
  // A host's line on a server that has not seen them yet: the browser says it is hosting.
  const h = await ok('exec', room(S.rm.s), { action: 'chat', body: 'Welcome, everyone', as_host: true })
  assert.equal(h.message.is_host, true)
  await deny(404, 'sale1', room(S.rm.s), { action: 'chat', body: 'let me in', as_host: true })
})
await t('questions: an anonymous one hides its asker from everyone but the host; one upvote per person', async () => {
  const q = await ok('dev3', room(S.rm.s), { action: 'ask', body: 'Will the deck be shared?', anonymous: true })
  S.rm.q = q.message.id
  assert.equal((await ok('dev1', room(S.rm.s))).questions.find(x => x.id === S.rm.q).author, 'Anonymous')
  assert.equal((await ok('exec', room(S.rm.s))).questions.find(x => x.id === S.rm.q).author, 'Dev Three')
  const sent = (await broadcasts()).filter(b => b.payload?.id === S.rm.q)
  assert.ok(sent.length && sent.every(b => b.payload.author === 'Anonymous'), 'the broadcast never names an anonymous asker')
  assert.equal((await ok('dev1', room(S.rm.s), { action: 'vote', message_id: S.rm.q })).upvotes, 1)
  assert.equal((await ok('dev1', room(S.rm.s), { action: 'vote', message_id: S.rm.q })).upvotes, 1, 'a second press does not add a vote')
  assert.equal((await ok('dev3', room(S.rm.s), { action: 'vote', message_id: S.rm.q })).upvotes, 2)
  assert.equal((await ok('dev1', room(S.rm.s), { action: 'vote', message_id: S.rm.q, on: false })).upvotes, 1)
  assert.deepEqual((await ok('dev3', room(S.rm.s))).my_votes, [S.rm.q])
  const fast = await deny(429, 'dev3', room(S.rm.s), { action: 'ask', body: 'And the recording?' })
  assert.match(fast.error, /ten seconds/)
})
await t('only the host runs the room: learners are refused every host action', async () => {
  for (const body of [{ action: 'go_live' }, { action: 'end' }, { action: 'hide', message_id: S.rm.chat }, { action: 'pin', message_id: S.rm.q },
    { action: 'answer', message_id: S.rm.q }, { action: 'settings', room_chat: false }, { action: 'poll', question: 'Q?', options: ['a', 'b'] }])
    await deny(403, 'dev1', room(S.rm.s), body)
})
await t('the host answers, pins and hides; a hidden line leaves everyone\'s screen but the host\'s', async () => {
  const a = await ok('exec', room(S.rm.s), { action: 'answer', message_id: S.rm.q, answer: 'Yes, after the session.' })
  assert.ok(a.message.answered_at); assert.equal(a.message.answer, 'Yes, after the session.')
  await ok('exec', room(S.rm.s), { action: 'pin', message_id: S.rm.q })
  assert.equal((await ok('dev1', room(S.rm.s))).pinned.id, S.rm.q)
  await ok('exec', room(S.rm.s), { action: 'hide', message_id: S.rm.chat })
  assert.equal((await ok('dev3', room(S.rm.s))).chat.some(x => x.id === S.rm.chat), false)
  assert.equal((await ok('exec', room(S.rm.s))).chat.find(x => x.id === S.rm.chat).hidden, true)
  assert.ok((await broadcasts()).some(b => b.event === 'hide' && b.payload.id === S.rm.chat))
  await ok('exec', room(S.rm.s), { action: 'settings', room_chat: false })
  await deny(409, 'dev1', room(S.rm.s), { action: 'chat', body: 'chat is off' })
  await ok('exec', room(S.rm.s), { action: 'settings', room_chat: true })
})
await t('polls: each person answers once, results follow; a closed poll takes no answers', async () => {
  await deny(400, 'exec', room(S.rm.s), { action: 'poll', question: 'One answer?', options: ['Only'] })
  const p = (await ok('exec', room(S.rm.s), { action: 'poll', question: 'Was this useful?', options: ['Yes', 'No', 'Not sure'] })).poll
  assert.ok((await broadcasts()).some(b => b.event === 'poll' && b.payload.id === p.id))
  const before = (await ok('dev1', room(S.rm.s))).polls.find(x => x.id === p.id)
  assert.equal(before.counts, null, 'no results before answering'); assert.equal(before.my_vote, null)
  const v = await ok('dev1', room(S.rm.s), { action: 'poll_vote', poll_id: p.id, option: 0 })
  assert.deepEqual(v.poll.counts, [1, 0, 0]); assert.equal(v.poll.my_vote, 0)
  await deny(409, 'dev1', room(S.rm.s), { action: 'poll_vote', poll_id: p.id, option: 1 })
  await deny(400, 'dev3', room(S.rm.s), { action: 'poll_vote', poll_id: p.id, option: 9 })
  await ok('dev3', room(S.rm.s), { action: 'poll_vote', poll_id: p.id, option: 2 })
  assert.deepEqual((await ok('exec', room(S.rm.s))).polls.find(x => x.id === p.id).counts, [1, 0, 1])
  const p2 = (await ok('exec', room(S.rm.s), { action: 'poll', question: 'Closed already?', options: ['A', 'B'] })).poll
  await ok('exec', room(S.rm.s), { action: 'poll_close', poll_id: p2.id })
  await deny(409, 'dev1', room(S.rm.s), { action: 'poll_vote', poll_id: p2.id, option: 0 })
  assert.equal((await sql(`SELECT count(*)::int n FROM lms_session_poll_votes WHERE poll_id=$1`, [p.id]))[0].n, 2)
})
await t('time in the room: the server clock counts, a sleeping laptop earns a minute, enough of it is attendance', async () => {
  const first = await ok('dev3', room(S.rm.s), { action: 'beat' })
  assert.equal(first.need_s, 360); assert.equal(first.attended, false)
  const row = await rowOf(S.rm.s, 'dev3')
  assert.ok(row.room_last_beat_at); assert.equal(row.status, 'REGISTERED', 'entering the room is joining'); assert.ok(row.joined_at)
  const base = Number(row.room_seconds)
  await sql(`UPDATE lms_session_attendees SET room_last_beat_at = now() - interval '2 hours' WHERE id=$1`, [row.id])
  const slept = await ok('dev3', room(S.rm.s), { action: 'beat' })
  assert.ok(Math.abs(slept.room_seconds - base - 60) < 1.5, `credited ${slept.room_seconds - base}`)
  assert.equal((await enrolOf('dev3', S.rm.course)).status !== 'COMPLETED', true)
  let last = slept
  for (let i = 0; i < 6 && !last.attended; i++) {
    await sql(`UPDATE lms_session_attendees SET room_last_beat_at = now() - interval '60 seconds' WHERE id=$1`, [row.id])
    last = await ok('dev3', room(S.rm.s), { action: 'beat' })
  }
  assert.equal(last.attended, true)
  const done = await rowOf(S.rm.s, 'dev3')
  assert.equal(done.attended, true); assert.equal(done.attendance_by, 'ROOM')
  assert.equal((await enrolOf('dev3', S.rm.course)).status, 'COMPLETED', 'the course\'s live lesson is done')
  assert.ok(last.viewers >= 1)
})
await t('a host\'s tick is never replaced by time in the room; nothing counts before the room opens', async () => {
  const dev1 = await learnerId('dev1')
  await ok('exec', `/api/lms/admin/sessions/${S.rm.s}`, { action: 'attendance', learners: [dev1], attended: true })
  await ok('dev1', room(S.rm.s), { action: 'beat' })
  for (let i = 0; i < 7; i++) {
    await sql(`UPDATE lms_session_attendees SET room_last_beat_at = now() - interval '60 seconds' WHERE session_id=$1 AND learner_id=$2`, [S.rm.s, dev1])
    await ok('dev1', room(S.rm.s), { action: 'beat' })
  }
  assert.equal((await rowOf(S.rm.s, 'dev1')).attendance_by, 'HOST')
  const later = await ok('exec', '/api/lms/admin/sessions', { title: 'Next week', starts_at: at(7 * 24 * 60), duration_min: 30, stream_kind: 'HLS', stream_url: 'https://cdn.example.com/live/index.m3u8', open_registration: true })
  S.rm.later = later.session.id
  const r = await ok('sale2', room(S.rm.later))
  assert.equal(r.session.phase, 'before'); assert.equal(r.stage.kind, 'HLS')
  await ok('sale2', room(S.rm.later), { action: 'beat' })
  const row = await rowOf(S.rm.later, 'sale2')
  assert.equal(row.status, 'REGISTERED'); assert.equal(row.source, 'SELF'); assert.equal(row.joined_at, null)
  await sql(`UPDATE lms_session_attendees SET room_last_beat_at = now() - interval '60 seconds' WHERE id=$1`, [row.id])
  assert.equal((await ok('sale2', room(S.rm.later), { action: 'beat' })).room_seconds, 0)
  await deny(404, 'bdev', room(S.rm.later))
})
await t('Go live opens the room early, End closes it, and time stops counting', async () => {
  const g = await ok('exec', room(S.rm.later), { action: 'go_live' })
  assert.equal(g.session.phase, 'live')
  assert.equal((await ok('sale2', room(S.rm.later))).session.phase, 'live')
  assert.ok((await broadcasts()).some(b => b.event === 'state' && b.payload.phase === 'live'))
  await sql(`UPDATE lms_session_attendees SET room_last_beat_at = now() - interval '60 seconds' WHERE session_id=$1`, [S.rm.later])
  assert.ok((await ok('sale2', room(S.rm.later), { action: 'beat' })).room_seconds >= 59)
  const e = await ok('exec', room(S.rm.later), { action: 'end' })
  assert.equal(e.session.phase, 'ended')
  const before = Number((await rowOf(S.rm.later, 'sale2')).room_seconds)
  await sql(`UPDATE lms_session_attendees SET room_last_beat_at = now() - interval '60 seconds' WHERE session_id=$1`, [S.rm.later])
  assert.equal((await ok('sale2', room(S.rm.later), { action: 'beat' })).room_seconds, before)
})
await t('a meeting\'s room never hands learners the link; a session without a room keeps learners out', async () => {
  const s = await ok('exec', '/api/lms/admin/sessions', { title: 'Zoom with a room', starts_at: at(-2), duration_min: 30, join_url: 'https://zoom.us/j/999', stream_kind: 'MEETING', targets: [{ kind: 'EMPLOYEE', value: emp('dev2') }] })
  const r = await ok('dev2', room(s.session.id))
  assert.equal(r.stage, null); assert.equal(r.session.has_link, true)
  assert.equal(JSON.stringify(r).includes('zoom.us'), false, 'the link only comes through Join')
  assert.equal((await ok('exec', room(s.session.id))).host_join_url, 'https://zoom.us/j/999')
  await ok('exec', `/api/lms/admin/sessions/${s.session.id}`, { room_enabled: false }, 'PATCH')
  await deny(409, 'dev2', room(s.session.id))
  await ok('exec', room(s.session.id))
  await deny(400, 'exec', `/api/lms/admin/sessions/${s.session.id}`, { stream_kind: 'VIMEO', stream_url: 'https://vimeo.com/channels/x' }, 'PATCH')
  await ok('exec', `/api/lms/admin/sessions/${s.session.id}`, { stream_kind: 'VIMEO', stream_url: 'https://vimeo.com/76979871' }, 'PATCH')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.log('Failed:\n - ' + failures.join('\n - ')); process.exit(1) }
