'use client'

// Lichte navigatie-schil voor de publieke /demo-omgeving. Bewust GEEN
// hergebruik van de echte <Sidebar> — die sleept SearchPalette,
// NotificationBell, FeedbackBubble, TimerIndicator en comments mee, die
// allemaal aan een echt (ingelogd) account hangen en voor een anonieme
// demo-bezoeker geen betekenis hebben (of zouden falen). Wél dezelfde
// look: donkere zijbalk, dezelfde 3 hoofd-routes als de echte Sidebar.
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useProfile } from './ProfileContext'
import { DEMO_MEMBERS } from '@/lib/demoFixtures'
import { resetDemoBoards } from '@/lib/demoBoardStore'

const NAV = [
  { href: '/demo',          label: 'Home' },
  { href: '/demo/planning', label: 'Werklast' },
  { href: '/demo/todos',    label: "To do's" },
]

export default function DemoShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { profile, setProfile } = useProfile()

  function doReset() {
    resetDemoBoards()
    router.refresh()
    window.location.reload()
  }

  return (
    <>
      <aside style={{
        width: 220, flexShrink: 0, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-light)',
        display: 'flex', flexDirection: 'column', padding: '18px 14px', gap: 18,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Yoko Planner</div>
          <div style={{
            marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
            Live demo
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(n => {
            const active = pathname === n.href
            return (
              <Link key={n.href} href={n.href} style={{
                padding: '8px 10px', borderRadius: 8, fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: active ? 'var(--bg-hover)' : 'transparent',
              }}>{n.label}</Link>
            )
          })}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Jij bent
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {DEMO_MEMBERS.map(m => {
                const active = profile?.memberId === m.id
                return (
                  <button key={m.id}
                    onClick={() => setProfile({ memberId: m.id, name: m.name, color: m.color, photo: null })}
                    title={`Bekijk demo als ${m.name}`}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', padding: 0,
                      background: m.color + (active ? '55' : '25'), border: `1.5px solid ${active ? m.color : m.color + '70'}`,
                      color: m.color, fontSize: 11, fontWeight: 700,
                    }}>{m.name.charAt(0)}</button>
                )
              })}
            </div>
          </div>
          <button onClick={doReset}
            style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)' }}>
            ↺ Reset demo
          </button>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>
            Verzonnen data · alleen lokaal in jouw browser bewaard
          </p>
        </div>
      </aside>
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg-base)', minWidth: 0 }}>{children}</main>
    </>
  )
}
