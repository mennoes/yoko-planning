import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')

test('the global UI separates filled controls from outlined fields', () => {
  assert.match(globals, /--control-fill:/)
  assert.match(globals, /--field-border:/)
  assert.match(globals, /\.yoko-control-button/)
  assert.match(globals, /input:not\(\[type="checkbox"\]\).*:focus/)
})

test('planning controls use fill rather than decorative borders', () => {
  assert.match(planning, /background: 'var\(--control-fill\)'/)
  assert.match(planning, /border: '1px solid transparent'/)
  assert.match(planning, /background: active \? 'var\(--accent\)'/)
})

test('active navigation is communicated by a full filled surface', () => {
  assert.match(sidebar, /background: active \? 'var\(--control-active\)' : 'transparent'/)
})
