import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('mobile board area is a dedicated horizontal touch scroller', () => {
  assert.match(source, /overflowX: 'scroll'/)
  assert.match(source, /overflowY: 'hidden'/)
  assert.match(source, /WebkitOverflowScrolling: 'touch'/)
  assert.match(source, /overscrollBehaviorX: 'contain'/)
})

test('mobile item and subitem creation use a vertical sheet before insertion', () => {
  assert.match(source, /function MobileCreateItemSheet/)
  assert.match(source, /maxHeight: '92dvh'/)
  assert.match(source, /if \(isMobile\) \{\s*setMobileCreateOpen\(true\)\s*return\s*\}/)
  assert.match(source, /kind="item"/)
  assert.match(source, /kind="subitem"/)
  assert.match(source, /onCreate=\{createMobileItem\}/)
  assert.match(source, /onCreate=\{createMobileSubitem\}/)
})

