import { connect, setInput, clickByText } from '/private/tmp/claude-501/-Users-tusharpanwar-Desktop-projects-HRMS-ezer-hrms-main/1675afd4-abf8-45c3-8aff-86a1658e099d/scratchpad/cdp.mjs'
let pass=0,fail=0
const ok=m=>{pass++;console.log('  ✅',m)}, no=m=>{fail++;console.log('  ❌',m)}, nb=m=>console.log('     ',m)
const P = await connect()
const NEWPW = 'Ezer@Test2026'

console.log('══ 1. /ess-login RENDERS ══\n')
await P.goto('http://localhost:3000/ess-login')
let t = await P.text()
t.length > 40 ? ok(`page rendered (${t.length} chars)`) : no('page is blank — client render failed')
nb('   ' + t.split('\n').filter(Boolean).slice(0,3).join(' | ').slice(0,90))
const inputs = await P.evaluate(`[...document.querySelectorAll('input')].map(i=>i.type+':'+(i.placeholder||i.name||'')).join(', ')`)
nb('   inputs: ' + inputs)

console.log('\n══ 2. SIGN IN AS SRS9006 ══\n')
const ids = await P.evaluate(`[...document.querySelectorAll('input')].map((i,n)=>n+'='+i.type).join(' ')`)
await P.evaluate(setInput('input[type="text"], input:not([type="password"]):not([type="checkbox"])', 'SRS9006'))
await P.evaluate(setInput('input[type="password"]', 'SRS9006'))
const filled = await P.evaluate(`[...document.querySelectorAll('input')].map(i=>i.value).filter(Boolean).join(' / ')`)
filled.includes('SRS9006') ? ok('credentials entered: ' + filled) : no('could not fill the form: ' + filled)

let r = await P.evaluate(clickByText('sign in'))
if (r !== 'CLICKED') r = await P.evaluate(clickByText('login'))
if (r !== 'CLICKED') r = await P.evaluate(`(()=>{const b=document.querySelector('button[type="submit"],form button');if(!b)return 'NOT_FOUND';b.click();return 'CLICKED'})()`)
r === 'CLICKED' ? ok('submitted') : no('submit button: ' + r)

await new Promise(s=>setTimeout(s,3000))
t = await P.text()
const onChange = /password/i.test(t) && /(new|change|set)/i.test(t)
nb('   now showing: ' + t.split('\n').filter(Boolean).slice(0,4).join(' | ').slice(0,100))

console.log('\n══ 3. FORCED PASSWORD CHANGE ══\n')
if (onChange) {
  ok('forced change step reached (temp password path)')
  const pws = await P.evaluate(`document.querySelectorAll('input[type="password"]').length`)
  nb(`   ${pws} password field(s)`)
  await P.evaluate(`
    (()=>{const f=[...document.querySelectorAll('input[type="password"]')];
      const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))};
      if(f.length===3){set(f[0],'SRS9006');set(f[1],${JSON.stringify(NEWPW)});set(f[2],${JSON.stringify(NEWPW)})}
      else if(f.length===2){set(f[0],${JSON.stringify(NEWPW)});set(f[1],${JSON.stringify(NEWPW)})}
      else if(f.length===1){set(f[0],${JSON.stringify(NEWPW)})}
      return f.length})()`)
  let c = await P.evaluate(clickByText('change'))
  if (c !== 'CLICKED') c = await P.evaluate(clickByText('save'))
  if (c !== 'CLICKED') c = await P.evaluate(clickByText('continue'))
  if (c !== 'CLICKED') c = await P.evaluate(`(()=>{const b=document.querySelector('button[type="submit"],form button');if(!b)return 'NOT_FOUND';b.click();return 'CLICKED'})()`)
  c === 'CLICKED' ? ok('password change submitted') : no('change button: ' + c)
  await new Promise(s=>setTimeout(s,3500))
} else nb('   no forced change shown')

console.log('\n══ 4. THE SESSION THE BROWSER NOW HOLDS ══\n')
const sess = await P.evaluate(`localStorage.getItem('ezer_ess_session')`)
if (sess) {
  const o = JSON.parse(sess)
  ok(`session stored for ${o.name || o.employee_id}`)
  o.token ? ok(`TOKEN PRESENT (${o.token.length} chars) — this was null before the fix`)
          : no('token is null — travel routes will 401')
} else no('no ezer_ess_session in localStorage')
nb('   url: ' + await P.evaluate('location.pathname'))
