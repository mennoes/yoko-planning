import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { CompletionError, setPersonalCompletion } from '@/lib/personalCompletionServer'

export const runtime = 'nodejs'
export async function POST(req: Request) {
  if (!supabaseAdmin) return Response.json({ error: 'Niet geconfigureerd.' }, { status: 503 })
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return Response.json({ error: 'Log eerst in.' }, { status: 401 })
  const { data, error } = await supabaseAdmin.auth.getUser(auth.slice(7))
  if (error || !data.user) return Response.json({ error: 'Log opnieuw in.' }, { status: 401 })
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Ongeldige invoer.' }, { status: 400 }) }
  if (!body || typeof body.parentItemId !== 'string' || !body.parentItemId || body.parentItemId.length > 500 ||
    (body.subitemId !== undefined && (typeof body.subitemId !== 'string' || !body.subitemId || body.subitemId.length > 500)) ||
    typeof body.done !== 'boolean' || !(body.expectedEventId === null || typeof body.expectedEventId === 'string')) {
    return Response.json({ error: 'Ongeldige invoer.' }, { status: 400 })
  }
  try {
    return Response.json(await setPersonalCompletion(supabaseAdmin, data.user.id,
      { parentItemId: body.parentItemId, ...(body.subitemId ? { subitemId: body.subitemId } : {}) }, body.done, body.expectedEventId))
  } catch (err) {
    console.error('[personal-completion]', err)
    return Response.json({ error: err instanceof CompletionError ? err.message : 'Opslaan mislukt. Probeer opnieuw.' },
      { status: err instanceof CompletionError ? err.status : 500 })
  }
}
