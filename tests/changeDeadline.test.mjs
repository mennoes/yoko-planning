import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const exports={}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/changeDeadline.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports})
const change=exports.changeDeadline
const groups=[{id:'g',items:[{id:'p',startDate:'2026-11-09',endDate:'2026-11-20',deadline:'2026-11-20',estHours:80,ownerIds:['m'],subitems:[{id:'a',startDate:'2026-11-09',endDate:'2026-11-11',deadline:'2026-11-12',estHours:24},{id:'b',deadline:'2026-11-15'}]}]}]
const plain=x=>JSON.parse(JSON.stringify(x))
test('parent deadline changes without changing any planning or steps',()=>{
 const result=plain(change(groups,'p',undefined,'2026-11-25'))
 const expected=plain(groups);expected[0].items[0].deadline='2026-11-25'
 assert.deepEqual(result,expected)
})
test('subitem deadline changes only the selected step',()=>{
 const result=plain(change(groups,'p','a','2026-11-16'))
 const expected=plain(groups);expected[0].items[0].subitems[0].deadline='2026-11-16'
 assert.deepEqual(result,expected)
 assert.equal(groups[0].items[0].subitems[0].deadline,'2026-11-12')
})
test('missing targets cannot change another deadline',()=>{
 assert.deepEqual(plain(change(groups,'missing',undefined,'2026-11-25')),groups)
 assert.deepEqual(plain(change(groups,'p','missing','2026-11-25')),groups)
})
test('Google deadlines get an override so synchronization preserves them',()=>{
 const input=plain(groups);input[0].items[0].source='google'
 assert.equal(change(input,'p','a','2026-11-16')[0].items[0].subitems[0].deadlineOverride,true)
 assert.equal(change(input,'p',undefined,'2026-11-16')[0].items[0].deadlineOverride,true)
})
