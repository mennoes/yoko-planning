// Waar staat dit item? Het item-venster op een agenda liet alleen 'ITEM'
// en de naam zien. Open je zoiets vanuit een zoekactie of vanaf de
// planning, dan is dat een naam zonder plek: in welke agenda, in welke
// groep, en bij een subitem onder welk item.
//
// Het venster op /planning zei dit al ('in → bord · groep' en '↳ subitem
// van'); dat op de agenda niet.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const BORD = [{ id: 'g1', name: 'Colleges', color: '#e2445c', items: [
  { id: 'p1', name: 'NL College S04 E33', ownerIds: ['menno'], status: 'Working on it', estHours: 16,
    startDate: iso(-1), endDate: iso(4), subitems: [
      { id: 's1', name: 'Standaard slide presentatie maken', ownerIds: ['menno'],
        status: 'Working on it', estHours: 8, startDate: iso(0), endDate: iso(4) },
    ] },
] }]

async function openAgenda() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-nederland', b)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/projects/nederland', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1200)
  return page
}

/** De kop van het geopende venster: soort, broodkruimel en naam. */
const vensterKop = (page, naam) => page.evaluate(zoek => {
  const titel = [...document.querySelectorAll('h2')].find(e => (e.textContent ?? '').includes(zoek))
  return (titel?.parentElement?.innerText ?? '').replace(/\n/g, ' | ')
}, naam)

test('het venster van een item noemt de agenda en de groep', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.locator('[data-item-id="p1"]').getByTitle('Plaats opmerking').first().click()
  await page.waitForTimeout(1000)
  const kop = await vensterKop(page, 'NL College S04 E33')
  await page.close()

  assert.match(kop, /^ITEM/, `het soort staat vooraan: ${kop}`)
  assert.match(kop, /Nederland/, `de agenda staat erbij: ${kop}`)
  assert.match(kop, /Colleges/, `en de groep ook: ${kop}`)
})

test('het venster van een subitem noemt ook het hoofditem', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.locator('[data-item-id="p1"] button').first().click()
  await page.waitForTimeout(800)
  await page.getByLabel('Reacties op subitem').first().click()
  await page.waitForTimeout(1000)
  const kop = await vensterKop(page, 'Standaard slide presentatie maken')
  await page.close()

  assert.match(kop, /^SUBITEM/, `het heet een subitem, geen item: ${kop}`)
  assert.match(kop, /Nederland.*Colleges.*NL College S04 E33/,
    `agenda, groep en hoofditem staan op volgorde: ${kop}`)
})
