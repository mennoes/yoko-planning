import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// De belangrijkste databelofte van deze app: een bord opslaan voegt toe en
// werkt bij, maar verwijdert nooit iets dat toevallig niet in de lokale
// staat zit. Zonder die belofte zou één tab met een gefilterde of nog niet
// volledig geladen lijst de rest van het bord kunnen wissen — en dat is
// precies de angst bij elke wijziging aan de laadkant (bv. het weghalen
// van de seed-fallback).
//
// Dit is bewust een controle op de code zelf: de enige manier om het
// gedrag écht uit te lokken is een echte database, en dan test je of
// Supabase doet wat Supabase doet. Wat hier telt is dat er geen
// verwijder-aanroep bijkomt die niet aan een expliciete gebruikersactie
// hangt.
const store = readFileSync(new URL('../lib/boardStore.ts', import.meta.url), 'utf8')

/** Alle `.delete()`-aanroepen met de functie waarin ze staan. */
function deleteCalls() {
  const regels = store.split('\n')
  const uit = []
  let huidige = '(top-level)'
  regels.forEach((regel, i) => {
    const fn = /^(?:export )?(?:async )?function (\w+)/.exec(regel)
    if (fn) huidige = fn[1]
    if (regel.includes('.delete()')) uit.push({ functie: huidige, regel: i + 1, tekst: regel.trim() })
  })
  return uit
}

// Functies die mogen verwijderen, met waarom.
const TOEGESTAAN = {
  purgeNieuwItemPlaceholders: "ruimt alleen rijen op die letterlijk 'Nieuw item' heten",
  pullBoardFromRemote:        "ruimt alleen lege 'Nieuw item'-placeholders op",
  purgeTrashItem:             'papierbak legen — expliciete gebruikersactie',
  hardDeleteItems:            "batch hard-delete van lege 'Nieuw item'-rijen",
}

test('opslaan verwijdert nooit items die niet in de lokale staat zitten', () => {
  // De twee expliciete opmerkingen in de code zijn de afspraak; als iemand
  // ze weghaalt moet deze test opvallen.
  assert.match(store, /GEEN reconcile-deletie meer op basis van baseline-diff/)
  assert.match(store, /OOK GEEN automatische reconcile-deletie van groepen meer/)

  // En de code moet 'm ook nakomen: geen enkele delete binnen de save-weg.
  const snapshotStart = store.indexOf('async function pushBoardSnapshot')
  assert.ok(snapshotStart > 0, 'pushBoardSnapshot bestaat nog')
  const snapshot = store.slice(snapshotStart, store.indexOf('\n}\n', snapshotStart))
  assert.doesNotMatch(snapshot, /\.delete\(\)/, 'pushBoardSnapshot verwijdert niets')
})

test('elke automatische verwijdering raakt alleen lege placeholders', () => {
  for (const call of deleteCalls()) {
    assert.ok(
      call.functie in TOEGESTAAN,
      `Nieuwe .delete() in ${call.functie}() op regel ${call.regel}: ${call.tekst}\n` +
      'Verwijderen hoort alleen bij een expliciete gebruikersactie of bij lege ' +
      "'Nieuw item'-placeholders. Klopt dit toch, voeg 'm dan hier toe met uitleg.",
    )
  }
})

test("de placeholder-opruiming filtert echt op de naam 'Nieuw item'", () => {
  // Anders zou 'opruimen' alsnog echte items kunnen raken.
  assert.match(store, /\.eq\('board_id', boardName\)\.eq\('name', 'Nieuw item'\)/)
  assert.match(store, /if \(isEmptyNieuwItem\(i\) && !inProgressNewItems\.has\(i\.id\)\) orphanIds\.push\(i\.id\)/)
})
