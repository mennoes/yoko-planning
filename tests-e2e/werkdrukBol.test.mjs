// De werkdrukbol in de planning.
//
// Die opende een lijstje met een categoriekiezer (Maken / Overige maken /
// Meeting / Vrij). Dat lijstje is weg: een klik op de bol klapt de
// persoon open, zodat je het werk zelf ziet staan.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL, boardFixture } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

async function openPlanning() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(payload => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', payload.board)
  }, { board: JSON.stringify(boardFixture()) })
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  return page
}

/** De bol van Menno in de week waarin het werk staat. */
const bol = page => page.locator('[data-member-id="menno"] button[title="Uitklappen"]').first()

test('een klik op de bol klapt de persoon uit', { skip: skip ?? false }, async () => {
  const page = await openPlanning()
  await bol(page).click()
  await page.waitForTimeout(500)

  // De rij staat open: de balken van het werk zijn er.
  await page.waitForSelector('[data-member-id="menno"] [data-project-bar]', { timeout: 5000 })
    .catch(() => {})
  const tekst = await page.locator('[data-member-id="menno"]').first().innerText()
  assert.match(tekst, /Eerste item/, 'het werk van die week staat er nu uitgeklapt bij')

  // En nog een klik klapt 'm weer dicht.
  await page.locator('[data-member-id="menno"] button[title="Inklappen"]').first().click()
  await page.waitForTimeout(500)
  const dicht = await page.locator('[data-member-id="menno"]').first().innerText()
  assert.doesNotMatch(dicht, /Eerste item/, 'weer dicht')
  await page.close()
})

test('de categoriekiezer komt niet meer tevoorschijn', { skip: skip ?? false }, async () => {
  const page = await openPlanning()
  await bol(page).click()
  await page.waitForTimeout(600)
  const tekst = await page.locator('body').innerText()
  assert.doesNotMatch(tekst, /Overige maken/, 'geen popup met Maken / Overige maken / Meeting / Vrij')
  await page.close()
})
