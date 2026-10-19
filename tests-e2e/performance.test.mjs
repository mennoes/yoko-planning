// Echte prestatiemetingen, in een echte browser, op een productiebuild.
//
// Hiervoor stond in tests/planningPersonalTimelinePerformance.test.mjs een
// rij regexen die de vórm van de oplossing vastlegden — dat er ergens
// `const parentItemsByBoard = new Map<...>` stond, dat WorkloadCell in een
// memo() zat. Die matchen niets als je een variabele hernoemt, en ze
// slagen als de index er staat maar niet gebruikt wordt. Wat we eigenlijk
// willen weten is: blijft uitklappen snel? Dat meten we hier.
//
// De drempels zijn ruim. Ze zijn er niet om 20% te bewaken maar om de
// regressies te vangen die we echt gehad hebben: één persoon uitklappen
// duurde 1950ms voordat de bord-index er was, nu ~175ms.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, openPage, gotoBoard, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10) }

/** Een bord met veel gedateerd werk per persoon plus één terugkerende
 *  meeting met honderden occurrences — de vorm waarop de planning eerder
 *  onderuit ging. */
function zwaarBord() {
  const leden = ['menno', 'vincent', 'odette', 'anne-fleur', 'kars']
  const items = []
  const subs = []
  for (let offset = -400; offset <= 120; offset++) {
    const d = new Date(); d.setDate(d.getDate() + offset)
    if (d.getDay() === 0 || d.getDay() === 6) continue
    subs.push({
      id: `sub_${offset}`, name: `Standup ${iso(offset)}`, ownerIds: ['menno'],
      startDate: iso(offset), endDate: iso(offset), startTime: '09:30', endTime: '09:45',
      estHours: 0.25, status: offset < 0 ? 'Done' : 'Working on it', source: 'google',
    })
  }
  items.push({
    id: 'item_standup', name: 'Standup', ownerIds: ['menno'],
    startDate: iso(-400), endDate: iso(120), estHours: 0,
    status: 'Working on it', source: 'google', subitems: subs,
  })
  let n = 0
  for (const lid of leden) {
    for (let i = 0; i < 50; i++) {
      const start = -380 + i * 14
      items.push({
        id: `item_${n++}`, name: `Project ${lid} ${i}`, ownerIds: [lid],
        startDate: iso(start), endDate: iso(start + 9), estHours: 24,
        status: i % 3 === 0 ? 'Done' : 'Working on it', subitems: [],
      })
    }
  }
  return [{ id: 'g_zwaar', name: 'Zwaar', color: '#579bfc', items }]
}

/** Mediaan van een handeling, gemeten over twee frames zodat de render
 *  erin zit en niet alleen de klik. */
async function medianMs(page, actie, keer = 6) {
  return page.evaluate(async ({ selector, index, keer }) => {
    const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const knop = document.querySelectorAll(selector)[index]
    if (!knop) return null
    const tijden = []
    for (let i = 0; i < keer; i++) {
      await settle()
      const t0 = performance.now()
      knop.click()
      await settle()
      tijden.push(performance.now() - t0)
    }
    tijden.sort((a, b) => a - b)
    return Math.round(tijden[Math.floor(keer / 2)])
  }, { ...actie, keer })
}

test('een persoon uitklappen in de planning blijft onder een seconde', { skip: skip ?? false }, async () => {
  const page = await openPage(browser, { board: zwaarBord(), storage: { 'planning-zoom': '"week"' } })
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-member-id]', { timeout: 30000 })
  await page.waitForTimeout(2500)

  const ms = await medianMs(page, { selector: '[data-member-id="menno"] button', index: 1 })
  assert.notEqual(ms, null, 'de rij van menno heeft een uitklapknop')
  assert.ok(ms < 1000, `uitklappen duurde ${ms}ms (grens 1000ms; was 1950ms vóór de bord-index)`)
  console.log(`    planning uitklappen: ${ms}ms`)
  await page.close()
})

test('een groep in- en uitklappen op een volle agenda blijft onder een seconde', { skip: skip ?? false }, async () => {
  const page = await openPage(browser, { board: zwaarBord() })
  await gotoBoard(page)

  const ms = await medianMs(page, { selector: '[data-group-id] button', index: 0 })
  assert.notEqual(ms, null, 'de groep heeft een klapknop')
  assert.ok(ms < 1000, `klappen duurde ${ms}ms (grens 1000ms)`)
  console.log(`    agenda groep klappen: ${ms}ms`)
  await page.close()
})
