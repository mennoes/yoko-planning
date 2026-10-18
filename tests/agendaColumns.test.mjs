import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const board = readFileSync(new URL('../components/BoardTable.tsx', import.meta.url), 'utf8')
const registry = readFileSync(new URL('../lib/boardsRegistry.ts', import.meta.url), 'utf8')
const planning = readFileSync(new URL('../app/planning/page.tsx', import.meta.url), 'utf8')

test('kolommen die nooit gevuld werden zijn uit de agenda', () => {
  // Geteld over alle agendas: uitzenddag 0 items, frame link 2, nummers 1.
  assert.match(board, /const RETIRED_COLUMN_KEYS = new Set\(\['uitzenddag', 'framelink', 'nummers'\]\)/)
  assert.match(board, /\.filter\(column => !RETIRED_COLUMN_KEYS\.has\(column\.key\)\)/)
  // Ook uit de standaardconfiguratie van de agendas zelf.
  assert.doesNotMatch(registry, /key: 'uitzenddag'/)
  assert.doesNotMatch(registry, /key: 'framelink'/)
  assert.doesNotMatch(registry, /key: 'nummers'/)
})

test('eigen kolommen blijven gewoon te maken', () => {
  assert.match(board, /\+ Kolom toevoegen/)
  assert.match(board, /let key = `custom_\$\{slug\}`/)
})

test('een eigen kolom is ook in het planning-venster in te vullen', () => {
  assert.match(planning, /const customColumns = \(getBoardConfig\(project\.board\)\?\.columns \?\? \[\]\)/)
  assert.match(planning, /col\.key\.startsWith\('custom_'\) && !col\.hidden/)
  assert.match(planning, /commit\(\{ \[col\.key\]: value \}\)/)
  // De waarde moet als losse sleutel door de update-keten passen.
  assert.match(planning, /type Patch = Record<string, unknown> & Partial<\{/)
  assert.equal((planning.match(/hiddenFromPlanning: boolean \}> & Record<string, unknown>/g) ?? []).length, 2)
})

test('de lege kolom rechts heeft een plusje om een kolom toe te voegen', () => {
  assert.match(board, /aria-label="Kolom toevoegen"/)
  // Opent dezelfde kolommenlijst, maar meteen op toevoegen.
  assert.match(board, /onClick=\{\(\) => \{ setOpen\(open => !open\); setAdding\(true\) \}\}/)
  // Staat in de voorheen lege kop-cel rechts in de tabel.
  assert.match(board, /<ColumnManagerButton boardId=\{boardId\} columns=\{allColumns\} color=\{accentColor\} plus \/>/)
  // De lijst krijgt álle kolommen mee, ook de verborgen — anders zou
  // zichtbaar maken van een verborgen kolom niet meer kunnen.
  assert.match(board, /allColumns=\{columns\} accentColor=\{color\}/)
})
