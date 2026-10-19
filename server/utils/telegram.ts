import { createError } from 'h3'
import { MASTER, type ParseObject } from './parse'
import { openSealedSecret, sealSecret } from './secrets'

// Telegram, send only. A bot token from @BotFather is sealed on the project (`telegram`) with the chat it posts to.
// Error alerts (server/utils/errorAlerts.ts) are sent there as well as mailed. HelpBites never reads messages,
// except once when connecting without a chat id, to find the chat that just wrote to the bot.

export type TelegramConnection = { connected: boolean, botName: string, chatName: string }
type Stored = { tokenSealed: string, chatId: string, botName: string, chatName: string }

async function call(token: string, method: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw createError({ statusCode: 502, statusMessage: `Telegram answered ${res.status}: ${String(json.description || res.statusText).slice(0, 200)}` })
  return json.result
}

const stored = (project: ParseObject) => (project.get('telegram') || null) as Stored | null

export function serializeTelegram(project: ParseObject): TelegramConnection {
  const row = stored(project)
  return { connected: Boolean(row), botName: row?.botName || '', chatName: row?.chatName || '' }
}

/** Checks the token, finds the chat (the given id, or whoever wrote to the bot last), sends a hello, then stores both. */
export async function connectTelegram(project: ParseObject, token: unknown, chat: unknown): Promise<TelegramConnection> {
  const key = typeof token === 'string' ? token.trim() : ''
  if (!/^\d{5,}:[\w-]{30,}$/.test(key)) throw createError({ statusCode: 400, statusMessage: 'Paste the bot token @BotFather gave you (123456:ABC…)' })
  const sealed = sealSecret(key)
  const bot = await call(key, 'getMe')
  let chatId = typeof chat === 'string' ? chat.trim() : ''
  if (chatId && !/^(-?\d+|@\w+)$/.test(chatId)) throw createError({ statusCode: 400, statusMessage: 'The chat id is a number (or @channelname)' })
  if (!chatId) {
    const updates = (await call(key, 'getUpdates', { limit: 20, allowed_updates: ['message', 'channel_post', 'my_chat_member'] })) as any[]
    const found = updates.map(u => (u.message || u.channel_post || u.my_chat_member)?.chat).filter(Boolean).at(-1)
    if (!found) throw createError({ statusCode: 400, statusMessage: `Send any message to @${bot.username} (or add it to your group) first, then connect again` })
    chatId = String(found.id)
  }
  const info = await call(key, 'getChat', { chat_id: chatId })
  const chatName = String(info.title || [info.first_name, info.last_name].filter(Boolean).join(' ') || info.username || chatId)
  await call(key, 'sendMessage', { chat_id: chatId, text: `HelpBites is connected to ${String(project.get('name') || 'your project')}. Error alerts will arrive here.` })
  project.set('telegram', { tokenSealed: sealed, chatId, botName: String(bot.username || bot.first_name || ''), chatName } satisfies Stored)
  await project.save(null, MASTER)
  return serializeTelegram(project)
}

export async function disconnectTelegram(project: ParseObject): Promise<void> {
  project.unset('telegram')
  await project.save(null, MASTER)
}

/** Posts to the project's chat; does nothing when Telegram is not connected. Plain text, split under Telegram's 4096 limit. */
export async function sendTelegram(project: ParseObject, text: string): Promise<void> {
  const row = stored(project)
  if (!row) return
  await call(openSealedSecret(row.tokenSealed), 'sendMessage', { chat_id: row.chatId, text: text.slice(0, 4000), disable_web_page_preview: true })
}
