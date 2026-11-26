import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const table = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')

test('each agenda item exposes its own compact color picker', () => {
  assert.match(table, /aria-label=\{`Kleur van \$\{item\.name \|\| 'item'\} wijzigen`\}/)
  assert.match(table, />Itemkleur<\/div>/)
  assert.match(table, /onUpdate\(\{ color \}\)/)
  assert.match(table, /onUpdate\(\{ color: undefined \}\)/)
  assert.match(table, />\s*Gebruik groepskleur\s*<\/button>/)
})

test('the item color is persisted in the existing extra metadata', () => {
  assert.doesNotMatch(store, /'color'.*STANDARD_FIELDS/)
  assert.match(store, /if \(!STANDARD_FIELDS\.has\(k\)\) extra\[k\]/)
})
