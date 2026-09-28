const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const ctx = { exports: {} }
vm.createContext(ctx)
vm.runInContext(ts.transpile(fs.readFileSync('lib/personalCompletion.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), ctx)
const { completionContext, completionState, completionReply } = ctx.exports
const target = { parentItemId: 'meeting', subitemId: 'occurrence' }
const actor = { memberId: 'menno', name: 'Menno' }
const event = (id, done, date) => ({ id, contextId: completionContext(target), thread: [completionReply(id, actor, target, done, 'Weekstart', [], date)] })
const threads = [event('1', true, '2026-09-28T10:00:00Z')]
assert.equal(completionState(threads, target, 'menno').done, true)
assert.equal(completionState(JSON.parse(JSON.stringify(threads)), target, 'menno').done, true)
assert.equal(completionState(threads, target, 'odette'), undefined)
threads.push(event('2', false, '2026-09-28T10:01:00Z'))
assert.equal(completionState(threads, target, 'menno').done, false)
for (const page of ['app/page.tsx', 'app/todos/page.tsx', 'app/planning/page.tsx']) {
  assert.match(fs.readFileSync(page, 'utf8'), /await completeLinkedTask\(/, `${page} must use the shared completion writer`)
}
console.log('PASS: shared completion, reload, reopen and independent participants')
