import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = file => readFileSync(new URL(file, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const deadlines = source('../components/PlanningDeadlines.tsx')
const planning = source('../app/planning/page.tsx')

test('deadline flags have their own lane instead of covering project bars', () => {
  assert.doesNotMatch(deadlines, /anchors/)
  assert.match(deadlines, /height:ends\.length\*22\+4/)
  assert.match(deadlines, /borderBottom:'1px solid var\(--border-light\)'/)
  const timeline = planning.slice(planning.indexOf('<PlanningDeadlines projects={owned}'), planning.indexOf('<PlanningDeadlines projects={owned}') + 600)
  assert.match(timeline, /data-testid=\{`planning-timeline-\$\{memberId\}`\}/)
  assert.match(timeline, /position: 'relative', height/)
})

test('day view places all deadlines in the separate lane', () => {
  assert.match(planning, /<PlanningDeadlines projects=\{visible\} cols=\{cols\} zoom="dag"/)
  assert.doesNotMatch(planning, /<PlanningDeadlines[^>]+anchors=/)
})
