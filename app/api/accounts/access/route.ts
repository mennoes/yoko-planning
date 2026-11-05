import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { accountAccess, accountAccessAdmin, accountTeamRole, ACCOUNT_TEAM_ROLES } from '@/lib/accountAccess'

export const dynamic = 'force-dynamic'
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
async function authorize(req: NextRequest) {
  if (!supabaseAdmin) return respond({ error: 'Beheer is niet ingesteld.' }, 503)
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '')
  if (!token) return respond({ error: 'Log opnieuw in.' }, 401)
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) return respond({ error: 'Log opnieuw in.' }, 401)
  if (!accountAccessAdmin(data.user.app_metadata)) return respond({ error: 'Alleen accountbeheerders kunnen dit wijzigen.' }, 403)
  return data.user
}
export async function GET(req: NextRequest) {
  const actor = await authorize(req)
  if (actor instanceof Response) return actor
  const rows = []
  for (let page = 1; ; page++) {
    const { data, error } = await supabaseAdmin!.auth.admin.listUsers({ page, perPage: 100 })
    if (error) return respond({ error: 'Toegang kon niet worden geladen.' }, 500)
    for (const user of data.users) rows.push({
      id: user.id, email: user.email ?? '',
      role: accountTeamRole(user.app_metadata?.team_role),
      allowed: accountAccess(user.app_metadata), admin: accountAccessAdmin(user.app_metadata),
    })
    if (data.users.length < 100) break
  }
  return respond({ users: rows })
}
export async function PATCH(req: NextRequest) {
  const actor = await authorize(req)
  if (actor instanceof Response) return actor
  let body
  try { body = await req.json() } catch { return respond({ error: 'Ongeldige wijziging.' }, 400) }
  if (!body || typeof body.userId !== 'string' || typeof body.allowed !== 'boolean' || !Object.hasOwn(ACCOUNT_TEAM_ROLES, body.role)) return respond({ error: 'Ongeldige wijziging.' }, 400)
  const { data, error } = await supabaseAdmin!.auth.admin.getUserById(body.userId)
  if (error || !data.user) return respond({ error: 'Login niet gevonden.' }, 404)
  // Admin rights cannot be created or removed through this endpoint.
  if (accountAccessAdmin(data.user.app_metadata)) return respond({ error: 'De toegang van accountbeheerders staat vast.' }, 403)
  const { error: saveError } = await supabaseAdmin!.auth.admin.updateUserById(body.userId, {
    app_metadata: { ...data.user.app_metadata, accounts_access: body.allowed, team_role: body.role },
  })
  if (saveError) return respond({ error: 'Opslaan mislukt. Probeer opnieuw.' }, 500)
  return respond({ ok: true })
}
