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

  const veld = page.locator('input[aria-label="Contactpersoon"]')
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
  assert.equal(await page.locator('input[aria-label="Contactpersoon"]').count(), 0,
    'de Yoko-agenda heeft geen Contactpersoon-kolom, dus ook geen veld')
  await page.close()
})

test('elke kolom van de agenda heeft een veld in het venster', { skip: skip ?? false }, async () => {
  // Een agenda met een zelfgemaakte kolom erbij: wat je daar ziet, hoor
  // je hier ook te kunnen invullen. Eerder kwamen alleen 'custom_…'-
  // kolommen door en bleven vaste kolommen als Contactpersoon onzichtbaar.
  const registry = [{
    id: 'pnp', name: 'PnP', emoji: '📋', color: '#e2445c', columns: [
      { key: 'ownerIds',       label: 'Owner',          type: 'owners',    width: 90 },
      { key: 'status',         label: 'Status',         type: 'status',    width: 145 },
      { key: 'timeline',       label: 'Timeline',       type: 'daterange', width: 175 },
      { key: 'deadline',       label: 'Deadline',       type: 'date',      width: 105 },
      { key: 'estHours',       label: 'Est Time',       type: 'number',    width: 85 },
      { key: 'dagen',          label: 'Dagen',          type: 'number',    width: 70 },
      { key: 'contactpersoon', label: 'Contactpersoon', type: 'text',      width: 160 },
      { key: 'custom_regie',   label: 'Regie',          type: 'text',      width: 120 },
      { key: 'notes',          label: 'Notes',          type: 'text',      width: 160 },
    ],
  }]
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, colorScheme: 'light' })
  await page.addInitScript(payload => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-pnp', payload.pnp)
    localStorage.setItem('yoko-boards-registry', payload.registry)
  }, {
    pnp: JSON.stringify([{ id: 'g1', name: 'Groep', color: '#e2445c', items: [item('p1', 'Klus met klant')] }]),
    registry: JSON.stringify(registry),
  })
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.getByText('Menno', { exact: true }).last().click()
  await page.waitForTimeout(1200)
  await openItem(page, 'Klus met klant')

  for (const label of ['Contactpersoon', 'Regie', 'Deadline']) {
    assert.equal(await page.getByLabel(label).count(), 1, `${label} heeft een veld`)
  }
  // Dagen niet: dat is uren ÷ 8 en staat al naast Est Time.
  const tekst = await page.locator('body').innerText()
  assert.equal((tekst.match(/\bDagen\b/g) ?? []).length, 0, 'Dagen krijgt geen eigen rij')

  await page.getByLabel('Regie').fill('Odette')
  await page.getByLabel('Regie').blur()
  await page.waitForTimeout(800)
  const bewaard = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoko-board-pnp'))[0].items[0].custom_regie)
  assert.equal(bewaard, 'Odette')
  await page.close()
})
