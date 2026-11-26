import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/ideas/page.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../app/ideas/ideas.module.css', import.meta.url), 'utf8')

test('idea cards keep secondary information behind icons and hover labels', () => {
  assert.doesNotMatch(page, /<span>Draagt bij aan<\/span>/)
  assert.doesNotMatch(page, />Ik pak dit op<\/span>/)
  assert.doesNotMatch(page, />Klaar<\/button>/)
  assert.doesNotMatch(page, />Terug op muur<\/button>/)
  assert.match(page, /styles\.noteCategoryMarker/)
  assert.match(page, /title="Markeer als klaar"/)
  assert.match(page, /title="Terug op de muur"/)
  assert.match(css, /\.noteCategoryMarker/)
})
