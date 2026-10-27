import { createError } from 'h3'

// A saved secret goes only to the server it was saved for. The Parse master key is sent to `serverUrl` (with the app id) on every
// test and sync, so whoever may edit a source could point it at a server of their own and read the key off the request; the
// workspace AI settings and the error trackers already refuse to carry a key to a changed address.

type Where = { serverUrl?: string, appId?: string }

const SECRET_DESTINATION_KEYS = ['serverUrl', 'appId'] as const

/** 400 when the address a saved secret would be sent to has changed and no new secret came with it. */
export function assertSecretStaysHome(before: Where | null | undefined, after: Where, newSecretGiven: boolean): void {
  if (!before || newSecretGiven) return
  if (SECRET_DESTINATION_KEYS.some(key => String(after[key] || '') !== String(before[key] || ''))) {
    throw createError({ statusCode: 400, statusMessage: 'Enter the secret again: a saved secret only goes to the server it was saved for' })
  }
}
