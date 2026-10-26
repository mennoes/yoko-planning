// Contactpersoon invullen vanuit het item-venster in de planning.
//
// De waarde werd al wél meegeschreven bij elke opslag, maar er was geen
// veld: wilde je 'm invullen, dan moest je terug naar de agenda.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const item = (id, name) => ({
  id, name, ownerIds: ['menno'], status: 'Working on it', estHours: 8,
  startDate: iso(0), endDate: iso(4), subitems: [],
})

async function openPlanning() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(payload => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    // PnP heeft een Contactpersoon-kolom, de Yoko-agenda niet.
    localStorage.setItem('yoko-board-pnp', payload.pnp)
    localStorage.setItem('yoko-board-yoko', payload.yoko)
  }, {
    pnp:  JSON.stringify([{ id: 'g1', name: 'Groep', color: '#e2445c', items: [item('p1', 'Klus met klant')] }]),
    yoko: JSON.stringify([{ id: 'g2', name: 'Groep', color: '#579bfc', items: [item('y1', 'Interne klus')] }]),
  })
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.getByText('Menno', { exact: true }).last().click()
  await page.waitForTimeout(1200)
  return page
}

async function openItem(page, naam) {
  await page.getByText(naam, { exact: false }).first().click()
  await page.waitForTimeout(1200)
}

test('contactpersoon is in te vullen en wordt bewaard', { skip: skip ?? false }, async () => {
  const page = await openPlanning()
  await openItem(page, 'Klus met klant')

  const veld = page.locator('input[placeholder="Naam of mailadres"]')
  assert.equal(await veld.count(), 1, 'het veld staat in het venster')

  await veld.fill('Joris de Vries')
  await veld.blur()
  await page.waitForTimeout(800)

  const bewaard = await page.evaluate(() => {
    const groups = JSON.parse(localStorage.getItem('yoko-board-pnp'))
    return groups[0].items.find(i => i.id === 'p1').contactpersoon
  })
  assert.equal(bewaard, 'Joris de Vries')
  await page.close()
})

test('een agenda zonder die kolom krijgt het veld niet', { skip: skip ?? false }, async () => {
  const page = await openPlanning()
  await openItem(page, 'Interne klus')
  assert.equal(await page.locator('input[placeholder="Naam of mailadres"]').count(), 0,
    'de Yoko-agenda heeft geen Contactpersoon-kolom, dus ook geen veld')
  await page.close()
})
