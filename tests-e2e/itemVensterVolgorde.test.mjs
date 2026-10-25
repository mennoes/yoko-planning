// De volgorde van de velden in het item-venster op /planning.
//
// De klacht: je zag bovenaan een taartpunt-verdeling van uren die pas
// veel verderop werden ingevuld, en de Timeline stond onderaan. Dat
// leest van achter naar voren. Nu eerst wanneer (Timeline) en hoeveel
// (Est Time), dan pas hoe die uren verdeeld worden en over wie.

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
  await page.getByText('Menno', { exact: true }).last().click()
  await page.waitForTimeout(1200)
  await page.getByText('Gedeelde klus', { exact: false }).first().click()
  await page.waitForTimeout(1400)
  return page
}

test('wanneer en hoeveel staan boven de verdeling', { skip: skip ?? false }, async () => {
  const page = await openPopup()

  // De labels van de rijen, in de volgorde waarin ze in het venster staan.
  const labels = await page.evaluate(() => {
    const wanted = ['Timeline', 'Est Time', 'Verdeling', 'Owner', 'Status']
    return [...document.querySelectorAll('span')]
      .filter(el => el.childElementCount === 0 && wanted.includes((el.textContent ?? '').trim()))
      .map(el => el.textContent.trim())
  })

  assert.deepEqual(labels, ['Timeline', 'Est Time', 'Verdeling', 'Owner', 'Status'],
    `verwachtte Timeline → Est Time → Verdeling → Owner → Status, kreeg ${labels.join(' → ')}`)
  await page.close()
})
