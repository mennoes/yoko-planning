import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const exports = {}
runInNewContext(ts.transpileModule(
  readFileSync(new URL('../lib/subitemDateSuggestions.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports })

const suggest = exports.suggestSubitemDateRanges
const plain = value => JSON.parse(JSON.stringify(value))

test('verdeelt de periode van een hoofditem gelijkmatig over lege subitems', () => {
  assert.deepEqual(plain(suggest('2026-12-16', '2027-01-15', [
    { id: 's1' }, { id: 's2' }, { id: 's3' },
  ])), {
    s1: { startDate: '2026-12-16', endDate: '2026-12-25' },
    s2: { startDate: '2026-12-26', endDate: '2027-01-04' },
    s3: { startDate: '2027-01-05', endDate: '2027-01-15' },
  })
})

test('laat bestaande datums ongemoeid en behoudt hun plaats in de verdeling', () => {
  assert.deepEqual(plain(suggest('2026-12-01', '2026-12-09', [
    { id: 's1' },
    { id: 's2', startDate: '2026-12-04', endDate: '2026-12-05' },
    { id: 's3' },
  ])), {
    s1: { startDate: '2026-12-01', endDate: '2026-12-03' },
    s3: { startDate: '2026-12-07', endDate: '2026-12-09' },
  })
})

test('maakt zonder ouderperiode geen suggesties en normaliseert omgekeerde datums', () => {
  assert.deepEqual(plain(suggest(null, null, [{ id: 's1' }])), {})
  assert.deepEqual(plain(suggest('2026-12-03', '2026-12-01', [{ id: 's1' }])), {
    s1: { startDate: '2026-12-01', endDate: '2026-12-03' },
  })
})
