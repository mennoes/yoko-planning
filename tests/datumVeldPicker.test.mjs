import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../components/DatumVeld.tsx', import.meta.url), 'utf8')

const calendar = readFileSync(new URL('../components/SingleDateCalendar.tsx', import.meta.url), 'utf8')

test('het kalendericoon opent de eigen maandkalender zonder de agendacel te sluiten', () => {
  assert.match(source, /data-testid="datum-kalender"/)
  assert.match(source, /onMouseDown=\{event => event\.preventDefault\(\)\}/)
  assert.match(source, /<SingleDateCalendar anchor=\{kalenderKnop\}/)
  assert.doesNotMatch(source, /<input type="date"/)
})

test('de kalender toont een maandraster en geeft de gekozen ISO-datum terug', () => {
  assert.match(calendar, /role="dialog" aria-label="Datum kiezen"/)
  assert.match(calendar, /gridTemplateColumns: '30px repeat\(7, 1fr\)'/)
  assert.match(calendar, /onChange\(date\)/)
  assert.match(calendar, />Vandaag<\/button>/)
  assert.match(calendar, />Wissen<\/button>/)
})
