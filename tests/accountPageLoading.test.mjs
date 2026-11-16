import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/accounts/page.tsx', import.meta.url), 'utf8')
const permissions = readFileSync(new URL('../lib/useAccountPermissions.ts', import.meta.url), 'utf8')

test('accounts loading uses the local session instead of a blocking user request', () => {
  assert.match(page, /supabase\.auth\.getSession\(\)/)
  assert.doesNotMatch(page, /supabase\.auth\.getUser\(\)/)
})

test('account permission management also starts from the local session', () => {
  assert.match(permissions, /supabase\.auth\.getSession\(\)/)
  assert.doesNotMatch(permissions, /supabase\.auth\.getUser\(\)/)
  assert.match(permissions, /fetch\('\/api\/accounts\/access'/)
})
