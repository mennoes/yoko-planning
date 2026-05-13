'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useProfile } from './ProfileContext'
import { useTeamPhotos } from './TeamPhotosContext'
import { IconBell } from './Icon'
import teamData from '@/data/team.json'
import {
  loadNotifications, markAllRead, markRead, onNotificationsChange,
  subscribeRemoteNotifications, type Notification,
} from '@/lib/notificationsStore'

function fmtRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1)    return 'zojuist'
  if (diff < 60)   return `${diff}m`
  if (diff < 1440) return `${Math.floor(diff / 60)}u`
  return `${Math.floor(diff / 1440)}d`
}

function actorName(actorId: string | null): string {
  if (!actorId) return 'Iemand'
  return teamData.members.find(m => m.id === actorId)?.name ?? actorId
}

function actionLabel(n: Notification): string {
  switch (n.kind) {
    case 'mention':  return 'noemde je in'
    case 'assigned': return 'wees je toe aan'
    case 'comment':  return 'reageerde op'
  }
}

export function NotificationBell() {
  const { profile }  = useProfile()
  const { getPhoto } = useTeamPhotos()
  const memberId     = profile?.memberId
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null)

  function computePos() {
    if (!btnRef.current) return null
    const r = btnRef.current.getBoundingClientRect()
    // Pop-out onder de bell, links uitgelijnd met de knop. Clamp tegen
    // de rechter scherm-rand zodat de popup nooit buiten beeld valt.
    const popW = 360
    const left = Math.min(r.left, window.innerWidth - popW - 8)
    return {
      top:  Math.min(r.bottom + 6, window.innerHeight - 24),
      left: Math.max(8, left),
    }
  }

  function toggleOpen() {
    if (!open) {
      const p = computePos()
      if (p) setPopPos(p)
    }
    setOpen(o => !o)
  }

  // herbereken positie tijdens scrollen/resizen zolang open
  useEffect(() => {
    if (!open) return
    const recompute = () => {
      const p = computePos()
      if (p) setPopPos(p)
    }
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)
    return () => {
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
    }
  }, [open])

  useEffect(() => {
    if (!memberId) return
    async function refresh() {
      if (!memberId) return
      setItems(await loadNotifications(memberId))
    }
    refresh()
    const offEvent  = onNotificationsChange(refresh)
    const offRemote = subscribeRemoteNotifications(memberId)
    return () => { offEvent(); offRemote() }
  }, [memberId])

  // sluit op klik buiten — popup leeft via portal, dus check zowel de
  // bell-wrapper als het popup-element
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (wrapRef.current?.contains(t)) return
      if (t?.closest?.('[data-bell-popover]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [open])

  if (!memberId) return null
  const unread = items.filter(i => !i.read).length

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button ref={btnRef} onClick={toggleOpen} aria-label="Meldingen"
        title={unread > 0 ? `${unread} ongelezen meldingen` : 'Geen nieuwe meldingen'}
        style={{
          background: unread > 0 ? 'var(--accent-light)' : 'var(--bg-card)',
          border: `1px solid ${unread > 0 ? 'var(--accent)' : 'var(--border-light)'}`,
          cursor: 'pointer',
          width: 44, height: 44, borderRadius: 11, position: 'relative',
          color: unread > 0 ? 'var(--accent)' : 'var(--text-secondary)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = unread > 0 ? 'var(--accent-light)' : 'var(--bg-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = unread > 0 ? 'var(--accent-light)' : 'var(--bg-card)')}>
        <IconBell size={22} strokeWidth={1.8} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
            background: '#e2445c', color: '#fff', fontSize: 10, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, border: '2px solid var(--bg-base)',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && popPos && typeof document !== 'undefined' && createPortal(
        <div data-bell-popover style={{
          position: 'fixed', top: popPos.top, left: popPos.left, zIndex: 9050,
          width: 'min(360px, calc(100vw - 16px))', maxHeight: '70vh', overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 4,
          boxShadow: '0 16px 40px rgba(0,0,0,0.30), 0 2px 6px rgba(0,0,0,0.10)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 10px 6px',
          }}>
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Meldingen</strong>
            {unread > 0 && (
              <button onClick={() => memberId && markAllRead(memberId)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11.5, color: 'var(--text-muted)', padding: 0 }}>
                Markeer alles gelezen
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p style={{ padding: '14px 12px', fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
              Geen meldingen — even kalm.
            </p>
          ) : items.map(n => {
            const photo = n.actor_id ? getPhoto(n.actor_id) : null
            const Inner = (
              <div style={{ display: 'flex', gap: 9, padding: '8px 10px',
                background: n.read ? 'transparent' : 'var(--accent-light)',
                borderRadius: 7, alignItems: 'flex-start' }}>
                {photo ? (
                  <img src={photo} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-hover)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {actorName(n.actor_id).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    <strong>{actorName(n.actor_id)}</strong>{' '}
                    <span style={{ color: 'var(--text-secondary)' }}>{actionLabel(n)}</span>{' '}
                    {n.body && <em style={{ color: 'var(--text-muted)', fontStyle: 'normal' }}>"{n.body}"</em>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {fmtRelative(n.created_at)}
                  </div>
                </div>
                {!n.read && (
                  <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', marginTop: 6, flexShrink: 0 }} />
                )}
              </div>
            )
            return n.href ? (
              <Link key={n.id} href={n.href}
                onClick={() => { setOpen(false); markRead(n.id) }}
                style={{ display: 'block', textDecoration: 'none' }}>
                {Inner}
              </Link>
            ) : (
              <button key={n.id}
                onClick={() => markRead(n.id)}
                style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                {Inner}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}
