import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/ownerHours.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports = {}
runInNewContext(js, { exports, Number, Math, Set, Object })

test('typed owner hours keep the agenda total constant', () => {
  const result = exports.rebalanceOwnerHours(['menno', 'take'], { menno: 80, take: 0 }, 80, 'take', 20)
  assert.deepEqual({ ...result }, { menno: 60, take: 20 })
})

test('remaining hours stay proportional across other owners', () => {
  const result = exports.rebalanceOwnerHours(['a', 'b', 'c'], { a: 40, b: 30, c: 10 }, 80, 'c', 20)
  assert.deepEqual({ ...result }, { c: 20, a: 34.3, b: 25.7 })
  assert.equal(Object.values(result).reduce((sum, value) => sum + value, 0), 80)
})

test('selected zero-hour owners are normalized to a complete equal distribution', () => {
  const result = exports.normalizeOwnerHours(
    ['take', 'menno', 'vincent'],
    25.6,
    { take: 25.6, menno: 0, vincent: 0 },
  )
  assert.deepEqual({ ...result }, { take: 8.6, menno: 8.5, vincent: 8.5 })
  assert.equal(Object.values(result).reduce((sum, value) => sum + value, 0), 25.6)
})

test('normalization preserves an intentional positive unequal split', () => {
  assert.deepEqual(
    { ...exports.normalizeOwnerHours(['take', 'menno'], 24, { take: 21.5, menno: 2.5 }) },
    { take: 21.5, menno: 2.5 },
  )
})

test('uren erbij laat ieders aandeel meegroeien, verhoudingen gelijk', () => {
  // De klacht: zet je een klus van 20 naar 40 uur, dan bleef de verdeling
  // op 10 + 10 staan en zakte iedereen van 50% naar 25%.
  const result = exports.scaleOwnerHours({ menno: 10, take: 10 }, 40)
  assert.deepEqual({ ...result }, { menno: 20, take: 20 })
})

test('een scheve verdeling blijft even scheef', () => {
  const result = exports.scaleOwnerHours({ a: 30, b: 10 }, 80)
  assert.deepEqual({ ...result }, { a: 60, b: 20 })
  assert.equal(Object.values(result).reduce((som, v) => som + v, 0), 80)
})

test('het afrondingsrestje gaat naar de grootste deler', () => {
  // 10 verdeeld over drie is 3.33…; opgeteld 9.9. Zonder correctie zou de
  // taart naast het totaal staan.
  const result = exports.scaleOwnerHours({ a: 1, b: 1, c: 1 }, 10)
  assert.equal(Object.values(result).reduce((som, v) => som + v, 0), 10)
})

test('uren eraf werkt net zo goed als uren erbij', () => {
  const result = exports.scaleOwnerHours({ a: 30, b: 10 }, 20)
  assert.deepEqual({ ...result }, { a: 15, b: 5 })
})

test('stond alles op nul, dan is er geen verhouding en wordt het gelijk op', () => {
  const result = exports.scaleOwnerHours({ a: 0, b: 0 }, 10)
  assert.deepEqual({ ...result }, { a: 5, b: 5 })
})

test('zonder eigenaren valt er niets te schalen', () => {
  assert.deepEqual({ ...exports.scaleOwnerHours({}, 40) }, {})
})
