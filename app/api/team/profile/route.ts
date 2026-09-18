import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isTeamAdmin } from '@/lib/teamAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FIELDS = new Set([
  'role', 'office', 'email', 'phone', 'slack_handle', 'linkedin',
  'birthday', 'pronouns', 'languages', 'days_off', 'vacation_from',
  'vacation_until', 'emergency_contact', 'emergency_phone', 'fun_fact', 'bio',
])
const DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
const DATES = new Set(['birthday', 'vacation_from', 'vacation_until'])

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return Response.json({ error: 'not_configured' }, { status: 500 })
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { data: userData, error: userError } = await supabase.auth.getUser(auth.slice(7))
  if (userError || !userData.user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { data: actor, error: actorError } = await supabaseAdmin.from('profiles')
    .select('member_id').eq('user_id', userData.user.id).maybeSingle()
  if (actorError || !isTeamAdmin(actor?.member_id)) return Response.json({ error: 'forbidden' }, { status: 403 })

  let body: { memberId?: unknown; patch?: unknown }
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_body' }, { status: 400 }) }
  const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
  if (!memberId || memberId === 'unassigned' || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const patch = body.patch as Record<string, unknown>
  const entries = Object.entries(patch)
  if (entries.length === 0 || entries.some(([key, value]) => {
    if (!FIELDS.has(key)) return true
    if (key === 'days_off') return !Array.isArray(value) || value.some(day => typeof day !== 'string' || !DAYS.has(day))
    if (value !== null && (typeof value !== 'string' || value.length > (key === 'bio' ? 5000 : 500))) return true
    return DATES.has(key) && value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value as string)
  })) return Response.json({ error: 'invalid_patch' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('profiles')
    .update(patch).eq('member_id', memberId).select('member_id').maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'profile_not_found' }, { status: 404 })
  return Response.json({ ok: true })
}
