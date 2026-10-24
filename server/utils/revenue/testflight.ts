import { createError } from 'h3'
import type { TestflightCounts, TestflightReport } from '#shared/revenue'
import { appleToken, parseCredentials } from './apple'
import type { Credentials } from './types'

// TestFlight usage from the same App Store Connect key as the Sales reports (read only): the
// account's apps, each app's newest builds, and every build's beta usage metrics
// (GET /v1/builds/{id}/metrics/betaBuildUsages: installs, sessions, crashes, invites, feedback,
// one data point per day). The key needs a role that can see the apps (Developer, App Manager or
// Admin); a key limited to Sales and Reports is answered 403.

const API = 'https://api.appstoreconnect.apple.com/v1'
const MAX_APPS = 10
const BUILDS_PER_APP = 8
const PARALLEL = 8
const CACHE_MS = 10 * 60_000

type Resource = { id: string, attributes?: Record<string, any>, relationships?: Record<string, { data?: { id: string } | null }> }
type Page = { data: Resource[], included?: Resource[] }
type Usage = { data?: { dataPoints?: { values?: Partial<Record<'installCount' | 'sessionCount' | 'crashCount' | 'inviteCount' | 'feedbackCount', number>> }[] }[] }

/** null for a 404: a build Apple keeps no metrics for (expired long ago) is not an error. */
async function ascGet<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { errors?: { detail?: string, title?: string }[] }
    const why = body.errors?.[0]?.detail || body.errors?.[0]?.title || res.statusText
    const hint = res.status === 401 || res.status === 403 ? ' (the key needs a role that can see apps and TestFlight, such as Developer or App Manager)' : ''
    throw createError({ statusCode: 502, statusMessage: `Apple answered ${res.status}: ${String(why).slice(0, 200)}${hint}` })
  }
  return await res.json() as T
}

const none = (): TestflightCounts => ({ installs: 0, sessions: 0, crashes: 0, invites: 0, feedback: 0 })
const add = (a: TestflightCounts, b: TestflightCounts) => { a.installs += b.installs; a.sessions += b.sessions; a.crashes += b.crashes; a.invites += b.invites; a.feedback += b.feedback; return a }

/** The sum of a build's daily data points. */
export function usageCounts(usage: Usage | null): TestflightCounts {
  const out = none()
  for (const series of usage?.data || []) {
    for (const point of series.dataPoints || []) {
      const v = point.values || {}
      add(out, { installs: v.installCount || 0, sessions: v.sessionCount || 0, crashes: v.crashCount || 0, invites: v.inviteCount || 0, feedback: v.feedbackCount || 0 })
    }
  }
  return out
}

/** Runs `fn` over `items`, at most `PARALLEL` at a time, keeping the order. */
async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += PARALLEL) out.push(...await Promise.all(items.slice(i, i + PARALLEL).map(fn)))
  return out
}

export async function testflightReport(credentials: Credentials): Promise<TestflightReport> {
  const token = await appleToken(parseCredentials(credentials))
  const apps = (await ascGet<Page>(token, `/apps?limit=${MAX_APPS}&fields[apps]=name,bundleId`))?.data || []
  const builds = await inBatches(apps, async (app) => {
    const page = await ascGet<Page>(token, `/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=${BUILDS_PER_APP}&include=preReleaseVersion&fields[builds]=version,uploadedDate,expired,preReleaseVersion&fields[preReleaseVersions]=version`)
    const short = new Map((page?.included || []).map(r => [r.id, String(r.attributes?.version || '')]))
    return (page?.data || []).map(b => ({ app: app.id, id: b.id, version: short.get(b.relationships?.preReleaseVersion?.data?.id || '') || '', build: String(b.attributes?.version || ''), uploadedAt: (b.attributes?.uploadedDate as string) || null, expired: b.attributes?.expired === true }))
  })
  const flat = builds.flat()
  const counts = await inBatches(flat, b => ascGet<Usage>(token, `/builds/${b.id}/metrics/betaBuildUsages?limit=200`).then(usageCounts))
  const totals = none()
  return {
    apps: apps.map((app) => {
      const own = flat.flatMap((b, i) => (b.app === app.id ? [{ ...b, ...counts[i]! }] : []))
      const sum = none()
      for (const b of own) add(sum, b)
      add(totals, sum)
      return { id: app.id, name: String(app.attributes?.name || app.id), bundleId: String(app.attributes?.bundleId || ''), totals: sum, builds: own.map(({ app: _app, ...b }) => b) }
    }),
    totals
  }
}

// ponytail: one process remembers it (a few minutes); a shared cache if the panel is ever polled by many replicas.
const cache = new Map<string, { at: number, report: TestflightReport }>()
export async function cachedTestflightReport(key: string, credentials: Credentials, fresh = false): Promise<TestflightReport> {
  const hit = cache.get(key)
  if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return hit.report
  const report = await testflightReport(credentials)
  cache.set(key, { at: Date.now(), report })
  return report
}
