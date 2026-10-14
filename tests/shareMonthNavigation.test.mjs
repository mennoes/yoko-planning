import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const share = readFileSync(new URL('../app/share/[board]/page.tsx', import.meta.url), 'utf8')

test('shared monthly overview can move backward, forward and with the wheel', () => {
  assert.match(share, /const \[monthCursor, setMonthCursor\] = useState\(0\)/)
  assert.match(share, /aria-label="Een maand terug"/)
  assert.match(share, /aria-label="Een maand verder"/)
  assert.match(share, /onWheel=\{event =>/)
})

test('clicking any visible month filters to that exact calendar month', () => {
  assert.match(share, /setPreset\('custom'\); setFrom\(monthFrom\); setUntil\(monthUntil\)/)
  assert.match(share, /date\.toLocaleDateString\('nl-NL', \{ month: 'long', year: 'numeric' \}\)/)
})
