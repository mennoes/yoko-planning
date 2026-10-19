import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// De echte module draaien, met alleen de randen (Supabase, sessie,
// window) vervangen. Zo testen we wat er werkelijk weggeschreven wordt.
function loadItemActivity() {
  const source = readFileSync(new URL('../lib/itemActivity.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText

  const inserts = []
  const supabase = {
    from() {
      return {
        async insert(row) { inserts.push(row); return { error: null } },
      }
    },
  }
  const exports = {}
  runInNewContext(js, {
    exports,
    window: { dispatchEvent() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    require(id) {
      if (id === './supabase') return { supabase }
      if (id === './sync') return { getCurrentUserId: async () => 'user-1' }
      throw new Error(`Onverwachte afhankelijkheid ${id}`)
    },
  })
  return { ...exports, inserts }
}

test('een aangemaakt item komt in de activiteit te staan, met maker', async () => {
  // Dit ontbrak: de activiteit van een item begon pas bij de eerste
  // wijziging, dus bij een item dat je niet herkent zag je nergens waar
  // het vandaan kwam.
  const mod = loadItemActivity()
  await mod.logItemCreated('item-42', 'Slides maken', 'nederland')

  assert.equal(mod.inserts.length, 1)
  const rij = mod.inserts[0]
  assert.equal(rij.user_id, 'user-1', 'de ingelogde gebruiker is de maker')
  assert.equal(rij.action, 'maakte dit item aan')
  assert.equal(rij.target, 'board_item:item-42')
  assert.equal(rij.detail, 'Slides maken')
  // Objecten uit runInNewContext hebben een andere prototype-keten,
  // dus veld voor veld vergelijken in plaats van deepStrictEqual.
  assert.equal(rij.meta.itemName, 'Slides maken')
  assert.equal(rij.meta.boardId, 'nederland')
})

test("de placeholdernaam 'Nieuw item' komt niet in het logboek", async () => {
  // Een rij die je op de agenda aanmaakt heet eerst 'Nieuw item' en
  // krijgt daarna pas een naam. Die placeholder herhalen zegt niets.
  const mod = loadItemActivity()
  await mod.logItemCreated('item-43', 'Nieuw item', 'yoko')

  assert.equal(mod.inserts[0].detail, null, 'geen naam achter de regel')
  assert.equal(mod.inserts[0].action, 'maakte dit item aan', 'de regel zelf staat er wel')
})

test('zonder sessie wordt er niets gelogd', async () => {
  const source = readFileSync(new URL('../lib/itemActivity.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const inserts = []
  const exports = {}
  runInNewContext(js, {
    exports,
    window: { dispatchEvent() {} },
    CustomEvent: class {},
    require(id) {
      if (id === './supabase') return { supabase: { from: () => ({ async insert(r) { inserts.push(r); return { error: null } } }) } }
      if (id === './sync') return { getCurrentUserId: async () => null }
      throw new Error(`Onverwachte afhankelijkheid ${id}`)
    },
  })
  await exports.logItemCreated('item-44', 'Iets', 'yoko')
  assert.equal(inserts.length, 0, 'een uitgelogde sessie schrijft geen maker weg')
})
