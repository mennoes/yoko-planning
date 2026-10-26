// Uren van een vrij-item aanpassen in de planning.
//
// De klacht: de uren van een reis aanpassen in de popup deed niets met
// het rode bolletje en het urentotaal van die week. Een item in de groep
// 'Vrij' telde altijd een hele werkdag, wat je er ook in typte.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

// Maandag t/m woensdag van deze week, zodat de periode binnen één kolom
// valt ongeacht welke dag de test draait.
function maandag(offsetDagen = 0) {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetDagen)
  return d.toISOString().slice(0, 10)
}

const BORD = [{ id: 'g1', name: 'Vrij', color: '#579bfc', items: [
  { id: 'v1', name: 'Heenreis', ownerIds: ['menno'], status: 'Working on it',
    estHours: 24, startDate: maandag(0), endDate: maandag(2), subitems: [] },
] }]

const urenVanRij = page => page.locator('[data-member-id="menno"]').first().innerText()

test('de uren van een vrij-item volgen wat je invult', { skip: skip ?? false }, async () => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(board => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', board)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  // Drie vrije werkdagen: 24u, net als voorheen zonder eigen uren.
  assert.match(await urenVanRij(page), /24u/, 'de week begint op de hele dagen')

  await page.getByText('Menno', { exact: true }).last().click()
  await page.waitForTimeout(1000)
  await page.getByText('Heenreis', { exact: false }).first().click()
  await page.waitForTimeout(1200)

  const veld = page.locator('input[aria-label="Geschatte uren"]')
  await veld.fill('6')
  await veld.blur()
  await page.waitForTimeout(1000)

  assert.match(await urenVanRij(page), /6u/, 'de bol en het urentotaal volgen de ingevulde uren')
  assert.doesNotMatch(await urenVanRij(page), /24u/, 'en blijven niet op de oude 24u staan')
  await page.close()
})
