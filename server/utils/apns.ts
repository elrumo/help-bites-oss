import { createPrivateKey, sign } from 'node:crypto'

type Device = { token: string, env: string }
type Push = { title: string, body: string, badge: number, conversationId: string }

let cachedJWT = ''
let jwtExpiresAt = 0

export function isAPNsConfigured(): boolean {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID && process.env.APNS_KEY)
}

/** APNs requires HTTP/2; verify Bun's fetch against development credentials before enabling production. */
export async function sendAPNs(device: Device, push: Push): Promise<'sent' | 'unregistered' | 'failed'> {
  if (!isAPNsConfigured()) return 'failed'
  try {
    const env = process.env.APNS_ENV || device.env
    const host = env === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com'
    const response = await fetch(`${host}/3/device/${device.token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${apnsJWT()}`,
        'apns-topic': process.env.APNS_BUNDLE_ID!,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ aps: { alert: { title: push.title, body: push.body }, sound: 'default', badge: push.badge }, conversationId: push.conversationId })
    })
    if (response.status === 410) return 'unregistered'
    if (!response.ok) console.warn(`[apns] ${response.status}: ${(await response.text()).slice(0, 200)}`)
    return response.ok ? 'sent' : 'failed'
  } catch (error) {
    console.warn('[apns] send failed:', (error as Error).message)
    return 'failed'
  }
}

function apnsJWT(): string {
  if (cachedJWT && Date.now() < jwtExpiresAt) return cachedJWT
  const header = base64url({ alg: 'ES256', kid: process.env.APNS_KEY_ID })
  const payload = base64url({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })
  const input = `${header}.${payload}`
  const key = createPrivateKey(process.env.APNS_KEY!.replace(/\\n/g, '\n'))
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  cachedJWT = `${input}.${signature}`
  jwtExpiresAt = Date.now() + 50 * 60 * 1000
  return cachedJWT
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
