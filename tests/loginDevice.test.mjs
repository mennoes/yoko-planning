import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const source = readFileSync(new URL('../lib/loginDevice.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const exports = {}
runInNewContext(js, { exports, require: id => id === 'node:crypto' ? { createHash } : (() => { throw new Error(`Unexpected dependency ${id}`) })() })

test('device hashes are stable per user and secret without storing the raw id', () => {
  const a = exports.hashDevice('user-a', 'device-id', 'secret')
  assert.equal(a, exports.hashDevice('user-a', 'device-id', 'secret'))
  assert.notEqual(a, exports.hashDevice('user-b', 'device-id', 'secret'))
  assert.equal(a.includes('device-id'), false)
})

test('common mobile and desktop user agents get a useful Dutch-facing label', () => {
  assert.equal(exports.describeUserAgent('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1').label, 'Safari op iOS/iPadOS')
  assert.equal(exports.describeUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36').label, 'Chrome op Windows')
})

test('untrusted proxy headers are decoded and stripped of newlines', () => {
  assert.equal(exports.safeHeader('Utrecht%0ABcc%3Aevil'), 'Utrecht Bcc:evil')
})
