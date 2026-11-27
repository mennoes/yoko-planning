import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8')

test('Home hides the unused overflow menu on mobile', () => {
  assert.match(home, /\{!isMobile && <div style=\{\{ position: 'relative', flexShrink: 0 \}\}>/)
  assert.match(home, /aria-label="Meer acties"/)
})

test('mobile navigation opens as a compact side sheet, not a desktop-sized full screen', () => {
  assert.match(sidebar, /width: 'min\(88vw, 340px\)'/)
  assert.match(sidebar, /borderRadius: isMobile \? '0 18px 18px 0'/)
  assert.doesNotMatch(sidebar, /width: '100vw', minWidth: '100vw', maxWidth: '100vw'/)
})

test('the mobile sheet has a matching high overlay behind it', () => {
  assert.match(shell, /zIndex: 9490/)
  assert.match(shell, /backdropFilter: 'blur\(2px\)'/)
})
