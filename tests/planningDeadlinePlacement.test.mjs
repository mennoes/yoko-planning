import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = file => readFileSync(new URL(file, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
const deadlines = source('../components/PlanningDeadlines.tsx')
const planning = source('../app/planning/page.tsx')

test('deadline flags sit on the corresponding planning bars', () => {
  assert.match(deadlines, /anchors:PlanningDeadlineAnchor\[\]/)
  assert.match(deadlines, /const anchorFor=/)
  assert.match(deadlines, /position:'absolute',inset:0,pointerEvents:'none'/)
  assert.doesNotMatch(deadlines, /height:ends\.length\*22\+4/)
  const timeline = planning.slice(planning.indexOf('data-testid={`planning-timeline-'), planning.indexOf('data-testid={`planning-timeline-') + 1000)
  assert.match(timeline, /<PlanningDeadlines projects=\{owned\}/)
  assert.match(timeline, /anchors=\{visibleBars\.map/)
})

test('day view attaches deadline flags to all-day and timed items', () => {
  assert.match(planning, /anchors=\{allDayBars\.map/)
  assert.match(planning, /anchors=\{timedBars\.map/)
  assert.doesNotMatch(planning, /<div style=\{\{display:'flex'\}\}><div[^\n]+<PlanningDeadlines/)
})
