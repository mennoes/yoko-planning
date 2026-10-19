// Harnas voor de flow-tests.
//
// Waarom deze er zijn: de bestaande suite in tests/ leest voor een groot
// deel de broncode als tekst in en matcht er regexen op. Dat faalt zodra
// je een variabele hernoemt of een label anders formuleert, en het slaagt
// als een functie bestaat maar niets doet. Daardoor is refactoren duur —
// precies wat we willen oplossen. Deze tests klikken in een echte browser
// en controleren wat er gebeurt.
//
// Ze draaien NIET mee in `npm test` en dus ook niet in de Vercel-build:
// daar is geen browser. Lokaal:
//
//     npm run build && npm start &
//     npm run e2e
//
// De tests werken zonder Supabase. Zonder config valt de app terug op
// localStorage, en dat is precies het pad dat we hier willen vastleggen.

import { existsSync } from 'node:fs'

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3210'

export function findChromium() {
  return CANDIDATES.find(p => existsSync(p)) ?? null
}

/** Draait de server? Zo niet, dan slaan we de suite over met uitleg i.p.v.
 *  dertig timeouts van 30 seconden. */
export async function serverIsUp() {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch { return false }
}

export async function reasonToSkip() {
  if (!findChromium()) {
    return 'geen Chromium gevonden — zet CHROMIUM_PATH of installeer er een'
  }
  if (!await serverIsUp()) {
    return `geen server op ${BASE_URL} — draai eerst \`npm run build && npm start\``
  }
  return null
}

const PROFILE = { memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }

/**
 * Een bord met twee gedateerde items. Gedateerd omdat de agenda standaard
 * op een periode filtert: items zonder datum vallen er buiten en dan krijg
 * je 'Geen resultaten gevonden' i.p.v. rijen.
 */
export function boardFixture() {
  const iso = offset => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d.toISOString().slice(0, 10)
  }
  return [{
    id: 'g1', name: 'Testgroep', color: '#579bfc',
    items: [
      { id: 'i1', name: 'Eerste item',  ownerIds: ['menno'], status: 'Working on it', estHours: 8, startDate: iso(1), endDate: iso(3), subitems: [] },
      { id: 'i2', name: 'Tweede item', ownerIds: ['menno'], status: 'Working on it', estHours: 4, startDate: iso(1), endDate: iso(3), subitems: [] },
    ],
  }]
}

/** Nieuwe pagina met profiel en bord al in localStorage, zodat we niet
 *  elke test door de 'wie ben jij?'-stap heen hoeven klikken. */
export async function openPage(browser, { board = boardFixture(), mobile = false, storage = {} } = {}) {
  const page = await browser.newPage(mobile
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    : { viewport: { width: 1500, height: 950 } })
  await page.addInitScript(payload => {
    localStorage.setItem('yoko-profile', payload.profile)
    localStorage.setItem('yoko-board-yoko', payload.board)
    for (const [key, value] of Object.entries(payload.extra)) localStorage.setItem(key, value)
  }, { profile: JSON.stringify(PROFILE), board: JSON.stringify(board), extra: storage })
  return page
}

export async function gotoBoard(page, path = '/projects/yoko') {
  await page.goto(BASE_URL + path, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id]', { timeout: 20000 })
  // De agenda doet na de eerste render nog een pull-ronde; even laten
  // bezinken, anders meet je de tussenstand.
  await page.waitForTimeout(800)
}

export async function itemNames(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-item-id]')].map(el => el.dataset.itemId))
}
