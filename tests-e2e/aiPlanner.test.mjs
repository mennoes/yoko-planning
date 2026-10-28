// Het paneel 'Item uitschrijven' op de agenda.
//
// Het model zelf draait hier niet mee: de route wordt onderschept zodat
// de test over de app gaat en niet over het netwerk. Wat we vastleggen:
// de knop verschijnt alleen als de server zegt dat de planner aanstaat,
// het voorstel is eerst te zien, en pas Aanmaken zet het op het bord.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL, boardFixture } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const VOORSTEL = {
  ok: true,
  plan: {
    name: 'NKO Explainer',
    groupName: 'Testgroep',
    startDate: iso(1),
    endDate: iso(14),
    estHours: 32,
    ownerIds: ['menno'],
    notes: 'Twee minuten, Nederlands gesproken.',
    subitems: [
      { name: 'Script', startDate: iso(1), endDate: iso(3), estHours: 8, ownerIds: ['menno'] },
      { name: 'Animatie', startDate: iso(7), endDate: iso(14), estHours: 24, ownerIds: ['menno'] },
    ],
  },
}

async function openAgenda({ available = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' })
  await page.route('**/api/ai/plan', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { available, model: 'test' } })
      return
    }
    await route.fulfill({ json: VOORSTEL })
  })
  await page.addInitScript(board => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-board-yoko', board)
  }, JSON.stringify(boardFixture()))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]')
  await page.waitForTimeout(800)
  return page
}

test('zonder sleutel op de server is er geen tabblad om te laten uitschrijven', { skip: skip ?? false }, async () => {
  const page = await openAgenda({ available: false })
  // De knop blijft: het sjabloon werkt altijd, ook zonder sleutel.
  await page.getByRole('button', { name: /Item aanmaken/ }).first().click()
  await page.waitForTimeout(400)
  assert.equal(await page.getByRole('tab', { name: 'Laten uitschrijven' }).count(), 0)
  await page.close()
})

test('een voorstel is eerst te zien en komt pas na Aanmaken op het bord', { skip: skip ?? false }, async () => {
  const page = await openAgenda()
  await page.getByRole('button', { name: /Item aanmaken/ }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('tab', { name: 'Laten uitschrijven' }).click()
  await page.waitForTimeout(300)

  await page.getByRole('dialog', { name: 'Item aanmaken' })
    .getByRole('textbox').first()
    .fill('Explainer van 2 minuten voor NKO, aanleveren over twee weken.')
  await page.getByRole('button', { name: 'Maak een voorstel' }).click()
  await page.waitForSelector('[data-ai-voorstel]')

  const voorstel = await page.locator('[data-ai-voorstel]').innerText()
  assert.match(voorstel, /NKO Explainer/)
  assert.match(voorstel, /Script/)
  assert.match(voorstel, /Animatie/)

  // Kijken is nog niets veranderen.
  const voorAanmaken = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('yoko-board-yoko'))[0].items.length)
  assert.equal(voorAanmaken, 2, 'het bord heeft nog alleen z\'n eigen items')

  // Eén subitem weglaten en dan pas aanmaken.
  await page.getByRole('button', { name: 'Animatie weglaten' }).click()
  await page.getByRole('button', { name: 'Aanmaken', exact: true }).click()
  await page.waitForTimeout(900)

  const opHetBord = await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('yoko-board-yoko'))[0].items
    const item = items.find(i => i.name === 'NKO Explainer')
    return item && {
      aantal: items.length,
      subs: (item.subitems ?? []).map(s => s.name),
      owners: item.ownerIds,
      start: item.startDate,
      notes: item.notes,
    }
  })
  assert.ok(opHetBord, 'het item staat op het bord')
  assert.equal(opHetBord.aantal, 3)
  assert.deepEqual(opHetBord.subs, ['Script'], 'het weggelaten subitem is er niet bij')
  assert.deepEqual(opHetBord.owners, ['menno'])
  assert.equal(opHetBord.start, iso(1))
  assert.match(opHetBord.notes, /Nederlands gesproken/)
  await page.close()
})
