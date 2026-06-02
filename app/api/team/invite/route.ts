// Server-route die een Supabase auth-user aanmaakt (of een nieuwe invite-
// mail stuurt als de user al bestaat) voor een nieuw team-lid. Gebruikt
// de service-role-key — alleen aanroepbaar door een ingelogde gebruiker
// (Authorization: Bearer <access_token>) zodat anonieme bots geen
// uitnodigingen kunnen versturen.
//
// POST { email, name?, redirectTo? } → { ok, status: 'invited' | 'exists' }

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!supabase || !supabaseAdmin) {
    return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })
  }

  // Auth-check: alleen ingelogde gebruikers mogen invites sturen.
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7))
  if (userErr || !userData.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: { email?: string; name?: string; redirectTo?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ ok: false, error: 'invalid_email' }, { status: 400 })
  }

  // Check of de auth-user al bestaat. Supabase heeft helaas geen directe
  // 'find by email'-helper, dus paginate door admin.listUsers totdat we
  // 'm vinden of de pages op zijn. Bij grote teams stoppen we na 500
  // gebruikers — meer dan voldoende voor een Studio Yoko-context.
  let existingUserId: string | null = null
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) break
    const users = data?.users ?? []
    const hit = users.find(u => (u.email ?? '').toLowerCase() === email)
    if (hit) { existingUserId = hit.id; break }
    if (users.length < 100) break
  }

  // Bouw de redirect-URL voor de invite-mail. Default = de origin van de
  // huidige request (vercel-deploy). Caller kan een specifieke pagina
  // meegeven via redirectTo (bv. '/?welcome=1').
  const origin = req.nextUrl.origin
  const redirectTo = body.redirectTo
    ? (body.redirectTo.startsWith('http') ? body.redirectTo : `${origin}${body.redirectTo}`)
    : `${origin}/`

  if (existingUserId) {
    // Bestaande user → stuur een nieuwe magic-link/password-reset zodat
    // ze opnieuw in kunnen loggen. We gebruiken generateLink type='magiclink'
    // en sturen 'm zelf NIET — Supabase doet dat automatisch via SMTP als
    // 'Send invite emails' aan staat. Anders zien admins de URL in 't
    // response object zodat ze 'm handmatig kunnen forwarden.
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    })
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 })
    }
    return Response.json({
      ok: true, status: 'exists',
      actionLink: data?.properties?.action_link ?? null,
    })
  }

  // Nieuwe user → invite versturen (Supabase verstuurt automatisch de mail
  // als SMTP geconfigureerd is). data?.user is de nieuwe gebruiker.
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: body.name ? { name: body.name } : undefined,
  })
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  return Response.json({
    ok: true, status: 'invited',
    userId: data?.user?.id ?? null,
  })
}
