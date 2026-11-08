import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const exports={}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/completedArchive.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Intl,Date})
const split=exports.splitCompletedArchive
test('three calendar months, boundary included, newest first, undated items remain visible',()=>{
 const items=['2026-08-07','2026-11-06',null,'2026-08-08','2025-01-01']
 const result=split(items,x=>x,new Date('2026-11-08T12:00:00Z'))
 assert.equal(result.cutoff,'2026-08-08')
 assert.equal(JSON.stringify(result.recent),JSON.stringify(['2026-11-06','2026-08-08',null]))
 assert.equal(JSON.stringify(result.older),JSON.stringify(['2026-08-07','2025-01-01']))
 assert.equal(items[0],'2026-08-07')
})
test('month-end cutoff clamps instead of overflowing February and uses Amsterdam today',()=>{
 assert.equal(split([],x=>x,new Date('2026-05-31T12:00:00Z')).cutoff,'2026-02-28')
 assert.equal(split([],x=>x,new Date('2026-11-07T23:30:00Z')).cutoff,'2026-08-08')
})
