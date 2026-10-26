// De categoriekiezer in de werkdruk-popover op Home.
//
// Elke regel in 'deze week' opende een venstertje met vier knoppen:
// Maken, Overige maken, Meeting en Vrij. Die indeling wordt niet
// gebruikt, dus de kiezer is eruit. Wat blijft: welk item het is,
// hoeveel uur het deze week kost en de link naar de agenda.

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
  { id: 'i1', name: 'Content video', ownerIds: ['menno'], status: 'Working on it',
    estHours: 8, startDate: iso(0), endDate: iso(2), subitems: [] },
] }]

test('de werkdruk-popover heeft geen categoriekiezer meer', { skip: skip ?? false }, async () => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, colorScheme: 'light' })
  await page.addInitScript(board => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', board)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  const regel = page.locator('[data-workload-row]').first()
  assert.ok(await regel.count() > 0, 'er staat werk in de weekwidget')
  // Hoveren opent het venstertje; klikken gaat naar de agenda.
  await regel.hover()
  await page.waitForTimeout(800)

  const popover = (await page.locator('[data-workload-row]').allInnerTexts()).join('\n')
  assert.match(popover, /Content video/, 'het venstertje staat open')
  assert.match(popover, /Open agenda/, 'met de link naar de agenda')
  assert.doesNotMatch(popover, /Overige maken/, 'maar zonder de categoriekiezer')
  assert.doesNotMatch(popover, /Reset naar automatisch/, 'en zonder de reset daarvan')
  await page.close()
})
