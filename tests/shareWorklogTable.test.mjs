import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/share/[board]/page.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../app/api/share/[board]/route.ts', import.meta.url), 'utf8')

test('share page is one concise work-accountability table', () => {
  assert.match(page, /aria-label="Urenverantwoording"/)
  assert.match(page, />Datum</)
  assert.match(page, />Werk</)
  assert.match(page, />Door</)
  assert.match(page, />Uren</)
  assert.doesNotMatch(page, /Uren per project/)
  assert.doesNotMatch(page, /filteredGroups\.map/)
})

test('share API exposes subitem owners for accurate accountability', () => {
  assert.match(api, /ownerIds:\s+s\.ownerIds \?\? r\.owner_ids \?\? \[\]/)
})

test('share page resolves live owners and renders their avatars', () => {
  assert.match(api, /from\('team_members'\)\.select\('id, name, color'\)\.in\('id', sharedOwnerIds\)/)
  assert.match(api, /from\('profiles'\)\.select\('member_id, photo'\)\.in\('member_id', sharedOwnerIds\)/)
  assert.match(api, /Response\.json\(\{ ok: true, board, groups, owners, monthlyHours, comments \}\)/)
  assert.match(page, /function ShareOwnerAvatar/)
  assert.match(page, /<ShareOwners ownerIds=\{row\.ownerIds\} ownersById=\{ownersById\} \/>/)
  assert.doesNotMatch(page, /teamData\.members\.find/)
})

test('share page uses restrained solid cards and clear Studio Yoko branding', () => {
  assert.match(page, /src="\/yoko-logo\.png" alt="Studio Yoko"/)
  assert.match(page, />Studio Yoko</)
  assert.match(page, /background: active \? 'var\(--yellow\)' : 'var\(--bg-card\)'/)
  assert.doesNotMatch(page, /boxShadow: active/)
  assert.doesNotMatch(page, /color \+ '14'/)
  assert.doesNotMatch(page, /color \+ '55'/)
  assert.doesNotMatch(page, /group\.color \+ '18'/)
})

test('share monthly totals use the same project materialization as Home and Planning', () => {
  assert.match(api, /groupsToProjects\(board, workloadGroups\)/)
  assert.doesNotMatch(api, /function collectHourSources/)
})

test('producers can leave a persisted question on the share page', () => {
  assert.match(page, /Vragen over de uren/)
  assert.match(page, /method: 'PUT'/)
  assert.match(api, /export async function PUT/)
  assert.match(api, /context_id: shareContext\(board, req\)/)
  assert.match(api, /from\('comments'\)\.insert/)
})
