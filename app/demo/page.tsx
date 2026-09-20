'use client'

import dynamic from 'next/dynamic'

// De volledige demo-home bevat veel interactieve widgets en fixtures.
// Laad die pas na de eerste browser-render. Vooral mobiele in-appbrowsers
// kunnen anders tijdens hydration de hele tab beëindigen.
const DemoHomePage = dynamic(() => import('@/components/DemoHomePage'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 14 }}>
      Demo laden…
    </div>
  ),
})

export default function DemoPage() {
  return <DemoHomePage />
}
