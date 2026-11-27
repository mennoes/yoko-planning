import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('the Home item popup makes its source agenda immediately visible', () => {
  assert.match(board, />Agenda<\/span>/)
  assert.match(board, /<Link href=\{agendaHref\}[\s\S]*?\{boardName\}<span aria-hidden/)
  assert.match(board, /const locatieDelen = \[groupName, parentName\]/)
})

test('the item popup keeps common fields visible and folds secondary metadata away', () => {
  assert.match(board, /const primaryPropertyKeys = new Set\(\['ownerIds', 'status', 'timeline', 'deadline', 'estHours'\]\)/)
  assert.match(board, /\{primaryPropertyCols\.map\(propertyCard\)\}/)
  assert.match(board, /Meer gegevens \(\{secondaryPropertyCols\.length\}\)/)
  assert.match(board, /\{secondaryPropertyCols\.map\(propertyCard\)\}/)
})

test('the item popup uses a compact hours distribution and description', () => {
  assert.match(board, /size=\{96\}/)
  assert.match(board, /Verschuif of vul uren in/)
  assert.match(board, /rows=\{3\}/)
  assert.match(board, /minHeight: 78/)
})
