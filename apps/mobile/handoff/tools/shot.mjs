// node shot.mjs <script.json>  — drives the Expo web build in a phone-sized Chrome.
// Steps: {go:url} {fill:[selectorText,value]} {tap:text} {wait:ms} {shot:name} {eval:js}
import { chromium } from 'playwright-core'
import { readFileSync, mkdirSync } from 'node:fs'
const steps = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const OUT = new URL('./shots/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true })
const ctx = await chromium.launchPersistentContext(new URL('./profile/', import.meta.url).pathname, {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--disable-web-security', '--disable-site-isolation-trials'],
  viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
})
const page = ctx.pages()[0] || await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)) })
page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`) })
for (const s of steps) {
  try {
    if (s.go) await page.goto(s.go, { waitUntil: 'domcontentloaded' })
    if (s.fill) { const el = page.getByPlaceholder(s.fill[0]).first(); await el.click(); await el.fill(s.fill[1]) }
    if (s.tap) await page.getByText(s.tap, { exact: !!s.exact }).first().click({ timeout: 15000 })
    if (s.tapLabel) await page.getByLabel(s.tapLabel).first().click({ timeout: 15000 })
    if (s.waitText) await page.getByText(s.waitText).first().waitFor({ timeout: s.timeout || 30000 })
    if (s.wait) await page.waitForTimeout(s.wait)
    if (s.eval) console.log('eval:', JSON.stringify(await page.evaluate(s.eval)))
    if (s.scroll) await page.mouse.wheel(0, s.scroll)
    if (s.shot) { await page.screenshot({ path: OUT + s.shot + '.png' }); console.log('shot', s.shot) }
  } catch (e) { console.log('STEP FAILED', JSON.stringify(s), String(e.message).split('\n')[0]); break }
}
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no errors')
await ctx.close()
