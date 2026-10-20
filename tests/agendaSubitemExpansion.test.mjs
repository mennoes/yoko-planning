import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('agenda items restore their remembered subitem expansion state', () => {
  assert.match(board, /useState\(\(\) => loadRememberedItemExpansion\(item\.id\)\)/)
  assert.match(board, /localStorage\.getItem\(`\$\{ITEM_EXPANSION_KEY_PREFIX\}\$\{itemId\}`\) === '1'/)
})

test('opening and closing subitems updates the remembered preference', () => {
  assert.match(board, /rememberItemExpansion\(item\.id, value\)/)
  assert.match(board, /if \(expanded\) window\.localStorage\.setItem\(key, '1'\)/)
  assert.match(board, /else window\.localStorage\.removeItem\(key\)/)
  assert.match(board, /setExpanded\(x => !x\)/)
})

test('blocked storage never prevents the agenda from rendering', () => {
  assert.match(board, /function loadRememberedItemExpansion[\s\S]*?catch \{[\s\S]*?return false/)
  assert.match(board, /function rememberItemExpansion[\s\S]*?catch \{/)
})
