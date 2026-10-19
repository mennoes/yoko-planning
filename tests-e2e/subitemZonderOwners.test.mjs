// Een subitem zonder ownerIds maakte de hele pagina wit.
//
// Het type zegt string[], maar oudere en geïmporteerde rijen hebben dat
// veld soms niet. Op vier plekken werd er zonder vangnet .filter/.some/
// .join op gedaan; zodra je zo'n item uitklapte viel het hele scherm om
// met 'Cannot read properties of undefined'. Eén kapot subitem hoort niet
// de agenda mee te nemen.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

test('een subitem zonder ownerIds klapt gewoon uit', { skip: skip ?? false }, async () => {
  const bord = [{ id: 'g1', name: 'Groep', color: '#579bfc', items: [
    { id: 'p1', name: 'Ouder A', ownerIds: ['menno'], status: 'Working on it', estHours: 24,
      startDate: iso(0), endDate: iso(6), subitems: [
        { id: 's1', name: 'Montage', status: 'Working on it', startDate: iso(1), endDate: iso(2), estHours: 16 },
        { id: 's2', name: 'Research', status: 'Done', startDate: iso(1), endDate: iso(2), estHours: 8 },
      ] },
  ] }]

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  const fouten = []
  page.on('pageerror', e => fouten.push(String(e)))
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
  }, JSON.stringify(bord))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1000)
  await page.locator('[data-item-id="p1"] button').first().click().catch(() => {})
  await page.waitForTimeout(900)

  const tekst = await page.evaluate(() => document.body.innerText)
  await page.close()

  assert.deepEqual(fouten, [], 'geen enkele fout in de pagina')
  assert.match(tekst, /Montage/, 'het subitem staat er gewoon')
  assert.match(tekst, /Ouder A/, 'en de agenda eromheen ook nog')
})
