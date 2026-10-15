import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('planning workload circles use larger view presets', () => {
  assert.match(planning, /return \{ cs: 90, or: 41, hh: 116, av: 58 \}/)
  assert.match(planning, /return\s+\{ cs: 58, or: 26, hh:\s+78, av: 44 \}/)
})

test('workload fill emphasizes the difference between quiet and busy weeks', () => {
  assert.match(planning, /Math\.pow\(ratio, 0\.78\)/)
  assert.match(planning, /Math\.min\(0\.14, \(pct - 1\) \* 0\.16\)/)
  assert.doesNotMatch(planning, /Math\.sqrt\(ratio\)/)
})
