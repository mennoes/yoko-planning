// Eenmalige, strikt begrensde onderhoudsactie. Alleen Manuel kan hiermee
// op inactief worden gezet; de route wordt direct na uitvoering verwijderd.

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EXPECTED_HASH = '8de07da2376e0b9f6f6b7c7bb2fd0e905c5194f2a12b4aed7ae88f41f15d0277'

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })

  const keyHash = createHash('sha256').update(req.headers.get('x-maintenance-key') ?? '').digest('hex')
  const allowed = timingSafeEqual(Buffer.from(keyHash), Buffer.from(EXPECTED_HASH))
  if (!allowed) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('team_members')
    .update({ inactive: true })
    .eq('id', 'm')
    .select('id, name, inactive')
    .single()

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true, member: data })
}
