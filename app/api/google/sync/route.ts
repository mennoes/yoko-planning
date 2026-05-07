import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { syncCalendarsForUser } from '@/lib/googleSync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) return new Response('not configured', { status: 500 })

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const { data, error } = await supabase.auth.getUser(auth.slice(7))
  if (error || !data.user) return new Response('unauthorized', { status: 401 })

  try {
    const results = await syncCalendarsForUser(supabaseAdmin, data.user.id)
    return Response.json({ ok: true, results })
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 })
  }
}
