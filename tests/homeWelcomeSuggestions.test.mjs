import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync('app/page.tsx', 'utf8')

test('welcome summary opens mentioned agenda items inside Home', () => {
  assert.match(home, /boardId: c\.project\.board, parentItemId: focusId, subitemId: subitem/)
  assert.match(home, /setHomeDetail\(\{ boardId: group\.boardId, parentItemId: group\.parentItemId \}\)/)
  assert.match(home, /setHomeDetail\(\{ boardId: item\.boardId, parentItemId: item\.parentItemId, subitemId: item\.subitemId \}\)/)
  assert.match(home, /behindSchedule\.map/)
  assert.match(home, /setHomeDetail\(\{ boardId: p\.board, parentItemId: focusId, subitemId: p\.completionSubitemId \}\)/)
})

test('welcome summary groups subitems after one main project name', () => {
  assert.match(home, /parentName\?: string/)
  assert.match(home, /const parentName = c\.project\.parentName \?\? c\.project\.parentProject\?\.name/)
  assert.match(home, /\[c\.project\.board, focusId, subitem \?\? c\.project\.name\.trim\(\)\.toLowerCase\(\)\]/)
  assert.match(home, /const groupProjectMentions/)
  assert.match(home, /`parent:\$\{item\.boardId\}:\$\{item\.parentItemId\}`/)
  assert.match(home, /\{group\.parentName\}[\s\S]*group\.items\.map/)
  assert.doesNotMatch(home, /↳ \{p\.parentName\}/)
})

test('overdue subitems name their main project', () => {
  assert.match(home, /const parentLabel = p\.parentName \?\? p\.parentProject\?\.name/)
  assert.match(home, /↳ \{parentLabel\}/)
})

test('free-time suggestion follows ideas, busy colleagues and todo fallbacks', () => {
  assert.match(home, /const suggestedIdea = ideas/)
  assert.match(home, /const busyColleague = overloaded\.find/)
  assert.match(home, /section\.id === 'ideeen' \|\| section\.id === 'socials'/)
  assert.match(home, /\/ideas\?idea=/)
  assert.match(home, /misschien kun je daar iets overnemen/)
  assert.match(home, /In \{suggestedTodo\.sectionTitle\} staat nog/)
})

test('personal message follows working days and looks ahead after the workweek', () => {
  assert.match(home, /lookupDaysOff\(memberId, memberNameForSchedule\)/)
  assert.match(home, /isWorkWeekFinished\(new Date\(\), \[\.\.\.personalDaysOff\]\)/)
  assert.match(home, /Je werkweek zit erop/)
  assert.match(home, /Vooruitkijkend: volgende week staan/)
  assert.match(home, /const nextWeekProjects = groupProjects\(myNextContribs\)/)
  assert.match(home, /!workWeekFinished && slack >= 4/)
})
