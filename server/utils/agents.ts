import { createError } from 'h3'

// Agents are plain Parse users; the class CLP is master-only, so this is the
// only way one comes into existence besides scripts/add-agent.mjs.

export async function countAgents(): Promise<number> {
  const Parse = useParse()
  return new Parse.Query(Parse.User).count(MASTER)
}

export async function createAgent(input: { username?: unknown, password?: unknown, email?: unknown, name?: unknown }): Promise<{ id: string }> {
  const username = String(input.username || '').trim().slice(0, 80)
  const password = String(input.password || '')
  const email = String(input.email || '').trim().slice(0, 200)
  const name = String(input.name || '').trim().slice(0, 120)
  if (!username) throw createError({ statusCode: 400, statusMessage: 'Username is required' })
  if (password.length < 8) throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })

  const res = await fetch(`${process.env.PARSE_URL}/users`, {
    method: 'POST',
    headers: { 'X-Parse-Application-Id': process.env.PARSE_ID || '', 'X-Parse-Master-Key': process.env.PARSE_MASTER_KEY || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, ...(email ? { email } : {}), ...(name ? { name } : {}) })
  })
  const body = await res.json().catch(() => ({})) as { objectId?: string, sessionToken?: string, error?: string, code?: number }
  if (!res.ok || !body.objectId) {
    const taken = body.code === 202 || body.code === 203
    throw createError({ statusCode: taken ? 409 : 400, statusMessage: taken ? 'That username or email is already taken' : (body.error || 'Could not create the account') })
  }
  return { id: body.objectId }
}

export async function findAgentByEmail(email: string): Promise<ParseObject | null> {
  const Parse = useParse()
  const row = await new Parse.Query(Parse.User).equalTo('email', email).first(MASTER)
  return row || null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The username Parse signs in with, from what was typed: a username, or an email address. */
export async function usernameForLogin(login: string): Promise<string> {
  const value = String(login || '').trim()
  if (!value.includes('@')) return value
  const Parse = useParse()
  // Emails are stored as typed; Parse keeps them unique case-insensitively.
  const byEmail = await new Parse.Query(Parse.User).matches('email', `^${escapeRegex(value)}$`, 'i').first(MASTER)
  return String(byEmail?.get('username') || value)
}

/** Master-key password change; Parse revokes the agent's other sessions itself. */
export async function setAgentPassword(id: string, password: string): Promise<void> {
  if (password.length < 8) throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
  const res = await fetch(`${process.env.PARSE_URL}/users/${id}`, {
    method: 'PUT',
    headers: { 'X-Parse-Application-Id': process.env.PARSE_ID || '', 'X-Parse-Master-Key': process.env.PARSE_MASTER_KEY || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw createError({ statusCode: 400, statusMessage: body.error || 'Could not update the password' })
  }
}

/** Email the agent a reset link. No-op when they have no email on file. */
export async function sendAgentResetEmail(agent: ParseObject): Promise<void> {
  const email = String(agent.get('email') || '').trim()
  if (!email) return
  const token = mintResetToken(process.env.PARSE_MASTER_KEY || '', agent.id || '')
  const base = (process.env.ADMIN_URL || process.env.APP_URL || 'http://localhost:3100').replace(/\/+$/, '')
  const link = `${base}/login?reset=${encodeURIComponent(token)}`
  const name = String(agent.get('name') || agent.get('username') || '').trim()
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,'
  const html = `<p>${greeting}</p><p>Someone asked to reset your help-bites password. Choose a new one with the link below — it expires in 30 minutes.</p><p><a href="${link}">Reset your password</a></p><p>If this wasn't you, ignore this email; nothing changes.</p>`
  const text = `${name ? `Hi ${name},` : 'Hi,'}\n\nSomeone asked to reset your help-bites password. Choose a new one with the link below (expires in 30 minutes):\n\n${link}\n\nIf this wasn't you, ignore this email; nothing changes.`
  const [result] = await deliverEmails([{
    project: null,
    to: { email, name },
    subject: 'Reset your help-bites password',
    html,
    text,
    sender: projectEmailSender(null, { fromName: 'help-bites' }),
    log: { source: 'system', kind: 'message', templateName: 'Operator password reset', batchId: newEmailBatchId(), actor: SYSTEM_EMAIL_ACTOR }
  }])
  if (result?.status === 'failed') throw new Error(result.error)
}

/** Exchange credentials for a Parse session token; null when they are wrong. */
export async function loginAgent(username: string, password: string): Promise<{ sessionToken: string, agent: { id: string, username: string, email: string, name: string } } | null> {
  const res = await fetch(`${process.env.PARSE_URL}/login`, {
    method: 'POST',
    headers: { 'X-Parse-Application-Id': process.env.PARSE_ID || '', 'X-Parse-Master-Key': process.env.PARSE_MASTER_KEY || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const body = await res.json().catch(() => ({})) as { sessionToken?: string, objectId?: string, username?: string, email?: string, name?: string }
  if (!res.ok || !body.sessionToken || !body.objectId) return null
  return { sessionToken: body.sessionToken, agent: { id: body.objectId, username: body.username || username, email: body.email || '', name: body.name || body.username || username } }
}
