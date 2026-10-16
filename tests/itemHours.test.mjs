import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/itemHours.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const api = {}
runInNewContext(js, { exports: api })

test('manual subitem hours replace the manual parent total', () => {
  assert.equal(api.itemRollupHours(
    { source: 'manual', estHours: 40 },
    [{ source: 'manual', estHours: 12 }, { source: 'manual', estHours: 8 }],
  ), 20)
})

test('zero-hour placeholders do not erase the manual parent total', () => {
  assert.equal(api.itemRollupHours(
    { source: 'manual', estHours: 40 },
    [{ source: 'manual', estHours: 0 }],
  ), 40)
})

test('Google occurrences are added to manual work', () => {
  assert.equal(api.itemRollupHours(
    { source: 'manual', estHours: 40 },
    [{ source: 'google', estHours: 1.5 }, { source: 'google', estHours: 1.5 }],
  ), 43)
})

test('a recurring Google container never counts its stored series total', () => {
  assert.equal(api.itemRollupHours(
    { source: 'google', estHours: 147.5, subitems: [{ id: 'occurrence' }] },
    [{ source: 'google', estHours: 1.5 }, { source: 'google', estHours: 1.5 }],
  ), 3)
})

test('a Google container stays at zero when all occurrences are outside the visible window', () => {
  assert.equal(api.itemRollupHours(
    { source: 'google', estHours: 147.5, subitems: [{ id: 'future-occurrence' }] },
    [],
  ), 0)
})

test('a standalone Google event without subitems retains its own hours', () => {
  assert.equal(api.itemRollupHours({ source: 'google', estHours: 1.5 }, []), 1.5)
})
