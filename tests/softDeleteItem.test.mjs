import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Minimale supabase-dubbel: legt vast wat er gevraagd wordt en geeft terug
// wat de test wil. Genoeg om softDeleteItem te doorlopen zonder database.
function fakeSupabase({ updateResult, rowLookup }) {
  const calls = { updates: [], lookups: 0 }
  return {
    client: {
      from() {
        return {
          update(patch) {
            const chain = {
              eq() { return chain },
              select() { calls.updates.push(patch); return Promise.resolve(updateResult.shift() ?? { data: [], error: null }) },
              then(resolve) { calls.updates.push(patch); return Promise.resolve(updateResult.shift() ?? { data: [], error: null }).then(resolve) },
            }
            return chain
          },
          select() {
            const chain = {
              eq() { return chain },
              maybeSingle() { calls.lookups += 1; return Promise.resolve({ data: rowLookup, error: null }) },
            }
            return chain
          },
        }
      },
    },
    calls,
  }
}

function loadStore(supabaseClient) {
  const source = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const statuses = []
  const stubs = {
    './supabase': { supabase: supabaseClient },
    './sync': { getCurrentUserId: async () => 'user-1' },
    './boardsRegistry': { getBoardIds: () => [], getBoardConfig: () => null, isCoreBoardId: () => true, upsertBoard: async () => true, defaultColumnsForNewBoard: () => [] },
    './subitemRules': { normalizeTitle: (v) => v },
    './googleMeetingHistory': { preserveStoredHistory: (incoming) => incoming },
    './boardSaveStatus': { emitBoardSaveStatus: (status) => statuses.push(status) },
    './boards': {},
  }
  const exports = {}
  runInNewContext(js, {
    exports, module: { exports },
    require: name => stubs[name] ?? {},
    console, Date, JSON, Math, Set, Map, Number, Promise, RegExp, Array, Object, String, Boolean, Error,
  })
  return { store: exports, statuses }
}

test('een geslaagde verwijdering bevestigt dat er echt een rij is bijgewerkt', async () => {
  const { client } = fakeSupabase({ updateResult: [{ data: [{ id: 'item-1' }], error: null }], rowLookup: null })
  const { store, statuses } = loadStore(client)
  assert.equal(await store.softDeleteItem('item-1', 'vlaanderen'), true)
  assert.deepEqual(statuses, [])
})

test('0 bijgewerkte rijen terwijl de rij bestaat is een fout, geen stille success', async () => {
  // Dit was de bug: PostgREST geeft geen error wanneer de update niets
  // raakt. softDeleteItem gaf dan 'true' terug, het item verdween uit
  // beeld en stond na een refresh gewoon weer in de agenda.
  const { client } = fakeSupabase({
    updateResult: [{ data: [], error: null }],
    rowLookup: { id: 'item-1', deleted_at: null },
  })
  const { store, statuses } = loadStore(client)
  assert.equal(await store.softDeleteItem('item-1', 'vlaanderen'), false)
  assert.equal(statuses.length, 1)
  assert.equal(statuses[0].state, 'error')
  assert.equal(statuses[0].boardName, 'vlaanderen')
  assert.match(statuses[0].message, /niet opgeslagen/i)
})

test('een item dat alleen lokaal bestond is gewoon weg', async () => {
  const { client } = fakeSupabase({ updateResult: [{ data: [], error: null }], rowLookup: null })
  const { store, statuses } = loadStore(client)
  assert.equal(await store.softDeleteItem('item-1', 'vlaanderen'), true)
  assert.deepEqual(statuses, [])
})

test('een al verwijderde rij telt als verwijderd', async () => {
  const { client } = fakeSupabase({
    updateResult: [{ data: [], error: null }],
    rowLookup: { id: 'item-1', deleted_at: '2026-10-16T10:00:00.000Z' },
  })
  const { store } = loadStore(client)
  assert.equal(await store.softDeleteItem('item-1', 'vlaanderen'), true)
})

test('zonder de deleted_by-kolom valt hij terug en slaagt alsnog', async () => {
  const { client, calls } = fakeSupabase({
    updateResult: [
      { data: null, error: { message: 'column board_items.deleted_by does not exist' } },
      { data: [{ id: 'item-1' }], error: null },
    ],
    rowLookup: null,
  })
  const { store, statuses } = loadStore(client)
  assert.equal(await store.softDeleteItem('item-1', 'vlaanderen'), true)
  assert.equal(calls.updates.length, 2)
  assert.ok('deleted_by' in calls.updates[0])
  assert.ok(!('deleted_by' in calls.updates[1]))
  assert.deepEqual(statuses, [])
})

test('een echte databasefout komt met tekst en al bij de gebruiker terecht', async () => {
  const { client } = fakeSupabase({
    updateResult: [{ data: null, error: { message: 'permission denied for table board_items' } }],
    rowLookup: null,
  })
  const { store, statuses } = loadStore(client)
  assert.equal(await store.softDeleteItem('item-1', 'vlaanderen'), false)
  assert.match(statuses[0].message, /permission denied/)
})

test('de agenda zet de rij terug wanneer verwijderen niet is opgeslagen', () => {
  const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
  assert.match(board, /const restoreOnFailure = \(ok: boolean\) => \{/)
  assert.match(board, /softDeleteItem\(itemId, boardId\)\.then\(restoreOnFailure\)/)
  assert.match(board, /softDeleteItem\(id, boardId\)\.then\(ok => \{ if \(!ok\) onChange\(snapshot\) \}\)/)
})
