// Een drukke dag nét buiten beeld mag de huidige persoonsrij niet hoog
// houden. Zodra die dag het scherm in scrollt moet de rij wel meegroeien,
// en na terugscrollen weer krimpen.

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

test('persoonsrij groeit alleen wanneer de drukke projecten in beeld scrollen', { skip: skip ?? false }, async () => {
  const busyDate = iso(77)
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: `future-${index + 1}`,
    name: `Future ${index + 1}`,
    ownerIds: ['menno'],
    status: 'Working on it',
    estHours: 8,
    startDate: busyDate,
    endDate: busyDate,
    subitems: [],
  }))
  const board = [{ id: 'g1', name: 'Projecten', color: '#579bfc', items }]
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.addInitScript(data => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', JSON.stringify(data))
    sessionStorage.removeItem('planning-expanded-members')
  }, board)
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.getByText('Menno', { exact: true }).last().click()
  await page.waitForTimeout(1200)

  const grid = page.getByTestId('planning-grid-scroll')
  const timeline = page.getByTestId('planning-timeline-menno')
  const future = page.getByText('Future 1', { exact: true }).first()

  // Zet de drukke dag bewust 100px buiten de rechterrand. De oude
  // drie-wekenbuffer telde hem dan al mee; de nieuwe zichtregel niet.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await page.waitForTimeout(300)
  const delta = await Promise.all([grid.boundingBox(), future.boundingBox()]).then(([g, f]) => {
    assert.ok(g && f, 'grid en toekomstige balk bestaan')
    return f.x - (g.x + g.width + 100)
  })
  await grid.evaluate((element, amount) => { element.scrollLeft += amount }, delta)
  await page.waitForTimeout(700)

  const compact = await timeline.evaluate(element => element.getBoundingClientRect().height)
  const outside = await Promise.all([grid.boundingBox(), future.boundingBox()]).then(([g, f]) => ({ g, f }))
  assert.ok(outside.g && outside.f && outside.f.x >= outside.g.x + outside.g.width,
    'de drukke dag staat echt buiten beeld')

  await grid.evaluate(element => { element.scrollLeft += 180 })
  await page.waitForTimeout(700)
  const expanded = await timeline.evaluate(element => element.getBoundingClientRect().height)

  await grid.evaluate(element => { element.scrollLeft -= 180 })
  await page.waitForTimeout(700)
  const compactAgain = await timeline.evaluate(element => element.getBoundingClientRect().height)
  await page.close()

  assert.ok(compact < 150, `buiten beeld blijft de rij compact (${compact}px)`)
  assert.ok(expanded > compact + 180, `in beeld groeit de rij mee (${compact}px → ${expanded}px)`)
  assert.ok(Math.abs(compactAgain - compact) <= 2, `na terugscrollen krimpt hij weer (${compactAgain}px)`)
})
