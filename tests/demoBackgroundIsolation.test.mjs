import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shell = readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8')

test('de demo start geen echte remote sync of subscriptions', () => {
  const remoteEffect = shell.slice(
    shell.indexOf('// Remote sync'),
    shell.indexOf('// Google Calendar sync'),
  )

  assert.match(remoteEffect, /if \(isDemoRoute\) return/)
  assert.ok(
    remoteEffect.indexOf('if (isDemoRoute) return') < remoteEffect.indexOf('isSyncing()'),
    'de demo-guard moet vóór iedere echte sync staan',
  )
  assert.match(remoteEffect, /\}, \[isDemoRoute\]\)/)
})

test('de demo start geen Google-sync of recovery-snapshots', () => {
  const googleEffect = shell.slice(
    shell.indexOf('// Google Calendar sync'),
    shell.indexOf('// Login + share + auth routes'),
  )

  assert.match(googleEffect, /if \(isDemoRoute\) return/)
  assert.ok(
    googleEffect.indexOf('if (isDemoRoute) return') < googleEffect.indexOf("fetch('/api/snapshots/create'"),
    'de demo-guard moet vóór het aanmaken van snapshots staan',
  )
  assert.match(googleEffect, /\}, \[isDemoRoute\]\)/)
})
