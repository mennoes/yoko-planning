import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = offset => {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

test('subitems tonen een voorstel en datums zijn met rechtsklik kopieerbaar', { skip: skip ?? false }, async () => {
  const parentStart = iso(1)
  const parentEnd = iso(31)
  const board = [{ id: 'g1', name: 'Groep', color: '#579bfc', items: [{
    id: 'p1', name: 'KHMW x3', ownerIds: ['menno'], status: 'Working on it', estHours: 24,
    startDate: parentStart, endDate: parentEnd,
    subitems: [
      { id: 's1', name: 'KHMW aflevering 1', ownerIds: [], status: '', startDate: null, endDate: null, estHours: 8 },
      { id: 's2', name: 'KHMW aflevering 2', ownerIds: [], status: '', startDate: null, endDate: null, estHours: 8 },
      { id: 's3', name: 'KHMW aflevering 3', ownerIds: [], status: '', startDate: null, endDate: null, estHours: 8 },
    ],
  }] }]

  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  await page.route(url => /supabase|\/rest\/v1\//i.test(url.href), route => route.abort())
  await page.addInitScript(({ board, profile }) => {
    if (!localStorage.getItem('yoko-profile')) localStorage.setItem('yoko-profile', JSON.stringify(profile))
    if (!localStorage.getItem('yoko-board-yoko')) localStorage.setItem('yoko-board-yoko', JSON.stringify(board))
  }, { board, profile: { memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null } })

  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  const parent = page.locator('[data-item-id="p1"]')
  await parent.waitFor({ state: 'visible', timeout: 20000 })
  await parent.getByTitle('3 subitems').click()

  const first = page.locator('[data-subitem-id="s1"] [data-date-range-cell]')
  const second = page.locator('[data-subitem-id="s2"] [data-date-range-cell]')
  await first.waitFor({ state: 'visible' })
  assert.match(await first.innerText(), /Suggestie/)

  await first.click()
  await page.waitForTimeout(450)
  const firstSaved = await page.evaluate(() => {
    const groups = JSON.parse(localStorage.getItem('yoko-board-yoko'))
    const sub = groups[0].items[0].subitems.find(row => row.id === 's1')
    return { startDate: sub.startDate, endDate: sub.endDate }
  })
  assert.ok(firstSaved.startDate && firstSaved.endDate)

  await first.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Datums kopiëren' }).click()
  await second.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Datums plakken/ }).click()
  await page.waitForTimeout(450)

  const saved = await page.evaluate(() => {
    const groups = JSON.parse(localStorage.getItem('yoko-board-yoko'))
    const subs = groups[0].items[0].subitems
    return subs.filter(row => row.id === 's1' || row.id === 's2')
      .map(row => ({ id: row.id, startDate: row.startDate, endDate: row.endDate }))
  })
  assert.deepEqual(saved[1], { id: 's2', ...firstSaved })

  await page.reload({ waitUntil: 'networkidle' })
  const reloadedSecond = page.locator('[data-subitem-id="s2"] [data-date-range-cell]')
  if (!await reloadedSecond.isVisible()) {
    await page.locator('[data-item-id="p1"]').getByTitle('3 subitems').click()
  }
  assert.doesNotMatch(await reloadedSecond.innerText(), /Suggestie/)
  await page.close()
})
