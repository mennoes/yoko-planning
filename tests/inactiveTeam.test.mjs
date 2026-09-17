import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('planning keeps inactive members in a separate collapsed section', () => {
  const source = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
  assert.match(source, /planning-inactive-team-open', false/)
  assert.match(source, /sectionHeader\('Inactief team'/)
  assert.match(source, /sectionLabel\('Inactief team'/)
  assert.match(source, /const inactiveVisible = team\.filter/)
  assert.match(source, /isYokoCrew\(m\.id\) && !isMemberInactive\(m\.id\)/)
  assert.match(source, /if \(inactiveTeamPos !== 0\)/)
  assert.match(source, /if \(isMemberInactive\(m\.id\)\) continue/)
})

test('team admin persists inactive status through the authenticated server route', () => {
  const page = readFileSync(new URL('../app/team-admin/page.tsx', import.meta.url), 'utf8')
  const route = readFileSync(new URL('../app/api/team/status/route.ts', import.meta.url), 'utf8')
  assert.match(page, /fetch\('\/api\/team\/status'/)
  assert.match(route, /supabaseAdmin/)
  assert.match(route, /update\(\{ inactive: body\.inactive \}\)/)
  assert.match(route, /cannot_change_unassigned/)
})

test('planning uses the shared personal task status from agendas', () => {
  const source = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
  assert.match(source, /PersonalCompletionSection/)
  assert.match(source, /completionTargetForProject/)
  assert.match(source, /ariaLabel="Status mijn taak"/)
  assert.match(source, /layout="row"/)
  assert.match(source, /disabled=\{disabled\}/)
})
