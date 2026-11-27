import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')

test('home deadlines open an in-place drawer without leaving Home', () => {
  assert.match(home, /onClick=\{\(\) => openHomeItem\(board, item\.id\)\}/)
  assert.match(home, /<LinkedItemDetailDrawer[\s\S]*\{\.\.\.homeDetail\}/)
  assert.doesNotMatch(home, /href=\{`\/projects\/\$\{board\}\?focus=/)
})

test('linked items in Jouw taken use the same Home drawer', () => {
  assert.match(home, /openHomeItem\(t\.projectRef\.board, t\.projectRef\.itemId\)/)
  assert.match(home, /title=\{t\.projectRef \? `Open \$\{t\.projectRef\.name \|\| t\.text\} op Home`/)
})
