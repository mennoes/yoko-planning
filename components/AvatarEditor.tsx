'use client'

import { useEffect, useRef, useState } from 'react'

const CROP_SIZE = 280
const OUTPUT_SIZE = 360

type Point = { x: number; y: number }
type Size = { width: number; height: number }

function coverScale(size: Size) {
  return Math.max(CROP_SIZE / size.width, CROP_SIZE / size.height)
}

function clampOffset(offset: Point, size: Size, scale: number): Point {
  const maxX = Math.max(0, (size.width * scale - CROP_SIZE) / 2)
  const maxY = Math.max(0, (size.height * scale - CROP_SIZE) / 2)
  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  }
}

async function cropImage(src: string, size: Size, scale: number, offset: Point): Promise<string> {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  await image.decode()

  const displayWidth = size.width * scale
  const displayHeight = size.height * scale
  const left = (CROP_SIZE - displayWidth) / 2 + offset.x
  const top = (CROP_SIZE - displayHeight) / 2 + offset.y
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Foto kon niet worden verwerkt.')
  context.drawImage(
    image,
    -left / scale,
    -top / scale,
    CROP_SIZE / scale,
    CROP_SIZE / scale,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  )
  return canvas.toDataURL('image/jpeg', 0.9)
}

export function AvatarEditor({ initialPhoto, name, color, onCancel, onSave }: {
  initialPhoto: string
  name: string
  color: string
  onCancel: () => void
  onSave: (photo: string) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const [src, setSrc] = useState(initialPhoto)
  const [size, setSize] = useState<Size>({ width: 1, height: 1 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const image = new Image()
    image.onload = () => {
      if (!alive) return
      setSize({ width: image.naturalWidth, height: image.naturalHeight })
      setZoom(1)
      setOffset({ x: 0, y: 0 })
      setError('')
    }
    image.onerror = () => alive && setError('Deze foto kon niet worden geopend. Kies een andere foto.')
    image.src = src
    return () => { alive = false }
  }, [src])

  const scale = coverScale(size) * zoom
  const displayWidth = size.width * scale
  const displayHeight = size.height * scale

  function chooseFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Kies een afbeeldingbestand.')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Deze foto is groter dan 15 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setSrc(String(reader.result ?? ''))
    reader.onerror = () => setError('Deze foto kon niet worden gelezen.')
    reader.readAsDataURL(file)
  }

  function updateZoom(nextZoom: number) {
    const bounded = Math.max(1, Math.min(4, nextZoom))
    const nextScale = coverScale(size) * bounded
    setZoom(bounded)
    setOffset(current => clampOffset(current, size, nextScale))
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const photo = await cropImage(src, size, scale, offset)
      await onSave(photo)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Opslaan is mislukt.')
      setSaving(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Profielfoto van ${name} aanpassen`}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(18, 20, 24, .62)', display: 'grid', placeItems: 'center', padding: 18 }}>
      <div style={{ width: 'min(440px, 100%)', maxHeight: 'calc(100vh - 36px)', overflowY: 'auto', borderRadius: 18, background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: '0 24px 80px rgba(0,0,0,.35)', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Profielfoto aanpassen</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>Sleep de foto en gebruik de zoomregelaar.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Sluiten" style={{ border: 0, background: 'transparent', color: 'var(--text-secondary)', fontSize: 24, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', placeItems: 'center' }}>
          <div
            onPointerDown={event => {
              event.currentTarget.setPointerCapture(event.pointerId)
              dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
            }}
            onPointerMove={event => {
              const drag = dragRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              dragRef.current = { ...drag, x: event.clientX, y: event.clientY }
              setOffset(current => clampOffset({
                x: current.x + event.clientX - drag.x,
                y: current.y + event.clientY - drag.y,
              }, size, scale))
            }}
            onPointerUp={() => { dragRef.current = null }}
            onPointerCancel={() => { dragRef.current = null }}
            style={{ position: 'relative', width: CROP_SIZE, height: CROP_SIZE, maxWidth: '100%', borderRadius: '50%', overflow: 'hidden', touchAction: 'none', cursor: 'grab', background: '#d9dde3', border: `3px solid ${color}`, boxShadow: `0 0 0 5px ${color}25` }}>
            <img src={src} alt="Uitsnedevoorbeeld" draggable={false} style={{ position: 'absolute', width: displayWidth, height: displayHeight, maxWidth: 'none', left: `calc(50% - ${displayWidth / 2}px + ${offset.x}px)`, top: `calc(50% - ${displayHeight / 2}px + ${offset.y}px)`, userSelect: 'none', pointerEvents: 'none' }} />
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={() => updateZoom(zoom - .1)} aria-label="Uitzoomen" style={roundButtonStyle}>−</button>
            <input aria-label="Zoom" type="range" min="100" max="400" step="1" value={Math.round(zoom * 100)} onChange={event => updateZoom(Number(event.target.value) / 100)} style={{ flex: 1, accentColor: color }} />
            <button type="button" onClick={() => updateZoom(zoom + .1)} aria-label="Inzoomen" style={roundButtonStyle}>+</button>
            <span style={{ width: 42, textAlign: 'right', color: 'var(--text-muted)', fontSize: 11 }}>{Math.round(zoom * 100)}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 14 }}>
            <button type="button" onClick={() => inputRef.current?.click()} style={secondaryButtonStyle}>Andere foto</button>
            <button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }} style={secondaryButtonStyle}>Centreren</button>
          </div>
          {error && <p role="alert" style={{ margin: '12px 0 0', color: 'var(--red, #e2445c)', fontSize: 12 }}>{error}</p>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>Annuleren</button>
          <button type="button" onClick={() => void save()} disabled={saving || !!error} style={{ border: 0, borderRadius: 9, padding: '10px 18px', background: color, color: '#fff', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving || error ? .6 : 1 }}>{saving ? 'Opslaan…' : 'Foto opslaan'}</button>
        </div>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) chooseFile(file); event.currentTarget.value = '' }} />
      </div>
    </div>
  )
}

const roundButtonStyle: React.CSSProperties = { width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 20, lineHeight: 1, cursor: 'pointer' }
const secondaryButtonStyle: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 9, padding: '9px 13px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer' }

