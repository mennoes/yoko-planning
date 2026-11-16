import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/accounts/page.tsx', import.meta.url), 'utf8')
const permissions = readFileSync(new URL('../lib/useAccountPermissions.ts', import.meta.url), 'utf8')
const groups = readFileSync(new URL('../components/AccountGroups.tsx', import.meta.url), 'utf8')
const store = readFileSync(new URL('../lib/accountsStore.ts', import.meta.url), 'utf8')

test('accounts loading uses the local session instead of a blocking user request', () => {
  assert.match(page, /supabase\.auth\.getSession\(\)/)
  assert.doesNotMatch(page, /supabase\.auth\.getUser\(\)/)
})

test('account permission management also starts from the local session', () => {
  assert.match(permissions, /supabase\.auth\.getSession\(\)/)
  assert.doesNotMatch(permissions, /supabase\.auth\.getUser\(\)/)
  assert.match(permissions, /fetch\('\/api\/accounts\/access'/)
})

test('account layout does not perform another blocking online user lookup', () => {
  assert.match(groups, /supabase\?\.auth\.getSession\(\)/)
  assert.doesNotMatch(groups, /supabase\?\.auth\.getUser\(\)/)
})

test('account ordering and category grouping are memoized', () => {
  assert.match(groups, /const ordered=useMemo/)
  assert.match(groups, /const byCategory=useMemo/)
  assert.doesNotMatch(groups, /layout\.order\.indexOf/)
  assert.doesNotMatch(groups, /accounts\.findIndex/)
})

test('account access and rows load in parallel after the local session check', () => {
  const detailed = store.slice(store.indexOf('export async function pullAccountsDetailed'), store.indexOf('export async function upsertAccount'))
  assert.match(detailed, /supabase\.auth\.getSession\(\)/)
  assert.match(detailed, /Promise\.all\(\[/)
  assert.match(detailed, /supabase\.rpc\('can_access_accounts'\)/)
  assert.match(detailed, /\.from\('accounts'\)/)
  assert.doesNotMatch(detailed, /getCurrentUserId\(\)/)
})
