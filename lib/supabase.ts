import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const hasSupabase = !!(url && key)
export const supabase    = hasSupabase ? createClient(url, key) : null

export type DbProfile = {
  id:              string
  user_id:         string
  member_id:       string
  name:            string
  color:           string
  photo:           string | null
  weekly_capacity: number
}
