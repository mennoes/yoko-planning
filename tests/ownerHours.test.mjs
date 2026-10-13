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
