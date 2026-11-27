import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/ideas/page.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../app/ideas/ideas.module.css', import.meta.url), 'utf8')

test('claiming an idea places the participant avatar on the note', () => {
  assert.match(page, /className=\{styles\.claimButton\}/)
  assert.doesNotMatch(page, /<UserAvatar memberId=\{profile\.memberId\} size=\{24\}/)
  assert.match(page, /<UserAvatar memberId=\{idea\.claimedBy\} size=\{26\}/)
  assert.match(page, /Opgepakt door/)
  assert.match(page, /profile\?\.memberId === idea\.claimedBy/)
  assert.doesNotMatch(css, /\.claimAvatar/)
  assert.match(css, /\.claimedState/)
})
