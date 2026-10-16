import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('een Google-subitem weggooien onthoudt ook de Google-id', () => {
  // Zie tests/googleMeetingRouting.test.mjs: de server vergelijkt de verse
  // Google-subitems met de tombstone-lijst op de Google-id. Een handmatig
  // genest item heeft een eigen subitem-id en bewaart de Google-id in
  // sourceItemId, dus zonder die tweede id kwam het item na elke sync terug.
  assert.match(board, /function dismissTombstones\(/)
  assert.match(board, /\.\.\.\(subitem\?\.sourceItemId \? \[subitem\.sourceItemId\] : \[\]\)/)
  assert.match(board, /onUpdate\(filtered, \{ dismissedInstanceIds: dismissTombstones\(dismissedInstanceIds, deleted, id\) \}\)/)
})

test('de bulk-verwijderknop gebruikt dezelfde tombstones als de losse x', () => {
  assert.match(board, /for \(const tombstone of dismissTombstones\(undefined, sub, sub\.id\)\) dismissed\.add\(tombstone\)/)
  assert.doesNotMatch(board, /dismissed\.add\(sub\.id\)\n/)
})
