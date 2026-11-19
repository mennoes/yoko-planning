import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const exports = {}
const code = ts.transpileModule(readFileSync(new URL('../lib/boardRowMerge.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
runInNewContext(code, { exports })
const { mergeBoardRowAgainstRemote } = exports

test('een positie-edit uit een oude tab zet geen nieuwere remote timeline terug', () => {
  const baseline = { id: 'ad', position: 1, name: 'Ad Alliance case videos', start_date: '2026-11-01', end_date: '2026-11-30', notes: null, extra: {} }
  const local = { ...baseline, position: 4 }
  const remote = { ...baseline, start_date: '2027-01-11', end_date: '2027-01-29' }

  const merged = mergeBoardRowAgainstRemote(local, baseline, remote)

  assert.equal(merged.position, 4)
  assert.equal(merged.start_date, '2027-01-11')
  assert.equal(merged.end_date, '2027-01-29')
})

test('de eigen timeline-edit blijft staan terwijl een remote notitie behouden blijft', () => {
  const baseline = { id: 'ad', position: 1, start_date: '2026-11-01', end_date: '2026-11-30', notes: null, extra: { datesOverride: false, remoteOnly: 'oud' } }
  const local = { ...baseline, start_date: '2027-01-11', end_date: '2027-01-29', extra: { datesOverride: true, remoteOnly: 'oud' } }
  const remote = { ...baseline, notes: 'Nieuw vanuit een andere tab', extra: { datesOverride: false, remoteOnly: 'nieuw' } }

  const merged = mergeBoardRowAgainstRemote(local, baseline, remote)

  assert.equal(merged.start_date, '2027-01-11')
  assert.equal(merged.end_date, '2027-01-29')
  assert.equal(merged.notes, 'Nieuw vanuit een andere tab')
  assert.equal(JSON.stringify(merged.extra), JSON.stringify({ datesOverride: true, remoteOnly: 'nieuw' }))
})
