import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')

test('board parent exists before board groups are persisted', () => {
  const snapshotStart = store.indexOf('async function pushBoardSnapshot')
  const snapshot = store.slice(snapshotStart, store.indexOf('// Upsert items', snapshotStart))
  assert.match(snapshot, /ensureBoardParentExists\(boardName\)/)
  assert.ok(
    snapshot.indexOf('ensureBoardParentExists(boardName)') < snapshot.indexOf("from('board_groups').upsert"),
    'parent check must happen before the group upsert',
  )
})

test('existing board settings are not overwritten by the parent safeguard', () => {
  const helperStart = store.indexOf('async function ensureBoardParentExists')
  const helper = store.slice(helperStart, store.indexOf('async function pushBoardSnapshot', helperStart))
  assert.match(helper, /from\('boards'\)/)
  assert.match(helper, /if \(data\?\.length\) return true/)
  assert.match(helper, /if \(!config\) return false/)
  assert.ok(
    helper.indexOf('if (data?.length) return true') < helper.indexOf('return upsertBoard'),
    'upsertBoard should only run when the parent row is missing',
  )
})
