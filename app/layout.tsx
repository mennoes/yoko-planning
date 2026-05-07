import type { Metadata, Viewport } from 'next'
import './globals.css'
import AppShell from '@/components/AppShell'

export const metadata: Metadata = {
  title: 'Yoko Planner',
  description: 'Studio Yoko planning tool',
  icons: { icon: '/favicon.svg' },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Yoko',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#B0C6EB',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" style={{ height: '100%' }}>
      <body style={{ height: '100%', display: 'flex', margin: 0 }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
