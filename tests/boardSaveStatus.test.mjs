import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const listeners = new Map()
const window = {
  addEventListener(name, listener) { listeners.set(name, listener) },
  removeEventListener(name, listener) {
    if (listeners.get(name) === listener) listeners.delete(name)
  },
  dispatchEvent(event) {
    listeners.get(event.type)?.(event)
    return true
  },
}
class CustomEvent {
  constructor(type, options) {
    this.type = type
    this.detail = options.detail
  }
}

const source = readFileSync(new URL('../lib/boardSaveStatus.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const api = {}
runInNewContext(js, { exports: api, window, CustomEvent, Date })

test('save status subscribers receive saving, confirmation and failure states', () => {
  const received = []
  const unsubscribe = api.subscribeBoardSaveStatus(status => received.push(status))
  api.emitBoardSaveStatus({ boardName: 'yoko', state: 'saving' })
  api.emitBoardSaveStatus({ boardName: 'yoko', state: 'saved' })
  api.emitBoardSaveStatus({ boardName: 'yoko', state: 'error', message: 'Netwerkfout' })
  unsubscribe()
  api.emitBoardSaveStatus({ boardName: 'yoko', state: 'saving' })

  assert.deepEqual(received.map(status => status.state), ['saving', 'saved', 'error'])
  assert.equal(received[2].message, 'Netwerkfout')
  assert.equal(typeof received[0].at, 'number')
})

test('the visible save indicator retains errors and offers an explicit retry', () => {
  const indicator = readFileSync(new URL('../components/BoardSaveIndicator.tsx', import.meta.url), 'utf8')
  assert.match(indicator, /status\.state === 'saved'/)
  assert.match(indicator, /setTimeout/)
  assert.match(indicator, /status\.state === 'error' && <button[^>]+onClick=\{retry\}>Opnieuw<\/button>/)
})
