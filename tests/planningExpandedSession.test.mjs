import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('planning remembers expanded people only for the current browser session', () => {
  assert.match(source, /sessionStorage\.getItem\('planning-expanded-members'\)/)
  assert.match(source, /sessionStorage\.setItem\('planning-expanded-members'/)
  assert.doesNotMatch(source, /ownExpandedRef/)
})
