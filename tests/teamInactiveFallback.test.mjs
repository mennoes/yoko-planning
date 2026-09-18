import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/teamStore.ts', import.meta.url), 'utf8')

function loadTeamStore(missingColumns) {
  const selected = []
  const row = {
    id: 'manuel', name: 'Manuel', email: '', color: '#9aadbd',
    weekly_capacity: 40, position: 8, hidden: false,
    kind: 'yoko', start_date: null, inactive: true,
  }
  const supabase = {
    from(table) {
      if (table === 'team_members') return {
        select(columns) {
          selected.push(columns)
          return { async order() {
            const missing = missingColumns.find(column => columns.split(', ').includes(column))
            return missing
              ? { data: null, error: { message: `column team_members.${missing} does not exist` } }
              : { data: [Object.fromEntries(columns.split(', ').map(column => [column, row[column]]))], error: null }
          } }
        },
      }
      if (table === 'team_members_extra') return {
        select() { return { async like() { return { data: [], error: null } } } },
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const exports = {}
  runInNewContext(js, { exports, console, require(id) {
    const mocks = {
      './supabase': { supabase },
      '@/data/team.json': { members: [] },
      './sync': { getCurrentUserId: async () => 'user' },
      './teamMemberIdentity': {
        START_DATE_META_PREFIX: '__team_start_date__:',
        isTeamMetadataId: id => id.startsWith('__team_start_date__:'),
      },
    }
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`)
    return mocks[id]
  } })
  return { pullTeam: exports.pullTeam, selected }
}

test('missing legacy start_date does not discard a saved inactive status', async () => {
  const { pullTeam, selected } = loadTeamStore(['start_date'])
  const members = await pullTeam()
  assert.equal(members[0].id, 'manuel')
  assert.equal(members[0].inactive, true)
  assert.equal(members[0].kind, 'yoko')
  assert.match(selected.at(-1), /inactive/)
  assert.doesNotMatch(selected.at(-1), /start_date/)
})

test('missing kind and start_date still retain inactive and use freelance fallback', async () => {
  const { pullTeam, selected } = loadTeamStore(['start_date', 'kind'])
  const members = await pullTeam()
  assert.equal(members[0].inactive, true)
  assert.equal(members[0].kind, 'freelance')
  assert.match(selected.at(-1), /inactive/)
})

test('missing inactive alone remains compatible with older schemas', async () => {
  const { pullTeam, selected } = loadTeamStore(['inactive'])
  const members = await pullTeam()
  assert.equal(members[0].inactive, false)
  assert.match(selected.at(-1), /start_date/)
})
