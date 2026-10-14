import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('column order lives in the agenda toolbar instead of every group header', () => {
  assert.match(board, />\s*Kolomvolgorde\s*<\/button>/)
  assert.match(board, /Kolommen en volgorde/)
  assert.doesNotMatch(board, /onToggleReorder/)
})

test('item sorting is named separately from column order', () => {
  assert.match(board, /Items sorteren/)
  assert.doesNotMatch(board, /'Volgorde aanpassen'/)
})
