import { chromium } from 'playwright-core'
const OUT = process.argv[2]
const defs = `<defs>
<linearGradient id="disc" x1="26" y1="18" x2="104" y2="112" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7DD3FC"/><stop offset=".38" stop-color="#38BDF8"/><stop offset=".72" stop-color="#2563EB"/><stop offset="1" stop-color="#1E3A8A"/></linearGradient>
<radialGradient id="spec" cx="42" cy="34" r="42" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".72"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="ring" x1="8" y1="40" x2="120" y2="92" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#BAE6FD" stop-opacity=".15"/><stop offset=".28" stop-color="#7DD3FC" stop-opacity=".95"/><stop offset=".62" stop-color="#38BDF8" stop-opacity=".85"/><stop offset="1" stop-color="#2563EB" stop-opacity=".18"/></linearGradient>
<linearGradient id="people" x1="40" y1="6" x2="88" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#E0F2FE"/><stop offset="1" stop-color="#7DD3FC"/></linearGradient>
<linearGradient id="bar" x1="44" y1="48" x2="92" y2="88" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#DBEAFE"/></linearGradient></defs>`
const E = (f) => `<rect x="49" y="49" width="9" height="34" rx="4.5" fill="${f}"/><rect x="49" y="49" width="32" height="9" rx="4.5" fill="${f}"/><rect x="49" y="60.5" width="24" height="8" rx="4" fill="${f}"/><rect x="49" y="74" width="32" height="9" rx="4.5" fill="${f}"/>`
const P = (f) => `<g fill="${f}"><circle cx="44" cy="24" r="6"/><path d="M34 39c0-5.5 4.5-9 10-9s10 3.5 10 9z"/><circle cx="64" cy="17" r="7.5"/><path d="M52 34c0-6.6 5.4-11 12-11s12 4.4 12 11z"/><circle cx="84" cy="24" r="6"/><path d="M74 39c0-5.5 4.5-9 10-9s10 3.5 10 9z"/></g>`
const color = `${defs}<circle cx="64" cy="66" r="46" fill="rgba(37,99,235,.18)"/>
<circle cx="64" cy="66" r="35.2" fill="none" stroke="#1D4ED8" stroke-opacity=".55" stroke-width="2.2"/><circle cx="64" cy="66" r="34" fill="url(#disc)"/><circle cx="64" cy="66" r="34" fill="url(#spec)"/>
<circle cx="64" cy="66" r="33" fill="none" stroke="#BAE6FD" stroke-opacity=".45" stroke-width="1.4" stroke-dasharray="60 150" stroke-dashoffset="-96" stroke-linecap="round"/>
<g transform="translate(0,1)" opacity=".22">${E('#0C2A6B')}</g>${E('url(#bar)')}${P('url(#people)')}
<ellipse cx="64" cy="66" rx="58" ry="23" transform="rotate(-24 64 66)" fill="none" stroke="url(#ring)" stroke-width="5" stroke-linecap="round"/>`
// Monochrome: Android tints it; it needs one solid silhouette with the E cut out.
const mono = `<defs><mask id="m"><rect x="0" y="0" width="128" height="128" fill="#fff"/>${E('#000')}</mask></defs>
<circle cx="64" cy="66" r="34" fill="#000" mask="url(#m)"/>${P('#000')}
<ellipse cx="64" cy="66" rx="58" ry="23" transform="rotate(-24 64 66)" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round"/>`
const svg = (inner, scale, bg) => `<html><body style="margin:0;background:${bg||'transparent'}"><svg width="1024" height="1024" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
<g transform="translate(64 62) scale(${scale}) translate(-64 -62)">${inner}</g></svg></body></html>`
const jobs = [
  ['icon.png', svg(color, 0.92, 'linear-gradient(145deg,#FFFFFF,#EAF1FC)'), false],
  ['android-icon-foreground.png', svg(color, 0.6), true],
  ['android-icon-monochrome.png', svg(mono, 0.6), true],
  ['splash-icon.png', svg(color, 0.95), true],
  ['favicon.png', svg(color, 0.95), true],
]
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
for (const [name, html, transparent] of jobs) {
  await page.setContent(html)
  await page.screenshot({ path: `${OUT}/${name}`, omitBackground: transparent })
}
await browser.close()
console.log('rendered', jobs.length)
