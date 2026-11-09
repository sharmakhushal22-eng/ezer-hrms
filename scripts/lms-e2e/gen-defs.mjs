// Table and column metadata only. No rows are fetched.
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync(process.argv[2],'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL,K=env.SUPABASE_SERVICE_ROLE_KEY
const spec=await (await fetch(U+'/rest/v1/',{headers:{apikey:K,Authorization:`Bearer ${K}`,Accept:'application/openapi+json'}})).json()
fs.writeFileSync(process.argv[3],JSON.stringify(spec.definitions))
console.log(Object.keys(spec.definitions).length,'definitions')
console.log(JSON.stringify(spec.definitions.employees.properties.department_id))
