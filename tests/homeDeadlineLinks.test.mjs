import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')

test('home deadlines focus the row and open the matching item drawer', () => {
  assert.match(home, /href=\{`\/projects\/\$\{board\}\?focus=\$\{encodeURIComponent\(item\.id\)\}&drawer=\$\{encodeURIComponent\(item\.id\)\}`\}/)
})
