'use client'

import { useEffect, useState } from 'react'
import { useTeamPhotos } from './TeamPhotosContext'
import teamData from '@/data/team.json'
import { supabase } from '@/lib/supabase'
import { loadItemActivity, onItemActivityChange, type ItemActivity } from '@/lib/itemActivity'

type ProfileRow = { user_id: string; member_id: string | null; name: string | null }

function fmtRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1)    return 'zojuist'
  if (diff < 60)   return `${diff}m geleden`
  if (diff < 1440) return `${Math.floor(diff / 60)}u geleden`
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Lijstje van wat er met dit item is gebeurd — wie zette wat wanneer.
 * Leest uit public.activity met target = 'board_item:${itemId}'.
 */
export function ItemHistory({ itemId }: { itemId: string }) {
  const { getPhoto } = useTeamPhotos()
  const [items, setItems]       = useState<ItemActivity[]>([])
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({})

  // Eenmalig profielen laden voor user_id → naam mapping.
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase.from('profiles').select('user_id, member_id, name').then(({ data }) => {
      if (cancelled || !data) return
      const map: Record<string, ProfileRow> = {}
      for (const r of data as ProfileRow[]) if (r.user_id) map[r.user_id] = r
      setProfiles(map)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const refresh = async () => setItems(await loadItemActivity(itemId))
    refresh()
    return onItemActivityChange(itemId, refresh)
  }, [itemId])

  if (items.length === 0) {
    return <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Nog geen wijzigingen.</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(a => {
        const profile = a.user_id ? profiles[a.user_id] : null
        const name = profile?.name ?? 'Iemand'
        const memberId = profile?.member_id ?? null
        const photo = memberId ? getPhoto(memberId) : null
        const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
        const memberColor = teamData.members.find(m => m.id === memberId)?.color ?? '#888'
        return (
          <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {photo ? (
              <img src={photo} alt={name} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9.5, fontWeight: 700,
                background: memberColor + '22', color: memberColor,
              }}>{initials || '?'}</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{name.split(' ')[0]}</strong>{' '}
                <span>{a.action}</span>
                {a.detail && <span style={{ color: 'var(--text-muted)' }}> · {a.detail}</span>}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 1 }}>{fmtRelative(a.ts)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
