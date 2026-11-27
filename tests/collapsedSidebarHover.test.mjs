import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sidebar = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

test('collapsed sidebar navigation uses a full-row hover treatment', () => {
  assert.match(sidebar, /sidebar-collapsed-action\$\{active \? ' is-active' : ''\}/)
  assert.match(sidebar, /className="sidebar-collapsed-action"/)
  assert.match(css, /\.sidebar-collapsed-action:hover[\s\S]*background: var\(--bg-hover\)/)
  assert.match(css, /\.sidebar-collapsed-action::before[\s\S]*background: var\(--sup-yellow\)/)
  assert.match(sidebar, /showCollapsedTip\(e, item\.label\)/)
  assert.match(sidebar, /role="tooltip" className="sidebar-collapsed-tooltip"/)
  assert.match(css, /\.sidebar-collapsed-tooltip[\s\S]*position: fixed/)
  assert.match(css, /prefers-reduced-motion: reduce/)
})
