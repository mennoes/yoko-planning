'use client'

import { useEffect } from 'react'

// Reads localStorage 'theme' and applies it to <html> on every route
// (including /login). 'auto' (or unset) defers to prefers-color-scheme.
export default function ThemeApply() {
  useEffect(() => {
    const t = localStorage.getItem('theme')
    if (t === 'dark' || t === 'light') {
      document.documentElement.setAttribute('data-theme', t)
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [])
  return null
}
