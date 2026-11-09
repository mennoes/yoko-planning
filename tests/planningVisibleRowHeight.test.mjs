import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('planning row height only counts bars inside the current viewport', () => {
  assert.match(source, /const windowed = placed\.filter\(r => r\.start < viewportEnd && r\.end > viewportStart\)/)
  assert.match(source, /const emptyViewportHeight = Math\.max\(8, Math\.round\(10 \* RS\)\)/)
  assert.match(source, /: Math\.max\(emptyViewportHeight, meetingSummaryHeight \+ BAR_GAP_S \* 2\)/)
  assert.doesNotMatch(source, /WINDOW_DAYS/)
  assert.doesNotMatch(source, /viewportEnd \+ windowPx/)
})

test('off-screen meetings do not reserve a summary lane', () => {
  assert.match(source, /const hasVisibleMeetingSummary = zoom === 'week'/)
  assert.match(source, /left < viewportEnd && left \+ width > viewportStart/)
  assert.match(source, /const meetingSummaryHeight = hasVisibleMeetingSummary \? 22 : 0/)
})

test('horizontal scrolling refreshes the height in small steps', () => {
  assert.match(source, /const step = Math\.max\(24, Math\.min\(56, grid\.clientWidth \* 0\.04\)\)/)
  assert.match(source, /data-testid="planning-grid-scroll"/)
  assert.match(source, /data-testid=\{`planning-timeline-\$\{memberId\}`\}/)
})
