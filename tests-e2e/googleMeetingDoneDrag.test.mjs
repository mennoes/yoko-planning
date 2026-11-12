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
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

test('Google meeting can be dragged to Done and remains there after reload', { skip: skip ?? false }, async () => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: 'light' })
  // Houd deze flow-test volledig los van het echte online bord. De lokale
  // save blijft actief en is precies wat we hier na een refresh controleren.
  await page.route(url => /supabase|\/rest\/v1\//i.test(url.href), route => route.abort())
  const board = [
    {
      id: 'meetings', name: 'Ouder dan 2 maanden', color: '#cab641', items: [{
        id: 'google-meet-1', name: 'Dienjaar presentatie', source: 'google', status: '',
        ownerIds: ['menno'], startDate: iso(0), endDate: iso(0), estHours: 1, subitems: [],
      }],
    },
    { id: 'done', name: 'Done', color: '#ff7a00', items: [] },
  ]
  await page.addInitScript(value => {
    localStorage.setItem('yoko-profile', JSON.stringify({ memberId: 'menno', name: 'Menno', color: '#579bfc', photo: null }))
    if (!localStorage.getItem('yoko-board-yoko')) localStorage.setItem('yoko-board-yoko', value)
  }, JSON.stringify(board))
  await page.goto(BASE_URL + '/projects/yoko', { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-item-id="google-meet-1"]', { timeout: 20000 })
  await page.waitForTimeout(900)

  const dragResult = await page.evaluate(() => {
    const grip = document.querySelector('[data-item-id="google-meet-1"] .row-grip')
    const target = document.querySelector('[data-group-id="done"] > div')
    if (!grip || !target) return 'not found'
    const transfer = new DataTransfer()
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
    const rect = target.getBoundingClientRect()
    const options = {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: rect.left + rect.width / 2, clientY: rect.top + 20,
    }
    target.dispatchEvent(new DragEvent('dragover', options))
    target.dispatchEvent(new DragEvent('drop', options))
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
    return 'ok'
  })
  assert.equal(dragResult, 'ok')
  await page.waitForTimeout(1000)

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('yoko-board-yoko')))
  const moved = stored.find(group => group.id === 'done')?.items.find(item => item.id === 'google-meet-1')
  assert.equal(moved?.status, 'Done')
  assert.equal(moved?.statusOverride, 'done')
  assert.equal(moved?.googlePlacementLocked, true)

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('yoko-board-yoko')))
  assert.ok(afterReload.find(group => group.id === 'done')?.items.some(item => item.id === 'google-meet-1'))
  await page.close()
})
