import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const guardedRoutes = [
  '../app/api/team/delete/route.ts',
  '../app/api/team/invite/route.ts',
  '../app/api/admin/import-boards/route.ts',
  '../app/api/snapshots/restore/route.ts',
  '../app/api/snapshots/merge-missing-items/route.ts',
  '../app/api/snapshots/merge-missing-subitems/route.ts',
  '../app/api/snapshots/restore-est/route.ts',
  '../app/api/snapshots/restore-item-est/route.ts',
]

for (const path of guardedRoutes) {
  test(`${path} requires a team administrator before service-role writes`, () => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    const guard = source.indexOf('await requireTeamAdmin(req)')
    const firstWrite = source.search(/supabaseAdmin\s*\.from\([^)]*\)\s*\.(?:insert|upsert|update|delete)/s)

    assert.ok(guard >= 0, 'route must invoke the shared admin guard')
    if (firstWrite >= 0) {
      assert.ok(guard < firstWrite, 'admin guard must run before the first service-role write')
    }
  })
}
