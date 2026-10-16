import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sync = readFileSync(new URL('../lib/googleSync.ts', import.meta.url), 'utf8')
const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('a Google item you delete yourself stays deleted after a sync', () => {
  // De sync zette deleted_at onvoorwaardelijk op null ("revive"), dus een
  // in de agenda weggegooide meeting stond na één refresh weer terug.
  assert.doesNotMatch(sync, /deleted_at:\s+null,\n\s+updated_at/)
  assert.match(sync, /function deletionFieldsForUpsert\(/)
  assert.match(sync, /if \(row\?\.deleted_at && row\.deleted_by\) return \{ deleted_at: row\.deleted_at, deleted_by: row\.deleted_by \}/)
  // Beide upsert-takken (los event én terugkerende serie) gebruiken 'm.
  assert.equal((sync.match(/\.\.\.deletionFieldsForUpsert\(existingRow\),/g) ?? []).length, 2)
  // De vlag moet wél uit de database komen, anders is elke rij 'automatisch'.
  assert.match(sync, /start_date, end_date, deleted_at, deleted_by'\)/)
  assert.match(sync, /deleted_at\?: string \| null; deleted_by\?: string \| null \}/)
})

test('handmatig verwijderen zet de vlag waar de sync op kijkt', () => {
  // softDeleteItem is het enige pad dat deleted_by vult; de automatische
  // opschoonpaden zetten alleen deleted_at.
  assert.match(store, /\.update\(\{ deleted_at: stamp, deleted_by: uid \}\)/)
  // De aanroep geeft nu ook het bord mee en kijkt naar het resultaat.
  assert.match(board, /softDeleteItem\(itemId, boardId\)\.then\(restoreOnFailure\)/)
})

test('herstellen uit de papierbak wist de handmatige-verwijdervlag', () => {
  // Anders zou een later automatisch verstopte rij nog steeds als
  // 'door een mens weggegooid' tellen en nooit meer terugkomen.
  assert.match(store, /\.update\(\{ deleted_at: null, deleted_by: null \}\)\n\s+\.eq\('id', itemId\)/)
  assert.match(store, /update\(\{ deleted_at: null, deleted_by: null \}\)\.in\('id', itemIds\)/)
  // Installaties zonder migratie 0032 blijven werken.
  assert.match(store, /if \(error && \/deleted_by\/\.test\(error\.message \?\? ''\)\)/)
})
