import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const linksRow = readFileSync(new URL('../components/LinksRow.tsx', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('pdf-links openen een ingebouwde preview met losse open-optie', () => {
  assert.match(linksRow, /function isPdfLink/)
  assert.match(linksRow, /data-pdf-preview/)
  assert.match(linksRow, /<iframe/)
  assert.match(linksRow, /Apart openen/)
})

test('Google Drive-bestanden gebruiken de embeddable preview-url', () => {
  assert.match(linksRow, /drive\.google\.com\/file\/d\/\$\{driveMatch\[1\]\}\/preview/)
})

test('ook het agenda-detailvenster toont gekoppelde bestanden', () => {
  assert.match(board, /<LinksRow links=\{item\.links\}/)
})
