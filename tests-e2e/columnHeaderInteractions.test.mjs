// De kolomkop heeft drie losse doelen: naam hernoemen, sorteren en slepen.
// Deze test bewaakt vooral de verwarrende combinatie uit de bugmelding:
// klikken op de naam mag niet slepen, en het vlak ernaast moet dat wel doen.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, openPage, gotoBoard } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

test('kolomnaam hernoemt; de ruimte ernaast is het sleephandvat', { skip: skip ?? false }, async () => {
  const page = await openPage(browser)
  await gotoBoard(page)

  const name = page.getByRole('button', { name: 'Kolom Timeline hernoemen' }).first()
  assert.equal(await name.getAttribute('draggable'), 'false', 'de naam zelf is niet sleepbaar')
  await name.click()

  const input = page.getByRole('textbox', { name: 'Nieuwe naam voor kolom Timeline' }).first()
  await input.fill('Planningperiode')
  await input.press('Enter')
  await page.getByRole('button', { name: 'Kolom Planningperiode hernoemen' }).first().waitFor()

  const handle = page.getByTestId('kolom-sleephandvat-timeline').first()
  assert.equal(await handle.getAttribute('draggable'), 'true', 'het vlak naast de naam is wel sleepbaar')

  const ownerHandle = page.getByTestId('kolom-sleephandvat-ownerIds').first()
  const before = await page.locator('[data-testid^="kolom-sleephandvat-"]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-testid')),
  )
  const targetBox = await handle.boundingBox()
  await ownerHandle.dragTo(handle, { targetPosition: { x: Math.max(1, (targetBox?.width ?? 20) - 2), y: Math.max(1, (targetBox?.height ?? 20) / 2) } })
  await page.waitForTimeout(400)
  const after = await page.locator('[data-testid^="kolom-sleephandvat-"]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-testid')),
  )
  assert.notDeepEqual(after, before, 'slepen via het vlak ernaast verandert de kolomvolgorde')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]', { timeout: 20000 })
  await page.getByRole('button', { name: 'Kolom Planningperiode hernoemen' }).first().waitFor()
  await page.close()
})
