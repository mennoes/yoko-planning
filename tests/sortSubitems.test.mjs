import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const exports={}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/sortSubitems.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports})
const sort=exports.sortSubitems
const rows=[
 {id:'a',name:'Z',startDate:null,estHours:2,ownerIds:['z']},
 {id:'b',name:'B',startDate:'2026-11-10',estHours:10,ownerIds:['a']},
 {id:'c',name:'A',startDate:'2026-11-01',estHours:5,ownerIds:[]},
]
const names=id=>({z:'Anna',a:'Zoe'})[id]
const ids=items=>Array.from(items,x=>x.id)
test('timeline follows direction and undated rows always stay last',()=>{
 assert.deepEqual(ids(sort(rows,{key:'timeline',dir:'asc'},names)),['c','b','a'])
 assert.deepEqual(ids(sort(rows,{key:'timeline',dir:'desc'},names)),['b','c','a'])
 assert.deepEqual(ids(rows),['a','b','c'])
})
test('owners sort by visible name, hours numerically, and manual order is retained without sorting',()=>{
 assert.deepEqual(ids(sort(rows,{key:'ownerIds',dir:'asc'},names)),['a','b','c'])
 assert.deepEqual(ids(sort(rows,{key:'estHours',dir:'asc'},names)),['a','c','b'])
 assert.equal(sort(rows,null,names),rows)
})
