import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../components/Sidebar.tsx', import.meta.url), 'utf8')

test("mobile Agenda's header only expands and does not open Yoko", () => {
  assert.match(source, /nextOpen && section\.type === 'projects' && !onNavigate/)
  assert.match(source, /onNavigate=\{isMobile \? onClose : undefined\}/)
})
