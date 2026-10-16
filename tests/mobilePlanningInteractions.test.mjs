import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('today line stays below sticky member cells on horizontal mobile scroll', () => {
  const start = source.indexOf('function TodayMarker')
  const marker = source.slice(start, source.indexOf('function DraggableBar', start))
  assert.match(marker, /zIndex: 19/)
})

test('tapping a Google bar on mobile pins its information card', () => {
  const hoverBar = source.slice(source.indexOf('function MeetingHoverBar'), source.indexOf('function MeetingCluster'))
  assert.match(hoverBar, /project\.source !== 'google'/)
  assert.match(hoverBar, /setPinned\(true\)/)
  assert.match(hoverBar, /data-meeting-hover/)
  assert.match(hoverBar, /document\.addEventListener\('pointerdown'/)
})
