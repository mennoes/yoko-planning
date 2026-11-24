import type { SupabaseClient } from '@supabase/supabase-js'

type ItemRow = Record<string, unknown> & { id: string; row_version?: string | number }
type Cache = { userId: string; rows: Map<string, ItemRow> }
const boards = new Map<string, Cache>()

// xmin changes on every PostgreSQL row update, including writes that don't
// maintain updated_at. Keep it in memory only, scoped to the signed-in user.
export async function readBoardItems(db: SupabaseClient, board: string, userId: string): Promise<ItemRow[] | null> {
  const cache = boards.get(board)
  const previous = cache?.userId === userId ? cache.rows : undefined
  const active = (columns: string) => db.from('board_items').select(columns)
    .eq('board_id', board).is('deleted_at', null)
  const ordered = (columns: string) => active(columns).order('position').order('id')
  const columns = previous ? 'id,row_version:xmin' : '*,row_version:xmin'
  const { data, error } = await ordered(columns)
  if (error) {
    // Older gateways may not expose system columns. Preserve the normal read.
    if (!error.message.includes('xmin')) return null
    const fallback = await ordered('*')
    return fallback.error ? null : fallback.data as unknown as ItemRow[]
  }
  const index = data as unknown as ItemRow[]
  let rows = index
  if (previous) {
    const changed = index.filter(row => row.row_version == null || previous.get(row.id)?.row_version !== row.row_version)
    const replacements = new Map<string, ItemRow>()
    for (let start = 0; start < changed.length; start += 50) {
      const ids = changed.slice(start, start + 50).map(row => row.id)
      const result = await active('*,row_version:xmin').in('id', ids)
      if (result.error) return null
      for (const row of result.data as unknown as ItemRow[]) replacements.set(row.id, row)
    }
    const changedIds = new Set(changed.map(row => row.id))
    rows = index.flatMap(({ id }) => {
      const row = changedIds.has(id) ? replacements.get(id) : previous.get(id)
      return row ? [row] : []
    })
  }
  boards.set(board, { userId, rows: new Map(rows.map(row => [row.id, row])) })
  return rows
}
