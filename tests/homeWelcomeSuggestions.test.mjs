import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync('app/page.tsx', 'utf8')

test('welcome summary links mentioned agenda items to their detail drawer', () => {
  assert.match(home, /href: `\/projects\/\$\{c\.project\.board\}\?focus=/)
  assert.match(home, /<Link href=\{p\.href\}/)
  assert.match(home, /behindSchedule\.map/)
  assert.match(home, /drawer=\$\{encodeURIComponent\(focusId\)\}/)
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
