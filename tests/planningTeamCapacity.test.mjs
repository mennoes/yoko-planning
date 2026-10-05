import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('team capacity summaries render for every planning zoom level', () => {
  assert.match(planning, /team-cap-day-/)
  assert.match(planning, /team-cap-\$\{label\}-\$\{col\.key\}/)
  assert.doesNotMatch(planning, /zoom === 'week' && opts\?\.members\?\.length \? cols\.map/)
  assert.match(planning, /\{total\}\/\{capacity\}u/)
})

test('team labels reserve the complete sticky name column', () => {
  assert.match(planning, /width: opts\?\.members\?\.length \? nameW \+ namePad : 'max-content'/)
  assert.match(planning, /width: nameW \+ namePad, flexShrink: 0/)
})

test('past columns are dimmed in all zoom levels', () => {
  assert.match(planning, /\{cols\.map\(\(col, index\) => col\.isPast \? \(/)
  assert.match(planning, /opacity: col\.isPast \? 0\.75 : 1/)
})

test('each person shows a subtle weekly capacity label', () => {
  assert.match(planning, /Weekcapaciteit:/)
  assert.match(planning, /\{member\.weeklyCapacity\}u\/w/)
  assert.match(planning, /\{m\.weeklyCapacity\}u\/w/)
})
