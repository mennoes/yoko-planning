'use client'

import { useState, useEffect } from 'react'
import { useTeamPhotos } from './TeamPhotosContext'
import { useProfile } from './ProfileContext'
import { useTeam } from './TeamContext'
import { hasStaticAvatar, pinnedStaticAvatarUrl, staticAvatarUrl } from '@/lib/avatarAssets'

export { hasStaticAvatar }

// Single source of truth for rendering a member avatar.
// Resolves photo in this order:
//   1. profile.photo (when this is the signed-in user)
//   2. TeamPhotosContext.getPhoto(memberId)
//   3. /team/{memberId}.jpg static asset
//   4. Coloured initials chip
export function UserAvatar({
  memberId,
  size = 32,
  onClick,
  style,
  borderless = true,
}: {
  memberId: string
  size?: number
  onClick?: (e: React.MouseEvent) => void
  style?: React.CSSProperties
  borderless?: boolean
}) {
  const { profile }   = useProfile()
  const { getPhoto }  = useTeamPhotos()
  const { allMembers } = useTeam()
  const isMe          = profile?.memberId === memberId
  const member        = allMembers.find(m => m.id === memberId)
  const color         = member?.color ?? '#9DB1A4'
  const name          = member?.name ?? '?'
  const initials      = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  const sharedPhoto = getPhoto(memberId)
  const pinnedPhoto = pinnedStaticAvatarUrl(memberId)
  const staticPhoto = staticAvatarUrl(memberId)
  const photoCandidates = [...new Set([
    pinnedPhoto,
    isMe ? profile?.photo : null,
    sharedPhoto,
    staticPhoto,
  ].filter(Boolean) as string[])]

  const [idx, setIdx] = useState(0)
  // Probeer opnieuw vanaf de hoogste-prioriteitsfoto wanneer de gedeelde
  // profiel-foto live wijzigt. Bij een kapotte/verdwenen remote foto valt
  // onError daarna vanzelf terug op /public/team/{id}.jpg.
  useEffect(() => { setIdx(0) }, [memberId, profile?.photo, sharedPhoto])

  const current = photoCandidates[idx]
  const showInitials = !current || idx >= photoCandidates.length

  const baseStyle: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%',
    flexShrink: 0, objectFit: 'cover',
    cursor: onClick ? 'pointer' : 'default',
    border: borderless ? 'none' : `1.5px solid ${color}`,
    ...style,
  }

  if (showInitials) {
    return (
      <span onClick={onClick}
        style={{
          ...baseStyle,
          background: color + '30',
          color, fontWeight: 700,
          fontSize: size * 0.36,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {initials}
      </span>
    )
  }
  return (
    <img src={current} alt={name}
      onClick={onClick}
      onError={() => setIdx(i => i + 1)}
      style={baseStyle} />
  )
}
