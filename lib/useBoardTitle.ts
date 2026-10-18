'use client'
import { useState, useEffect } from 'react'
import { loadSections, saveSections } from './navStore'
import { pullBoardsFromRemote, renameBoard } from './boardsRegistry'

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

  async function renameTitle(label: string) {
    const clean = label.trim()
    if (!clean || clean === title) return
    const previous = title
    setTitle(clean)
    const sections = loadSections()
    const updated = sections.map(s => ({
      ...s,
      items: s.items.map(i => i.href === href ? { ...i, label: clean } : i),
    }))
    saveSections(updated)

    // Een titelwijziging in de agenda-header moet via exact dezelfde
    // bevestigde database-route lopen als hernoemen in de sidebar. Voorheen
    // wijzigde dit pad alleen localStorage en zette een refresh de oude naam
    // terug. Bij een fout rollen we de optimistische UI-wijziging terug.
    // renameBoard geeft null bij succes, anders de reden.
    const reason = await renameBoard(key, clean)
    if (!reason) {
      await pullBoardsFromRemote()
      return
    }
    setTitle(previous)
    saveSections(sections)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('yoko-push-failed', {
        detail: { boardName: key, message: `Naam '${clean}' is niet opgeslagen. ${reason}` },
      }))
    }
  }

  return { title, renameTitle }
}
