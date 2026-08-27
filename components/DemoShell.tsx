'use client'

// Chrome voor de publieke /demo-omgeving. Hergebruikt de ECHTE Sidebar +
// SearchPalette + TimerIndicator + FeedbackBubble + mobile-UI 1-op-1
// (zelfde structuur als AppShell's normale branch) zodat de demo er
// precies zo uitziet en werkt als de echte tool. ProfileContext/
// TeamContext/boardsRegistry/navStore geven op /demo al een vaste
// nep-identiteit + nep-team + nep-borden (zie lib/demoFixtures.ts) — dit
// bestand voegt alleen toe:
//   1. een globale klik-onderschepper: elke link die buiten /demo komt
//      wordt naar het demo-equivalent omgeleid, of toont een 'kan niet
//      in de demo'-toast als er geen equivalent is;
//   2. een klein 'Live demo'-label + reset-knop.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import SearchPalette from './SearchPalette'
import TimerIndicator from './TimerIndicator'
import { FeedbackBubble } from './FeedbackBubble'
import ProfileSetup from './ProfileSetup'
import { useIsMobile } from '@/lib/useIsMobile'
import { IconMenu, IconSearch } from './Icon'
import { NotificationBell } from './NotificationBell'
import { UserAvatar } from './UserAvatar'
import { useProfile } from './ProfileContext'
import { useTeam } from './TeamContext'
import { DEMO_BLOCKED_EVENT, demoSafeHref, notifyDemoBlocked } from '@/lib/demoFixtures'
import { resetDemoBoards } from '@/lib/demoBoardStore'

