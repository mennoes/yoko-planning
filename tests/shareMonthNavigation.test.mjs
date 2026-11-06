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
  assert.match(share, /setPreset\('selectedMonth'\); setFrom\(monthFrom\); setUntil\(monthUntil\)/)
  assert.match(share, /date\.toLocaleDateString\('nl-NL', \{ month: 'long', year: 'numeric' \}\)/)
})

test('month cards use calendar titles and a separate current-month label', () => {
  assert.doesNotMatch(share, /relativeMonthLabel/)
  assert.match(share, /\{m\.label\}/)
  assert.match(share, /m\.isCurrent \? 'Deze maand'/)
  assert.match(share, /aria-pressed=\{active\}/)
  assert.match(share, /Terug naar deze maand/)
})
