// De urenverdeling op de owner-cel van een hoofditem met subitems.
//
// De klacht: op de agenda de taart van een item met meerdere eigenaren
// verschuiven, en na een refresh staat de oude verdeling er weer. Dat
// kwam doordat de getoonde verdeling van zo'n hoofditem wordt opgeteld
// uit de subitems: je wijziging landde wel op het hoofditem, maar bij de
// volgende render werd ze overschreven door die optelsom.

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
  { id: 'plat', name: 'Platte klus', ownerIds: ['menno', 'odette'], status: 'Working on it',
    estHours: 20, ownerHours: { menno: 10, odette: 10 },
    startDate: iso(0), endDate: iso(4), subitems: [] },
  { id: 'ouder', name: 'Ad Alliance', ownerIds: ['menno', 'odette'], status: 'Working on it',
    estHours: 0, startDate: iso(0), endDate: iso(4), subitems: [
      { id: 's1', name: 'Content video', ownerIds: ['menno', 'odette'], status: 'Working on it',
        estHours: 20, startDate: iso(0), endDate: iso(3) },
    ] },
] }]

async function openAgenda() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' })
  // Zaaien via evaluate, niet via addInitScript: dat laatste draait ook
  // bij een reload en zou de wijziging van deze test terugzetten.
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(board => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', board)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]')
  await page.waitForTimeout(1000)
  return page
}

const openCel = async (page, itemId) => {
  await page.locator(`[data-item-id="${itemId}"]`).getByLabel('Owners wijzigen').first().click()
  await page.waitForTimeout(500)
}

test('een eigen verdeling blijft staan na een refresh', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await openCel(page, 'plat')

  const veld = page.getByLabel('Uren voor Menno').first()
  await veld.fill('15')
  await veld.blur()
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]')
  await page.waitForTimeout(1200)
  await openCel(page, 'plat')
  assert.equal(await page.getByLabel('Uren voor Menno').first().inputValue(), '15')
  await page.close()
})

test('bij een hoofditem met subitems valt er niets te verschuiven', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await openCel(page, 'ouder')

  // Geen invulvelden: die wijziging zou bij de volgende render toch
  // worden overschreven door de optelsom uit de subitems.
  assert.equal(await page.getByLabel('Uren voor Menno').count(), 0,
    'de uren van een opgetelde verdeling zijn hier niet te bewerken')

  const paneel = await page.locator('body').innerText()
  assert.match(paneel, /Opgeteld uit de subitems/, 'het paneel vertelt waar je wél moet zijn')
  assert.match(paneel, /10u · 50%/, 'en laat de opgetelde verdeling gewoon zien')
  await page.close()
})
