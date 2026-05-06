'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Mode = 'magic' | 'password'

export default function LoginPage() {
  const [mode,     setMode]     = useState<Mode>('password')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [isNew,    setIsNew]    = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [message,  setMessage]  = useState<{ text: string; ok: boolean } | null>(null)

  async function handleMagicLink() {
    if (!email) return
    setLoading(true); setMessage(null)
    const { error } = await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
    setLoading(false)
    if (error) setMessage({ text: error.message, ok: false })
    else       setMessage({ text: `Check je e-mail (${email}) voor de loginlink!`, ok: true })
  }

  async function handlePassword() {
    if (!email || !password) return
    setLoading(true); setMessage(null)
    const fn = isNew ? supabase!.auth.signUp : supabase!.auth.signInWithPassword
    const { error } = await fn.call(supabase!.auth, { email, password })
    setLoading(false)
    if (error) setMessage({ text: error.message, ok: false })
    else if (isNew) setMessage({ text: 'Account aangemaakt! Check je e-mail om te bevestigen.', ok: true })
    else window.location.href = '/'
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  }
  const btn: React.CSSProperties = {
    width: '100%', padding: '11px', borderRadius: 8, border: 'none',
    background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700,
    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
      <div style={{ width: 380, padding: '40px 36px', background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>

        {/* Logo */}
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <svg width="80" height="14" viewBox="0 0 323 57" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'var(--text-primary)' }}>
            <path d="M28.1953 0L38.8008 21.0498L49.3555 0H77.5508L53.1279 37.75V57H24.4229V37.75L0 0H28.1953ZM126.141 0C142.252 0 155.305 12.75 155.254 28.5C155.254 44.25 142.252 57 126.141 57H100.749C84.6885 56.9998 71.6357 44.2498 71.6357 28.5C71.6357 12.7502 84.6375 0.000245086 100.749 0H126.141ZM191.607 28.4004L211.34 0H243.104L223.78 28.9004L243.104 57H211.34L191.607 28.4004V57H161.22V0H191.607V28.4004ZM293.887 0C309.947 1.6438e-05 323 12.75 323 28.5C323 44.25 309.998 57 293.887 57H268.495C252.434 56.9999 239.382 44.2499 239.382 28.5C239.382 12.7501 252.383 0.000120154 268.495 0H293.887ZM128.792 4.9502C122.113 0.850233 110.08 7.85003 101.974 20.5498C93.8668 33.2498 92.7446 46.9 99.4238 51C106.103 55.1 118.136 48.1003 126.243 35.4004C134.35 22.7004 135.471 9.0502 128.792 4.9502ZM296.487 4.9502C289.808 0.850206 277.775 7.84987 269.668 20.5498C261.561 33.2498 260.44 46.9 267.119 51C273.798 55.0996 285.831 48.1 293.938 35.4004C302.044 22.7006 303.217 9.05043 296.487 4.9502Z" fill="currentColor"/>
          </svg>
          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.28em', textTransform: 'uppercase', marginTop: 5 }}>PLANNING</div>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px', textAlign: 'center' }}>Inloggen</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 24px' }}>Studio Yoko planning tool</p>

        {/* Mode tabs */}
        <div style={{ display: 'flex', background: 'var(--overlay-medium)', borderRadius: 8, padding: 3, marginBottom: 20 }}>
          {(['magic', 'password'] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ flex: 1, padding: '7px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: mode === m ? 'var(--bg-card)' : 'transparent',
                color: mode === m ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>
              {m === 'magic' ? '✉️ Magic link' : '🔑 Wachtwoord'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="E-mailadres" style={inp}
            onKeyDown={e => e.key === 'Enter' && (mode === 'magic' ? handleMagicLink() : handlePassword())} />

          {mode === 'password' && (
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Wachtwoord" style={inp}
              onKeyDown={e => e.key === 'Enter' && handlePassword()} />
          )}

          <button onClick={mode === 'magic' ? handleMagicLink : handlePassword} disabled={loading} style={btn}>
            {loading ? 'Even wachten…' : mode === 'magic' ? 'Stuur loginlink' : isNew ? 'Account aanmaken' : 'Inloggen'}
          </button>

          {mode === 'password' && (
            <button onClick={() => setIsNew(n => !n)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 0 }}>
              {isNew ? 'Al een account? Inloggen' : 'Nog geen account? Registreren'}
            </button>
          )}
        </div>

        {message && (
          <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
            background: message.ok ? 'rgba(0,200,117,0.1)' : 'rgba(226,68,92,0.1)',
            color: message.ok ? '#037f4c' : '#C4453A',
            border: `1px solid ${message.ok ? 'rgba(0,200,117,0.3)' : 'rgba(226,68,92,0.3)'}`,
          }}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  )
}
