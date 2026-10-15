import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('clicking a regular item name immediately starts renaming', () => {
  assert.match(board, /setNameDraft\(item\.name\)\s+setEditName\(true\)/)
  assert.match(board, /title=\{item\.source === 'google' \? 'Details openen' : 'Klik om naam aan te passen'\}/)
})

test('subitem names are also direct edit targets', () => {
  assert.match(board, /setNameDraft\(subitem\.name\); setEditName\(true\)/)
  assert.match(board, /title="Klik om naam aan te passen"/)
})

test('details remain available through a separate arrow action', () => {
  assert.match(board, /title="Details openen"/)
  assert.match(board, />\s*↗\s*<\/button>/)
})
