import { createClient } from '@supabase/supabase-js'

const url    = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
const key    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
// Auth is required unless explicitly disabled with NEXT_PUBLIC_BYPASS_AUTH=true.
const bypass = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'

// Supabase client is available whenever URL+key are set, regardless of auth
// bypass. Auth-redirect / login-required behavior is gated separately by
// `requiresAuth`. Keeping the client always available lets sync code make
// authenticated queries when a user happens to be signed in even with bypass
// turned on.
const hasConfig = !!(url && key)

export const supabase = hasConfig
  ? createClient(url, key, { auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true } })
  : null

export const hasSupabase  = hasConfig                    // legacy export — keep
export const requiresAuth = !bypass && hasConfig

export type DbProfile = {
  id:              string
  user_id:         string
  member_id:       string
  name:            string
  color:           string
  photo:           string | null
  weekly_capacity: number
}
