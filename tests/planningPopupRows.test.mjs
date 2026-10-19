import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')
const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const registry = readFileSync(new URL('../lib/boardsRegistry.ts', import.meta.url), 'utf8')

test('sorteren op timeline gebruikt dezelfde datum als de kolom toont', () => {
  // Liep dit uit elkaar, dan stond een rij op een onnavolgbare plek: je
  // zag 21 okt staan terwijl er op een heel andere datum gesorteerd werd.
  // Allebei via itemDatums is de enige manier om dat vast te houden; de
  // regel zelf staat in tests/itemDatums.test.mjs.
  const sortBlok = board.slice(board.indexOf("if (dKey === 'startDate' || dKey === 'endDate')"))
  assert.match(sortBlok.slice(0, 300), /itemDatums\(item\)/)
  assert.doesNotMatch(board, /if \(!v && \(dKey === 'startDate' \|\| dKey === 'endDate'\)\)/)
})

test('een agenda hernoemen gaat rechtstreeks naar de database', () => {
  // De API-route was de enige weg en weigert zonder profiel-rij of als
  // de agenda nog geen rij in 'boards' had — in beide gevallen sprong de
  // naam terug. Nu eerst zelf schrijven, route als laatste redmiddel.
  assert.match(registry, /\.update\(withStamp\(\{ name: clean \}\)\)/)
  assert.match(registry, /if \(await upsertBoard\(\{ \.\.\.existing, name: clean \}, index\)\) return null/)
  assert.match(registry, /export async function renameBoard\(boardId: string, name: string\): Promise<string \| null>/)
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
