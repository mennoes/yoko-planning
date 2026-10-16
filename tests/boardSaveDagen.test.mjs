import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/0039_dagen_numeric.sql', import.meta.url), 'utf8')

test('halve dagen blokkeren de hele bord-save niet meer', () => {
  // `dagen` = uren ÷ 8, dus 60u geeft 7.5. Met een integer-kolom weigerde
  // Postgres de hele upsert ("invalid input syntax for type integer") en
  // kreeg je op mobiel 'Niet online opgeslagen' voor álle wijzigingen op
  // dat bord, niet alleen voor dat ene item.
  assert.match(store, /invalid input syntax for type integer/i)
  assert.match(store, /dagen: Math\.round\(exact\)/)
  // De precieze waarde blijft bewaard in extra; rowToItem spreidt extra
  // over de standaardvelden heen, dus de UI blijft 7.5 tonen.
  assert.match(store, /const extra = \{ \.\.\.\(row\.extra as Record<string, unknown> \| undefined \?\? \{\}\), dagen: exact \}/)
  assert.match(store, /Number\.isInteger\(exact\)/)
})

test('de migratie maakt de kolom numeric in plaats van integer', () => {
  assert.match(migration, /alter column dagen type numeric/)
})

test('de precieze waarde uit extra wint alleen als de kolom de afronding is', () => {
  // Kolommen zijn leidend (oude legacy-kopieen in extra mogen niets
  // terugdraaien), behalve bij exact deze afrondings-workaround.
  assert.match(store, /function dagenFromRow\(column: unknown, fromExtra: unknown\): number/)
  assert.match(store, /Math\.round\(exact\) === stored/)
  assert.match(store, /dagen:     dagenFromRow\(r\.dagen, extra\.dagen\)/)
})
