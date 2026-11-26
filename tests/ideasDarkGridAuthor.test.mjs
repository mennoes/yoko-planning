import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/ideas/page.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../app/ideas/ideas.module.css', import.meta.url), 'utf8')

test('idea cards show the author avatar with a fallback', () => {
  assert.match(page, /function IdeaAuthor/)
  assert.match(page, /<UserAvatar memberId=\{id\} size=\{22\}/)
  assert.match(page, /className=\{styles\.authorFallback\}/)
  assert.match(page, /<IdeaAuthor id=\{idea\.authorId\} name=\{idea\.authorName\}/)
})

test('dark mode idea canvas uses a quieter dot grid', () => {
  assert.match(css, /:global\(\[data-theme="dark"\]\) \.canvasViewport/)
  assert.match(css, /rgba\(255,255,255,\.055\) \.8px/)
})
