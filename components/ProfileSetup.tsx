'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import teamData from '@/data/team.json'
import { useProfile } from './ProfileContext'
import type { UserProfile } from '@/lib/profile'

const MEMBERS = teamData.members
const PREVIEW = 200   // crop-circle diameter px
const OUTPUT  = 240   // saved avatar px

// ─── Canvas export ────────────────────────────────────────────────────────────
async function exportCrop(
  src:    string,
  scale:  number,
  offset: { x: number; y: number },
): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = OUTPUT
      canvas.height = OUTPUT
      const ctx = canvas.getContext('2d')!
      ctx.beginPath()
      ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2)
      ctx.clip()

      // bgX/bgY: top-left of the scaled image inside the PREVIEW container
      const imgDisplayW = img.naturalWidth  * scale
      const imgDisplayH = img.naturalHeight * scale
      const bgX = (PREVIEW - imgDisplayW) / 2 + offset.x
      const bgY = (PREVIEW - imgDisplayH) / 2 + offset.y

      // Corresponding source region in the original image
      const srcX = -bgX / scale
      const srcY = -bgY / scale
      const srcW = PREVIEW / scale
      const srcH = PREVIEW / scale

      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUTPUT, OUTPUT)
      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.src = src
  })
}

// ─── Photo cropper ────────────────────────────────────────────────────────────
function PhotoCropper({
  src, color, onSave, onClear,
}: {
  src:     string
  color:   string
  onSave:  (dataUrl: string) => void
  onClear: () => void
}) {
  const [scale,   setScale]   = useState(1)
  const [offset,  setOffset]  = useState({ x: 0, y: 0 })
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 })
  const [saving,  setSaving]  = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef      = useRef<{ x: number; y: number } | null>(null)

  // Load image to get natural size + compute initial fill-scale
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const fillScale = Math.max(PREVIEW / img.naturalWidth, PREVIEW / img.naturalHeight)
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
      setScale(fillScale)
      setOffset({ x: 0, y: 0 })
    }
    img.src = src
  }, [src])

  // Clamp offset so image always covers the circle
  function clampedOffset(newOffset: { x: number; y: number }, sc: number) {
    const dw  = imgSize.w * sc
    const dh  = imgSize.h * sc
    const maxX = (dw  - PREVIEW) / 2
    const maxY = (dh - PREVIEW) / 2
    return {
      x: Math.max(-maxX, Math.min(maxX, newOffset.x)),
      y: Math.max(-maxY, Math.min(maxY, newOffset.y)),
    }
  }

  // Wheel zoom (non-passive)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setScale(s => {
        const minScale = Math.max(PREVIEW / imgSize.w, PREVIEW / imgSize.h)
        const next = Math.max(minScale, Math.min(6, s - e.deltaY * 0.002))
        setOffset(o => clampedOffset(o, next))
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [imgSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    dragRef.current = { x: e.clientX, y: e.clientY }
    setOffset(o => clampedOffset({ x: o.x + dx, y: o.y + dy }, scale))
  }, [scale, imgSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const onMouseUp = useCallback(() => { dragRef.current = null }, [])

  const minScale = Math.max(PREVIEW / imgSize.w, PREVIEW / imgSize.h)
  const imgDisplayW = imgSize.w * scale
  const imgDisplayH = imgSize.h * scale
  const bgX = (PREVIEW - imgDisplayW) / 2 + offset.x
  const bgY = (PREVIEW - imgDisplayH) / 2 + offset.y

  async function handleSave() {
    setSaving(true)
    const dataUrl = await exportCrop(src, scale, offset)
    onSave(dataUrl)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      {/* Circular preview */}
      <div style={{ position: 'relative' }}>
        <div
          ref={containerRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{
            width: PREVIEW, height: PREVIEW, borderRadius: '50%',
            overflow: 'hidden', cursor: dragRef.current ? 'grabbing' : 'grab',
            border: `3px solid ${color}`,
            backgroundImage: `url(${src})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${imgDisplayW}px ${imgDisplayH}px`,
            backgroundPosition: `${bgX}px ${bgY}px`,
            userSelect: 'none',
          }}
        />
        {/* Ring glow */}
        <div style={{
          position: 'absolute', inset: -3, borderRadius: '50%',
          boxShadow: `0 0 0 3px ${color}44`,
          pointerEvents: 'none',
        }} />
      </div>

      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        Sleep om te positioneren · scroll om in te zoomen
      </p>

      {/* Zoom slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔍</span>
        <input
          type="range"
          min={Math.round(minScale * 100)}
          max={600}
          value={Math.round(scale * 100)}
          onChange={e => {
            const next = parseInt(e.target.value) / 100
            setScale(next)
            setOffset(o => clampedOffset(o, next))
          }}
          style={{ flex: 1, accentColor: color }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔍+</span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, width: '100%' }}>
        <button onClick={onClear} style={{
          flex: 1, padding: '7px 0', borderRadius: 6, border: '1px solid var(--border)',
          background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12,
        }}>
          Andere foto
        </button>
        <button onClick={handleSave} disabled={saving} style={{
          flex: 2, padding: '7px 0', borderRadius: 6, border: 'none',
          background: color, color: '#fff', cursor: 'pointer',
          fontSize: 13, fontWeight: 600,
          opacity: saving ? 0.7 : 1,
        }}>
          {saving ? 'Verwerken…' : 'Foto opslaan ✓'}
        </button>
      </div>
    </div>
  )
}

// ─── Avatar preview (initials) ────────────────────────────────────────────────
function InitialsAvatar({ name, color, size = 80 }: { name: string; color: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color + '25', border: `3px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.28, fontWeight: 700, color,
      flexShrink: 0,
    }}>{initials}</div>
  )
}

// ─── Main setup modal ─────────────────────────────────────────────────────────
export default function ProfileSetup() {
  const { profile, setProfile, needsSetup, editOpen, closeEdit } = useProfile()
  const isVisible = needsSetup || editOpen

  const [selected, setSelected] = useState<typeof MEMBERS[0] | null>(
    profile ? (MEMBERS.find(m => m.id === profile.memberId) ?? null) : null
  )
  const [photoSrc,   setPhotoSrc]   = useState<string | null>(null)   // raw uploaded file
  const [savedPhoto, setSavedPhoto] = useState<string | null>(profile?.photo ?? null)
  const [cropMode,   setCropMode]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reset state when reopened in edit mode
  useEffect(() => {
    if (editOpen && profile) {
      setSelected(MEMBERS.find(m => m.id === profile.memberId) ?? null)
      setSavedPhoto(profile.photo)
      setPhotoSrc(null)
      setCropMode(false)
    }
  }, [editOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      setPhotoSrc(e.target?.result as string)
      setSavedPhoto(null)
      setCropMode(true)
    }
    reader.readAsDataURL(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/')) handleFile(file)
  }

  function handleSave() {
    if (!selected) return
    const p: UserProfile = {
      memberId: selected.id,
      name:     selected.name,
      color:    selected.color,
      photo:    savedPhoto,
    }
    setProfile(p)
  }

  if (!isVisible) return null

  const color = selected?.color ?? '#579bfc'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(4px)',
    }}
      onClick={e => { if (editOpen && e.target === e.currentTarget) closeEdit() }}
    >
      <div style={{
        background: 'var(--bg-card)', borderRadius: 16,
        border: '1px solid var(--border)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        width: 520, maxWidth: '94vw', maxHeight: '92vh',
        overflowY: 'auto', padding: '32px 32px 28px',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            {editOpen ? '✏️ Profiel bewerken' : '👋 Welkom bij Yoko Planner'}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            {editOpen ? 'Pas je naam, kleur of foto aan.' : 'Stel even in wie jij bent op dit apparaat.'}
          </p>
        </div>

        {/* Member picker */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            Wie ben jij?
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {MEMBERS.map(m => {
              const active = selected?.id === m.id
              return (
                <button key={m.id} onClick={() => setSelected(m)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', borderRadius: 10,
                  border: `2px solid ${active ? m.color : 'var(--border)'}`,
                  background: active ? m.color + '18' : 'var(--bg-hover)',
                  cursor: 'pointer', transition: 'all 0.12s',
                }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: m.color + '30', border: `2px solid ${m.color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: m.color,
                  }}>
                    {m.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <span style={{
                    fontSize: 13, fontWeight: active ? 700 : 400,
                    color: active ? m.color : 'var(--text-secondary)',
                  }}>
                    {m.name}
                  </span>
                  {active && <span style={{ color: m.color, fontSize: 12 }}>✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid var(--border)', marginBottom: 24 }} />

        {/* Photo section */}
        <div style={{ marginBottom: 28 }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            Profielfoto <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optioneel)</span>
          </p>

          {cropMode && photoSrc ? (
            <PhotoCropper
              src={photoSrc}
              color={color}
              onSave={url => { setSavedPhoto(url); setCropMode(false) }}
              onClear={() => { setPhotoSrc(null); setCropMode(false) }}
            />
          ) : savedPhoto ? (
            /* Show saved photo with option to change */
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <img src={savedPhoto} alt="avatar" style={{
                width: 72, height: 72, borderRadius: '50%',
                border: `3px solid ${color}`,
                objectFit: 'cover',
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Foto opgeslagen ✓</span>
                <button onClick={() => { setPhotoSrc(null); setSavedPhoto(null); setCropMode(false) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', textAlign: 'left', padding: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                  × Verwijder foto
                </button>
              </div>
            </div>
          ) : (
            /* Upload drop zone */
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${selected ? color + '66' : 'var(--border)'}`,
                borderRadius: 10, padding: '24px 16px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                cursor: 'pointer', transition: 'border-color 0.15s',
                background: selected ? color + '08' : 'transparent',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = color)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = selected ? color + '66' : 'var(--border)')}
            >
              <div style={{ fontSize: 28 }}>📷</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
                Sleep een foto hierheen<br />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>of klik om te uploaden</span>
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />
            </div>
          )}
        </div>

        {/* Preview + CTA */}
        {!cropMode && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            {/* Avatar preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {savedPhoto ? (
                <img src={savedPhoto} alt="" style={{
                  width: 42, height: 42, borderRadius: '50%',
                  border: `2px solid ${color}`, objectFit: 'cover',
                }} />
              ) : (
                <InitialsAvatar name={selected?.name ?? '?'} color={color} size={42} />
              )}
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {selected ? selected.name : <span style={{ color: 'var(--text-muted)' }}>Kies een naam ↑</span>}
              </span>
            </div>

            <button
              onClick={handleSave}
              disabled={!selected}
              style={{
                padding: '10px 24px', borderRadius: 8, border: 'none',
                background: selected ? color : 'var(--overlay-medium)',
                color: selected ? '#fff' : 'var(--text-muted)',
                cursor: selected ? 'pointer' : 'default',
                fontSize: 14, fontWeight: 700, transition: 'all 0.12s',
              }}
            >
              {editOpen ? 'Opslaan' : 'Aan de slag →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
