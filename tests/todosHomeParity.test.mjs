import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/todos/page.tsx', import.meta.url), 'utf8')
const weekly = readFileSync(new URL('../components/MemberWeeklyTodos.tsx', import.meta.url), 'utf8')

test("To do's uses the Home workload list for every visible person", () => {
  // `compact` schakelt alleen de herhaalde kaartkop uit; de lijst zelf
  // is dezelfde als op Home.
  assert.match(page, /<MemberWeeklyTodos (compact )?memberId=\{section\.id\}/)
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

test('desktop puts every person in a narrow column with additions underneath', () => {
  assert.match(page, /data-personal-todo-grid/)
  assert.match(page, /gridTemplateColumns: `repeat\(\$\{personal\.length\}, minmax\(270px, 1fr\)\)`/)
  assert.match(page, /data-personal-todo-column/)
  assert.match(page, /<MemberWeeklyTodos compact memberId=\{section\.id\}/)
  const desktopColumn = page.slice(page.indexOf('data-personal-todo-column'))
  assert.ok(desktopColumn.indexOf('<MemberWeeklyTodos compact') < desktopColumn.indexOf('displayTitle="Aanvullingen"'))
})

test('people can filter the todo columns by one or more planning groups', () => {
  assert.match(page, /useTeamGroups\(\)/)
  assert.match(page, /data-todo-team-group-filter/)
  assert.match(page, /aria-pressed=\{selected\}/)
  assert.match(page, /todos-visible-team-groups/)
  assert.match(page, /selectedTeamGroupSet\.has\(teamGroupIdForMember\(section\.id\)\)/)
  assert.match(page, /if \(next\.size === 1\) return/)
  assert.match(page, />\s*Alles\s*</)
})
