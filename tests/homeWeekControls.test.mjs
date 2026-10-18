import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')
const todos = readFileSync(new URL('../app/todos/page.tsx', import.meta.url), 'utf8')

test('het Overbelast-overzicht heeft weekpijlen met het bereik erbij', () => {
  // Zonder de datums zeggen de pijltjes niets.
  const card = home.slice(home.indexOf('overload: ('), home.indexOf('overload: (') + 3000)
  assert.match(card, /Overbelast\n/)
  assert.match(card, /\{weekRangeLabel\}/)
  assert.match(card, /title="Vorige week"/)
  assert.match(card, /title="Volgende week"/)
})

test('beide kaarten volgen dezelfde weekkeuze', () => {
  // weekStartTeam stond vast op de huidige week; de To do's-kaart schoof
  // wel mee met de pijlen en liep dus uit de pas.
  assert.match(home, /monday\.setDate\(monday\.getDate\(\) \+ weekOffset \* 7\)\n\s+return monday/)
  assert.match(home, /const weekRangeLabel = \(\(\) => \{/)
})

test('je kunt de week van een collega bekijken, maar niet afvinken', () => {
  assert.match(home, /const \[viewMemberId, setViewMemberId\] = useState<string>\(''\)/)
  assert.match(home, /const shownWeekMemberId = viewMemberId \|\| memberId/)
  assert.match(home, /const contribs = memberContributions\(allProjects, shownMemberId, week/)
  assert.match(home, /readOnly=\{shownWeekMemberId !== memberId\}/)
  assert.match(home, /disabled=\{readOnly\}/)
  // De capaciteit hoort bij de getoonde persoon, niet bij jou.
  assert.match(home, /const capMemberId = viewMemberId \|\| memberId/)
})

test('een groep aanklikken toont alleen die groep, shift zet erbij', () => {
  assert.match(todos, /if \(event\.shiftKey \|\| event\.metaKey \|\| event\.ctrlKey\) \{ toggleTeamGroupFilter\(group\.id\); return \}/)
  assert.match(todos, /updateTeamGroupFilter\(\[group\.id\]\)/)
  // Nog een keer op de enige actieve groep = weer alles.
  assert.match(todos, /if \(selected && selectedTeamGroupSet\.size === 1\) \{\n\s+updateTeamGroupFilter\(teamFilterOptions\.map\(option => option\.id\)\)/)
})
