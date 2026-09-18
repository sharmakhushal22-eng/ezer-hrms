// lib/supabase/server.ts — the server client under the name the Today package
// imports it by.
//
// The drop was written against a project that exports createServerClient() from
// here. This repo has had the same thing for longer under a different name:
// rmsServiceClient in lib/rms/server.ts, already configured with the service
// role and used by every other ESS route. Rather than edit the package's files
// — the point of a drop is that it stays diffable against the next one — this
// is the adapter.

export { rmsServiceClient } from '@/lib/rms/server'
import { rmsServiceClient } from '@/lib/rms/server'

/** Same client every other server route uses. Not a new connection. */
export function createServerClient() {
  return rmsServiceClient
}
