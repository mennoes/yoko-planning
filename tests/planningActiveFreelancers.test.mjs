import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('freelancers met werk binnen twee weken blijven zichtbaar', () => {
  assert.match(planning, /const ACTIVE_FREELANCER_DAYS = 14/)
  assert.match(planning, /function membersWithWorkSoon\(/)
  assert.match(planning, /const activeFreelancers = freelancers\.filter\(m => freelancersWithWorkSoon\.has\(m\.id\)\)/)
  assert.match(planning, /const shown = freelancersPos !== 0 \? freelancers : activeFreelancers/)
  // Ook in de dagweergave.
  assert.match(planning, /: freelancersVisible\.filter\(m => freelancersWithWorkSoon\.has\(m\.id\)\)/)
})

test('werk dat nu loopt telt mee, afgerond werk niet', () => {
  const fn = planning.slice(planning.indexOf('function membersWithWorkSoon('), planning.indexOf('function contributionsPerCell('))
  // Overlap met het venster, niet alleen items die erin starten.
  assert.match(fn, /if \(end < from \|\| start > until\) continue/)
  assert.match(fn, /if \(project\.status === 'done'\) continue/)
})

test('de kop vertelt waarom die mensen er staan', () => {
  assert.match(planning, /\$\{activeFreelancers\.length\} met werk deze 2 weken/)
  assert.match(planning, /note\?: string/)
})

test('de lijst wordt één keer per projectenset berekend', () => {
  assert.match(planning, /const freelancersWithWorkSoon = useMemo\(\n\s+\(\) => membersWithWorkSoon\(effectiveProjects\),\n\s+\[effectiveProjects\],\n\s+\)/)
})
