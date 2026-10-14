import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const context = readFileSync(new URL('../components/TeamPhotosContext.tsx', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('shared photo resolver falls back to static team avatars', () => {
  assert.match(context, /pinnedStaticAvatarUrl\(id\) \?\? photos\[id\] \?\? staticAvatarUrl\(id\) \?\? null/)
})

test('distribution pies use the shared photo resolver', () => {
  assert.match(board, /avatarUrl: getPhoto\(id\)/)
  assert.match(board, /avatarUrl: m \? getPhoto\(m\.id\) : null/)
})
