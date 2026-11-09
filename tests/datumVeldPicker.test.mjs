import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../components/DatumVeld.tsx', import.meta.url), 'utf8')

test('de kalender krijgt een echt klikbaar vlak in plaats van een verborgen 0x0-input', () => {
  assert.match(source, /data-testid="datum-kalender"/)
  assert.match(source, /position: 'absolute', inset: 0, width: '100%', height: '100%'/)
  assert.doesNotMatch(source, /\.showPicker\(/)
  assert.doesNotMatch(source, /pointerEvents:\s*'none'/)
})

test('de kalenderkeuze blijft gekoppeld aan dezelfde ISO-datumcallback', () => {
  assert.match(source, /onChange=\{event => onChange\(event\.target\.value \|\| null\)\}/)
})
