import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/planningBarHeight.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports = {}
runInNewContext(js, { exports, Date, Number })

test('forty hours fill one workweek but stay subtle across a long period', () => {
  assert.equal(exports.planningBarHeightRatio({ hours: 40, startDate: '2026-10-05', endDate: '2026-10-09' }), 1)
  const spread = exports.planningBarHeightRatio({ hours: 40, startDate: '2026-10-05', endDate: '2026-12-31' })
  assert.ok(spread > 0.1 && spread < 0.15, `expected a subtle long-running bar, got ${spread}`)
})

test('height follows average daily load rather than total project hours', () => {
  const tenDays = exports.planningBarHeightRatio({ hours: 40, startDate: '2026-10-05', endDate: '2026-10-16' })
  assert.ok(tenDays > 0.5 && tenDays < 0.55)
  const sameDensity = exports.planningBarHeightRatio({ hours: 80, startDate: '2026-10-05', endDate: '2026-10-30' })
  assert.equal(sameDensity, tenDays)
})

test('low personal workloads keep visibly different bar heights', () => {
  const low = exports.planningBarHeightRatio({ hours: 20, startDate: '2026-10-01', endDate: '2026-12-31' })
  const high = exports.planningBarHeightRatio({ hours: 40, startDate: '2026-10-01', endDate: '2026-12-31' })
  const lowPx = exports.planningBarPixelHeight(89, low)
  const highPx = exports.planningBarPixelHeight(89, high)

  assert.ok(highPx > lowPx, `${highPx}px should be taller than ${lowPx}px`)
  assert.ok(lowPx >= 10)
  assert.ok(highPx <= 89)
})
