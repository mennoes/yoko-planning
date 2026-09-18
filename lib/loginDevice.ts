import { createHash } from 'node:crypto'

export function hashDevice(userId: string, deviceId: string, secret: string): string {
  return createHash('sha256').update(`${userId}:${deviceId}:${secret}`).digest('hex')
}

export function describeUserAgent(userAgent: string): { browser: string; os: string; label: string } {
  const ua = userAgent || ''
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /CriOS\//.test(ua) ? 'Chrome'
    : /FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Onbekende browser'
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS/iPadOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows NT/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'onbekend apparaat'
  return { browser, os, label: `${browser} op ${os}` }
}

export function safeHeader(value: string | null): string {
  if (!value) return ''
  try { return decodeURIComponent(value).replace(/[\r\n]/g, ' ').slice(0, 180) }
  catch { return value.replace(/[\r\n]/g, ' ').slice(0, 180) }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!)
}
