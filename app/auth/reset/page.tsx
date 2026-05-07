'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [ready,    setReady]    = useState(false)
  const [pw,       setPw]       = useState('')
  const [pw2,      setPw2]      = useState('')
  const [loading,  setLoading]  = useState(false)
  const [message,  setMessage]  = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (!supabase) return
    // After clicking the recovery link, Supabase puts a session in URL (hash)
    // and the client picks it up automatically (detectSessionInUrl + implicit
    // flow). Wait a tick, then check.
    const timer = setTimeout(async () => {
      const { data } = await supabase!.auth.getSession()
      if (data.session?.user) setReady(true)
      else setMessage({ text: 'Geen geldige reset-sessie. Vraag opnieuw een reset-link aan.', ok: false })
    }, 200)
    return () => clearTimeout(timer)
  }, [])

  async function handleSubmit() {
    if (!pw || pw.length < 6) { setMessage({ text: 'Wachtwoord moet minimaal 6 tekens zijn.', ok: false }); return }
    if (pw !== pw2)            { setMessage({ text: 'Wachtwoorden komen niet overeen.',         ok: false }); return }
    setLoading(true); setMessage(null)
    const { error } = await supabase!.auth.updateUser({ password: pw })
    setLoading(false)
    if (error) { setMessage({ text: error.message, ok: false }); return }
    setMessage({ text: 'Wachtwoord opgeslagen. Doorsturen…', ok: true })
    setTimeout(() => router.replace('/'), 800)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
      <div style={{ width: 380, padding: '40px 36px', background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>Wachtwoord instellen</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Kies een nieuw wachtwoord voor je account.</p>
        </div>

        {ready ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)}
              placeholder="Nieuw wachtwoord (min 6 tekens)"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={inp} autoFocus />
            <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
              placeholder="Herhaal wachtwoord"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={inp} />
            <button onClick={handleSubmit} disabled={loading} style={btn}>
              {loading ? 'Opslaan…' : 'Wachtwoord opslaan'}
            </button>
          </div>
        ) : !message ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>Even controleren…</p>
        ) : null}

        {message && (
          <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
            background: message.ok ? 'rgba(0,200,117,0.1)' : 'rgba(196,69,58,0.1)',
            color: message.ok ? '#037f4c' : '#C4453A',
            border: `1px solid ${message.ok ? 'rgba(0,200,117,0.3)' : 'rgba(196,69,58,0.3)'}`,
          }}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  )
}

const inp: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg-card)',
  color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const btn: React.CSSProperties = {
  width: '100%', padding: '11px', borderRadius: 8, border: 'none',
  background: 'var(--accent)', color: '#000', fontSize: 14, fontWeight: 700,
  cursor: 'pointer',
}
