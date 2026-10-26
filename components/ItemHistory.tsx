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
export function ItemHistory({ itemId, createdAt }: { itemId: string; createdAt?: string }) {
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

  // Wie een item maakte is pas sinds kort bekend; wannéér staat al sinds
  // het begin in board_items.created_at. Voor alles van vóór die
  // wijziging is die datum het enige houvast, dus die tonen we onderaan —
  // de oudste regel, waar hij chronologisch hoort.
  const aangemaakt = createdAt ? (
    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
      Aangemaakt op {new Date(createdAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}
      {items.length === 0 && ' · wie dat deed is van vóór we dat bijhielden'}
    </div>
  ) : null

  if (items.length === 0) {
    return aangemaakt ?? <span style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>Nog geen wijzigingen.</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
              <img src={photo} alt={name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <span style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
                background: memberColor + '22', color: memberColor,
              }}>{initials || '?'}</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{name.split(' ')[0]}</strong>{' '}
                <span>{a.action}</span>
                {a.detail && <span style={{ color: 'var(--text-muted)' }}> · {a.detail}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{fmtRelative(a.ts)}</div>
            </div>
          </div>
        )
      })}
      {aangemaakt}
    </div>
  )
}
