import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const exports = {}
runInNewContext(ts.transpileModule(
  readFileSync(new URL('../lib/dateRangeClipboard.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports })

test('maakt een kopieerbaar bereik van een of twee datums', () => {
  const plain = value => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(exports.normaliseDateRange('2026-12-01', null)), {
    startDate: '2026-12-01', endDate: '2026-12-01',
  })
  assert.deepEqual(plain(exports.normaliseDateRange('2026-12-09', '2026-12-02')), {
    startDate: '2026-12-02', endDate: '2026-12-09',
  })
  assert.equal(exports.normaliseDateRange(null, null), null)
})
