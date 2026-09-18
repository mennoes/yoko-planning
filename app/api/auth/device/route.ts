import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { describeUserAgent, escapeHtml, hashDevice, safeHeader } from '@/lib/loginDevice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type DeviceBody = { deviceId?: string }

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { data, error } = await supabaseAdmin.auth.getUser(auth.slice(7))
  const user = data.user
  if (error || !user?.email) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: DeviceBody
  try { body = await req.json() as DeviceBody }
  catch { return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 }) }
  const deviceId = (body.deviceId ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return Response.json({ ok: false, error: 'invalid_device' }, { status: 400 })

  const resendKey = process.env.RESEND_API_KEY ?? ''
  const from = process.env.AUTH_ALERT_FROM_EMAIL ?? ''
  if (!resendKey || !from) return Response.json({ ok: true, configured: false })

  const deviceHash = hashDevice(user.id, deviceId, process.env.DEVICE_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '')
  const userAgent = safeHeader(req.headers.get('user-agent'))
  const info = describeUserAgent(userAgent)
  const now = new Date().toISOString()
  const existing = await supabaseAdmin.from('login_devices').select('id').eq('user_id', user.id).eq('device_hash', deviceHash).maybeSingle()
  if (existing.error) return Response.json({ ok: false, error: 'device_lookup_failed' }, { status: 500 })
  if (existing.data) {
    await supabaseAdmin.from('login_devices').update({ last_seen_at: now, label: info.label }).eq('id', existing.data.id)
    return Response.json({ ok: true, isNew: false })
  }

  // A stolen session must warn its owner, but may not be abused as an
  // unlimited email endpoint. Five genuinely new browsers per hour is ample.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const recent = await supabaseAdmin.from('login_devices').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).gte('created_at', since)
  if (recent.error) return Response.json({ ok: false, error: 'rate_limit_check_failed' }, { status: 500 })
  if ((recent.count ?? 0) >= 5) return Response.json({ ok: true, rateLimited: true })

  const inserted = await supabaseAdmin.from('login_devices').insert({
    user_id: user.id, device_hash: deviceHash, label: info.label, first_seen_at: now, last_seen_at: now,
  }).select('id').single()
  if (inserted.error) {
    if (inserted.error.code === '23505') return Response.json({ ok: true, isNew: false })
    return Response.json({ ok: false, error: 'device_insert_failed' }, { status: 500 })
  }

  const city = safeHeader(req.headers.get('x-vercel-ip-city'))
  const region = safeHeader(req.headers.get('x-vercel-ip-country-region'))
  const country = safeHeader(req.headers.get('x-vercel-ip-country'))
  const location = [city, region, country].filter(Boolean).join(', ') || 'Onbekende locatie'
  const ip = safeHeader(req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || null) || 'Onbekend'
  const time = new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Amsterdam',
  }).format(new Date())
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : req.nextUrl.origin)
  const resetUrl = `${appUrl.replace(/\/$/, '')}/login`
  const text = `Er is ingelogd op je Yoko Planner-account vanaf een nieuw apparaat.\n\nApparaat: ${info.label}\nTijdstip: ${time}\nLocatie: ${location}\nIP-adres: ${ip}\n\nWas jij dit niet? Ga direct naar ${resetUrl} en wijzig je wachtwoord.`
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;line-height:1.55;color:#202124"><h2>Nieuwe login bij Yoko Planner</h2><p>Er is ingelogd op je account vanaf een nieuw apparaat.</p><table style="border-collapse:collapse"><tr><td style="padding:5px 18px 5px 0;color:#666">Apparaat</td><td><strong>${escapeHtml(info.label)}</strong></td></tr><tr><td style="padding:5px 18px 5px 0;color:#666">Tijdstip</td><td>${escapeHtml(time)}</td></tr><tr><td style="padding:5px 18px 5px 0;color:#666">Locatie</td><td>${escapeHtml(location)}</td></tr><tr><td style="padding:5px 18px 5px 0;color:#666">IP-adres</td><td>${escapeHtml(ip)}</td></tr></table><p style="margin-top:24px">Was jij dit niet? <a href="${escapeHtml(resetUrl)}">Wijzig dan direct je wachtwoord</a>.</p></div>`
  const mail = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [user.email], subject: `Nieuwe login: ${info.label}`, text, html }),
  })
  if (!mail.ok) {
    // Retry on the next login instead of silently marking an unsent alert done.
    await supabaseAdmin.from('login_devices').delete().eq('id', inserted.data.id)
    console.error('[login-device] Resend failed', mail.status, await mail.text())
    return Response.json({ ok: false, error: 'email_failed' }, { status: 502 })
  }
  return Response.json({ ok: true, isNew: true, notified: true })
}
