// POST /api/maintenance/prune
//
// Voert de retention-cleanup uit voor board_snapshots, activity, en
// soft-deleted board_items + board_groups. Roept de SQL-functie
// `public.run_maintenance_prune()` aan via de service-role-client.
//
// Beveiliging: vereist een Authorization-header met de CRON_SECRET
// env-var. Wordt door Vercel cron met die header gestuurd (header-vorm
// 'Bearer <secret>'). Zo kunnen externen 't endpoint niet triggeren.
//
// Geen body, geen query-params. Response: counts per categorie.

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return run(req)
}

// Vercel cron stuurt GET. Beide ondersteunen zodat 't ook handmatig kan.
export async function GET(req: NextRequest) {
  return run(req)
}

async function run(req: NextRequest) {
  if (!supabaseAdmin) return Response.json({ ok: false, error: 'not_configured' }, { status: 500 })

  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
  }

  const { data, error } = await supabaseAdmin.rpc('run_maintenance_prune')
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  // RPC returns an array van 1 row met de counts.
  const row = Array.isArray(data) && data.length > 0 ? data[0] as Record<string, number> : null
  return Response.json({
    ok: true,
    at: new Date().toISOString(),
    snapshotsPruned: row?.snapshots_pruned ?? 0,
    activityPruned:  row?.activity_pruned  ?? 0,
    itemsPurged:     row?.items_purged     ?? 0,
    groupsPurged:    row?.groups_purged    ?? 0,
  })
}
