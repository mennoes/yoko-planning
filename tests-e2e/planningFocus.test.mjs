// Uitklappen dempt de andere rijen zodat de uitgeklapte persoon opvalt.
//
// Voor Unassigned klopt dat niet: dat is geen persoon maar een bak met
// werk dat nog verdeeld moet worden. Klap je die open, dan wil je de
// mensen eromheen juist goed kunnen lezen om er iets heen te slepen —
// en stond alles grijs.

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
  { id: 'i1', name: 'Nog te verdelen', ownerIds: ['unassigned'], status: 'Working on it',
    estHours: 8, startDate: iso(0), endDate: iso(5), subitems: [] },
  { id: 'i2', name: 'Klus van Vincent', ownerIds: ['vincent'], status: 'Working on it',
    estHours: 8, startDate: iso(0), endDate: iso(5), subitems: [] },
  { id: 'i3', name: 'Klus van Odette', ownerIds: ['odette'], status: 'Working on it',
    estHours: 8, startDate: iso(0), endDate: iso(5), subitems: [] },
] }]

async function openPlanning() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, colorScheme: 'light' })
  await page.addInitScript(b => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', b)
    sessionStorage.removeItem('planning-expanded-members')
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  return page
}

/** Hoe doorzichtig staat de rij van deze persoon erbij? */
const doorzichtigheid = (page, id) => page.evaluate(memberId => {
  const rij = document.querySelector(`[data-member-id="${memberId}"]`)
  const schil = rij?.parentElement
  const lees = el => el ? Number(getComputedStyle(el).opacity) : null
  // De demping zit op de rij zelf (dagweergave) of op de schil eromheen
  // (overzicht); de laagste van de twee is wat je ziet.
  return Math.min(lees(rij) ?? 1, lees(schil) ?? 1)
}, id)

test('Unassigned openklappen dempt de andere rijen niet', { skip: skip ?? false }, async () => {
  const page = await openPlanning()
  assert.equal(await doorzichtigheid(page, 'vincent'), 1, 'niets gedempt om mee te beginnen')

  await page.getByText('Unassigned', { exact: true }).last().click()
  await page.waitForTimeout(800)

  const vincent = await doorzichtigheid(page, 'vincent')
  const odette  = await doorzichtigheid(page, 'odette')
  await page.close()
  assert.equal(vincent, 1, `Vincent blijft leesbaar (${vincent})`)
  assert.equal(odette, 1, `en Odette ook (${odette})`)
})

test('een persoon openklappen dempt de rest nog steeds wel', { skip: skip ?? false }, async () => {
  // De focus-mode zelf blijft; alleen Unassigned doet er niet aan mee.
  const page = await openPlanning()
  await page.getByText('Vincent', { exact: true }).last().click()
  await page.waitForTimeout(800)

  const vincent = await doorzichtigheid(page, 'vincent')
  const odette  = await doorzichtigheid(page, 'odette')
  await page.close()
  assert.equal(vincent, 1, 'de uitgeklapte persoon staat op volle sterkte')
  assert.ok(odette < 1, `en de rest is gedempt (${odette})`)
})
