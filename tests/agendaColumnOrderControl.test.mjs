import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('column order lives in the agenda toolbar instead of every group header', () => {
  assert.match(board, />\s*Kolommen\s*<\/button>/)
  assert.match(board, />Kolommen<\/strong>/)
  assert.doesNotMatch(board, /onToggleReorder/)
})

test('existing column names can be edited without changing their data key', () => {
  assert.match(board, /function renameColumn\(key: string, label: string\)/)
  assert.match(board, /column\.key === key \? \{ \.\.\.column, label: nextLabel \} : column/)
  assert.match(board, /aria-label=\{`Naam van kolom \$\{c\.label\}`\}/)
  assert.match(board, /renameColumn\(c\.key, nextLabel\)/)
  assert.doesNotMatch(board, /column\.key === 'status'[\s\S]{0,120}label: 'Status'/)
  assert.doesNotMatch(board, /column\.key === 'timeline'[\s\S]{0,120}label: 'Timeline'/)
})

test('item sorting is named separately from column order', () => {
  assert.match(board, /Items sorteren/)
  assert.doesNotMatch(board, /'Volgorde aanpassen'/)
})
