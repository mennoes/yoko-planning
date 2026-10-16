import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')

test('een Google-subitem weggooien onthoudt ook de Google-id', () => {
  // Zie tests/googleMeetingRouting.test.mjs: de server vergelijkt de verse
  // Google-subitems met de tombstone-lijst op de Google-id. Een handmatig
  // genest item heeft een eigen subitem-id en bewaart de Google-id in
  // sourceItemId, dus zonder die tweede id kwam het item na elke sync terug.
  assert.match(board, /function dismissTombstones\(/)
  assert.match(board, /\.\.\.\(subitem\?\.sourceItemId \? \[subitem\.sourceItemId\] : \[\]\)/)
  assert.match(board, /onUpdate\(filtered, \{ dismissedInstanceIds: dismissTombstones\(dismissedInstanceIds, deleted, id\) \}\)/)
})

test('de bulk-verwijderknop gebruikt dezelfde tombstones als de losse x', () => {
  assert.match(board, /for \(const tombstone of dismissTombstones\(undefined, sub, sub\.id\)\) dismissed\.add\(tombstone\)/)
  assert.doesNotMatch(board, /dismissed\.add\(sub\.id\)\n/)
})

test('elk subitem krijgt een tombstone, niet alleen Google-instances', () => {
  // preserveStoredHistory (lib/googleMeetingHistory) plakt bij ELKE
  // bord-save elk al opgeslagen subitem met een datum in het verleden
  // terug op de rij. De tombstone-lijst is de enige uitweg die die regel
  // kent, dus een handmatig subitem zonder tombstone was niet weg te
  // krijgen: weg uit beeld, na een refresh weer terug.
  assert.doesNotMatch(board, /const isGoogleInstance = deleted\?\.source === 'google'/)
  assert.match(board, /onUpdate\(filtered, \{ dismissedInstanceIds: dismissTombstones\(dismissedInstanceIds, deleted, id\) \}\)/)
  assert.doesNotMatch(board, /if \(sub\.source === 'google' \|\| !!sub\.externalLink \|\| sub\.id\.startsWith\('si_g_'\)\) \{/)
})

test('ook de planning zet een tombstone bij het verwijderen van een subitem', () => {
  const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
  assert.match(planning, /const removedSub = subs\[subIdx\]/)
  assert.match(planning, /removedSub\.sourceItemId \? \[removedSub\.sourceItemId\] : \[\]/)
  assert.match(planning, /subitems: subs\.filter\(\(_, idx\) => idx !== subIdx\), dismissedInstanceIds: tombstones/)
})