export default function DemoShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notice, setNotice] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const viewerRef = useRef<HTMLDivElement>(null)
  const { profile, setProfile } = useProfile()
  // useTeam() i.p.v. de statische DEMO_MEMBERS-import — zodat leden die een
  // bezoeker zelf toevoegt/verwijdert via /demo/team-admin ook meteen in
  // deze switcher verschijnen/verdwijnen (team-admin schrijft naar dezelfde
  // localStorage-backed lijst die TeamContext op /demo uitleest).
  const { members: liveTeam } = useTeam()
  const bekijkAlsMembers = liveTeam.filter(m => m.id !== 'unassigned' && !m.hidden)
  const activeViewer = bekijkAlsMembers.find(m => m.id === profile?.memberId) ?? bekijkAlsMembers[0]

  useEffect(() => {
    if (!viewerOpen) return
    function close(e: MouseEvent) {
      if (!viewerRef.current?.contains(e.target as Node)) setViewerOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [viewerOpen])

  // Onderschept ELKE <a>-klik binnen de demo (capture-phase, vóór Next's
  // eigen Link-handler) — of het nou uit de hergebruikte Sidebar komt, uit
  // SearchPalette, of ergens anders. Bekende routes (Home/Planning/
  // Todo's) worden naar hun /demo-equivalent omgeleid; de rest toont de
  // 'kan niet in de demo'-toast i.p.v. de bezoeker op een inlogscherm te
  // laten stranden.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      if (a.target === '_blank') return // externe links (Google Meet, mailto, ...) altijd laten gaan
      const href = a.getAttribute('href') || ''
      const safe = demoSafeHref(href)
      if (safe === href) return // al een geldige /demo-link
      e.preventDefault()
      e.stopPropagation()
      if (safe) router.push(safe)
      else notifyDemoBlocked()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [router])

  useEffect(() => {
    function onBlocked() {
      setNotice(true)
      const t = setTimeout(() => setNotice(false), 5000)
      return () => clearTimeout(t)
    }
    window.addEventListener(DEMO_BLOCKED_EVENT, onBlocked)
    return () => window.removeEventListener(DEMO_BLOCKED_EVENT, onBlocked)
  }, [])

  function doReset() {
    resetDemoBoards()
    window.location.reload()
  }

  return (
    <>
      <Sidebar isMobile={isMobile} open={!isMobile || drawerOpen} onClose={() => setDrawerOpen(false)}
        onOpenSearch={!isMobile ? () => setSearchOpen(true) : undefined} />

      {isMobile && drawerOpen && (
        <div onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 55 }} />
      )}
      {isMobile && !drawerOpen && (
        <>
          <div style={{ position: 'fixed', top: 10, left: 10, zIndex: 70, display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setDrawerOpen(true)} aria-label="Menu openen"
              style={{ width: 38, height: 38, borderRadius: 9, background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)', color: 'var(--text-primary)', padding: 0 }}>
              <IconMenu size={20} />
            </button>
          </div>
          <div style={{ position: 'fixed', top: 10, right: 10, zIndex: 70, display: 'flex', gap: 6, alignItems: 'center' }}>
            <NotificationBell />
            <button onClick={() => setSearchOpen(true)} aria-label="Zoeken"
              style={{ width: 38, height: 38, borderRadius: 9, background: 'var(--bg-card)', border: '1px solid var(--border-light)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)', color: 'var(--text-primary)', padding: 0 }}>
              <IconSearch size={18} />
            </button>
          </div>
        </>
      )}

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <TimerIndicator />
      <FeedbackBubble />
      {/* Zelfde modal als de echte app: Sidebar-footer opent 'm via
          openEdit() (ProfileContext). Zonder deze mount deed die knop
          niets zichtbaars op /demo — editOpen ging wel op true, maar er
          was niets dat er iets mee deed. */}
      <ProfileSetup />

      {/* Bekijk-als-switcher — wissel wie 'jij' bent in de demo, direct
          boven de (hergebruikte) Sidebar-footer. Alleen desktop: op
          mobile zit de sidebar achter de hamburger-drawer, geen vaste
          linkerkolom om iets boven te plakken. */}
      {!isMobile && (
        <div ref={viewerRef} style={{
          // bottom: 108 — de Sidebar's eigen 'Volgorde'-toggle + footer
          // (profiel/thema/instellingen) zitten ALTIJD op ~100px van de
          // viewport-onderkant (vast, ongeacht nav-inhoud). Bij bottom: 62
          // stond deze switcher daar bovenop — de avatars overlapten de
          // 'Volgorde'-tekst zodat die onleesbaar werd.
          position: 'fixed', bottom: 108, left: 12, zIndex: 40,
          display: 'flex', flexDirection: 'column', gap: 5, width: 184,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', paddingLeft: 2 }}>
            Bekijk als
          </span>
          <button onClick={() => setViewerOpen(open => !open)} aria-expanded={viewerOpen}
            style={{
              width: '100%', height: 38, padding: '4px 8px 4px 5px', borderRadius: 10,
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              background: 'var(--bg-card)', border: '1px solid var(--border-light)',
              color: 'var(--text-primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}>
            {activeViewer && <UserAvatar memberId={activeViewer.id} size={28} />}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', fontSize: 12.5, fontWeight: 650 }}>
              {activeViewer?.name ?? 'Kies persoon'}
            </span>
            <span aria-hidden style={{ color: 'var(--text-muted)', fontSize: 10 }}>{viewerOpen ? '▼' : '▲'}</span>
          </button>
          {viewerOpen && (
            <div style={{
              position: 'absolute', left: 0, bottom: 46, width: 220, maxHeight: 280, overflowY: 'auto',
              padding: 5, borderRadius: 11, background: 'var(--bg-card)', border: '1px solid var(--border)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            }}>
              {bekijkAlsMembers.map(m => {
                const active = profile?.memberId === m.id
                return (
                  <button key={m.id}
                    onClick={() => {
                      setProfile({ memberId: m.id, name: m.name, color: m.color, photo: active ? profile?.photo ?? null : null })
                      setViewerOpen(false)
                    }}
                    style={{
                      width: '100%', padding: '6px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left',
                      background: active ? 'var(--accent-light)' : 'transparent', color: 'var(--text-primary)',
                    }}>
                    <UserAvatar memberId={m.id} size={27} borderless={!active} />
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: active ? 700 : 500 }}>{m.name}</span>
                    {active && <span style={{ color: 'var(--accent)', fontWeight: 800 }}>✓</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Live-demo label + reset — rechtsboven, uit de weg van de
          (hergebruikte) Sidebar-footer met profiel/thema/instellingen. Op
          mobile linksonder (rechtsonder is al de FeedbackBubble, en
          bovenin zit de pagina-header te dicht op de hamburger/zoek-
          iconen). */}
      {(!isMobile || !drawerOpen) && <div style={{
        position: 'fixed',
        ...(isMobile ? { bottom: 10, left: 10 } : { top: 10, right: 10 }),
        zIndex: 60, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 999,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
          color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border-light)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
          Live demo
        </span>
        <button onClick={doReset} title="Zet alle demo-data terug naar de standaard"
          style={{ padding: '4px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
            background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
          ↺ Reset
        </button>
      </div>}

      {notice && (
        <div style={{
          position: 'fixed', bottom: 50, left: '50%', transform: 'translateX(-50%)', zIndex: 200,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '10px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10,
          maxWidth: '92vw',
        }}>
          <span>Dit is een demo — dat kan niet in deze versie.</span>
          <a href="mailto:menno@studioyoko.nl" style={{ color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}
            onClick={e => e.stopPropagation()} target="_blank" rel="noopener noreferrer">
            Meer info →
          </a>
        </div>
      )}

      <main style={{
        flex: 1, overflow: 'auto', background: 'var(--bg-base)', minWidth: 0,
        width: isMobile ? '100%' : undefined, position: 'relative',
      }}>
        {children}
      </main>
    </>
  )
}
