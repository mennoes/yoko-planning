import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')
const history = readFileSync(new URL('../lib/googleMeetingHistory.ts', import.meta.url), 'utf8')

test('every board upsert preserves stored historical occurrences', () => {
  assert.match(store, /select\('id, board_id, subitems, extra'\)/)
  assert.match(store, /preserveStoredHistory/)
  assert.match(history, /export function preserveStoredHistory/)
})

test('an explicit tombstone remains the only way to delete history', () => {
  assert.match(history, /dismissedIds\.has\(item\.id\)/)
  assert.match(history, /dismissedIds\.has\(item\.sourceItemId\)/)
})
