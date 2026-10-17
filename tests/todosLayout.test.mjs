import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/todos/page.tsx', import.meta.url), 'utf8')
const weekly = readFileSync(new URL('../components/MemberWeeklyTodos.tsx', import.meta.url), 'utf8')

test('de kop "To do’s" staat niet bij elke collega opnieuw', () => {
  // De pagina heet al To do's en de naam van de persoon staat er direct
  // boven; in de smalle kolomweergave is die kop pure herhaling.
  assert.match(weekly, /\{!compact && \(/)
  assert.match(weekly, /uit Agenda &amp; Planning/)
  assert.doesNotMatch(weekly, /compact \? <>Agenda \+ Planning<\/>/)
})

test('de algemene rij telt zijn eigen kolommen en blijft op één regel', () => {
  // Stond op het AANTAL PERSONEN: meer secties dan personen betekende een
  // tweede regel. Nu bepaalt het aantal secties de kolommen.
  assert.match(page, /const generalCols = Math\.max\(1, general\.length\)/)
  assert.match(page, /repeat\(\$\{generalCols\}, minmax\(\$\{COL_MIN\}px, 1fr\)\)/)
  assert.match(page, /const COL_MIN = 250/)
  // Past 't niet, dan scroll je horizontaal in plaats van te wrappen.
  assert.match(page, /overflowX: 'auto' as const/)
})

test('de losse +-kolom is weg; de knop bovenaan blijft', () => {
  assert.doesNotMatch(page, /Persistente '\+ sectie'-knop/)
  // Alleen nog de knop in de paginakop, die mobiel en desktop delen.
  assert.equal((page.match(/\+ Nieuwe sectie/g) ?? []).length, 1)
})

test('kaarten naast elkaar krijgen een compacte kop', () => {
  assert.match(page, /compact\?: boolean/)
  assert.match(page, /padding: compact \? '8px 12px 7px' : '13px 16px 11px'/)
  assert.match(page, /fontSize: compact \? 12\.5 : 18/)
  assert.match(page, /<TodoCard section=\{additions\} isMember=\{true\} compact/)
  assert.match(page, /<TodoCard key=\{s\.id\} section=\{s\} isMember=\{false\} onUpdate=\{updateSection\} compact/)
})
