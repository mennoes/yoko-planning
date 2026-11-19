type Row = Record<string, unknown>

const MERGE_FIELDS = [
  'group_id', 'position', 'name', 'owner_ids', 'status', 'start_date', 'end_date',
  'deadline', 'est_hours', 'dagen', 'notes', 'contactpersoon', 'uitzenddag',
  'framelink', 'nummers', 'subitems', 'journal', 'source', 'external_link',
  'external_synced_at',
] as const

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Three-way merge for a board row.
 *
 * A tab may have an old local snapshot while another tab has already changed
 * the same item. Only fields that this tab changed versus its pulled baseline
 * may be written from the local row; all other fields keep the current remote
 * value. This prevents a harmless reorder or notes edit from restoring an old
 * timeline.
 */
export function mergeBoardRowAgainstRemote(local: Row, baseline: Row, remote: Row): Row {
  const merged: Row = { ...local }

  for (const field of MERGE_FIELDS) {
    if (same(local[field], baseline[field])) merged[field] = remote[field] ?? null
  }

  const localExtra = (local.extra && typeof local.extra === 'object' ? local.extra : {}) as Row
  const baselineExtra = (baseline.extra && typeof baseline.extra === 'object' ? baseline.extra : {}) as Row
  const remoteExtra = (remote.extra && typeof remote.extra === 'object' ? remote.extra : {}) as Row
  const extra: Row = { ...localExtra }
  const keys = new Set([...Object.keys(localExtra), ...Object.keys(baselineExtra), ...Object.keys(remoteExtra)])
  for (const key of keys) {
    if (!same(localExtra[key], baselineExtra[key])) continue
    if (key in remoteExtra) extra[key] = remoteExtra[key]
    else delete extra[key]
  }
  merged.extra = extra

  return merged
}
