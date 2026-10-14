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
  assert.match(helper, /if \(data\?\.length\) return 'ready'/)
  assert.match(helper, /if \(!config\) return 'retired'/)
  assert.match(helper, /if \(!isCoreBoardId\(boardName\)\) return 'retired'/)
  assert.ok(
    helper.indexOf("if (data?.length) return 'ready'") < helper.indexOf('return await upsertBoard'),
    'upsertBoard should only run when the parent row is missing',
  )
})

test('a missing custom board is retired instead of silently recreated', () => {
  assert.match(store, /import \{[^}]*isCoreBoardId[^}]*\} from '\.\/boardsRegistry'/)
  const helperStart = store.indexOf('async function ensureBoardParentExists')
  const helper = store.slice(helperStart, store.indexOf('async function pushBoardSnapshot', helperStart))
  assert.ok(
    helper.indexOf('if (!isCoreBoardId(boardName)) return \'retired\'') < helper.indexOf('return await upsertBoard'),
    'a stale custom board must be discarded before the core-board repair path',
  )
})

test('stale writes for a retired board are cleared without an error toast', () => {
  assert.match(store, /if \(parentState === 'retired'\) \{\s*discardRetiredBoardCache\(boardName\)\s*return true/)
  const cleanupStart = store.indexOf('function discardRetiredBoardCache')
  const cleanup = store.slice(cleanupStart, store.indexOf('async function pushBoardSnapshot', cleanupStart))
  assert.match(cleanup, /localStorage\.removeItem\(key\(boardName\)\)/)
  assert.match(cleanup, /localStorage\.removeItem\(pulledKey\(boardName\)\)/)
  assert.match(cleanup, /localStorage\.removeItem\(dirtyKey\(boardName\)\)/)
})
