// Afvinken op een item met meerdere mensen.
//
// De verwarring: je vinkt bij de weekstart je eigen taak af, bij de rest
// verandert niets, en nergens staat dat dat de bedoeling is. Afvinken
// namens een collega kan bewust niet — maar het hele item op Done zetten
// hoort wél vanaf diezelfde plek te kunnen.

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
  { id: 'w1', name: 'Weekstart', ownerIds: ['menno', 'odette', 'vincent'], status: 'Working on it',
    estHours: 3, startDate: iso(0), endDate: iso(0), subitems: [] },
] }]

async function openAgenda() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' })
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' })
  await page.evaluate(board => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', board)
  }, JSON.stringify(BORD))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]')
  await page.waitForTimeout(800)
  // De statuspil opent het menu met 'Jouw status' erin.
  await page.locator('[data-item-id="w1"]').getByText('Working on it').first().click()
  await page.waitForTimeout(500)
  return page
}

test('het menu vertelt dat je alleen voor jezelf afvinkt', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  const paneel = await page.locator('body').innerText()
  assert.match(paneel, /Jouw status/i, 'je eigen status staat er')
  assert.match(paneel, /alleen over jouw deel/i, 'met uitleg dat het alleen over jou gaat')
  assert.match(paneel, /0\/3 klaar/, 'en hoeveel mensen er al klaar zijn')
  await page.close()
})

test('voor iedereen afronden zet de gezamenlijke status op Done', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  page.on('dialog', d => d.accept())

  await page.getByRole('button', { name: 'Voor iedereen afronden' }).first().click()
  await page.waitForTimeout(900)

  const status = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoko-board-yoko'))[0].items.find(i => i.id === 'w1').status)
  assert.equal(status, 'Done', 'het item zelf staat nu op Done, en dat geldt voor iedereen')
  await page.close()
})
