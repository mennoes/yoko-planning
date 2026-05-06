import { createClient } from '@supabase/supabase-js'

const url    = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
const key    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
// Auth temporarily bypassed — set NEXT_PUBLIC_BYPASS_AUTH=false in Vercel to re-enable
const bypass = process.env.NEXT_PUBLIC_BYPASS_AUTH !== 'false'

export const hasSupabase = !bypass && !!(url && key)
export const supabase    = hasSupabase
  ? createClient(url, key, { auth: { flowType: 'implicit' } })
  : null

export type DbProfile = {
  id:              string
  user_id:         string
  member_id:       string
  name:            string
  color:           string
  photo:           string | null
  weekly_capacity: number
}
