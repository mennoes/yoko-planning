const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const source = ts.transpile(fs.readFileSync('lib/workload.ts', 'utf8'), { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS })
const context = { exports: {}, require: () => ({ getBoardColor: () => '#888', isVrijTitle: () => false, loadCategoryOverrides: () => ({}) }) }
vm.createContext(context)
vm.runInContext(source, context)
const groups = [{ id: 'g', name: 'Projects', items: [{ id: 'parent', name: 'Parent', ownerIds: ['odette', 'menno'], subitems: [
  { id: 'sub', name: 'Thumbs', startDate: '2026-10-06', endDate: '2026-11-01', estHours: 50, ownerHours: { odette: 35, menno: 15 } },
] }] }]
// Simulate persistence/reload, then rebuild the planning projection.
const project = context.exports.groupsToProjects('vlaanderen', JSON.parse(JSON.stringify(groups)))[0]
assert.equal(project.id, 'vlaanderen__parent__si0')
assert.equal(project.ownerHours.odette, 35)
assert.equal(project.ownerHours.menno, 15)
assert.equal(project.estHours, 50)
console.log('Planning subitem distribution survives serialization and projection')
