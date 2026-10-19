// De periode van een item met subitems, in de echte UI.
//
// De klacht: je zet een periode van weken op een klus, er komt een
// subitem van twee dagen bij, en opeens staat de hele klus op twee dagen.
// De eigen periode hoort te blijven staan tot je 'm zelf weghaalt.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

/** Een klus van ruim zes weken met één subitem van twee dagen erin. */
const bord = (eigenPeriode) => [{ id: 'g1', name: 'Groep', color: '#579bfc', items: [
  { id: 'p1', name: 'Lange klus', ownerIds: ['menno'], status: 'Working on it', estHours: 40,
    startDate: eigenPeriode ? '2026-11-02' : null,
    endDate:   eigenPeriode ? '2026-12-18' : null,
    subitems: [
      { id: 's1', name: 'Kort subitem', ownerIds: ['menno'], status: 'Working on it', estHours: 4,
        startDate: '2026-11-10', endDate: '2026-11-11' },
    ] },
] }]

async function open(eigenPeriode) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
  }, JSON.stringify(bord(eigenPeriode)))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  return page
}

/** De tekst van de hoofdrij; daar staat de Timeline-cel in. */
const rijTekst = page => page.evaluate(() =>
  (document.querySelector('[data-item-id="p1"]')?.textContent ?? '').slice(0, 300))

test('een kort subitem overrult de eigen periode van het item niet', { skip: skip ?? false }, async () => {
  const page = await open(true)
  const cel = await rijTekst(page)
  await page.close()
  assert.match(cel, /2 nov\./, `de eigen startdatum staat er: ${cel}`)
  assert.match(cel, /18 dec\./, `en hij loopt nog steeds door tot 18 december: ${cel}`)
})

test('zonder eigen periode volgt het item zijn subitems', { skip: skip ?? false }, async () => {
  const page = await open(false)
  const cel = await rijTekst(page)
  await page.close()
  assert.match(cel, /nov\. 10 – 11/, `nu komt de periode van het subitem: ${cel}`)
  assert.ok(!/dec\./.test(cel), `en loopt hij niet door tot december: ${cel}`)
})

test('de tijdlijn tekent dezelfde balk als de lijst toont', { skip: skip ?? false }, async () => {
  // Liepen die uit elkaar, dan zou je in de ene weergave een klus van zes
  // weken zien en in de andere eentje van twee dagen.
  const page = await open(true)
  await page.getByRole('button', { name: 'Tijdlijn' }).click()
  await page.waitForTimeout(900)
  const titel = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-board-timeline] div[title]')]
      .find(d => (d.getAttribute('title') ?? '').startsWith('Lange klus ·'))
    return el?.getAttribute('title') ?? ''
  })
  await page.close()
  assert.match(titel, /2 nov/, `de balk begint op de eigen startdatum: ${titel}`)
  assert.match(titel, /18 dec/, `en eindigt op de eigen einddatum: ${titel}`)
})

test('de periode leegmaken zet het item terug op automatisch', { skip: skip ?? false }, async () => {
  // De ↺-knop naast de datumcel.
  const page = await open(true)
  await page.locator('[data-item-id="p1"]').hover()
  const knop = page.getByTitle(/Periode leegmaken/)
  assert.equal(await knop.count(), 1, 'de knop staat er zolang het item een eigen periode heeft')
  await knop.first().click()
  // Weg van de rij: blijf je erop hangen, dan toont de datumcel de
  // hover-stand (de duur) in plaats van de periode.
  await page.mouse.move(5, 5)
  await page.waitForTimeout(900)

  const opgeslagen = await page.evaluate(() => {
    const i = JSON.parse(localStorage.getItem('yoko-board-yoko')).flatMap(g => g.items).find(x => x.id === 'p1')
    return { start: i.startDate, eind: i.endDate }
  })
  const cel = await rijTekst(page)
  await page.close()

  assert.equal(opgeslagen.start, null, 'de eigen datums zijn echt weg, niet alleen een vlaggetje')
  assert.equal(opgeslagen.eind, null)
  assert.match(cel, /nov\. 10 – 11/, `en de cel volgt nu het subitem: ${cel}`)
})
