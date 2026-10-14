import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const profile = readFileSync(new URL('../app/profile/[memberId]/page.tsx', import.meta.url), 'utf8')

test('admin can open the avatar editor even when the current photo is missing', () => {
  assert.match(profile, /onClick=\{openEditor\}/)
  assert.match(profile, /role=\{editable \? 'button'/)
  assert.match(profile, /aria-label=\{editable \? `Profielfoto van \$\{name\} wijzigen`/)
  assert.match(profile, /onError=\{\(\) => setPhotoFailed\(true\)\}/)
  assert.match(profile, /!photoFailed \? <img/)
})

test('avatar editor remains keyboard accessible', () => {
  assert.match(profile, /event\.key !== 'Enter' && event\.key !== ' '/)
  assert.match(profile, /openEditor\(\)/)
})
