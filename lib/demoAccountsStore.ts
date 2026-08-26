'use client'

// Demo-variant van lib/accountsStore.ts — GEEN Supabase, GEEN import van
// lib/accountsStore.ts. Puur lokaal (localStorage), gevuld met volledig
// verzonnen fixtures. Dit bestand mag NOOIT een `supabase.from('accounts')`
// call of een import uit lib/accountsStore.ts bevatten — de echte tabel
// bevat plaintext wachtwoorden voor Studio Yoko's eigen tool-abonnementen.
//
// Zelfde vorm (Account-type, CRUD-functienamen) als de echte store zodat
// de demo-pagina 'm als drop-in kan gebruiken, maar met een eigen
// `yoko-demo-`-key en zonder enige remote call.

export type DemoAccount = {
  id:         string
  account:    string
  url:        string
  username:   string
  password:   string
  licensedBy: string
}

const KEY   = 'yoko-demo-accounts'
const EVENT = 'yoko-demo-accounts-update'

// Verzonnen voorbeeld-accounts — duidelijk fictief (domeinen eindigen op
// -demo.nl, wachtwoorden zijn nep-placeholders). Representeert het soort
// gedeelde SaaS-tools die een klein creatief studio zou gebruiken, zonder
// ook maar in de buurt te komen van een echte Studio Yoko-credential.
const SEED_ACCOUNTS: DemoAccount[] = [
  {
    id:         'demo-acct-1',
    account:    'Adobe Creative Cloud (Demo)',
    url:        'https://account.adobe.com',
    username:   'demo@studioyoko-demo.nl',
    password:   'demo-wachtwoord-123',
    licensedBy: 'Team-account (demo)',
  },
  {
    id:         'demo-acct-2',
    account:    'Google Workspace (Demo)',
    url:        'https://admin.google.com',
    username:   'demo-team@studioyoko-demo.nl',
    password:   'Demo-Wachtwoord-2024',
    licensedBy: 'Studio (demo)',
  },
  {
    id:         'demo-acct-3',
    account:    'Vimeo Pro (Demo)',
    url:        'https://vimeo.com/log_in',
    username:   'demo-video@studioyoko-demo.nl',
    password:   'demo-vimeo-wachtwoord-1',
    licensedBy: 'Marketing (demo)',
  },
  {
    id:         'demo-acct-4',
    account:    'Dropbox Business (Demo)',
    url:        'https://www.dropbox.com/login',
    username:   'demo-files@studioyoko-demo.nl',
    password:   'demo-dropbox-wachtwoord-2',
    licensedBy: 'Studio (demo)',
  },
  {
    id:         'demo-acct-5',
    account:    'Figma Organization (Demo)',
    url:        'https://figma.com/login',
    username:   'demo-design@studioyoko-demo.nl',
    password:   'demo-figma-wachtwoord-3',
    licensedBy: 'Design team (demo)',
  },
]

// Geeft telkens een verse kopie terug zodat een caller de seed-array niet
// per ongeluk kan muteren.
export function seedAccounts(): DemoAccount[] {
  return SEED_ACCOUNTS.map(a => ({ ...a }))
}

export function loadAccounts(): DemoAccount[] {
  if (typeof window === 'undefined') return seedAccounts()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return seedAccounts()
    const parsed = JSON.parse(raw) as DemoAccount[]
    return Array.isArray(parsed) ? parsed : seedAccounts()
  } catch { return seedAccounts() }
}

export function saveAccounts(accounts: DemoAccount[]): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(KEY, JSON.stringify(accounts)) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function onAccountsUpdate(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

export function resetDemoAccounts(): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(KEY) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT))
}
