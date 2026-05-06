'use client'
import { useState, useEffect } from 'react'
import { loadSections, saveSections } from './navStore'

export function useBoardTitle(key: string, fallback: string) {
  const href = `/projects/${key}`

  const [title, setTitle] = useState<string>(() => {
    if (typeof window === 'undefined') return fallback
    try {
      const sections = loadSections()
      const item = sections.flatMap(s => s.items).find(i => i.href === href)
      return item?.label ?? fallback
    } catch { return fallback }
  })

  useEffect(() => {
    const sections = loadSections()
    const item = sections.flatMap(s => s.items).find(i => i.href === href)
    if (item) setTitle(item.label)

    function onUpdate() {
      const updated = loadSections()
      const found = updated.flatMap(s => s.items).find(i => i.href === href)
      if (found) setTitle(found.label)
    }
    window.addEventListener('yoko-nav-update', onUpdate)
    return () => window.removeEventListener('yoko-nav-update', onUpdate)
  }, [href])

  function renameTitle(label: string) {
    setTitle(label)
    const sections = loadSections()
    const updated = sections.map(s => ({
      ...s,
      items: s.items.map(i => i.href === href ? { ...i, label } : i),
    }))
    saveSections(updated)
  }

  return { title, renameTitle }
}
