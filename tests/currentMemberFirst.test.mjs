import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const exports = {}
runInNewContext(ts.transpileModule(
  readFileSync(new URL('../lib/currentMemberFirst.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports })

const ids = members => Array.from(members, member => member.id)

test('zet de ingelogde persoon vooraan en behoudt de volgorde van collega’s', () => {
  const members = [{ id: 'vincent' }, { id: 'menno' }, { id: 'odette' }, { id: 'loeta' }]
  assert.deepEqual(ids(exports.currentMemberFirst(members, 'menno')), ['menno', 'vincent', 'odette', 'loeta'])
  assert.deepEqual(ids(members), ['vincent', 'menno', 'odette', 'loeta'])
})

test('laat de lijst ongemoeid als het profiel ontbreekt of al vooraan staat', () => {
  const members = [{ id: 'menno' }, { id: 'odette' }]
  assert.equal(exports.currentMemberFirst(members, 'menno'), members)
  assert.equal(exports.currentMemberFirst(members, null), members)
  assert.equal(exports.currentMemberFirst(members, 'onbekend'), members)
})
