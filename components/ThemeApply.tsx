'use client'

import { useEffect } from 'react'
import { applyThemePreference, getThemePreference, nextSolarTransition } from '@/lib/theme'

// Reads localStorage 'theme' and applies it to <html> on every route
// (including /login). 'auto' (or unset) picks light/dark from time of day.
export default function ThemeApply() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function applyAndSchedule() {
      const preference = getThemePreference()
      applyThemePreference(preference)
      if (timer) clearTimeout(timer)
      if (preference === 'auto') {
        const delay = Math.max(1000, nextSolarTransition().getTime() - Date.now() + 1000)
        timer = setTimeout(applyAndSchedule, delay)
      }
    }
    applyAndSchedule()
    const onStorage = (e: StorageEvent) => { if (e.key === 'theme') applyAndSchedule() }
    const onThemeChange = () => applyAndSchedule()
    const onVisible = () => { if (document.visibilityState === 'visible') applyAndSchedule() }
    window.addEventListener('storage', onStorage)
    window.addEventListener('yoko-theme-change', onThemeChange)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('yoko-theme-change', onThemeChange)
      document.removeEventListener('visibilitychange', onVisible)
      if (timer) clearTimeout(timer)
    }
  }, [])
  return null
}
