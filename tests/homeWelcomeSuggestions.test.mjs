import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync('app/page.tsx', 'utf8')

test('welcome summary opens mentioned agenda items inside Home', () => {
  assert.match(home, /boardId: c\.project\.board, parentItemId: focusId, subitemId: subitem/)
  assert.match(home, /setHomeDetail\(\{ boardId: p\.boardId, parentItemId: p\.parentItemId, subitemId: p\.subitemId \}\)/)
  assert.match(home, /behindSchedule\.map/)
  assert.match(home, /setHomeDetail\(\{ boardId: p\.board, parentItemId: focusId, subitemId: p\.completionSubitemId \}\)/)
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
