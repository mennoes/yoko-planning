// De deadline-kalender moet vanuit de tabel echt open blijven staan.
// Het oorspronkelijke probleem zat in de klikvolgorde: de kalenderknop
// liet eerst het datumveld blurren, waardoor de hele editor verdween vóór
// de kalender kon openen. Deze test bewaakt de volledige browserflow.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const nlDatum = value => {
  const d = new Date(`${value}T12:00:00`)
  return `${d.getDate()} ${['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'][d.getMonth()]}.`
}

async function openBord() {
  const deadline = iso(7)
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
  await page.addInitScript(({ board, profile }) => {
    localStorage.setItem('yoko-profile', JSON.stringify(profile))
    localStorage.setItem('yoko-board-yoko', JSON.stringify(board))
  }, {
    profile: { memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null },
    board: [{ id: 'g1', name: 'Groep', color: '#579bfc', items: [{
      id: 'p1', name: 'Deadline test', ownerIds: ['menno'], status: 'Working on it',
      estHours: 8, startDate: iso(0), endDate: iso(4), deadline, subitems: [],
    }] }],
  })
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="p1"]', { timeout: 20000 })
  await page.waitForTimeout(1000)
  return { page, deadline }
}

test('kalendericoon in een deadlinecel opent de volledige maandkalender', { skip: skip ?? false }, async () => {
  const { page, deadline } = await openBord()
  const row = page.locator('[data-item-id="p1"]')

  await row.locator('div').filter({ hasText: new RegExp(`^${nlDatum(deadline).replace('.', '\\.')}$`) }).last().click()
  const button = row.getByTestId('datum-kalender')
  await button.waitFor({ state: 'visible' })
  await button.click()

  const dialog = page.getByRole('dialog', { name: 'Datum kiezen' })
  await dialog.waitFor({ state: 'visible' })
  assert.match(await dialog.innerText(), /Vandaag/)
  assert.match(await dialog.innerText(), /Wissen/)

  const target = iso(9)
  const label = new Date(`${target}T12:00:00`).toLocaleDateString('nl-NL', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  await dialog.getByRole('button', { name: label }).click()
  await page.waitForTimeout(700)

  const saved = await page.evaluate(() => {
    const groups = JSON.parse(localStorage.getItem('yoko-board-yoko'))
    return groups[0].items[0].deadline
  })
  await page.close()
  assert.equal(saved, target, 'de gekozen deadline is opgeslagen')
})
