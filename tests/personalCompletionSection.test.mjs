import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function render({ ownerIds = ['menno', 'odette'], memberId = 'menno', demo = false, done = false, status = '', layout = 'row' } = {}) {
  const exports = {}
  const source = readFileSync(new URL('../components/PersonalCompletionSection.tsx', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const mocks = {
    'next/navigation': { usePathname: () => demo ? '/demo/planning' : '/planning' },
    './ProfileContext': { useProfile: () => ({ profile: memberId ? { memberId } : null }) },
    './TeamContext': { useTeam: () => ({ members: [{ id: 'menno', name: 'Menno' }, { id: 'odette', name: 'Odette' }] }) },
    '@/lib/commentsStore': {},
    '@/lib/personalCompletion': { completionContext: () => 'board-item:item', completionState: (_threads, _target, id) => id === memberId && done ? { done: true } : undefined },
    '@/lib/personalCompletionClient': { updatePersonalCompletion: () => { throw new Error('Rendering must not save changes') } },
  }
  runInNewContext(js, { exports, require: id => id in mocks ? mocks[id] : require(id) })
  return renderToStaticMarkup(createElement(exports.PersonalCompletionSection, { target: { parentItemId: 'item' }, ownerIds, status, layout }))
}

test('solo, unassigned and duplicate owners leave no empty property row', () => {
  for (const ownerIds of [[], ['menno'], ['unassigned'], ['menno', 'unassigned'], ['menno', 'menno', '']]) {
    assert.equal(render({ ownerIds }), '')
  }
})
test('personal control is only shown for an assigned person on a shared item', () => {
  assert.equal(render({ memberId: 'vincent' }), '')
  assert.equal(render({ memberId: null }), '')
  assert.equal(render({ demo: true }), '')
  assert.match(render(), /Mijn taak/)
})
test('Planning and Agenda use a compact property instead of a separate card', () => {
  for (const layout of ['row', 'field']) {
    const html = render({ layout })
    assert.match(html, /✓ Afronden/)
    assert.match(html, /0\/2 klaar/)
    assert.match(html, /font-size:12px/)
    assert.doesNotMatch(html, /<strong|<p|padding:14px/)
  }
  assert.match(render(), /grid-template-columns:90px minmax\(0, 1fr\)/)
  assert.match(render({ layout: 'field' }), /text-transform:uppercase/)
})
test('shared personal tasks can still reopen and respect global Done', () => {
  const done = render({ done: true })
  assert.match(done, /↺ Heropenen/)
  assert.match(done, /aria-pressed="true"/)
  assert.match(done, /1\/2 klaar/)
  assert.match(render({ status: 'Done' }), /disabled=""/)
})
