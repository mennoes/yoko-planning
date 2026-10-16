import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const start = source.indexOf('function BoardGroupSection')
const end = source.indexOf('// ─── BoardTable', start)
const groupSection = source.slice(start, end > start ? end : undefined)

test('agenda columns can be dragged directly and reveal their grip on press', () => {
  assert.match(groupSection, /draggable=\{!isMobile\}/)
  assert.match(groupSection, /onMoveColumn\(sourceKey, col\.key, side\)/)
  assert.match(groupSection, /pressedColumnKey === col\.key \? 1 : 0/)
})

test('agenda group no longer offers select-all controls', () => {
  assert.doesNotMatch(groupSection, /selecteer alles/i)
  assert.doesNotMatch(groupSection, /onSelectGroup/)
})

test('individual row selection remains available', () => {
  assert.match(groupSection, /onToggleSelect/)
})
