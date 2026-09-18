import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function route(file, actorId = 'menno') {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const writes = []
  const admin = { from(table) {
    return {
      select() { return this }, eq() { return this },
      update(patch) { writes.push({ table, patch }); return this },
      async maybeSingle() { return { data: table === 'profiles' ? { member_id: actorId } : { id: 'manuel', inactive: true }, error: null } },
    }
  } }
  const exports = {}
  runInNewContext(js, { exports, Response, console, require(id) {
    const mocks = {
      '@/lib/supabase': { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'user-id' } }, error: null }) } } },
      '@/lib/supabaseAdmin': { supabaseAdmin: admin },
      '@/lib/teamAdmin': { isTeamAdmin: id => ['menno', 'vincent'].includes(id) },
    }
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`)
    return mocks[id]
  } })
  const request = (body, bearer = true) => ({
    headers: new Headers(bearer ? { authorization: 'Bearer token' } : {}),
    json: async () => body,
  })
  return { POST: exports.POST, writes, request }
}

test('admin may edit an existing team profile without changing its identity', async () => {
  const { POST, writes, request } = route('../app/api/team/profile/route.ts')
  const res = await POST(request({ memberId: 'manuel', patch: { role: 'Designer', days_off: ['sun'] } }))
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ table: 'profiles', patch: { role: 'Designer', days_off: ['sun'] } }])
})

test('non-admin cannot edit someone else’s profile', async () => {
  const { POST, writes, request } = route('../app/api/team/profile/route.ts', 'manuel')
  const res = await POST(request({ memberId: 'menno', patch: { bio: 'changed' } }))
  assert.equal(res.status, 403)
  assert.equal(writes.length, 0)
})

test('admin profile endpoint rejects identity changes and malformed dates', async () => {
  const { POST, writes, request } = route('../app/api/team/profile/route.ts')
  assert.equal((await POST(request({ memberId: 'manuel', patch: { user_id: 'other' } }))).status, 400)
  assert.equal((await POST(request({ memberId: 'manuel', patch: { birthday: 'tomorrow' } }))).status, 400)
  assert.equal((await POST(request({ memberId: 'manuel', patch: { role: 'Designer' } }, false))).status, 401)
  assert.equal(writes.length, 0)
})

test('inactive status endpoint also enforces team admin permissions', async () => {
  const { POST, writes, request } = route('../app/api/team/status/route.ts', 'manuel')
  const res = await POST(request({ id: 'manuel', inactive: true }))
  assert.equal(res.status, 403)
  assert.equal(writes.length, 0)
})

test('team page has contextual actions and profile has admin controls', () => {
  const teamPage = readFileSync(new URL('../app/team-admin/page.tsx', import.meta.url), 'utf8')
  const profilePage = readFileSync(new URL('../app/profile/[memberId]/page.tsx', import.meta.url), 'utf8')
  assert.match(teamPage, /Acties voor \$\{member\.name\}/)
  assert.match(teamPage, /Profiel bekijken \/ bewerken/)
  assert.match(teamPage, /Inactief maken/)
  assert.match(profilePage, /<AdminTeamCard/)
  assert.match(profilePage, /\/api\/team\/profile/)
  assert.match(profilePage, /Planningstatus/)
})
