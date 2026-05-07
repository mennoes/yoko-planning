import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { signState, getAuthUrl } from '@/lib/googleOAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!supabase) return new Response('supabase not configured', { status: 500 })

  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const { data, error } = await supabase.auth.getUser(auth.slice(7))
  if (error || !data.user) return new Response('unauthorized', { status: 401 })

  const body    = await req.json().catch(() => ({}))
  const boardId = typeof body?.boardId === 'string' ? body.boardId : null

  const state = signState({
    uid:     data.user.id,
    boardId,
    nonce:   Math.random().toString(36).slice(2),
    exp:     Date.now() + 10 * 60 * 1000,
  })

  const redirectUri = `${req.nextUrl.origin}/api/google/callback`
  return Response.json({ url: getAuthUrl(state, redirectUri) })
}
