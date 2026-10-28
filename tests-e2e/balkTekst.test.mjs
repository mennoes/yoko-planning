// Leesbaarheid van de tekst op een balk in de planning.
//
// Twee dingen stonden elkaar in de weg: de tweede regel (het hoofditem)
// liep achter de gezichten langs die onderlangs op een balk met meerdere
// eigenaren staan, en witte letters op een licht stuk van zo'n balk
// waren nauwelijks te lezen.

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
  { id: 'p1', name: 'NKO Explainer', ownerIds: ['menno'], status: 'Working on it', estHours: 0,
    startDate: iso(-2), endDate: iso(6), subitems: [
      // Eén eigenaar: geen gezichten onderlangs, dus de tweede regel past.
      { id: 's1', name: '04 Storyboard & visuele stijl', ownerIds: ['menno'],
        status: 'Working on it', estHours: 12, startDate: iso(-2), endDate: iso(2) },
      // Twee eigenaren en genoeg uren: gezichten onderlangs.
      { id: 's2', name: '05 Animatie', ownerIds: ['menno', 'odette'],
        status: 'Working on it', estHours: 30, startDate: iso(1), endDate: iso(6) },
    ] },
] }]

async function openPlanning() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' })
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(board => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', board)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.getByText('Menno', { exact: true }).last().click()
  await page.waitForTimeout(1500)
  return page
}

/** De balk waarvan de titel hiermee begint: tekst, hoogte en of er
 *  gezichten op staan. */
const balk = (page, begin) => page.evaluate(start => {
  for (const el of document.querySelectorAll('div')) {
    const tekst = (el.textContent ?? '').trim()
    if (!tekst.startsWith(start)) continue
    const rect = el.getBoundingClientRect()
    // De balk zelf, niet de hele rij eromheen.
    if (rect.height < 10 || rect.height > 80 || rect.width > 600) continue
    const tekstvak = el.querySelector('span[style*="flex-direction: column"]')
    if (!tekstvak) continue
    return {
      tekst,
      hoogte: Math.round(rect.height),
      gezichten: el.querySelectorAll('[data-bar-owner]').length,
      schaduw: getComputedStyle(tekstvak).textShadow,
    }
  }
  return null
}, begin)

test('met gezichten op de balk verdwijnt de tweede regel', { skip: skip ?? false }, async () => {
  const page = await openPlanning()

  const metGezichten = await balk(page, '05 Animatie')
  assert.ok(metGezichten, 'de balk van het gedeelde subitem staat er')
  assert.ok(metGezichten.gezichten > 0, 'er staan gezichten onderlangs')
  assert.doesNotMatch(metGezichten.tekst, /↳/,
    `geen tweede regel achter de gezichten langs, kreeg "${metGezichten.tekst}"`)

  // Zonder gezichten blijft het hoofditem er gewoon onder staan.
  const zonder = await balk(page, '04 Storyboard')
  assert.ok(zonder, 'de balk van het andere subitem staat er')
  assert.equal(zonder.gezichten, 0)
  assert.match(zonder.tekst, /NKO Explainer/, 'daar past de tweede regel wel')
  await page.close()
})

test('de tekst op een balk heeft een schaduw om leesbaar te blijven', { skip: skip ?? false }, async () => {
  const page = await openPlanning()
  const metGezichten = await balk(page, '05 Animatie')
  assert.notEqual(metGezichten.schaduw, 'none',
    'witte letters op een licht stuk balk hebben een schaduw nodig')
  await page.close()
})
