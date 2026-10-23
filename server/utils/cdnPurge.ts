// Bunny.net's purge API: one call per URL, a trailing `*` matches everything under it (query strings too).
// Off unless BUNNY_NET_API_KEY (the account API key) is set; a failure never blocks what asked for it.
export type CdnPurge = { purged: number, error: string }

export async function purgeCdn(urls: string[]): Promise<CdnPurge | null> {
  const key = (process.env.BUNNY_NET_API_KEY || '').trim()
  if (!key) return null
  const out: CdnPurge = { purged: 0, error: '' }
  for (const url of [...new Set(urls)]) {
    try {
      const res = await fetch(`https://api.bunny.net/purge?url=${encodeURIComponent(url)}&async=false`, { method: 'POST', headers: { AccessKey: key }, signal: AbortSignal.timeout(10_000) })
      if (res.ok) out.purged++
      else out.error ||= `Bunny.net answered ${res.status}`
    } catch (e: any) {
      out.error ||= e?.message || 'Bunny.net could not be reached'
    }
  }
  return out
}
