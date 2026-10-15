import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/todos/page.tsx', import.meta.url), 'utf8')
const weekly = readFileSync(new URL('../components/MemberWeeklyTodos.tsx', import.meta.url), 'utf8')

test("To do's uses the Home workload list for every visible person", () => {
  assert.match(page, /<MemberWeeklyTodos memberId=\{section\.id\}/)
  assert.match(weekly, /memberContributions\(projects, memberId, week/)
  assert.match(weekly, /uit Agenda &amp; Planning/)
  assert.match(weekly, /\/ \{capacity\} uur/)
  assert.match(weekly, /DAYS\.map/)
})

test('manually typed additions are isolated from linked agenda work', () => {
  assert.match(page, /items: section\.items\.filter\(item => !item\.projectRef\)/)
  assert.match(page, /displayTitle="Aanvullingen"/)
  assert.match(page, /const linked = original\.items\.filter\(item => !!item\.projectRef\)/)
})

test('the week selector controls every personal list together', () => {
  assert.match(page, /setWeekOffset\(offset => offset - 1\)/)
  assert.match(page, /setWeekOffset\(offset => offset \+ 1\)/)
  assert.match(page, /weekOffset=\{weekOffset\}/)
})
