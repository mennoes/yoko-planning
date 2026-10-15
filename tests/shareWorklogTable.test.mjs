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

test('producers can leave a persisted question on the share page', () => {
  assert.match(page, /Vragen over de uren/)
  assert.match(page, /method: 'PUT'/)
  assert.match(api, /export async function PUT/)
  assert.match(api, /context_id: shareContext\(board, req\)/)
  assert.match(api, /from\('comments'\)\.insert/)
})
