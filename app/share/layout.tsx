import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Yoko Share',
  description: 'Read-only project view',
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      {children}
    </div>
  )
}
