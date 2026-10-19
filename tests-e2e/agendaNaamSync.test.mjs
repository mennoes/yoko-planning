// Hernoem je een agenda op het ene apparaat, dan hoort die naam op het
// andere apparaat ook te verschijnen.
//
// De naam is gedeeld: hij staat in Supabase (boards.name) en komt via de
// boards-registry binnen. Het menu bewaart per apparaat z'n eigen
// volgorde — en bewaarde ook een kópie van de naam. Die kopie kon oud
// zijn, en dan las je in het menu nog de vorige naam.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChromium, reasonToSkip, BASE_URL } from './harness.mjs'

const skip = await reasonToSkip()
let browser

before(async () => { if (!skip) browser = await chromium.launch({ executablePath: findChromium() }) })
after(async () => { await browser?.close() })

// Wat er uit de database komt. Het menu van dit apparaat kent deze twee
// nog onder hun oude naam ('PnP' en 'Dienjaar' staan in de standaardlijst).
const REGISTRY = [
  { id: 'yoko',     name: 'yoko',     emoji: '📋', color: '#579bfc', columns: [] },
  { id: 'pnp',      name: 'U Studio', emoji: '📋', color: '#e2445c', columns: [] },
  { id: 'dienjaar', name: 'Itorium',  emoji: '📋', color: '#00c875', columns: [] },
]

async function menuLabels() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  await page.addInitScript(r => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    localStorage.setItem('yoko-boards-registry', r)
  }, JSON.stringify(REGISTRY))
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  // De Agenda's-sectie staat standaard dicht; de kop is zelf een link,
  // dus na het openklappen gaan we terug.
  await page.getByText("Agenda's", { exact: true }).first().click().catch(() => {})
  await page.waitForTimeout(600)
  await page.goto(BASE_URL + '/planning', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  const labels = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('a[href^="/projects/"]')]
      .map(a => [a.getAttribute('href'), (a.textContent ?? '').trim()])))
  await page.close()
  return labels
}

test('het menu toont de gedeelde naam, niet de lokale kopie', { skip: skip ?? false }, async () => {
  const labels = await menuLabels()
  assert.equal(labels['/projects/pnp'], 'U Studio',
    'elders hernoemd naar U Studio, dus dat hoort hier ook te staan')
  assert.equal(labels['/projects/dienjaar'], 'Itorium')
})

test('agendas zonder hernoeming houden gewoon hun naam', { skip: skip ?? false }, async () => {
  const labels = await menuLabels()
  assert.equal(labels['/projects/yoko'], 'yoko')
  // Agenda's die niet in de meegegeven registry zitten vallen terug op de
  // standaardlijst en blijven dus ook gewoon staan.
  assert.equal(labels['/projects/nederland'], 'Nederland')
})
