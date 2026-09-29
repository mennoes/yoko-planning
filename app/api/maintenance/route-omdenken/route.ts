import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { routeLegacyOmdenkenItems } from '@/lib/googleSync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) {
    return Response.json({ ok: false, moved: 0, names: [], error: 'not_configured' }, { status: 500 })
  }

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return Response.json({ ok: false, moved: 0, names: [], error: 'unauthorized' }, { status: 401 })
  }
  const { data, error } = await supabase.auth.getUser(auth.slice(7))
  if (error || !data.user) {
    return Response.json({ ok: false, moved: 0, names: [], error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await routeLegacyOmdenkenItems(supabaseAdmin)
    return Response.json({ ok: true, ...result })
  } catch (error) {
    return Response.json({ ok: false, moved: 0, names: [], error: String(error).slice(0, 500) }, { status: 500 })
  }
}
