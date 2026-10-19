import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('activiteit bepaalt in welke sectie iemand staat, niet óf je iemand ziet', () => {
  // Eerder verborg de planning freelancers zonder recent werk helemaal.
  // Dat is teruggedraaid met de regel: activiteit mag nooit stilletjes
  // iemand laten verdwijnen. Die regel geldt nog steeds — iedereen is
  // standaard zichtbaar.
  assert.match(planning, /new Set<string>\(team\.map\(member => member\.id\)\)/)

  // Wat activiteit wél doet: bepalen of een freelancer onder 'Freelancers'
  // of onder 'Inactief team' staat. Beide secties blijven in beeld, dus er
  // verdwijnt niemand.
  assert.match(planning, /if \(!isYokoCrew\(id\)\) return !activeFreelancerIds\.has\(id\)/)
  assert.match(planning, /const activeFreelancerIds = useMemo\(/)
  assert.match(planning, /membersWithWorkInWindow\(effectiveProjects/)
})

test('het handmatige vinkje blijft gelden voor het eigen team', () => {
  // Iemand die weggaat is weg, ook in een week zonder geplande uren. Dat
  // mag niet afhangen van of er toevallig werk staat.
  assert.match(planning, /return !!liveTeam\.find\(m => m\.id === id\)\?\.inactive/)
})
