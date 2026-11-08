import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const exports={}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/completedArchive.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Intl,Date})
const split=exports.splitCompletedArchive
test('two calendar months, boundary included, newest first, undated items remain visible',()=>{
 const items=['2026-09-07','2026-11-06',null,'2026-09-08','2025-01-01']
 const result=split(items,x=>x,new Date('2026-11-08T12:00:00Z'))
 assert.equal(result.cutoff,'2026-09-08')
 assert.equal(JSON.stringify(result.recent),JSON.stringify(['2026-11-06','2026-09-08',null]))
 assert.equal(JSON.stringify(result.older),JSON.stringify(['2026-09-07','2025-01-01']))
 assert.equal(items[0],'2026-09-07')
})
test('month-end cutoff clamps instead of overflowing February and uses Amsterdam today',()=>{
 assert.equal(split([],x=>x,new Date('2026-04-30T12:00:00Z')).cutoff,'2026-02-28')
 assert.equal(split([],x=>x,new Date('2026-11-07T23:30:00Z')).cutoff,'2026-09-08')
})

test('explicit agenda order is retained inside both archive buckets',()=>{
 const result=split(['2026-09-10','2026-11-01','2025-01-01','2026-01-01'],x=>x,new Date('2026-11-08T12:00:00Z'),false)
 assert.equal(JSON.stringify(result.recent),JSON.stringify(['2026-09-10','2026-11-01']))
 assert.equal(JSON.stringify(result.older),JSON.stringify(['2025-01-01','2026-01-01']))
})
