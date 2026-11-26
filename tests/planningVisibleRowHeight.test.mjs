import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('planning row height only counts bars inside the current viewport', () => {
  assert.match(source, /const visibleBars = bars\.filter\(b => b\.left < viewportEnd && b\.left \+ b\.width > viewportStart\)/)
  assert.match(source, /const placementBars = \[\.\.\.visibleBars\]/)
  assert.match(source, /const bStart = Math\.max\(viewportStart, b\.left\)/)
  assert.match(source, /const emptyViewportHeight = Math\.max\(8, Math\.round\(10 \* RS\)\)/)
  assert.match(source, /: Math\.max\(emptyViewportHeight, meetingSummaryHeight \+ BAR_GAP_S \* 2\)/)
  assert.doesNotMatch(source, /WINDOW_DAYS/)
  assert.doesNotMatch(source, /viewportEnd \+ windowPx/)
})

test('sticky member mask stays above bars and row height animates smoothly', () => {
  assert.match(source, /zIndex: 7000, background: stickyBg/)
  assert.match(source, /gridTemplateRows: visuallyOpen \? '1fr' : '0fr'/)
  assert.match(source, /height 380ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/)
  assert.match(source, /visibleStartPx=\{Math\.max\(0, visibleGridRange\.start\)\}/)
  assert.match(source, /visibleEndPx=\{Math\.max\(0, visibleGridRange\.end - nameW - namePad\)\}/)
})

test('very low bars keep their agenda context inline', () => {
  assert.match(source, /const showInlineContext = scaleByHours && !small && !!contextLabel && barH < secondLineMinHeight/)
  assert.match(source, /\{showInlineContext && \(/)
  assert.match(source, />↳ \{contextLabel\}<\/span>/)
})

test('planning bars prefer the current group color', () => {
  assert.match(source, /project\.color \?\? BOARD_COLORS\[project\.board\]/)
  assert.match(source, /b\.p\.color \?\? BOARD_COLORS\[b\.p\.board\]/)
})

test('off-screen meetings do not reserve a summary lane', () => {
  assert.match(source, /const hasVisibleMeetingSummary = zoom === 'week'/)
  assert.match(source, /left < viewportEnd && left \+ width > viewportStart/)
  assert.match(source, /const meetingSummaryHeight = hasVisibleMeetingSummary \? 22 : 0/)
})

test('horizontal scrolling refreshes the height in small steps and settles exactly', () => {
  assert.match(source, /const step = Math\.max\(8, Math\.min\(16, grid\.clientWidth \* 0\.012\)\)/)
  assert.match(source, /setVisibleGridRange\(\{ start: settledStart, end: settledStart \+ settledGrid\.clientWidth \}\)/)
  assert.match(source, /data-testid="planning-grid-scroll"/)
  assert.match(source, /data-testid=\{`planning-timeline-\$\{memberId\}`\}/)
})
