// POST /api/ai/plan   { prompt, context }  → { ok, plan }
// GET  /api/ai/plan                        → { available }
//
// Zet een opdracht in gewone taal om in een voorstel voor één item met
// subitems. De sleutel voor het model staat alleen op de server; de
// browser praat nooit rechtstreeks met de API.
//
// Zonder ANTHROPIC_API_KEY is dit uit: de GET zegt dat het niet
// beschikbaar is en de knop verschijnt niet in de app. Zo kan deze code
// gewoon mee zonder dat er iets verandert tot de sleutel er is.
//
// Dit schrijft zelf niets naar een bord. Het antwoord is een voorstel
// dat de gebruiker eerst ziet; pas een klik op Aanmaken zet het item
// erop, via dezelfde weg als een item dat je met de hand maakt.

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { normalizePlan, planSystemPrompt, PLAN_TOOL, type PlanContext } from '@/lib/aiPlan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Welk model het voorstel schrijft. Te kiezen met ANTHROPIC_MODEL;
// claude-haiku-5-5 is veruit het goedkoopst voor dit soort werk,
// claude-opus-5-5 het sterkst.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5'
const API = 'https://api.anthropic.com/v1/messages'
/** Een briefing mag lang zijn, maar een boek plakken heeft geen zin. */
const MAX_PROMPT = 8000

export async function GET() {
  return Response.json({ available: !!process.env.ANTHROPIC_API_KEY, model: MODEL })
}

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 })

  // Zelfde deur als de andere routes: alleen een ingelogd teamlid.
  const auth = req.headers.get('authorization')
  if (!supabase || !auth?.startsWith('Bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7))
  if (userErr || !userData.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: { prompt?: unknown; context?: unknown }
  try { body = await req.json() } catch {
    return Response.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_PROMPT) : ''
  if (!prompt) return Response.json({ ok: false, error: 'missing_prompt' }, { status: 400 })

  const raw = (body.context ?? {}) as Record<string, unknown>
  const context: PlanContext = {
    today: typeof raw.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.today)
      ? raw.today
      : new Date().toISOString().slice(0, 10),
    boardName: typeof raw.boardName === 'string' ? raw.boardName.slice(0, 80) : 'onbekend',
    groupNames: Array.isArray(raw.groupNames)
      ? raw.groupNames.filter((n): n is string => typeof n === 'string').slice(0, 40).map(n => n.slice(0, 120))
      : [],
    members: Array.isArray(raw.members)
      ? (raw.members as Array<Record<string, unknown>>)
          .filter(m => typeof m?.id === 'string' && typeof m?.name === 'string')
          .slice(0, 60)
          .map(m => ({ id: String(m.id).slice(0, 80), name: String(m.name).slice(0, 80) }))
      : [],
  }

  let response: Response
  try {
    response = await fetch(API, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        // De huidige modellen denken eerst na, en dat telt mee in de
        // uitvoer. Te krap betekent een afgekapt voorstel.
        max_tokens: 8000,
        // Dit is invulwerk, geen puzzel: lage denkdiepte scheelt tijd en
        // geld zonder dat het voorstel er minder van wordt.
        output_config: { effort: 'low' },
        system: planSystemPrompt(context),
        tools: [PLAN_TOOL],
        // Géén tool_choice die het model dwingt: dat geeft op de huidige
        // modellen een 400. De opdracht zegt dat het de tool moet
        // aanroepen, en gebeurt dat niet, dan melden we dat gewoon.
        messages: [{ role: 'user', content: prompt }],
      }),
      // Een traag antwoord is vervelend, een hangende request erger.
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    return Response.json({ ok: false, error: 'model_unreachable' }, { status: 502 })
  }

  if (!response.ok) {
    // De foutmelding van de API kan de sleutel of interne details
    // bevatten; alleen de status gaat terug naar de browser.
    return Response.json({ ok: false, error: 'model_error', status: response.status }, { status: 502 })
  }

  let payload: { content?: Array<{ type?: string; name?: string; input?: unknown }> }
  try { payload = await response.json() } catch {
    return Response.json({ ok: false, error: 'model_error' }, { status: 502 })
  }
  const call = (payload.content ?? []).find(deel => deel.type === 'tool_use' && deel.name === PLAN_TOOL.name)
  if (!call) return Response.json({ ok: false, error: 'geen_voorstel' }, { status: 502 })

  const result = normalizePlan(call.input, context)
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 502 })
  return Response.json({ ok: true, plan: result.plan })
}
