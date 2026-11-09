import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const deadlines = readFileSync(new URL('../components/PlanningDeadlines.tsx', import.meta.url), 'utf8')
const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('deadline flags have their own lane instead of covering project bars', () => {
  assert.doesNotMatch(deadlines, /anchors/)
  assert.match(deadlines, /height:ends\.length\*22\+4/)
  assert.match(deadlines, /borderBottom:'1px solid var\(--border-light\)'/)
  assert.match(planning, /<PlanningDeadlines projects=\{owned\}[\s\S]{0,180}?\/>\s*<div style=\{\{ position: 'relative', height/)
})

test('day view places all deadlines in the separate lane', () => {
  assert.match(planning, /<PlanningDeadlines projects=\{visible\} cols=\{cols\} zoom="dag"/)
  assert.doesNotMatch(planning, /<PlanningDeadlines[^>]+anchors=/)
})
