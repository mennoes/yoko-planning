import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function render({ ownerIds = ['menno', 'odette'], memberId = 'menno', demo = false, done = false, status = '', personalStatus, layout = 'row' } = {}) {
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
    '@/lib/personalCompletion': {
      completionContext: () => 'board-item:item',
      completionState: (_threads, _target, id) => id === memberId ? { done, status: personalStatus } : undefined,
      personalTaskStatus: state => state?.done ? 'Done' : state?.status ?? 'Not started',
    },
    '@/lib/personalCompletionClient': { updatePersonalCompletion: () => { throw new Error('Rendering must not save changes') } },
  }
  runInNewContext(js, { exports, require: id => id in mocks ? mocks[id] : require(id) })
  return renderToStaticMarkup(createElement(exports.PersonalCompletionSection, {
    target: { parentItemId: 'item' }, ownerIds, status, layout,
    renderStatus: (value, _onChange, disabled) => createElement('button', { disabled, 'aria-label': 'Status mijn taak' }, value),
  }))
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
  assert.match(render(), /Status mijn taak/)
})
test('Planning and Agenda use a compact property instead of a separate card', () => {
  for (const layout of ['row', 'field']) {
    const html = render({ layout })
    assert.match(html, /Not started/)
    assert.match(html, /0\/2 klaar/)
    assert.doesNotMatch(html, /<strong|<p|padding:14px/)
  }
  assert.match(render(), /grid-template-columns:90px minmax\(0, 1fr\)/)
  assert.match(render({ layout: 'field' }), /text-transform:uppercase/)
})
test('shared personal tasks can still reopen and respect global Done', () => {
  const done = render({ done: true })
  assert.match(done, />Done<\/button>/)
  assert.match(done, /1\/2 klaar/)
  assert.match(render({ status: 'Done' }), /disabled=""/)
  assert.match(render({ personalStatus: 'Working on...' }), />Working on\.\.\.<\/button>/)
  assert.match(render({ personalStatus: 'Stuck' }), />Stuck<\/button>/)
  assert.match(render({ status: 'Working on...' }), />Not started<\/button>/)
})

test('Planning places personal status directly below project status and reuses the same picker', () => {
  const source = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('<Row label="Status project">')
  const end = source.indexOf('<Row label="Bord">', start)
  const statuses = source.slice(start, end)
  assert.match(statuses, /<PersonalCompletionSection/)
  assert.equal((statuses.match(/<StatusPicker\s/g) ?? []).length, 2)
})
