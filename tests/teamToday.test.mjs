import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const exports = {}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/teamToday.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports })
const sections = [
  { id: '__yoko__', name: 'Studio Yoko', memberIds: [] },
  { id: 'onderzoek', name: 'Onderzoek / stage', memberIds: ['job', 'ilse'] },
  { id: '__freelance__', name: 'Freelancers', memberIds: [] },
]
const members = [
  { id: 'menno', name: 'Menno', yoko: true, activeToday: false },
  { id: 'job', name: 'Job', yoko: true, activeToday: false },
  { id: 'ilse', name: 'Ilse', yoko: true, activeToday: false },
  { id: 'take', name: 'Take', yoko: false, activeToday: true },
  { id: 'kars', name: 'Kars', yoko: false, activeToday: false },
]
const plain = value => JSON.parse(JSON.stringify(value))
test('custom groups override Yoko kind and retain section order without duplicates', () => {
  const result = exports.teamTodaySections(members, sections)
  assert.deepEqual(plain(result.map(s => [s.name, s.members.map(m => m.id)])), [
    ['Studio Yoko', ['menno']], ['Onderzoek / stage', ['job', 'ilse']], ['Freelancers vandaag', ['take']],
  ])
})
test('visibility overrides hide custom members and show otherwise unscheduled freelancers', () => {
  const result = exports.teamTodaySections(members, sections, { job: false, ilse: false, kars: true })
  assert.deepEqual(plain(result.flatMap(s => s.members.map(m => m.id))), ['menno', 'take', 'kars'])
  assert.equal(result.some(s => s.id === 'onderzoek'), false)
})
test('picker includes hidden members and reset returns defaults', () => {
  assert.equal(exports.teamTodaySections(members, sections, { job: false }, true).flatMap(s => s.members).length, 5)
  assert.equal(exports.teamTodaySections(members, sections).flatMap(s => s.members).length, 4)
  assert.equal(exports.teamTodaySections(members, sections, Object.fromEntries(members.map(m => [m.id, false]))).length, 0)
})
test('saved visibility preserves false and rejects malformed preferences', () => {
  assert.deepEqual(plain(exports.parseTeamTodayVisibility('{"job":false,"ilse":true,"bad":"yes"}')), { job: false, ilse: true })
  for (const raw of ['bad', 'null', '[]']) assert.deepEqual(plain(exports.parseTeamTodayVisibility(raw)), {})
})
