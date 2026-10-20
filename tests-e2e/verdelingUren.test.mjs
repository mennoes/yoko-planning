// De verdeling in het item-venster op /planning.
//
// De klacht: zet je een klus van 20 naar 40 uur, dan bleef de verdeling
// op 10 + 10 staan. De taart klopte niet meer met het totaal en iedereen
// zakte van 50% naar 25%, terwijl er juist uren bíj kwamen.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const BORD = [{ id: 'g1', name: 'Groep', color: '#579bfc', items: [
  { id: 'i1', name: 'Gedeelde klus', ownerIds: ['menno', 'odette'], status: 'Working on it',
    estHours: 20, ownerHours: { menno: 10, odette: 10 },
    startDate: iso(0), endDate: iso(10), subitems: [] },
] }]

async function openPopup() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  // De rij van de persoon uitklappen; pas dan staan de balken er.
  await page.getByText('Menno', { exact: true }).last().click()
  await page.waitForTimeout(1200)
  await page.getByText('Gedeelde klus', { exact: false }).first().click()
  await page.waitForTimeout(1400)
  return page
}

/** De uren- en %-velden uit de Verdeling-rij, op volgorde: uren en % van
 *  de eerste persoon, daarna van de tweede. Het vijfde nummerveld is de
 *  uren van het item zelf. */
const verdeling = page => page.evaluate(() =>
  [...document.querySelectorAll('input[type="number"]')]
    .map(i => i.value)
    .slice(0, 4))

test('uren toevoegen laat de verdeling meegroeien', { skip: skip ?? false }, async () => {
  const page = await openPopup()
  const tekst = await page.evaluate(() => document.body.innerText)
  assert.match(tekst, /Verdeling/, 'het venster staat open met de verdeling erin')

  const voor = await verdeling(page)
  assert.deepEqual(voor, ['10', '50', '10', '50'], `start op 10u/50% per persoon, kreeg ${voor.join(',')}`)

  // De uren van het item naar 40.
  const uren = page.locator('input[type="number"]').nth(4)
  await uren.fill('40')
  await uren.blur()
  await page.waitForTimeout(1200)

  const na = await verdeling(page)
  await page.close()
  assert.deepEqual(na, ['20', '50', '20', '50'],
    `ieders uren verdubbelen en de percentages blijven 50/50, kreeg ${na.join(',')}`)
})

test('uren weghalen krimpt de verdeling net zo goed', { skip: skip ?? false }, async () => {
  const page = await openPopup()
  const uren = page.locator('input[type="number"]').nth(4)
  await uren.fill('10')
  await uren.blur()
  await page.waitForTimeout(1200)

  const na = await verdeling(page)
  await page.close()
  assert.deepEqual(na, ['5', '50', '5', '50'], `kreeg ${na.join(',')}`)
})
