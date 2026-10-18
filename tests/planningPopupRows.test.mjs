import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const registry = readFileSync(new URL('../lib/boardsRegistry.ts', import.meta.url), 'utf8')

test('sorteren op timeline gebruikt dezelfde datum als de kolom toont', () => {
  // De kolom toont bij subitems altijd de rollup; de sortering pakte die
  // alleen als de parent zelf geen datum had. Een Google-serie heeft die
  // wel (vaak verouderd), dus die rijen stonden op een willekeurige plek.
  assert.match(board, /if \(dates\.length > 0 && !item\.datesOverride\) \{/)
  assert.doesNotMatch(board, /if \(!v && \(dKey === 'startDate' \|\| dKey === 'endDate'\)\)/)
})

test('een agenda hernoemen werkt ook als de rij nog niet bestond', () => {
  assert.match(registry, /if \(result\.error === 'board_not_found'\)/)
  assert.match(registry, /const created = await upsertBoard\(\{ \.\.\.existing, name: clean \}, index\)/)
})

test('het itemvenster toont alleen nog wat we gebruiken', () => {
  assert.doesNotMatch(planning, /<Row label="Categorie">/)
  assert.doesNotMatch(planning, /<Row label="Contactpersoon">/)
  assert.doesNotMatch(planning, /<Row label="Bestanden">/)
  assert.doesNotMatch(planning, /<Row label="Journaal">/)
  // Notes blijft — dat dekt wat het journaal ook deed.
  assert.match(planning, /<Row label="Notes">/)
  // Eigen status staat er nog, direct onder de projectstatus.
  assert.match(planning, /<PersonalCompletionSection/)
})

test('de verdeling staat bovenaan', () => {
  const body = planning.slice(planning.indexOf('<Row label="Verdeling">'), planning.indexOf('<Row label="Status">'))
  assert.match(body, /<Row label="Owner">/)
  assert.ok(planning.indexOf('<Row label="Verdeling">') < planning.indexOf('<Row label="Owner">'))
})

test('de titel in het venster is te hernoemen', () => {
  assert.match(planning, /title="Klik om de naam te wijzigen"/)
  assert.match(planning, /if \(next && next !== project\.name\) commit\(\{ name: next \}\)/)
})

test('losse sleutels overleven de commit-keten', () => {
  // commit bouwde een vast object; naam en eigen kolommen vielen eruit.
  assert.match(planning, /const HANDLED = new Set\(\[/)
  assert.match(planning, /for \(const \[key, value\] of Object\.entries\(patch\)\) \{\n\s+if \(HANDLED\.has\(key\)\) continue\n\s+extra\[key\] = value/)
})
