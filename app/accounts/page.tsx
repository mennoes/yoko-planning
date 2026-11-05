'use client'

import { AccountAccessPanel } from '@/components/AccountAccessPanel'
import { accountAccessAdmin } from '@/lib/accountAccess'
import { AccountCard } from '@/components/AccountCard'
import { AccountGroups } from '@/components/AccountGroups'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { IconKey } from '@/components/Icon'
import { useProfile } from '@/components/ProfileContext'
import { useUndo } from '@/components/UndoContext'
import { requiresAuth, supabase } from '@/lib/supabase'
import { clearAuthCache } from '@/lib/sync'
import {
  pullAccountsDetailed, upsertAccount, deleteAccount, subscribeRemoteAccounts,
  type Account,
} from '@/lib/accountsStore'

export default function AccountsPage() {
  const { isAuthenticated, authChecked } = useProfile()
  const { showToast } = useUndo()
  const router = useRouter()
  const pathname = usePathname()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [manageAccess, setManageAccess] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [authBlocked, setAuthBlocked] = useState(false)
  const [sessionInfo, setSessionInfo] = useState<{ hasSession: boolean; email?: string | null; dbError?: string }>({ hasSession: false })
  const [retrying, setRetrying] = useState(false)
  // Authenticatie + initiële pull. We laten de gate aan de DATA-laag over:
  // pullAccounts probeert sowieso de query. RLS blokkeert anon-toegang
  // op database-niveau, dus een mislukte pull = niet-ingelogd of geen
  // toegang. Voordeel: de pagina werkt ook als isAuthenticated-state
  // hier-en-daar nog niet doorgekomen is (timing / localStorage-only
  // profile-cache) — zolang de Supabase-sessie geldig is, krijgt de
  // user de accounts. Lukt 't niet → nette lock-melding.
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!requiresAuth) { setAuthBlocked(true); setLoading(false); return }
      if (!authChecked)  { setLoading(true); return }       // auth nog aan 't laden
      // Check de Supabase-sessie rechtstreeks, niet via de cache van
      // ProfileContext — die kan stale zijn. Zo zien we ook in welke
      // staat we hangen wanneer authBlocked uiteindelijk true wordt.
      let sessEmail: string | null | undefined
      let sessHas = false
      if (supabase) {
        const { data } = await supabase.auth.getUser()
        if (cancelled) return
        sessHas = !!data.user
        sessEmail = data.user?.email
        setManageAccess(accountAccessAdmin(data.user?.app_metadata))
      }
      clearAuthCache()
      const result = await pullAccountsDetailed()
      if (cancelled) return
      setAccessDenied(!!result.forbidden)
      if (!result.rows) {
        setAccounts([])
        setSessionInfo({
          hasSession: sessHas,
          email:      sessEmail,
          dbError:    result.error?.message
                      ? `${result.error.message}${result.error.code ? ` (${result.error.code})` : ''}`
                      : (result.noAuth ? 'geen geldige sessie gevonden bij Supabase' : undefined),
        })
        setAuthBlocked(true); setLoading(false); return
      }
      setSessionInfo({ hasSession: sessHas, email: sessEmail })
      setAuthBlocked(false)
      setAccounts(result.rows); setLoading(false)
    }
    load()
    const off = subscribeRemoteAccounts(() => { void load() })
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, 30000)
    return () => { cancelled = true; off(); window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [isAuthenticated, authChecked, retrying])

  async function retry() {
    if (!supabase) return
    setLoading(true)
    setRetrying(r => !r)  // dep flip → effect re-runs
    try {
      // Sessie pakken na een eventuele refresh — als de gebruiker net
      // een tab terug komt na inactiviteit kan dit 'm weer wakker maken.
      await supabase.auth.refreshSession()
    } catch {}
  }

  const saveAccount = async (account: Account) => {
    const ok = await upsertAccount(account, accounts.findIndex(a => a.id === account.id))
    if (ok) setAccounts(current => current.map(a => a.id === account.id ? account : a))
    return ok
  }

  const addRow = async () => {
    const newId = Date.now().toString()
    const fresh: Account = { id: newId, account: 'Nieuw account', url: '', username: '', password: '', licensedBy: '' }
    const next = [...accounts, fresh]
    if (await upsertAccount(fresh, next.length - 1)) setAccounts(next)
    else showToast('Toevoegen mislukt — probeer opnieuw')
  }

  const deleteRow = async (id: string) => {
    if (await deleteAccount(id)) setAccounts(prev => prev.filter(a => a.id !== id))
    else showToast('Verwijderen mislukt — probeer opnieuw')
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 1400, padding: '48px 36px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 28px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconKey size={32} />Accounts
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Laden…</p>
      </div>
    )
  }

  if (accessDenied) return <div style={{maxWidth:700,padding:'40px 28px'}}>
    <h1 style={{fontSize:28}}>Accounts</h1>
    <p style={{fontSize:15,color:'var(--text-secondary)'}}>Je hebt geen toegang tot de accountgegevens en wachtwoorden. Vraag een beheerder als je een account nodig hebt.</p>
  </div>

  if (authBlocked) {
    return (
      <div style={{ maxWidth: 1400, padding: '48px 36px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 28px', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconKey size={32} />Accounts
        </h1>
        <div style={{ padding: '32px 28px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 16px' }}>
            🔒 De wachtwoorden zijn alleen zichtbaar voor ingelogde teamleden.
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
            Status: {sessionInfo.hasSession
              ? <>ingelogd als <strong>{sessionInfo.email}</strong>, maar de database wijst je af.</>
              : <>geen actieve sessie gevonden.</>}
          </p>
          {sessionInfo.dbError && (
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', background: 'var(--bg-base)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
              {sessionInfo.dbError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={retry}
              style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-hover)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
            >
              Probeer opnieuw
            </button>
            <button
              onClick={() => router.push(`/login?next=${encodeURIComponent(pathname || '/accounts')}`)}
              style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
            >
              Log in
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <div style={{ padding: '28px 28px', maxWidth: 1600, margin: '0 auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
      <h1 style={{ margin: 0, fontSize: 28, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-primary)' }}><IconKey size={24} />Accounts</h1>
      <div style={{display:'flex',gap:8}}>
      {manageAccess&&<button onClick={()=>setAccessOpen(!accessOpen)} aria-expanded={accessOpen} style={{border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',background:'var(--bg-card)',color:'var(--text-primary)',fontSize:12,cursor:'pointer'}}>Toegang beheren</button>}
      <button onClick={addRow} style={{ border: 0, borderRadius: 8, padding: '8px 12px', background: 'var(--accent)', color: '#171717', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}>+ Account</button></div>
    </div>
    {manageAccess&&accessOpen&&<AccountAccessPanel/>}
    <AccountGroups accounts={accounts} renderCard={(account,handle,categoryPicker) => <AccountCard account={account} handle={handle} categoryPicker={categoryPicker} onSave={saveAccount} onDelete={() => deleteRow(account.id)} />} />
  </div>
}
