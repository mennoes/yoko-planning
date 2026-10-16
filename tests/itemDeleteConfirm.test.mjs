import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('het kruisje vraagt eerst of je het zeker weet', () => {
  assert.match(board, /const confirmed = window\.confirm\(/)
  assert.match(board, /verwijderen\?\$\{extra\}/)
  assert.match(board, /Je kunt 'm terughalen uit de papierbak/)
  assert.match(board, /if \(!confirmed\) return/)
})

test('de vraag noemt het item en hoeveel subitems eraan hangen', () => {
  assert.match(board, /const subs = removed\.subitems\?\.length \?\? 0/)
  assert.match(board, /Inclusief \$\{subs\} subitem\$\{subs === 1 \? '' : 's'\}/)
})

test('lege placeholders vragen niets', () => {
  // Daar valt niets aan kwijt te raken; een dialoog is dan alleen maar lastig.
  assert.match(board, /if \(removed && !isEmptyPlaceholder\(removed\)\) \{/)
})

test('op touch is het kruisje zichtbaar zonder hover', () => {
  assert.match(board, /\) : \(hover \|\| isMobile\) && item\.source !== 'google' \? \(/)
  assert.match(board, /padding: isMobile \? '6px 10px' : '2px 6px'/)
})
