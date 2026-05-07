'use client'

import { useEffect } from 'react'

// Time-of-day based auto theme. 7:00–19:00 → light, otherwise dark.
function autoTheme(): 'light' | 'dark' {
  const h = new Date().getHours()
  return (h >= 7 && h < 19) ? 'light' : 'dark'
}

// Reads localStorage 'theme' and applies it to <html> on every route
// (including /login). 'auto' (or unset) picks light/dark from time of day.
export default function ThemeApply() {
  useEffect(() => {
    function apply() {
      const t = localStorage.getItem('theme')
      if (t === 'dark' || t === 'light') {
        document.documentElement.setAttribute('data-theme', t)
      } else {
        document.documentElement.setAttribute('data-theme', autoTheme())
      }
    }
    apply()
    // Re-apply if user changes theme in another tab or every 10 minutes (in
    // case the app is left open across the day/night boundary).
    const onStorage = (e: StorageEvent) => { if (e.key === 'theme') apply() }
    window.addEventListener('storage', onStorage)
    const tick = setInterval(apply, 10 * 60 * 1000)
    return () => { window.removeEventListener('storage', onStorage); clearInterval(tick) }
  }, [])
  return null
}
