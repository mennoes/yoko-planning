// De veldvakken in het item-venster van een agenda.
//
// Elk vak was minstens 250px breed, ook voor een datum of een getal.
// Daardoor pasten er drie op een rij en bungelde Notes in z'n eentje op
// een vierde rij. Nu zijn de vakken smaller en krijgt vrije tekst juist
// dubbele breedte.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL, boardFixture } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

async function openVenster() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(board => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', board)
  }, JSON.stringify(boardFixture()))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]')
  await page.waitForTimeout(800)
  await page.locator('[data-item-id="i1"]').getByTitle('Plaats opmerking').first().click()
  await page.waitForTimeout(1000)
  return page
}

/** Per veld de bovenkant van z'n vak; velden met dezelfde waarde staan
 *  op één rij. */
const rijen = page => page.evaluate(() => {
  const uit = {}
  for (const span of document.querySelectorAll('span')) {
    const tekst = (span.textContent ?? '').trim()
    if (span.childElementCount !== 0) continue
    if (!['Owner', 'Status', 'Timeline', 'Deadline', 'Est Time', 'Dagen', 'Notes'].includes(tekst)) continue
    const vak = span.parentElement
    uit[tekst] = Math.round(vak.getBoundingClientRect().top)
  }
  return uit
})

test('Est Time, Dagen en Notes staan samen op één rij', { skip: skip ?? false }, async () => {
  const page = await openVenster()
  const top = await rijen(page)

  for (const veld of ['Owner', 'Status', 'Timeline', 'Deadline', 'Est Time', 'Dagen', 'Notes']) {
    assert.ok(top[veld] !== undefined, `${veld} staat in het venster`)
  }
  assert.equal(top['Dagen'], top['Est Time'], 'Dagen staat naast Est Time')
  assert.equal(top['Notes'], top['Est Time'], 'en Notes ook, niet op een eigen rij eronder')

  // Twee rijen in totaal, niet vier: de eerste rij is een andere dan deze.
  const unieke = new Set(Object.values(top))
  assert.equal(unieke.size, 2, `verwachtte twee rijen, kreeg ${unieke.size}`)
  await page.close()
})
