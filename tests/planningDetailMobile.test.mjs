import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('geen sleepgreep meer naast elke naam in het raster', () => {
  // De greep blijft bestaan in 'Mensen & capaciteit', waar je mensen
  // tussen secties sleept; in de rijen zelf was 't ruis.
  assert.equal((planning.match(/planningTeamDragHandle\((?:m|member)\)/g) ?? []).length, 1)
  assert.doesNotMatch(planning, /\{!editOrder && planningTeamDragHandle\(/)
})

test('namenkolom: ruimer op mobiel, versleepbaar op desktop', () => {
  assert.match(planning, /const nameW\s+= isMobile \? 104 : nameColW/)
  assert.match(planning, /localStorage\.setItem\('planning-name-w', String\(nameColW\)\)/)
  assert.match(planning, /Sleep om de namenkolom breder of smaller te maken/)
})

test('het itemvenster is op mobiel een bottom sheet', () => {
  assert.match(planning, /position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 300/)
  assert.match(planning, /borderRadius: '18px 18px 0 0'/)
})

test('swipen in het venster trekt de pagina niet meer in refresh', () => {
  // overscroll-behavior stopt het doorketenen naar de pagina; de
  // body-lock vangt de rest.
  assert.match(planning, /overscrollBehavior: 'contain' as const/)
  assert.match(planning, /overflowY: 'auto', overscrollBehavior: 'contain'/)
  assert.match(planning, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(planning, /touchAction: 'none' \}\} \/>/)
})

test('de timer is uit het itemvenster', () => {
  assert.doesNotMatch(planning, /<Row label="Tijd">/)
  assert.doesNotMatch(planning, /Start timer/)
  assert.doesNotMatch(planning, /from '@\/lib\/timerStore'/)
})

test('labels staan op mobiel boven hun waarde', () => {
  const row = planning.slice(planning.indexOf('function Row({ label'), planning.indexOf('function Row({ label') + 900)
  assert.match(row, /const isMobile = useIsMobile\(\)/)
  assert.match(row, /\? \{ display: 'block', marginBottom: 16 \}/)
})
