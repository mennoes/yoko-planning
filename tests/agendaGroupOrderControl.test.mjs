import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const start = source.indexOf('function BoardGroupSection')
const end = source.indexOf('// ─── BoardTable', start)
const groupSection = source.slice(start, end > start ? end : undefined)

test('agenda group header exposes the item order control directly', () => {
  assert.match(groupSection, /onToggleReorder/)
  assert.match(groupSection, /reorderMode \? 'Klaar' : 'Volgorde'/)
  assert.match(groupSection, /aria-pressed=\{reorderMode\}/)
})

test('agenda group no longer offers select-all controls', () => {
  assert.doesNotMatch(groupSection, /selecteer alles/i)
  assert.doesNotMatch(groupSection, /onSelectGroup/)
})

test('individual row selection remains available', () => {
  assert.match(groupSection, /onToggleSelect/)
})
