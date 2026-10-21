import { createError, getHeader, getRequestIP, type H3Event } from 'h3'

/**
 * The caller's address, for per-IP limits and consent records. Each proxy
 * appends the address it saw to X-Forwarded-For, but a client may send the
 * header pre-filled, so the left-most entry (what h3's getRequestIP reads) is
 * whatever the client chose. Count from the right instead: TRUST_PROXY_HOPS
 * is how many proxies stand in front of the app (default 1, Dokploy's
 * Traefik; 2 for e.g. Cloudflare → Traefik). Bun's preset passes no socket
 * address, so the header is all there is behind a proxy.
 */
export function clientIp(event: H3Event): string {
  const hops = Math.max(1, Number.parseInt(process.env.TRUST_PROXY_HOPS || '', 10) || 1)
  const chain = String(getHeader(event, 'x-forwarded-for') || '').split(',').map(part => part.trim()).filter(Boolean)
  return chain[chain.length - hops] || chain[0] || getRequestIP(event) || ''
}

// Fixed window in Redis: INCR the key, set its expiry on first hit. Two
// commands, no Lua. When Redis is down the request is allowed — the limiter
// protects against abuse, not against outages.

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  let count = 0
  try {
    const redis = useRedis()
    const [incr] = await redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec() || []
    count = Number(incr?.[1] || 0)
  } catch (error) {
    console.warn('[rateLimit] redis unavailable, allowing request:', (error as Error).message)
    return
  }
  if (count > limit) {
    throw createError({ statusCode: 429, statusMessage: 'Too many requests', data: { retryAfter: windowSeconds } })
  }
}

export const LIMITS = {
  messagesPerUser: { limit: 30, window: 60 },
  uploadsPerUser: { limit: 10, window: 60 },
  requestsPerProject: { limit: 600, window: 60 },
  badTokensPerIp: { limit: 20, window: 60 },
  adminLoginPerIp: { limit: 10, window: 300 },
  // Caps guesses spread across many addresses; looser than per-IP, since it
  // also holds back the account's owner while someone is guessing.
  adminLoginPerUser: { limit: 20, window: 900 },
  feedbackPostsPerUser: { limit: 10, window: 600 },
  feedbackCommentsPerUser: { limit: 30, window: 60 },
  feedbackVotesPerUser: { limit: 60, window: 60 },
  feedbackReactionsPerUser: { limit: 60, window: 60 },
  feedbackReadsPerIp: { limit: 300, window: 60 },
  flagReadsPerIp: { limit: 300, window: 60 },
  // A host's server renders its changelog pages from one IP, so this is well above the feedback read limit.
  changelogReadsPerIp: { limit: 1200, window: 60 },
  // Five comments in ten minutes is far more than a discussion needs and far less than a flood.
  changelogCommentsPerUser: { limit: 5, window: 600 },
  // The blog: a host's server renders its pages from one IP, as for the changelog.
  blogReadsPerIp: { limit: 1200, window: 60 },
  blogCommentsPerUser: { limit: 5, window: 600 },
  blogReactionsPerUser: { limit: 60, window: 60 },
  // AI changelog runs cost credits: by hand, and from GitHub pushes.
  changelogGeneratePerProject: { limit: 10, window: 3600 },
  changelogPushPerProject: { limit: 20, window: 3600 },
  emailSharePerIp: { limit: 300, window: 60 },
  emailSendsPerProject: { limit: 120, window: 60 },
  emailRendersPerProject: { limit: 300, window: 60 },
  emailTestsPerAgent: { limit: 20, window: 60 },
  emailAiPerAgent: { limit: 20, window: 60 },
  emailImagesPerAgent: { limit: 30, window: 60 },
  // Unsubscribe and preference links, sign-up forms: per IP and per project.
  emailLinksPerIp: { limit: 60, window: 60 },
  signupsPerIp: { limit: 10, window: 600 },
  signupsPerProject: { limit: 300, window: 3600 },
  confirmMailsPerAddress: { limit: 3, window: 86400 },
  // Email-only users. Carrier NAT puts many phones behind one address, so the IP caps are generous;
  // the per-address ones are what stop someone mailing codes to a stranger.
  anonSessionsPerIp: { limit: 30, window: 3600 },
  anonSessionsPerProject: { limit: 1000, window: 3600 },
  anonCodeMailsPerAddress: { limit: 5, window: 86400 },
  anonCodesPerIp: { limit: 30, window: 3600 },
  anonConfirmPerIp: { limit: 60, window: 3600 },
  anonConfirmPerAddress: { limit: 20, window: 3600 },
  campaignTestsPerAgent: { limit: 20, window: 600 },
  // Hosted legal pages are read by crawlers and every app launch that links to them.
  legalReadsPerIp: { limit: 600, window: 60 },
  legalAiPerAgent: { limit: 10, window: 60 },
  // Auto-translation: each request is a few model calls per language.
  translatePerAgent: { limit: 10, window: 60 },
  // Each scan reads up to ten repos from GitHub.
  legalScanPerAgent: { limit: 6, window: 60 },
  // Every first launch of an app reads its onboarding; carrier NAT puts many phones behind one address.
  onboardingReadsPerIp: { limit: 1200, window: 60 },
  // Lead forms load on every page view of the site they sit on.
  leadFormReadsPerIp: { limit: 1200, window: 60 },
  // Multipart sign-ups carry files: counted before the body is read, so nobody streams in gigabytes.
  leadFormUploadsPerIp: { limit: 20, window: 600 },
  brandReadsPerIp: { limit: 600, window: 60 },
  // The hub page, its JSON twin and the loader: helpbites.js reads the loader on every page view of a site.
  hubReadsPerIp: { limit: 1200, window: 60 },
  // Pages and the CMS delivery API: a site build can read many entries at once.
  cmsReadsPerIp: { limit: 1200, window: 60 }
} as const
