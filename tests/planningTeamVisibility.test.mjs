import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('planning keeps active freelancers visible without requiring recent work', () => {
  assert.doesNotMatch(planning, /isFreelancerActive/)
  assert.doesNotMatch(planning, /activeFreelancerIds/)
  assert.match(planning, /new Set<string>\(team\.map\(member => member\.id\)\)/)
  assert.match(planning, /const freelancers\s+= visible\.filter\(m => !isYokoCrew/)
})
