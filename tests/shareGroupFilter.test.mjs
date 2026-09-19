import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const boardTable = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const sharePage = readFileSync(new URL('../app/share/[board]/page.tsx', import.meta.url), 'utf8')
const shareApi = readFileSync(new URL('../app/api/share/[board]/route.ts', import.meta.url), 'utf8')

test('share creator supports selecting multiple groups in the generated URL', () => {
  assert.match(boardTable, /selectedGroupIds/)
  assert.match(boardTable, /\?groups=\$\{encodeURIComponent\(ids\.join\(','\)\)\}/)
  assert.match(boardTable, /type="checkbox" checked=\{checked\}/)
})

test('public share page supports multi-selecting within shared groups', () => {
  assert.match(sharePage, /Set<string>/)
  assert.match(sharePage, /groups\.filter\(group => selectedGroupIds\.has\(group\.id\)\)/)
  assert.match(sharePage, /Selecteer alles/)
})

test('share API excludes groups outside the URL scope', () => {
  assert.match(shareApi, /req\.nextUrl\.searchParams\.get\('groups'\)/)
  assert.match(shareApi, /scopedGroupRows/)
  assert.match(shareApi, /scopedItemRows/)
})
