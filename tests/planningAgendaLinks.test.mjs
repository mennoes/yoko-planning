import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

test('planning details open, focus and highlight the matching agenda item', () => {
  assert.match(planning, /\?focus=\$\{encodeURIComponent\(agendaItemId\)\}&drawer=\$\{encodeURIComponent\(agendaItemId\)\}/)
  assert.match(planning, /subitem=\$\{encodeURIComponent\(agendaSubitemId\)\}/)
  assert.match(styles, /\.yoko-focus-flash[^}]*animation: yoko-focus-flash/)
  assert.match(styles, /@keyframes yoko-focus-flash[\s\S]*box-shadow:/)
})
