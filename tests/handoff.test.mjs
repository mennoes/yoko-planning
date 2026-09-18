import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/handoff.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports = {}
runInNewContext(js, { exports })

test('handoff comment visibly tags the selected next owner', () => {
  assert.equal(exports.handoffCommentBody('Vincent Wijnbergen', 'Leader is af. Graag sounddesign doen.'),
    'Overdracht aan @Vincent\n\nLeader is af. Graag sounddesign doen.')
})

test('personal Done UI offers an optional handoff after saving', () => {
  const ui = readFileSync(new URL('../components/PersonalCompletionSection.tsx', import.meta.url), 'utf8')
  assert.match(ui, /Klaar\. Geef je het werk door\?/)
  assert.match(ui, /Wie gaat hiermee verder\?/)
  assert.match(ui, /Plaats overdracht/)
  assert.match(ui, /setHandoffOpen\(true\)/)
})
