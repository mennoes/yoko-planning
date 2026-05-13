// Accounts (incl. wachtwoorden) — Supabase store met auth-gated RLS.
//
// Niet-ingelogde gebruikers krijgen GEEN data (RLS blokkeert select voor
// anon). Ingelogde gebruikers lezen en schrijven via deze module. De
// pagina-component houdt zelf state bij; pull/push hier zijn dunne wrappers
// rondom de Supabase calls plus realtime-subscriptie zodat wijzigingen
// over meerdere devices direct doorkomen.

import { supabase } from './supabase'
import { getCurrentUserId } from './sync'

export type Account = {
  id:         string
  account:    string
  url:        string
  username:   string
  password:   string
  licensedBy: string
}

type Row = {
  id:         string
  account:    string
  url:        string | null
  username:   string | null
  password:   string | null
  license_by: string | null
  position:   number | null
}

function rowToAccount(r: Row): Account {
  return {
    id:         r.id,
    account:    r.account ?? '',
    url:        r.url ?? '',
    username:   r.username ?? '',
    password:   r.password ?? '',
    licensedBy: r.license_by ?? '',
  }
}

export async function pullAccounts(): Promise<Account[] | null> {
  if (!supabase) return null
  if (!await getCurrentUserId()) return null
  const { data, error } = await supabase
    .from('accounts')
    .select('id, account, url, username, password, license_by, position')
    .order('position', { ascending: true })
  if (error || !data) return null
  return (data as Row[]).map(rowToAccount)
}

export async function upsertAccount(a: Account, position: number): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { error } = await supabase.from('accounts').upsert({
    id:         a.id,
    account:    a.account,
    url:        a.url,
    username:   a.username,
    password:   a.password,
    license_by: a.licensedBy,
    position,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  return !error
}

export async function deleteAccount(id: string): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const { error } = await supabase.from('accounts').delete().eq('id', id)
  return !error
}

// Bulk-replace: handig voor reorderen of voor first-time seed vanuit
// een lokaal JSON-bestand. Doet upserts + verwijdert wat er teveel staat.
export async function syncAccounts(items: Account[]): Promise<boolean> {
  if (!supabase) return false
  if (!await getCurrentUserId()) return false
  const rows = items.map((a, idx) => ({
    id:         a.id,
    account:    a.account,
    url:        a.url,
    username:   a.username,
    password:   a.password,
    license_by: a.licensedBy,
    position:   idx,
    updated_at: new Date().toISOString(),
  }))
  if (rows.length > 0) {
    const { error } = await supabase.from('accounts').upsert(rows, { onConflict: 'id' })
    if (error) return false
  }
  const localIds = new Set(items.map(a => a.id))
  const { data: remoteIds } = await supabase.from('accounts').select('id')
  if (remoteIds) {
    const stale = (remoteIds as { id: string }[]).map(r => r.id).filter(id => !localIds.has(id))
    if (stale.length > 0) await supabase.from('accounts').delete().in('id', stale)
  }
  return true
}

let accountsChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
export function subscribeRemoteAccounts(onChange: () => void): () => void {
  if (!supabase) return () => {}
  if (accountsChannel) return () => {}
  const ch = supabase.channel('accounts')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => onChange())
    .subscribe()
  accountsChannel = ch
  return () => {
    if (supabase && accountsChannel) {
      supabase.removeChannel(accountsChannel)
      accountsChannel = null
    }
  }
}
