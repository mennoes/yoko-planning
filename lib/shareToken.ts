import { createHmac, timingSafeEqual } from 'node:crypto'

export function signShare(board: string, groups: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Sharing is not configured')
  return createHmac('sha256', secret).update(JSON.stringify(['yoko-share-v1', board, groups])).digest('hex')
}

export function validShare(board: string, groups: string, token: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(token)) return false
  try { return timingSafeEqual(Buffer.from(signShare(board, groups), 'hex'), Buffer.from(token, 'hex')) }
  catch { return false }
}
