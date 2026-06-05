import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Browser Supabase client factory.
// The offer-flow components import `createClient` from here and call it to get
// a client instance. This mirrors the singleton in `@/lib/supabase` but as a
// factory, which is the shape those components expect.
export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
